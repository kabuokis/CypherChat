export default async function channelRoutes(app, opts) {
  const db = app.db;

  // Create channel (admin only)
  app.post('/', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { userId } = request.user;
    const { serverId, encryptedName, channelKeyHash, isPrivate, roleRequired, memberKeys } = request.body;

    const roleCheck = await db.query(
      'SELECT role FROM server_members WHERE server_id = $1 AND user_id = $2',
      [serverId, userId]
    );
    if (roleCheck.rows.length === 0 || !['admin', 'moderator'].includes(roleCheck.rows[0].role)) {
      return reply.code(403).send({ error: 'Insufficient permissions' });
    }

    const chResult = await db.query(
      `INSERT INTO channels (server_id, encrypted_name, channel_key_hash, is_private, role_required)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [serverId, Buffer.from(encryptedName, 'base64'), Buffer.from(channelKeyHash, 'base64'),
       isPrivate || false, roleRequired || 'member']
    );
    const channelId = chResult.rows[0].id;

    for (const mk of memberKeys || []) {
      await db.query(
        `INSERT INTO channel_keys (channel_id, user_id, encrypted_channel_key)
         VALUES ($1, $2, $3)`,
        [channelId, mk.userId, Buffer.from(mk.encryptedChannelKey, 'base64')]
      );
    }

    return { channelId, success: true };
  });

  // Send message to channel
  app.post('/:id/messages', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { userId } = request.user;
    const { id } = request.params;
    const { ciphertextBlob, iv } = request.body;

    // Verify membership and channel access
    const member = await db.query(
      `SELECT sm.role FROM server_members sm
       JOIN channels c ON c.server_id = sm.server_id
       WHERE c.id = $1 AND sm.user_id = $2`,
      [id, userId]
    );
    if (member.rows.length === 0) return reply.code(403).send({ error: 'Not a member' });

    const channel = await db.query(
      'SELECT is_private, role_required FROM channels WHERE id = $1',
      [id]
    );
    if (channel.rows[0].is_private) {
      const required = channel.rows[0].role_required;
      const roles = ['member', 'moderator', 'admin'];
      if (roles.indexOf(member.rows[0].role) < roles.indexOf(required)) {
        return reply.code(403).send({ error: 'Insufficient channel permissions' });
      }
    }

    const userHash = await db.query('SELECT username_hash FROM users WHERE id = $1', [userId]);
    await db.query(
      `INSERT INTO server_messages (channel_id, sender_username_hash, ciphertext_blob, iv)
       VALUES ($1, $2, $3, $4)`,
      [id, userHash.rows[0].username_hash, Buffer.from(ciphertextBlob, 'base64'), Buffer.from(iv, 'base64')]
    );

    return { success: true };
  });

  // Get channel messages
  app.get('/:id/messages', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { userId } = request.user;
    const { id } = request.params;
    const { after = 0 } = request.query;

    const access = await db.query(
      `SELECT sm.role, c.is_private, c.role_required
       FROM server_members sm
       JOIN channels c ON c.server_id = sm.server_id
       WHERE c.id = $1 AND sm.user_id = $2`,
      [id, userId]
    );
    if (access.rows.length === 0) return reply.code(403).send({ error: 'Not a member' });

    const row = access.rows[0];
    if (row.is_private) {
      const roles = ['member', 'moderator', 'admin'];
      if (roles.indexOf(row.role) < roles.indexOf(row.role_required)) {
        return reply.code(403).send({ error: 'Insufficient channel permissions' });
      }
    }

    const result = await db.query(
      `SELECT id, sender_username_hash, ciphertext_blob, iv, sequence_number, created_at
       FROM server_messages
       WHERE channel_id = $1 AND sequence_number > $2
       ORDER BY sequence_number DESC LIMIT 100`,
      [id, after]
    );

    return result.rows.map(r => ({
      id: r.id,
      senderUsernameHash: r.sender_username_hash.toString('base64'),
      ciphertextBlob: r.ciphertext_blob.toString('base64'),
      iv: r.iv.toString('base64'),
      sequenceNumber: r.sequence_number,
      createdAt: r.created_at
    })).reverse();
  });
}