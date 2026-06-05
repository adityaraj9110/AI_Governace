const pool = require('../db/pool');

/**
 * User Management Routes
 */
async function routes(fastify) {

  // ── List users ──
  fastify.get('/users', async (request) => {
    const { role, status = 'active' } = request.query;
    let query = 'SELECT id, email, name, role, avatar_url, status, last_login, created_at FROM users WHERE 1=1';
    const params = [];

    if (status) { params.push(status); query += ` AND status = $${params.length}`; }
    if (role) { params.push(role); query += ` AND role = $${params.length}`; }

    query += ' ORDER BY created_at DESC';
    const { rows } = await pool.query(query, params);
    return { data: rows };
  });

  // ── Get single user ──
  fastify.get('/users/:id', async (request, reply) => {
    const { rows } = await pool.query(
      'SELECT id, email, name, role, avatar_url, status, last_login, created_at FROM users WHERE id = $1',
      [request.params.id]
    );
    if (rows.length === 0) return reply.status(404).send({ error: 'User not found' });
    return { data: rows[0] };
  });

  // ── Create user ──
  fastify.post('/users', async (request, reply) => {
    const { email, name, role = 'viewer', password } = request.body;
    if (!email || !name) {
      return reply.status(400).send({ error: 'Email and name are required' });
    }

    // Check duplicate
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return reply.status(409).send({ error: 'User with this email already exists' });
    }

    let passwordHash = null;
    if (password) {
      const bcrypt = require('bcrypt');
      passwordHash = await bcrypt.hash(password, 10);
    }

    const { rows } = await pool.query(`
      INSERT INTO users (email, name, role, password_hash)
      VALUES ($1, $2, $3, $4)
      RETURNING id, email, name, role, status, created_at
    `, [email, name, role, passwordHash]);

    return reply.status(201).send({ data: rows[0] });
  });

  // ── Update user ──
  fastify.patch('/users/:id', async (request, reply) => {
    const { name, role, status } = request.body;
    const updates = [];
    const params = [];
    let idx = 1;

    if (name) { updates.push(`name = $${idx++}`); params.push(name); }
    if (role) { updates.push(`role = $${idx++}`); params.push(role); }
    if (status) { updates.push(`status = $${idx++}`); params.push(status); }

    if (updates.length === 0) {
      return reply.status(400).send({ error: 'No fields to update' });
    }

    updates.push(`updated_at = now()`);
    params.push(request.params.id);

    const { rows } = await pool.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${idx} RETURNING id, email, name, role, status`,
      params
    );

    if (rows.length === 0) return reply.status(404).send({ error: 'User not found' });
    return { data: rows[0] };
  });

  // ── Deactivate user ──
  fastify.delete('/users/:id', async (request, reply) => {
    const { rows } = await pool.query(
      `UPDATE users SET status = 'inactive', updated_at = now() WHERE id = $1 RETURNING id, email, name, status`,
      [request.params.id]
    );
    if (rows.length === 0) return reply.status(404).send({ error: 'User not found' });
    return { data: rows[0], message: 'User deactivated' };
  });
}

module.exports = routes;
