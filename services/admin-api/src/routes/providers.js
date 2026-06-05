const pool = require('../db/pool');

/**
 * Provider Management Routes
 * Users bring their own provider API keys — the platform discovers models automatically.
 */
async function routes(fastify) {

  // ── List all providers ──
  fastify.get('/providers', async () => {
    const { rows } = await pool.query(`
      SELECT p.id, p.name, p.display_name, p.base_url, p.api_key_prefix, p.status,
             p.models, p.config, p.last_verified, p.created_at, p.updated_at,
             u.name as added_by_name, u.email as added_by_email,
        (SELECT COUNT(*) FROM virtual_keys vk WHERE vk.provider_id = p.id AND vk.status = 'active') as active_keys,
        (SELECT COALESCE(SUM(ce.cost_usd), 0) FROM cost_events ce WHERE ce.provider = p.name AND ce.created_at >= now() - interval '30 days') as cost_30d,
        (SELECT COALESCE(AVG(ce.latency_ms), 0) FROM cost_events ce WHERE ce.provider = p.name AND ce.created_at >= now() - interval '7 days') as avg_latency_7d,
        (SELECT COUNT(*) FROM cost_events ce WHERE ce.provider = p.name AND ce.status_code >= 400 AND ce.created_at >= now() - interval '7 days') as errors_7d,
        (SELECT COUNT(*) FROM cost_events ce WHERE ce.provider = p.name AND ce.created_at >= now() - interval '7 days') as requests_7d
      FROM providers p
      LEFT JOIN users u ON p.added_by = u.id
      ORDER BY p.created_at ASC
    `);

    // Never expose api_key_encrypted to the frontend
    return {
      data: rows.map(r => ({
        ...r,
        cost_30d: parseFloat(r.cost_30d),
        avg_latency_7d: Math.round(parseFloat(r.avg_latency_7d)),
        error_rate_7d: r.requests_7d > 0 ? parseFloat((r.errors_7d / r.requests_7d * 100).toFixed(2)) : 0,
      }))
    };
  });

  // ── Get single provider (no API key exposed) ──
  fastify.get('/providers/:id', async (request, reply) => {
    const { rows } = await pool.query(
      `SELECT id, name, display_name, base_url, api_key_prefix, status, models, config, last_verified, created_at, updated_at
       FROM providers WHERE id = $1`,
      [request.params.id]
    );
    if (rows.length === 0) return reply.status(404).send({ error: 'Provider not found' });
    return { data: rows[0] };
  });

  // ── Add Provider (user provides their API key + base URL) ──
  fastify.post('/providers', async (request, reply) => {
    const { name, display_name, base_url, api_key, config = {} } = request.body;

    if (!name || !base_url || !api_key) {
      return reply.status(400).send({ error: 'name, base_url, and api_key are required' });
    }

    // Check duplicate
    const existing = await pool.query('SELECT id FROM providers WHERE name = $1', [name.toLowerCase()]);
    if (existing.rows.length > 0) {
      return reply.status(409).send({ error: `Provider "${name}" already exists. Use PATCH to update.` });
    }

    // Create prefix for display (e.g., "sk-proj-Abc1" → "sk-proj-••••")
    const apiKeyPrefix = api_key.length > 8 ? api_key.substring(0, 8) + '••••' : api_key.substring(0, 4) + '••••';

    // Try to discover models from the provider
    let discoveredModels = [];
    let providerStatus = 'active';
    try {
      discoveredModels = await discoverModels(name.toLowerCase(), base_url, api_key);
    } catch (err) {
      fastify.log.warn(`Model discovery failed for ${name}: ${err.message}`);
      providerStatus = 'error';
    }

    const { rows } = await pool.query(`
      INSERT INTO providers (name, display_name, base_url, api_key_encrypted, api_key_prefix, status, models, config, last_verified)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
      RETURNING id, name, display_name, base_url, api_key_prefix, status, models, config, last_verified, created_at
    `, [
      name.toLowerCase(),
      display_name || name,
      base_url,
      api_key, // TODO: encrypt with AES-256 in production
      apiKeyPrefix,
      providerStatus,
      JSON.stringify(discoveredModels),
      JSON.stringify(config),
    ]);

    return reply.status(201).send({
      data: rows[0],
      models_discovered: discoveredModels.length,
      message: discoveredModels.length > 0
        ? `Provider added with ${discoveredModels.length} models discovered`
        : 'Provider added but model discovery failed. Check your API key and base URL.',
    });
  });

  // ── Refresh Models (re-discover from provider API) ──
  fastify.post('/providers/:id/discover-models', async (request, reply) => {
    const { rows } = await pool.query('SELECT * FROM providers WHERE id = $1', [request.params.id]);
    if (rows.length === 0) return reply.status(404).send({ error: 'Provider not found' });

    const provider = rows[0];

    try {
      const models = await discoverModels(provider.name, provider.base_url, provider.api_key_encrypted);

      await pool.query(
        `UPDATE providers SET models = $1, status = 'active', last_verified = now(), updated_at = now() WHERE id = $2`,
        [JSON.stringify(models), provider.id]
      );

      return { data: { models, count: models.length }, message: `Discovered ${models.length} models` };
    } catch (err) {
      await pool.query(
        `UPDATE providers SET status = 'error', updated_at = now() WHERE id = $1`,
        [provider.id]
      );
      return reply.status(502).send({ error: `Model discovery failed: ${err.message}` });
    }
  });

  // ── Update provider config ──
  fastify.patch('/providers/:id', async (request, reply) => {
    const { status, config, api_key, base_url, display_name } = request.body;
    const updates = [];
    const params = [];
    let idx = 1;

    if (display_name) { updates.push(`display_name = $${idx++}`); params.push(display_name); }
    if (base_url) { updates.push(`base_url = $${idx++}`); params.push(base_url); }
    if (status) { updates.push(`status = $${idx++}`); params.push(status); }
    if (config) { updates.push(`config = $${idx++}`); params.push(JSON.stringify(config)); }
    if (api_key) {
      updates.push(`api_key_encrypted = $${idx++}`);
      params.push(api_key); // TODO: encrypt
      const prefix = api_key.length > 8 ? api_key.substring(0, 8) + '••••' : api_key.substring(0, 4) + '••••';
      updates.push(`api_key_prefix = $${idx++}`);
      params.push(prefix);
    }

    if (updates.length === 0) {
      return reply.status(400).send({ error: 'No fields to update' });
    }

    updates.push(`updated_at = now()`);
    params.push(request.params.id);

    const { rows } = await pool.query(
      `UPDATE providers SET ${updates.join(', ')} WHERE id = $${idx}
       RETURNING id, name, display_name, base_url, api_key_prefix, status, models, config, last_verified`,
      params
    );

    if (rows.length === 0) return reply.status(404).send({ error: 'Provider not found' });
    return { data: rows[0] };
  });

  // ── Delete provider ──
  fastify.delete('/providers/:id', async (request, reply) => {
    // Check if any active virtual keys reference this provider
    const keysCheck = await pool.query(
      `SELECT COUNT(*) FROM virtual_keys WHERE provider_id = $1 AND status = 'active'`,
      [request.params.id]
    );
    if (parseInt(keysCheck.rows[0].count) > 0) {
      return reply.status(409).send({
        error: 'Cannot delete provider with active virtual keys. Revoke keys first.'
      });
    }

    const { rows } = await pool.query('DELETE FROM providers WHERE id = $1 RETURNING id, name', [request.params.id]);
    if (rows.length === 0) return reply.status(404).send({ error: 'Provider not found' });
    return { data: rows[0], message: 'Provider deleted' };
  });

  // ── Get provider API key (internal only — for gateway) ──
  fastify.get('/internal/providers/:id/key', async (request, reply) => {
    const { rows } = await pool.query(
      'SELECT api_key_encrypted, base_url, name FROM providers WHERE id = $1 AND status = $2',
      [request.params.id, 'active']
    );
    if (rows.length === 0) return reply.status(404).send({ error: 'Provider not found or inactive' });
    return { data: rows[0] };
  });
}

// ═══════════════════════════════════════════════
// Model Discovery — call provider's API to list available models
// ═══════════════════════════════════════════════
async function discoverModels(providerName, baseUrl, apiKey) {
  const normalized = providerName.toLowerCase();

  // ── Gemini ──
  if (normalized.includes('gemini') || normalized.includes('google') || baseUrl.includes('googleapis.com')) {
    return discoverGeminiModels(baseUrl, apiKey);
  }

  // ── OpenAI / OpenAI-compatible (Azure, Groq, Together, etc.) ──
  if (normalized.includes('openai') || normalized.includes('azure') ||
      normalized.includes('groq') || normalized.includes('together') ||
      normalized.includes('deepseek') || normalized.includes('mistral')) {
    return discoverOpenAIModels(baseUrl, apiKey);
  }

  // ── Anthropic ──
  if (normalized.includes('anthropic') || normalized.includes('claude') || baseUrl.includes('anthropic.com')) {
    return discoverAnthropicModels(baseUrl, apiKey);
  }

  // ── Default: try OpenAI-compatible /v1/models ──
  try {
    return await discoverOpenAIModels(baseUrl, apiKey);
  } catch {
    return [];
  }
}

async function discoverGeminiModels(baseUrl, apiKey) {
  const url = `${baseUrl.replace(/\/$/, '')}/v1beta/models?key=${apiKey}`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });

  if (!resp.ok) throw new Error(`Gemini API returned ${resp.status}: ${await resp.text()}`);

  const data = await resp.json();
  if (!data.models) return [];

  return data.models
    .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
    .map(m => ({
      id: m.name.replace('models/', ''),
      name: m.displayName || m.name,
      description: m.description || '',
      input_token_limit: m.inputTokenLimit,
      output_token_limit: m.outputTokenLimit,
    }));
}

async function discoverOpenAIModels(baseUrl, apiKey) {
  const url = `${baseUrl.replace(/\/$/, '')}/v1/models`;
  const resp = await fetch(url, {
    headers: { 'Authorization': `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(10000),
  });

  if (!resp.ok) throw new Error(`OpenAI API returned ${resp.status}: ${await resp.text()}`);

  const data = await resp.json();
  if (!data.data) return [];

  return data.data.map(m => ({
    id: m.id,
    name: m.id,
    owned_by: m.owned_by || 'unknown',
  }));
}

async function discoverAnthropicModels(baseUrl, apiKey) {
  // Anthropic doesn't have a public /models endpoint yet — return known models
  // We verify the key works by making a minimal completions call
  const url = `${baseUrl.replace(/\/$/, '')}/v1/messages`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-3-haiku-20240307',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'hi' }],
    }),
    signal: AbortSignal.timeout(10000),
  });

  // If we get a response (even 400 for wrong format), the key works
  if (resp.status === 401 || resp.status === 403) {
    throw new Error('Invalid API key');
  }

  return [
    { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4' },
    { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
    { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku' },
    { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus' },
  ];
}

module.exports = routes;
