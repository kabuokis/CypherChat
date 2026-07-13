'use strict';

const pool = require('../db');

module.exports = async function (fastify, opts) {

  // POST /api/messages/send — authenticated
  fastify.post('/send', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      const { recipientUsernameHash, ciphertextBlob, ephemeralPublicKey, paddingSize, expiresAt } = request.body;

      if (!recipientUsernameHash || !ciphertextBlob || !ephemeralPublicKey) {
        return reply.code(400).send({ error: 'Missing required fields' });
      }

      const recipientBuf = Buffer.from(recipientUsernameHash, 'base64');
      fastify.log.info(`[MSG SEND] recipientUsernameHash (b64): ${recipientUsernameHash.substring(0, 30)}...`);
      fastify.log.info(`[MSG SEND] recipientBuf hex: ${recipientBuf.toString('hex').substring(0, 32)}...`);
      fastify.log.info(`[MSG SEND] recipientBuf length: ${recipientBuf.length}`);
      const cipherBuf = Buffer.from(ciphertextBlob, 'base64');
      const ephPubBuf = Buffer.from(ephemeralPublicKey, 'base64');
      const padSize = paddingSize || 1024;
      const expires = expiresAt ? new Date(expiresAt) : null;

      try {
        await pool.query(
          `INSERT INTO messages (recipient_username_hash, ciphertext_blob, ephemeral_public_key, padding_size, expires_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [recipientBuf, cipherBuf, ephPubBuf, padSize, expires]
        );
        return reply.code(201).send({ success: true });
      } catch (err) {
        fastify.log.error(err);
        return reply.code(500).send({ error: 'Failed to send message' });
      }
    }
  });

  // GET /api/messages/inbox — authenticated
  fastify.get('/inbox', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        // Delete expired messages first
        await pool.query('DELETE FROM messages WHERE expires_at IS NOT NULL AND expires_at <= NOW()');

        fastify.log.info(`[MSG INBOX] Querying for recipient hash (b64): ${request.usernameHash.substring(0, 30)}...`);
        fastify.log.info(`[MSG INBOX] Decoded hex: ${Buffer.from(request.usernameHash, 'base64').toString('hex').substring(0, 32)}...`);
        const result = await pool.query(
          `SELECT id, ciphertext_blob, ephemeral_public_key, padding_size, sequence_number, expires_at, created_at
           FROM messages
           WHERE recipient_username_hash = $1 AND delivered = FALSE
           ORDER BY sequence_number ASC
           LIMIT 100`,
          [Buffer.from(request.usernameHash, 'base64')]
        );

        fastify.log.info(`[MSG INBOX] Found ${result.rows.length} messages`);
        const messages = result.rows.map(row => ({
          id: row.id,
          ciphertextBlob: row.ciphertext_blob.toString('base64'),
          ephemeralPublicKey: row.ephemeral_public_key.toString('base64'),
          paddingSize: row.padding_size,
          sequenceNumber: row.sequence_number,
          expiresAt: row.expires_at,
          createdAt: row.created_at
        }));

        // Mark as delivered
        if (result.rows.length > 0) {
          const ids = result.rows.map(r => r.id);
          await pool.query(
            `UPDATE messages SET delivered = TRUE WHERE id = ANY($1)`,
            [ids]
          );
        }

        return reply.code(200).send({ messages });
      } catch (err) {
        fastify.log.error(err);
        return reply.code(500).send({ error: 'Failed to fetch messages' });
      }
    }
  });

  // DELETE /api/messages/:id — authenticated
  fastify.delete('/:id', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      const { id } = request.params;
      try {
        fastify.log.info(`[MSG INBOX] Querying for recipient hash (b64): ${request.usernameHash.substring(0, 30)}...`);
        fastify.log.info(`[MSG INBOX] Decoded hex: ${Buffer.from(request.usernameHash, 'base64').toString('hex').substring(0, 32)}...`);
        const result = await pool.query(
          `DELETE FROM messages WHERE id = $1 AND recipient_username_hash = $2 RETURNING id`,
          [id, Buffer.from(request.usernameHash, 'base64')]
        );
        if (result.rowCount === 0) {
          return reply.code(404).send({ error: 'Message not found' });
        }
        return reply.code(200).send({ success: true });
      } catch (err) {
        fastify.log.error(err);
        return reply.code(500).send({ error: 'Failed to delete message' });
      }
    }
  });
};
