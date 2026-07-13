'use strict';

const pool = require('../db');
const crypto = require('crypto');

const MAX_MEMBERS = 150;
const ROLES = ['admin', 'moderator', 'member'];
const ROLE_HIERARCHY = { admin: 3, moderator: 2, member: 1 };

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest();
}

function generateInviteToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function getServerKey() {
  const secret = process.env.SERVER_SECRET || 'change-me-in-production-server-secret-32-bytes';
  return crypto.scryptSync(secret, 'cypherchat-server-salt', 32);
}

function encryptServerData(plaintext) {
  const key = getServerKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

function decryptServerData(ciphertext) {
  const key = getServerKey();
  const data = Buffer.from(ciphertext, 'base64');
  const iv = data.subarray(0, 12);
  const authTag = data.subarray(12, 28);
  const encrypted = data.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

function canManageRole(actorRole, targetRole) {
  return ROLE_HIERARCHY[actorRole] > ROLE_HIERARCHY[targetRole];
}

module.exports = async function (fastify, opts) {

  // POST /api/servers — create a new server
  fastify.post('/', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      const { nameCiphertext, nameNonce, iconUrl } = request.body;
      if (!nameCiphertext || !nameNonce) {
        return reply.code(400).send({ error: 'Missing server name' });
      }

      const nameCipherBuf = Buffer.from(nameCiphertext, 'base64');
      const nameNonceBuf = Buffer.from(nameNonce, 'base64');

      try {
        const result = await pool.query(
          `INSERT INTO servers (name_ciphertext, name_nonce, icon_url, owner_id, member_count, max_members)
           VALUES ($1, $2, $3, $4, 1, $5)
           RETURNING id`,
          [nameCipherBuf, nameNonceBuf, iconUrl || null, request.userId, MAX_MEMBERS]
        );
        const serverId = result.rows[0].id;

        await pool.query(
          `INSERT INTO server_members (server_id, user_id, role)
           VALUES ($1, $2, 'admin')`,
          [serverId, request.userId]
        );

        return reply.code(201).send({ serverId });
      } catch (err) {
        fastify.log.error(err);
        return reply.code(500).send({ error: 'Failed to create server' });
      }
    }
  });

  // GET /api/servers — list servers user is a member of
  fastify.get('/', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const result = await pool.query(
          `SELECT s.id, s.name_ciphertext, s.name_nonce, s.icon_url, s.owner_id, s.member_count, s.max_members, sm.role
           FROM servers s
           JOIN server_members sm ON s.id = sm.server_id
           WHERE sm.user_id = $1
           ORDER BY s.created_at DESC`,
          [request.userId]
        );

        return reply.code(200).send({
          servers: result.rows.map(r => ({
            id: r.id,
            nameCiphertext: r.name_ciphertext.toString('base64'),
            nameNonce: r.name_nonce.toString('base64'),
            iconUrl: r.icon_url,
            ownerId: r.owner_id,
            memberCount: r.member_count,
            maxMembers: r.max_members,
            myRole: r.role
          }))
        });
      } catch (err) {
        fastify.log.error(err);
        return reply.code(500).send({ error: 'Failed to fetch servers' });
      }
    }
  });

  // GET /api/servers/:id — get server details
  fastify.get('/:id', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      const { id } = request.params;
      try {
        const memberCheck = await pool.query(
          'SELECT role FROM server_members WHERE server_id = $1 AND user_id = $2',
          [id, request.userId]
        );
        if (memberCheck.rows.length === 0) {
          return reply.code(403).send({ error: 'Not a member of this server' });
        }

        const result = await pool.query(
          `SELECT id, name_ciphertext, name_nonce, icon_url, owner_id, member_count, max_members
           FROM servers WHERE id = $1`,
          [id]
        );

        if (result.rows.length === 0) {
          return reply.code(404).send({ error: 'Server not found' });
        }

        const s = result.rows[0];
        return reply.code(200).send({
          id: s.id,
          nameCiphertext: s.name_ciphertext.toString('base64'),
          nameNonce: s.name_nonce.toString('base64'),
          iconUrl: s.icon_url,
          ownerId: s.owner_id,
          memberCount: s.member_count,
          maxMembers: s.max_members,
          myRole: memberCheck.rows[0].role
        });
      } catch (err) {
        fastify.log.error(err);
        return reply.code(500).send({ error: 'Failed to fetch server' });
      }
    }
  });

  // GET /api/servers/:id/members — list members
  fastify.get('/:id/members', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      const { id } = request.params;
      try {
        const memberCheck = await pool.query(
          'SELECT role FROM server_members WHERE server_id = $1 AND user_id = $2',
          [id, request.userId]
        );
        if (memberCheck.rows.length === 0) {
          return reply.code(403).send({ error: 'Not a member of this server' });
        }

        const result = await pool.query(
          `SELECT sm.id, sm.user_id, sm.role, sm.joined_at, sm.encrypted_username,
                  u.identity_public_key, u.signing_public_key
           FROM server_members sm
           JOIN users u ON sm.user_id = u.id
           WHERE sm.server_id = $1
           ORDER BY sm.joined_at ASC`,
          [id]
        );

        return reply.code(200).send({
          members: result.rows.map(m => ({
            id: m.id,
            userId: m.user_id,
            role: m.role,
            joinedAt: m.joined_at,
            encryptedUsername: m.encrypted_username ? m.encrypted_username.toString('base64') : null,
            identityPublicKey: m.identity_public_key.toString('base64'),
            signingPublicKey: m.signing_public_key.toString('base64')
          }))
        });
      } catch (err) {
        fastify.log.error(err);
        return reply.code(500).send({ error: 'Failed to fetch members' });
      }
    }
  });

  // POST /api/servers/:id/invite — generate invite link
  fastify.post('/:id/invite', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      const { id } = request.params;
      try {
        const memberCheck = await pool.query(
          'SELECT role FROM server_members WHERE server_id = $1 AND user_id = $2',
          [id, request.userId]
        );
        if (memberCheck.rows.length === 0 || !['admin', 'moderator'].includes(memberCheck.rows[0].role)) {
          return reply.code(403).send({ error: 'Insufficient permissions' });
        }

        const token = generateInviteToken();
        const tokenHash = sha256(token);

        await pool.query(
          'UPDATE servers SET invite_token_hash = $1 WHERE id = $2',
          [tokenHash, id]
        );

        return reply.code(200).send({ inviteToken: token });
      } catch (err) {
        fastify.log.error(err);
        return reply.code(500).send({ error: 'Failed to generate invite' });
      }
    }
  });

  // POST /api/servers/join — join via invite token
  fastify.post('/join', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      const { inviteToken, encryptedUsername } = request.body;
      if (!inviteToken) {
        return reply.code(400).send({ error: 'Invite token required' });
      }

      const tokenHash = sha256(inviteToken);

      try {
        const serverResult = await pool.query(
          'SELECT id, member_count, max_members FROM servers WHERE invite_token_hash = $1',
          [tokenHash]
        );
        if (serverResult.rows.length === 0) {
          return reply.code(404).send({ error: 'Invalid invite' });
        }

        const server = serverResult.rows[0];

        if (server.member_count >= server.max_members) {
          return reply.code(403).send({ error: 'Server is at maximum capacity (150 members)' });
        }

        const existing = await pool.query(
          'SELECT 1 FROM server_members WHERE server_id = $1 AND user_id = $2',
          [server.id, request.userId]
        );
        if (existing.rows.length > 0) {
          return reply.code(409).send({ error: 'Already a member' });
        }

        const encryptedUsernameBuf = encryptedUsername ? Buffer.from(encryptedUsername, 'base64') : null;

        await pool.query(
          `INSERT INTO server_members (server_id, user_id, role, encrypted_username)
           VALUES ($1, $2, 'member', $3)`,
          [server.id, request.userId, encryptedUsernameBuf]
        );

        await pool.query(
          'UPDATE servers SET member_count = member_count + 1 WHERE id = $1',
          [server.id]
        );

        return reply.code(200).send({ serverId: server.id });
      } catch (err) {
        fastify.log.error(err);
        return reply.code(500).send({ error: 'Failed to join server' });
      }
    }
  });

  // POST /api/servers/:id/leave — leave server
  fastify.post('/:id/leave', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      const { id } = request.params;
      try {
        const result = await pool.query(
          'DELETE FROM server_members WHERE server_id = $1 AND user_id = $2 RETURNING role',
          [id, request.userId]
        );
        if (result.rowCount === 0) {
          return reply.code(404).send({ error: 'Not a member' });
        }

        await pool.query(
          'UPDATE servers SET member_count = GREATEST(0, member_count - 1) WHERE id = $1',
          [id]
        );

        const remaining = await pool.query(
          'SELECT user_id, role FROM server_members WHERE server_id = $1 ORDER BY joined_at ASC LIMIT 1',
          [id]
        );
        if (remaining.rows.length > 0) {
          await pool.query(
            'UPDATE servers SET owner_id = $1 WHERE id = $2',
            [remaining.rows[0].user_id, id]
          );
          await pool.query(
            "UPDATE server_members SET role = 'admin' WHERE server_id = $1 AND user_id = $2",
            [id, remaining.rows[0].user_id]
          );
        } else {
          await pool.query('DELETE FROM servers WHERE id = $1', [id]);
        }

        return reply.code(200).send({ success: true });
      } catch (err) {
        fastify.log.error(err);
        return reply.code(500).send({ error: 'Failed to leave server' });
      }
    }
  });

  // POST /api/servers/:id/kick — kick or ban a member
  fastify.post('/:id/kick', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      const { id } = request.params;
      const { targetUserId } = request.body;
      if (!targetUserId) {
        return reply.code(400).send({ error: 'Target user required' });
      }

      try {
        const actorResult = await pool.query(
          'SELECT role FROM server_members WHERE server_id = $1 AND user_id = $2',
          [id, request.userId]
        );
        if (actorResult.rows.length === 0) {
          return reply.code(403).send({ error: 'Not a member' });
        }
        const actorRole = actorResult.rows[0].role;

        const targetResult = await pool.query(
          'SELECT role FROM server_members WHERE server_id = $1 AND user_id = $2',
          [id, targetUserId]
        );
        if (targetResult.rows.length === 0) {
          return reply.code(404).send({ error: 'Target not found' });
        }
        const targetRole = targetResult.rows[0].role;

        if (!canManageRole(actorRole, targetRole)) {
          return reply.code(403).send({ error: 'Cannot kick this user' });
        }

        await pool.query(
          'DELETE FROM server_members WHERE server_id = $1 AND user_id = $2',
          [id, targetUserId]
        );

        await pool.query(
          'UPDATE servers SET member_count = GREATEST(0, member_count - 1) WHERE id = $1',
          [id]
        );

        return reply.code(200).send({ success: true });
      } catch (err) {
        fastify.log.error(err);
        return reply.code(500).send({ error: 'Failed to kick member' });
      }
    }
  });

  // POST /api/servers/:id/role — change member role
  fastify.post('/:id/role', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      const { id } = request.params;
      const { targetUserId, newRole } = request.body;
      if (!targetUserId || !newRole || !ROLES.includes(newRole)) {
        return reply.code(400).send({ error: 'Invalid role' });
      }

      try {
        const actorResult = await pool.query(
          'SELECT role FROM server_members WHERE server_id = $1 AND user_id = $2',
          [id, request.userId]
        );
        if (actorResult.rows.length === 0) {
          return reply.code(403).send({ error: 'Not a member' });
        }
        const actorRole = actorResult.rows[0].role;

        if (newRole === 'admin' && actorRole !== 'admin') {
          return reply.code(403).send({ error: 'Only admin can assign admin role' });
        }

        const targetResult = await pool.query(
          'SELECT role FROM server_members WHERE server_id = $1 AND user_id = $2',
          [id, targetUserId]
        );
        if (targetResult.rows.length === 0) {
          return reply.code(404).send({ error: 'Target not found' });
        }
        const targetRole = targetResult.rows[0].role;

        if (!canManageRole(actorRole, targetRole)) {
          return reply.code(403).send({ error: 'Cannot modify this user' });
        }

        await pool.query(
          'UPDATE server_members SET role = $1 WHERE server_id = $2 AND user_id = $3',
          [newRole, id, targetUserId]
        );

        return reply.code(200).send({ success: true });
      } catch (err) {
        fastify.log.error(err);
        return reply.code(500).send({ error: 'Failed to update role' });
      }
    }
  });

  // POST /api/servers/:id/rotate-keys — rotate channel keys after kick/leave
  fastify.post('/:id/rotate-keys', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      const { id } = request.params;
      const { channelKeys } = request.body;

      if (!Array.isArray(channelKeys)) {
        return reply.code(400).send({ error: 'channelKeys array required' });
      }

      try {
        const memberCheck = await pool.query(
          'SELECT role FROM server_members WHERE server_id = $1 AND user_id = $2',
          [id, request.userId]
        );
        if (memberCheck.rows.length === 0 || memberCheck.rows[0].role !== 'admin') {
          return reply.code(403).send({ error: 'Admin only' });
        }

        const client = await pool.connect();
        try {
          await client.query('BEGIN');

          for (const ck of channelKeys) {
            const { channelId, encryptedKeys } = ck;
            if (!channelId || !Array.isArray(encryptedKeys)) continue;

            const versionResult = await client.query(
              'SELECT COALESCE(MAX(key_version), 0) + 1 as next_version FROM channel_keys WHERE channel_id = $1',
              [channelId]
            );
            const nextVersion = versionResult.rows[0].next_version;

            await client.query(
              'DELETE FROM channel_keys WHERE channel_id = $1',
              [channelId]
            );

            for (const ek of encryptedKeys) {
              await client.query(
                `INSERT INTO channel_keys (channel_id, user_id, encrypted_key, key_version)
                 VALUES ($1, $2, $3, $4)`,
                [channelId, ek.userId, Buffer.from(ek.encryptedKey, 'base64'), nextVersion]
              );
            }
          }

          await client.query('COMMIT');
          return reply.code(200).send({ success: true });
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release();
        }
      } catch (err) {
        fastify.log.error(err);
        return reply.code(500).send({ error: 'Key rotation failed' });
      }
    }
  });

  // DELETE /api/servers/:id — delete server
  fastify.delete('/:id', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      const { id } = request.params;
      try {
        const result = await pool.query(
          'DELETE FROM servers WHERE id = $1 AND owner_id = $2 RETURNING id',
          [id, request.userId]
        );
        if (result.rowCount === 0) {
          return reply.code(403).send({ error: 'Not authorized or server not found' });
        }
        return reply.code(200).send({ success: true });
      } catch (err) {
        fastify.log.error(err);
        return reply.code(500).send({ error: 'Failed to delete server' });
      }
    }
  });
};
