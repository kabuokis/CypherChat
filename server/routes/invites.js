import crypto from 'crypto';

export default async function inviteRoutes(app, opts) {
  const db = app.db;

  // Create invite (admin/mod only)
  app.post('/', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { userId } = request.user;
    const { serverId, encryptedKeyBundle, usesLeft, expiresAt } = request.body;

    const roleCheck = await db.query(
      'SELECT role FROM server_members WHERE server_id = $1 AND user_id = $2',
      [serverId, userId]
    );
    if (roleCheck.rows.length === 0 || !['admin', 'moderator'].includes(roleCheck.rows[0].role)) {
      return reply.code(403).send({ error: 'Insufficient permissions' });
    }

    const code = crypto.randomBytes(8).toString('hex');
    await db.query(
      `INSERT INTO invites (server_id, code, encrypted_key_bundle, uses_left, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [serverId, code, Buffer.from(encryptedKeyBundle, 'base64'), usesLeft || null,
       expiresAt ? new Date(expiresAt) : null, userId]
    );

    return { code, success: true };
  });

  // Get invite info (public, for join page)
  app.get('/:code', async (request, reply) => {
    const { code } = request.params;
    const result = await db.query(
      `SELECT i.server_id, s.encrypted_name, i.encrypted_key_bundle, i.uses_left, i.expires_at
       FROM invites i
       JOIN servers s ON i.server_id = s.id
       WHERE i.code = $1`,
      [code]
    );
    if (result.rows.length === 0) return reply.code(404).send({ error: 'Invalid invite' });

    const row = result.rows[0];
    if (row.expires_at && new Date(row.expires_at) < new Date()) {
      return reply.code(410).send({ error: 'Invite expired' });
    }
    if (row.uses_left !== null && row.uses_left <= 0) {
      return reply.code(410).send({ error: 'Invite exhausted' });
    }

    return {
      serverId: row.server_id,
      encryptedName: row.encrypted_name.toString('base64'),
      encryptedKeyBundle: row.encrypted_key_bundle.toString('base64'),
      usesLeft: row.uses_left
    };
  });

  // Join via invite
  app.post('/:code/join', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { userId } = request.user;
    const { code } = request.params;
    const { encryptedServerKey, encryptedChannelKeys } = request.body;

    const invite = await db.query(
      'SELECT server_id, uses_left, expires_at FROM invites WHERE code = $1',
      [code]
    );
    if (invite.rows.length === 0) return reply.code(404).send({ error: 'Invalid invite' });

    const { server_id, uses_left, expires_at } = invite.rows[0];
    if (expires_at && new Date(expires_at) < new Date()) {
      return reply.code(410).send({ error: 'Invite expired' });
    }
    if (uses_left !== null && uses_left <= 0) {
      return reply.code(410).send({ error: 'Invite exhausted' });
    }

    // Check not already member
    const existing = await db.query(
      'SELECT 1 FROM server_members WHERE server_id = $1 AND user_id = $2',
      [server_id, userId]
    );
    if (existing.rows.length > 0) return reply.code(409).send({ error: 'Already a member' });

    const userHash = await db.query('SELECT username_hash FROM users WHERE id = $1', [userId]);

    await db.query(
      `INSERT INTO server_members (server_id, user_id, username_hash, encrypted_server_key)
       VALUES ($1, $2, $3, $4)`,
      [server_id, userId, userHash.rows[0].username_hash, Buffer.from(encryptedServerKey, 'base64')]
    );

    for (const ck of encryptedChannelKeys || []) {
      await db.query(
        `INSERT INTO channel_keys (channel_id, user_id, encrypted_channel_key)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [ck.channelId, userId, Buffer.from(ck.encryptedChannelKey, 'base64')]
      );
    }

    if (uses_left !== null) {
      await db.query(
        'UPDATE invites SET uses_left = uses_left - 1 WHERE code = $1',
        [code]
      );
    }

    return { serverId: server_id, success: true };
  });

  // Get my invites for a server (for sharing)
  app.get('/server/:serverId', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { userId } = request.user;
    const { serverId } = request.params;

    const roleCheck = await db.query(
      'SELECT role FROM server_members WHERE server_id = $1 AND user_id = $2',
      [serverId, userId]
    );
    if (roleCheck.rows.length === 0) return reply.code(403).send({ error: 'Not a member' });

    const result = await db.query(
      `SELECT code, uses_left, expires_at, created_at
       FROM invites WHERE server_id = $1 AND created_by = $2
       ORDER BY created_at DESC`,
      [serverId, userId]
    );

    return result.rows.map(r => ({
      code: r.code,
      usesLeft: r.uses_left,
      expiresAt: r.expires_at,
      createdAt: r.created_at
    }));
  });
}