const crypto = require('crypto');
const pool = require('../db/pool');

/**
 * Virtual Keys CRUD + Rotate
 */
async function routes(fastify) {

  // ── List all virtual keys ──
  fastify.get('/keys', async (request, reply) => {
    const { page = 1, limit = 50, status } = request.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT vk.*, u.name as user_name, u.email as user_email, p.display_name as provider_name
      FROM virtual_keys vk
      LEFT JOIN users u ON vk.user_id = u.id
      LEFT JOIN providers p ON vk.provider_id = p.id
    `;
    const params = [];

    if (status) {
      query += ` WHERE vk.status = $1`;
      params.push(status);
    }

    query += ` ORDER BY vk.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const { rows } = await pool.query(query, params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) FROM virtual_keys';
    if (status) countQuery += ` WHERE status = $1`;
    const countResult = await pool.query(countQuery, status ? [status] : []);

    return {
      data: rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].count),
      }
    };
  });

  // ── Get single key ──
  fastify.get('/keys/:id', async (request, reply) => {
    const { id } = request.params;
    const { rows } = await pool.query(`
      SELECT vk.*, u.name as user_name, u.email as user_email, p.display_name as provider_name
      FROM virtual_keys vk
      LEFT JOIN users u ON vk.user_id = u.id
      LEFT JOIN providers p ON vk.provider_id = p.id
      WHERE vk.id = $1
    `, [id]);

    if (rows.length === 0) {
      return reply.status(404).send({ error: 'Key not found' });
    }
    return { data: rows[0] };
  });

  // ── Create new virtual key ──
  fastify.post('/keys', async (request, reply) => {
    const { name, user_id, provider_id, config = {} } = request.body;

    if (!name) {
      return reply.status(400).send({ error: 'Name is required' });
    }

    // Generate virtual key: vk-<32 hex chars>
    const rawKey = `vk-${crypto.randomBytes(24).toString('hex')}`;
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const keyPrefix = rawKey.substring(0, 8);

    const { rows } = await pool.query(`
      INSERT INTO virtual_keys (name, key_prefix, key_hash, user_id, provider_id, config)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [name, keyPrefix, keyHash, user_id, provider_id, JSON.stringify(config)]);

    // Return the full key ONCE — it cannot be retrieved again
    return reply.status(201).send({
      data: rows[0],
      key: rawKey,
      warning: 'Store this key securely. It will not be shown again.'
    });
  });

  // ── Update key config ──
  fastify.patch('/keys/:id', async (request, reply) => {
    const { id } = request.params;
    const { name, config, status } = request.body;

    const updates = [];
    const params = [];
    let paramIdx = 1;

    if (name !== undefined) { updates.push(`name = $${paramIdx++}`); params.push(name); }
    if (config !== undefined) { updates.push(`config = $${paramIdx++}`); params.push(JSON.stringify(config)); }
    if (status !== undefined) {
      updates.push(`status = $${paramIdx++}`);
      params.push(status);
      if (status === 'revoked') {
        updates.push(`revoked_at = now()`);
      }
    }

    if (updates.length === 0) {
      return reply.status(400).send({ error: 'No fields to update' });
    }

    params.push(id);
    const { rows } = await pool.query(
      `UPDATE virtual_keys SET ${updates.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
      params
    );

    if (rows.length === 0) {
      return reply.status(404).send({ error: 'Key not found' });
    }
    return { data: rows[0] };
  });

  // ── Revoke key ──
  fastify.delete('/keys/:id', async (request, reply) => {
    const { id } = request.params;
    const { rows } = await pool.query(
      `UPDATE virtual_keys SET status = 'revoked', revoked_at = now() WHERE id = $1 RETURNING *`,
      [id]
    );
    if (rows.length === 0) {
      return reply.status(404).send({ error: 'Key not found' });
    }
    return { data: rows[0], message: 'Key revoked successfully' };
  });

  // ── Rotate key ──
  fastify.post('/keys/:id/rotate', async (request, reply) => {
    const { id } = request.params;

    // Get old key metadata
    const { rows: oldRows } = await pool.query('SELECT * FROM virtual_keys WHERE id = $1', [id]);
    if (oldRows.length === 0) {
      return reply.status(404).send({ error: 'Key not found' });
    }

    const oldKey = oldRows[0];

    // Revoke old key
    await pool.query(
      `UPDATE virtual_keys SET status = 'revoked', revoked_at = now() WHERE id = $1`,
      [id]
    );

    // Create new key with same config
    const rawKey = `vk-${crypto.randomBytes(24).toString('hex')}`;
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const keyPrefix = rawKey.substring(0, 8);

    const { rows: newRows } = await pool.query(`
      INSERT INTO virtual_keys (name, key_prefix, key_hash, user_id, provider_id, config)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [`${oldKey.name} (rotated)`, keyPrefix, keyHash, oldKey.user_id, oldKey.provider_id, JSON.stringify(oldKey.config)]);

    return {
      data: newRows[0],
      key: rawKey,
      rotated_from: id,
      warning: 'Store this key securely. It will not be shown again.'
    };
  });

  // ── Resolve key by hash (internal — used by gateway) ──
  fastify.get('/keys/resolve/:hash', async (request, reply) => {
    const { hash } = request.params;
    const { rows } = await pool.query(`
      SELECT vk.id, vk.provider_id, vk.user_id, vk.config, vk.status,
             p.name as provider_name, p.base_url
      FROM virtual_keys vk
      LEFT JOIN providers p ON vk.provider_id = p.id
      WHERE vk.key_hash = $1 AND vk.status = 'active'
    `, [hash]);

    if (rows.length === 0) {
      return reply.status(404).send({ error: 'Key not found or revoked' });
    }

    // Update last_used timestamp
    await pool.query('UPDATE virtual_keys SET last_used = now(), total_requests = total_requests + 1 WHERE id = $1', [rows[0].id]);

    return { data: rows[0] };
  });
}

module.exports = routes;
