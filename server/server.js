import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pool from './db.js';
import authRoutes from './routes/auth.js';
import messageRoutes from './routes/messages.js';
import contactRoutes from './routes/contacts.js';
import blobRoutes from './routes/blobs.js';
import serverRoutes from './routes/servers.js';
import channelRoutes from './routes/channels.js';
import inviteRoutes from './routes/invites.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '.env');
dotenv.config({ path: envPath });

if (!process.env.DATABASE_URL) {
  console.error('FATAL: DATABASE_URL not set in .env');
  process.exit(1);
}

const app = Fastify({
  logger: { level: 'warn' },
  trustProxy: true
});

app.addHook('onRequest', async (request, reply) => {
  request.log.warn({ path: request.raw.url }, 'request');
});

await app.register(cors, {
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true
});

await app.register(jwt, {
  secret: process.env.JWT_SECRET || 'dev-secret-change-me-32-bytes-long!!'
});

await app.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute'
});

app.decorate('authenticate', async (request, reply) => {
  try {
    await request.jwtVerify();
  } catch (err) {
    reply.code(401).send({ error: 'Unauthorized' });
  }
});

app.decorate('db', pool);

await app.register(authRoutes, { prefix: '/api/auth' });
await app.register(messageRoutes, { prefix: '/api/messages' });
await app.register(contactRoutes, { prefix: '/api/contacts' });
await app.register(blobRoutes, { prefix: '/api/blobs' });
await app.register(serverRoutes, { prefix: '/api/servers' });
await app.register(channelRoutes, { prefix: '/api/channels' });
await app.register(inviteRoutes, { prefix: '/api/invites' });

setInterval(async () => {
  try {
    await pool.query('DELETE FROM challenges WHERE expires_at < NOW()');
    await pool.query('DELETE FROM messages WHERE delivered = TRUE OR expires_at < NOW()');
    await pool.query('DELETE FROM blobs WHERE expires_at < NOW()');
    await pool.query('DELETE FROM invites WHERE expires_at < NOW()');
  } catch (e) {
    console.error('Cleanup error:', e.message);
  }
}, 60000);

await app.listen({ port: 3000, host: '0.0.0.0' });
console.log('Server listening on http://localhost:3000');