const pool = require('../db/pool');

/**
 * Analytics & Cost Routes
 */
async function routes(fastify) {

  // ── Cost Overview (KPI summary) ──
  fastify.get('/analytics/overview', async (request) => {
    const { period = '30d' } = request.query;
    const days = parseInt(period) || 30;

    const [totalSpend, requestsToday, activeKeys, avgLatency, dailyCosts] = await Promise.all([
      // Total spend in period
      pool.query(`
        SELECT COALESCE(SUM(cost_usd), 0) as total_spend,
               COUNT(*) as total_requests,
               COALESCE(SUM(total_tokens), 0) as total_tokens
        FROM cost_events
        WHERE created_at >= now() - interval '${days} days'
      `),
      // Requests today
      pool.query(`
        SELECT COUNT(*) as count, COALESCE(SUM(cost_usd), 0) as cost
        FROM cost_events
        WHERE created_at >= CURRENT_DATE
      `),
      // Active keys
      pool.query(`SELECT COUNT(*) as count FROM virtual_keys WHERE status = 'active'`),
      // Avg latency
      pool.query(`
        SELECT COALESCE(AVG(latency_ms), 0) as avg_latency
        FROM cost_events
        WHERE created_at >= now() - interval '${days} days'
      `),
      // Daily cost breakdown
      pool.query(`
        SELECT DATE(created_at) as date,
               SUM(cost_usd) as cost,
               COUNT(*) as requests,
               SUM(total_tokens) as tokens
        FROM cost_events
        WHERE created_at >= now() - interval '${days} days'
        GROUP BY DATE(created_at)
        ORDER BY date ASC
      `)
    ]);

    return {
      data: {
        totalSpend: parseFloat(totalSpend.rows[0].total_spend),
        totalRequests: parseInt(totalSpend.rows[0].total_requests),
        totalTokens: parseInt(totalSpend.rows[0].total_tokens),
        requestsToday: parseInt(requestsToday.rows[0].count),
        costToday: parseFloat(requestsToday.rows[0].cost),
        activeKeys: parseInt(activeKeys.rows[0].count),
        avgLatency: Math.round(parseFloat(avgLatency.rows[0].avg_latency)),
        dailyCosts: dailyCosts.rows.map(r => ({
          date: r.date,
          cost: parseFloat(r.cost),
          requests: parseInt(r.requests),
          tokens: parseInt(r.tokens),
        })),
      }
    };
  });

  // ── Cost by model ──
  fastify.get('/analytics/cost', async (request) => {
    const { period = '30d', group_by = 'model' } = request.query;
    const days = parseInt(period) || 30;

    const groupCol = ['model', 'provider', 'user_id'].includes(group_by) ? group_by : 'model';

    const { rows } = await pool.query(`
      SELECT ${groupCol},
             SUM(cost_usd) as total_cost,
             COUNT(*) as request_count,
             SUM(prompt_tokens) as prompt_tokens,
             SUM(completion_tokens) as completion_tokens,
             SUM(total_tokens) as total_tokens,
             AVG(latency_ms) as avg_latency
      FROM cost_events
      WHERE created_at >= now() - interval '${days} days'
      GROUP BY ${groupCol}
      ORDER BY total_cost DESC
    `);

    return {
      data: rows.map(r => ({
        [groupCol]: r[groupCol],
        totalCost: parseFloat(r.total_cost),
        requestCount: parseInt(r.request_count),
        promptTokens: parseInt(r.prompt_tokens),
        completionTokens: parseInt(r.completion_tokens),
        totalTokens: parseInt(r.total_tokens),
        avgLatency: Math.round(parseFloat(r.avg_latency)),
      }))
    };
  });

  // ── Token usage over time ──
  fastify.get('/analytics/tokens', async (request) => {
    const { period = '30d', model } = request.query;
    const days = parseInt(period) || 30;

    let query = `
      SELECT DATE(created_at) as date, model,
             SUM(prompt_tokens) as prompt_tokens,
             SUM(completion_tokens) as completion_tokens,
             SUM(total_tokens) as total_tokens
      FROM cost_events
      WHERE created_at >= now() - interval '${days} days'
    `;
    const params = [];
    if (model) { params.push(model); query += ` AND model = $1`; }
    query += ` GROUP BY DATE(created_at), model ORDER BY date ASC`;

    const { rows } = await pool.query(query, params);
    return { data: rows };
  });

  // ── Prompt logs (paginated + searchable) ──
  fastify.get('/analytics/logs', async (request) => {
    const { page = 1, limit = 25, model, user_id, search } = request.query;
    const offset = (page - 1) * limit;
    const params = [];
    let whereClause = 'WHERE 1=1';

    if (model) { params.push(model); whereClause += ` AND pl.model = $${params.length}`; }
    if (user_id) { params.push(user_id); whereClause += ` AND pl.user_id = $${params.length}`; }
    if (search) { params.push(`%${search}%`); whereClause += ` AND (pl.prompt_preview ILIKE $${params.length} OR pl.response_preview ILIKE $${params.length})`; }

    params.push(limit, offset);
    const { rows } = await pool.query(`
      SELECT pl.*, u.name as user_name, u.email as user_email
      FROM prompt_logs pl
      LEFT JOIN users u ON pl.user_id = u.id
      ${whereClause}
      ORDER BY pl.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    const countResult = await pool.query(`SELECT COUNT(*) FROM prompt_logs pl ${whereClause}`, params.slice(0, -2));

    return {
      data: rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].count),
      }
    };
  });

  // ── Top consumers ──
  fastify.get('/analytics/top-consumers', async (request) => {
    const { period = '30d', limit = 10 } = request.query;
    const days = parseInt(period) || 30;

    const { rows } = await pool.query(`
      SELECT u.id, u.name, u.email,
             SUM(ce.cost_usd) as total_cost,
             COUNT(*) as request_count,
             SUM(ce.total_tokens) as total_tokens
      FROM cost_events ce
      JOIN users u ON ce.user_id = u.id
      WHERE ce.created_at >= now() - interval '${days} days'
      GROUP BY u.id, u.name, u.email
      ORDER BY total_cost DESC
      LIMIT $1
    `, [parseInt(limit)]);

    return {
      data: rows.map(r => ({
        id: r.id, name: r.name, email: r.email,
        totalCost: parseFloat(r.total_cost),
        requestCount: parseInt(r.request_count),
        totalTokens: parseInt(r.total_tokens),
      }))
    };
  });
}

module.exports = routes;
