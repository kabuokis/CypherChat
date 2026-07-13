'use strict';

require('dotenv').config();
const fastify = require('fastify')({ logger: true });

async function start() {
  await fastify.register(require('@fastify/jwt'), {
    secret: process.env.JWT_SECRET || 'change-me-in-production-jwt-secret-32-bytes-long',
    cookie: { cookieName: 'token', signed: false }
  });

  await fastify.register(require('./middleware/auth'));
  await fastify.register(require('./routes/auth'), { prefix: '/api/auth' });
  await fastify.register(require('./routes/messages'), { prefix: '/api/messages' });
  await fastify.register(require('./routes/contacts'), { prefix: '/api/contacts' });
  await fastify.register(require('./routes/servers'), { prefix: '/api/servers' });
  await fastify.register(require('./routes/channels'), { prefix: '/api/channels' });

  fastify.setErrorHandler((error, request, reply) => {
    fastify.log.error(error);
    reply.status(error.statusCode || 500).send({
      error: error.message || 'Internal server error'
    });
  });

  const port = parseInt(process.env.PORT || '3000', 10);
  const host = process.env.HOST || '0.0.0.0';

  try {
    await fastify.listen({ port, host });
    fastify.log.info(`Server listening on ${host}:${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

start();
