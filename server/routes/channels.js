'use strict';

const pool = require('../db');

module.exports = async function (fastify, opts) {

  // POST /api/channels — create a channel
  fastify.post('/', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      const { serverId, nameCiphertext, nameNonce, isPrivate, requiredRole, encryptedKeys } = request.body;
      if (!serverId || !nameCiphertext || !nameNonce) {
        return reply.code(400).send({ error: 'Missing required fields' });
      }

      try {
        // Check admin/mod
        const memberCheck = await pool.query(
          'SELECT role FROM server_members WHERE server_id = $1 AND user_id = $2',
          [serverId, request.userId]
        );
        if (memberCheck.rows.length === 0 || !['admin', 'moderator'].includes(memberCheck.rows[0].role)) {
          return reply.code(403).send({ error: 'Insufficient permissions' });
        }

        const nameCipherBuf = Buffer.from(nameCiphertext, 'base64');
        const nameNonceBuf = Buffer.from(nameNonce, 'base64');

        const result = await pool.query(
          `INSERT INTO channels (server_id, name_ciphertext, name_nonce, is_private, required_role)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id`,
          [serverId, nameCipherBuf, nameNonceBuf, isPrivate || false, requiredRole || 'member']
        );
        const channelId = result.rows[0].id;

        // Store encrypted keys for each member
        if (Array.isArray(encryptedKeys)) {
          for (const ek of encryptedKeys) {
            await pool.query(
              `INSERT INTO channel_keys (channel_id, user_id, encrypted_key, key_version)
               VALUES ($1, $2, $3, 1)`,
              [channelId, ek.userId, Buffer.from(ek.encryptedKey, 'base64')]
            );
          }
        }

        return reply.code(201).send({ channelId });
      } catch (err) {
        fastify.log.error(err);
        return reply.code(500).send({ error: 'Failed to create channel' });
      }
    }
  });

  // GET /api/channels — list channels for a server
  fastify.get('/', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      const { serverId } = request.query;
      if (!serverId) {
        return reply.code(400).send({ error: 'serverId required' });
      }

      try {
        // Check membership
        const memberCheck = await pool.query(
          'SELECT role FROM server_members WHERE server_id = $1 AND user_id = $2',
          [serverId, request.userId]
        );
        if (memberCheck.rows.length === 0) {
          return reply.code(403).send({ error: 'Not a member' });
        }
        const myRole = memberCheck.rows[0].role;
        const roleRank = { admin: 3, moderator: 2, member: 1 };

        const result = await pool.query(
          `SELECT id, server_id, name_ciphertext, name_nonce, is_private, required_role, created_at
           FROM channels WHERE server_id = $1
           ORDER BY created_at ASC`,
          [serverId]
        );

        // Filter private channels based on role
        const channels = result.rows
          .filter(r => {
            if (!r.is_private) return true;
            return roleRank[myRole] >= roleRank[r.required_role];
          })
          .map(r => ({
            id: r.id,
            serverId: r.server_id,
            nameCiphertext: r.name_ciphertext.toString('base64'),
            nameNonce: r.name_nonce.toString('base64'),
            isPrivate: r.is_private,
            requiredRole: r.required_role,
            createdAt: r.created_at
          }));

        return reply.code(200).send({ channels });
      } catch (err) {
        fastify.log.error(err);
        return reply.code(500).send({ error: 'Failed to fetch channels' });
      }
    }
  });

  // GET /api/channels/keys — get my encrypted channel keys for a server
  fastify.get('/keys', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      const { serverId } = request.query;
      if (!serverId) {
        return reply.code(400).send({ error: 'serverId required' });
      }

      try {
        const result = await pool.query(
          `SELECT ck.channel_id, ck.encrypted_key, ck.key_version
           FROM channel_keys ck
           JOIN channels c ON ck.channel_id = c.id
           WHERE c.server_id = $1 AND ck.user_id = $2
           ORDER BY ck.key_version DESC`,
          [serverId, request.userId]
        );

        return reply.code(200).send({
          keys: result.rows.map(r => ({
            channelId: r.channel_id,
            encryptedKey: r.encrypted_key.toString('base64'),
            keyVersion: r.key_version
          }))
        });
      } catch (err) {
        fastify.log.error(err);
        return reply.code(500).send({ error: 'Failed to fetch keys' });
      }
    }
  });

  // POST /api/channels/:id/messages — send a message to a channel
  fastify.post('/:id/messages', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      const { id } = request.params;
      const { ciphertextBlob, nonce, signature, paddingSize } = request.body;
      if (!ciphertextBlob || !nonce || !signature) {
        return reply.code(400).send({ error: 'Missing required fields' });
      }

      try {
        // Check channel access
        const channelCheck = await pool.query(
          `SELECT c.server_id, c.is_private, c.required_role
           FROM channels c WHERE c.id = $1`,
          [id]
        );
        if (channelCheck.rows.length === 0) {
          return reply.code(404).send({ error: 'Channel not found' });
        }
        const channel = channelCheck.rows[0];

        const memberCheck = await pool.query(
          'SELECT role FROM server_members WHERE server_id = $1 AND user_id = $2',
          [channel.server_id, request.userId]
        );
        if (memberCheck.rows.length === 0) {
          return reply.code(403).send({ error: 'Not a member' });
        }
        const myRole = memberCheck.rows[0].role;
        const roleRank = { admin: 3, moderator: 2, member: 1 };

        if (channel.is_private && roleRank[myRole] < roleRank[channel.required_role]) {
          return reply.code(403).send({ error: 'Cannot access this channel' });
        }

        await pool.query(
          `INSERT INTO server_messages (channel_id, sender_id, ciphertext_blob, nonce, signature, padding_size)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [id, request.userId, Buffer.from(ciphertextBlob, 'base64'), Buffer.from(nonce, 'base64'), Buffer.from(signature, 'base64'), paddingSize || 1024]
        );

        return reply.code(201).send({ success: true });
      } catch (err) {
        fastify.log.error(err);
        return reply.code(500).send({ error: 'Failed to send message' });
      }
    }
  });

  // GET /api/channels/:id/messages — fetch messages from a channel
  fastify.get('/:id/messages', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      const { id } = request.params;
      const { limit = 50, before } = request.query;

      try {
        const channelCheck = await pool.query(
          `SELECT c.server_id, c.is_private, c.required_role
           FROM channels c WHERE c.id = $1`,
          [id]
        );
        if (channelCheck.rows.length === 0) {
          return reply.code(404).send({ error: 'Channel not found' });
        }
        const channel = channelCheck.rows[0];

        const memberCheck = await pool.query(
          'SELECT role FROM server_members WHERE server_id = $1 AND user_id = $2',
          [channel.server_id, request.userId]
        );
        if (memberCheck.rows.length === 0) {
          return reply.code(403).send({ error: 'Not a member' });
        }
        const myRole = memberCheck.rows[0].role;
        const roleRank = { admin: 3, moderator: 2, member: 1 };

        if (channel.is_private && roleRank[myRole] < roleRank[channel.required_role]) {
          return reply.code(403).send({ error: 'Cannot access this channel' });
        }

        let query = `SELECT id, sender_id, ciphertext_blob, nonce, signature, padding_size, sequence_number, created_at
                     FROM server_messages WHERE channel_id = $1`;
        const params = [id];
        if (before) {
          query += ` AND sequence_number < $2`;
          params.push(before);
        }
        query += ` ORDER BY sequence_number DESC LIMIT $${params.length + 1}`;
        params.push(Math.min(parseInt(limit), 100));

        const result = await pool.query(query, params);

        return reply.code(200).send({
          messages: result.rows.map(r => ({
            id: r.id,
            senderId: r.sender_id,
            ciphertextBlob: r.ciphertext_blob.toString('base64'),
            nonce: r.nonce.toString('base64'),
            signature: r.signature.toString('base64'),
            paddingSize: r.padding_size,
            sequenceNumber: r.sequence_number,
            createdAt: r.created_at
          }))
        });
      } catch (err) {
        fastify.log.error(err);
        return reply.code(500).send({ error: 'Failed to fetch messages' });
      }
    }
  });
};
