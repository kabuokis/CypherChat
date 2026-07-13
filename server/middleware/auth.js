'use strict';

const fp = require('fastify-plugin');
const pool = require('../db');

module.exports = fp(async function (fastify, opts) {
  fastify.decorate('authenticate', async function (request, reply) {
    try {
      await request.jwtVerify();
    } catch (err) {
      reply.code(401).send({ error: 'Authentication required' });
      return;
    }

    const { userId, usernameHash, sessionId, sessionToken } = request.user;

    if (!userId || !usernameHash || !sessionId || !sessionToken) {
      reply.code(401).send({ error: 'Authentication required' });
      return;
    }

    const crypto = require('crypto');
    const tokenHash = crypto.createHash('sha256').update(sessionToken).digest();

    const result = await pool.query(
      'SELECT id FROM sessions WHERE id = $1 AND user_id = $2 AND token_hash = $3',
      [sessionId, userId, tokenHash]
    );

    if (result.rows.length === 0) {
      reply.code(401).send({ error: 'Authentication required' });
      return;
    }

    await pool.query(
      'UPDATE sessions SET last_seen = NOW() WHERE id = $1',
      [sessionId]
    );

    fastify.log.info(`[AUTH] usernameHash from JWT (b64): ${usernameHash ? usernameHash.substring(0, 30) + '...' : 'NULL'}`);
    request.userId = userId;
    request.usernameHash = usernameHash;
    request.sessionId = sessionId;
  });
});
