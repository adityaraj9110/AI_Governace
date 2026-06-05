require('dotenv').config();
const Fastify = require('fastify');
const cors = require('@fastify/cors');
const pool = require('./db/pool');

const app = Fastify({
  logger: {
    level: 'info',
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:HH:MM:ss' }
    }
  }
});

// ── Plugins ──
app.register(cors, {
  origin: ['http://localhost:3000', 'http://localhost:3001'],
  credentials: true,
});

// ── DB pool on request ──
app.decorate('db', pool);

// ── Health Check ──
app.get('/health', async () => {
  const { rows } = await pool.query('SELECT NOW() as time');
  return { status: 'ok', time: rows[0].time, service: 'admin-api' };
});

// ── Routes ──
app.register(require('./routes/keys'), { prefix: '/api/v1' });
app.register(require('./routes/users'), { prefix: '/api/v1' });
app.register(require('./routes/analytics'), { prefix: '/api/v1' });
app.register(require('./routes/providers'), { prefix: '/api/v1' });

// ── Start ──
const PORT = process.env.PORT || 3001;
app.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  app.log.info(`🚀 Admin API running on http://localhost:${PORT}`);
});

// ── Graceful shutdown ──
const shutdown = async () => {
  app.log.info('Shutting down...');
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
