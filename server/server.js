import crypto from 'crypto';

export default async function serverRoutes(app, opts) {
  const db = app.db;

  // Create server
  app.post('/', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { userId } = request.user;
    const { encryptedName, encryptedIcon, encryptedServerKey, channels } = request.body;

    const serverResult = await db.query(
      `INSERT INTO servers (owner_id, encrypted_name, encrypted_icon)
       VALUES ($1, $2, $3) RETURNING id`,
      [userId, Buffer.from(encryptedName, 'base64'), encryptedIcon ? Buffer.from(encryptedIcon, 'base64') : null]
    );
    const serverId = serverResult.rows[0].id;

    // Add creator as admin
    const userResult = await db.query('SELECT username_hash FROM users WHERE id = $1', [userId]);
    await db.query(
      `INSERT INTO server_members (server_id, user_id, username_hash, role, encrypted_server_key)
       VALUES ($1, $2, $3, 'admin', $4)`,
      [serverId, userId, userResult.rows[0].username_hash, Buffer.from(encryptedServerKey, 'base64')]
    );

    // Create channels and keys
    const createdChannels = [];
    for (const ch of channels || []) {
      const chResult = await db.query(
        `INSERT INTO channels (server_id, encrypted_name, channel_key_hash, is_private, role_required)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [serverId, Buffer.from(ch.encryptedName, 'base64'), Buffer.from(ch.channelKeyHash, 'base64'),
         ch.isPrivate || false, ch.roleRequired || 'member']
      );
      const channelId = chResult.rows[0].id;
      await db.query(
        `INSERT INTO channel_keys (channel_id, user_id, encrypted_channel_key)
         VALUES ($1, $2, $3)`,
        [channelId, userId, Buffer.from(ch.encryptedChannelKey, 'base64')]
      );
      createdChannels.push({ channelId });
    }

    return { serverId, channels: createdChannels, success: true };
  });

  // List my servers
  app.get('/list', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { userId } = request.user;
    const result = await db.query(
      `SELECT s.id, s.encrypted_name, s.encrypted_icon, sm.role
       FROM servers s
       JOIN server_members sm ON s.id = sm.server_id
       WHERE sm.user_id = $1`,
      [userId]
    );
    return result.rows.map(r => ({
      id: r.id,
      encryptedName: r.encrypted_name.toString('base64'),
      encryptedIcon: r.encrypted_icon ? r.encrypted_icon.toString('base64') : null,
      role: r.role
    }));
  });

  // Get server members (for key rotation)
  app.get('/:id/members', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { userId } = request.user;
    const { id } = request.params;

    // Check membership
    const memCheck = await db.query(
      'SELECT role FROM server_members WHERE server_id = $1 AND user_id = $2',
      [id, userId]
    );
    if (memCheck.rows.length === 0) {
      return reply.code(403).send({ error: 'Not a member' });
    }

    const result = await db.query(
      `SELECT sm.user_id, sm.username_hash, sm.role, u.identity_public_key
       FROM server_members sm
       JOIN users u ON sm.user_id = u.id
       WHERE sm.server_id = $1`,
      [id]
    );
    return result.rows.map(r => ({
      userId: r.user_id,
      usernameHash: r.username_hash.toString('base64'),
      role: r.role,
      identityPublicKey: r.identity_public_key.toString('base64')
    }));
  });

  // Get my server keys
  app.get('/:id/keys', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { userId } = request.user;
    const { id } = request.params;

    const serverKey = await db.query(
      'SELECT encrypted_server_key FROM server_members WHERE server_id = $1 AND user_id = $2',
      [id, userId]
    );
    if (serverKey.rows.length === 0) return reply.code(403).send({ error: 'Not a member' });

    const channelKeys = await db.query(
      `SELECT ck.channel_id, c.encrypted_name, ck.encrypted_channel_key, c.is_private, c.role_required
       FROM channel_keys ck
       JOIN channels c ON ck.channel_id = c.id
       WHERE ck.user_id = $1 AND c.server_id = $2`,
      [userId, id]
    );

    return {
      encryptedServerKey: serverKey.rows[0].encrypted_server_key.toString('base64'),
      channels: channelKeys.rows.map(r => ({
        channelId: r.channel_id,
        encryptedName: r.encrypted_name.toString('base64'),
        encryptedChannelKey: r.encrypted_channel_key.toString('base64'),
        isPrivate: r.is_private,
        roleRequired: r.role_required
      }))
    };
  });

  // Kick member (triggers key rotation - admin/mod only)
  app.post('/:id/kick', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { userId } = request.user;
    const { id } = request.params;
    const { targetUserId } = request.body;

    const myRole = await db.query(
      'SELECT role FROM server_members WHERE server_id = $1 AND user_id = $2',
      [id, userId]
    );
    if (myRole.rows.length === 0 || !['admin', 'moderator'].includes(myRole.rows[0].role)) {
      return reply.code(403).send({ error: 'Insufficient permissions' });
    }

    const target = await db.query(
      'SELECT role FROM server_members WHERE server_id = $1 AND user_id = $2',
      [id, targetUserId]
    );
    if (target.rows.length === 0) return reply.code(404).send({ error: 'Member not found' });
    if (target.rows[0].role === 'admin') return reply.code(403).send({ error: 'Cannot kick admin' });

    await db.query(
      'DELETE FROM server_members WHERE server_id = $1 AND user_id = $2',
      [id, targetUserId]
    );
    await db.query(
      'DELETE FROM channel_keys WHERE user_id = $1 AND channel_id IN (SELECT id FROM channels WHERE server_id = $2)',
      [targetUserId, id]
    );

    return { success: true, keyRotationRequired: true };
  });

  // Leave server
  app.post('/:id/leave', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { userId } = request.user;
    const { id } = request.params;

    await db.query(
      'DELETE FROM server_members WHERE server_id = $1 AND user_id = $2',
      [id, userId]
    );
    await db.query(
      'DELETE FROM channel_keys WHERE user_id = $1 AND channel_id IN (SELECT id FROM channels WHERE server_id = $2)',
      [userId, id]
    );

    return { success: true };
  });

  // Upload rotated keys (admin does this after kick/ban)
  app.post('/:id/rotate-keys', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { userId } = request.user;
    const { id } = request.params;
    const { channelKeys } = request.body; // [{ channelId, userId, encryptedChannelKey }]

    const myRole = await db.query(
      'SELECT role FROM server_members WHERE server_id = $1 AND user_id = $2',
      [id, userId]
    );
    if (myRole.rows.length === 0 || !['admin', 'moderator'].includes(myRole.rows[0].role)) {
      return reply.code(403).send({ error: 'Insufficient permissions' });
    }

    for (const ck of channelKeys) {
      await db.query(
        `INSERT INTO channel_keys (channel_id, user_id, encrypted_channel_key)
         VALUES ($1, $2, $3)
         ON CONFLICT (channel_id, user_id)
         DO UPDATE SET encrypted_channel_key = $3`,
        [ck.channelId, ck.userId, Buffer.from(ck.encryptedChannelKey, 'base64')]
      );
    }

    return { success: true };
  });
}