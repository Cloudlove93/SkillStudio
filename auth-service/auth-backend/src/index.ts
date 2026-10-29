import cors from 'cors';
import express from 'express';
import authRoutes from './routes/auth.js';
import { config } from './config.js';
import { getLogger } from './logger.js';
import { startCleanup, stopCleanup } from './services/otp.js';

const app = express();
const log = getLogger('auth-service');

app.use(cors({
  origin: [
    `http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`,
    'http://auth.localhost',
    'http://localhost',
    'http://127.0.0.1',
  ],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Accept', 'Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '2mb' }));

app.get('/healthz', (_req, res) => {
  res.json({ ok: true });
});

app.use(authRoutes);

startCleanup();

const server = app.listen(config.port, config.host, () => {
  log.info({ host: config.host, port: config.port }, 'Auth service is listening');
});

function shutdown() {
  log.info('Shutting down');
  stopCleanup();
  server.close();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
