export default async function messageRoutes(app, opts) {
  const db = app.db;

  app.post('/send', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { recipientUsernameHash, ciphertextBlob, ephemeralPublicKey, paddingSize, expiresAt } = request.body;

    await db.query(
      `INSERT INTO messages (recipient_username_hash, ciphertext_blob, ephemeral_public_key, padding_size, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        Buffer.from(recipientUsernameHash, 'base64'),
        Buffer.from(ciphertextBlob, 'base64'),
        Buffer.from(ephemeralPublicKey, 'base64'),
        paddingSize || 1024,
        expiresAt ? new Date(expiresAt) : null
      ]
    );

    return { success: true };
  });

  app.get('/inbox', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { usernameHash } = request.user;
    const result = await db.query(
      `SELECT id, ciphertext_blob, ephemeral_public_key, padding_size, sequence_number
       FROM messages 
       WHERE recipient_username_hash = $1 
         AND delivered = FALSE
         AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY sequence_number ASC LIMIT 100`,
      [Buffer.from(usernameHash, 'base64')]
    );

    const ids = result.rows.map(r => r.id);
    if (ids.length > 0) {
      await db.query('UPDATE messages SET delivered = TRUE WHERE id = ANY($1)', [ids]);
    }

    return result.rows.map(r => ({
      id: r.id,
      ciphertextBlob: r.ciphertext_blob.toString('base64'),
      ephemeralPublicKey: r.ephemeral_public_key.toString('base64'),
      paddingSize: r.padding_size,
      sequenceNumber: r.sequence_number
    }));
  });

  app.delete('/:id', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const { usernameHash } = request.user;
    await db.query(
      'DELETE FROM messages WHERE id = $1 AND recipient_username_hash = $2',
      [id, Buffer.from(usernameHash, 'base64')]
    );
    return { success: true };
  });
}