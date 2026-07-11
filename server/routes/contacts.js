export default async function contactRoutes(app, opts) {
  const db = app.db;

  app.get('/search/:hash', async (request, reply) => {
    const result = await db.query(
      'SELECT identity_public_key, signing_public_key FROM users WHERE username_hash = $1',
      [Buffer.from(request.params.hash, 'base64')]
    );
    if (result.rows.length === 0) {
      return reply.code(404).send({ error: 'User not found' });
    }
    return {
      exists: true,
      publicKey: result.rows[0].identity_public_key.toString('base64'),
      signingPublicKey: result.rows[0].signing_public_key.toString('base64')
    };
  });

  app.post('/add', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { usernameHash } = request.user;
    const { contactUsernameHash, contactPublicKey, contactSigningPublicKey, encryptedAlias } = request.body;
    await db.query(
      `INSERT INTO contacts (owner_username_hash, contact_username_hash, contact_public_key, contact_signing_public_key, encrypted_alias)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (owner_username_hash, contact_username_hash)
       DO UPDATE SET contact_public_key = $3, contact_signing_public_key = $4, encrypted_alias = $5`,
      [
        Buffer.from(usernameHash, 'base64'),
        Buffer.from(contactUsernameHash, 'base64'),
        Buffer.from(contactPublicKey, 'base64'),
        contactSigningPublicKey ? Buffer.from(contactSigningPublicKey, 'base64') : null,
        encryptedAlias ? Buffer.from(encryptedAlias, 'base64') : null
      ]
    );
    return { success: true };
  });

  app.get('/list', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { usernameHash } = request.user;
    const result = await db.query(
      'SELECT contact_username_hash, contact_public_key, contact_signing_public_key, encrypted_alias FROM contacts WHERE owner_username_hash = $1',
      [Buffer.from(usernameHash, 'base64')]
    );
    return result.rows.map(r => ({
      contactUsernameHash: r.contact_username_hash.toString('base64'),
      contactPublicKey: r.contact_public_key.toString('base64'),
      contactSigningPublicKey: r.contact_signing_public_key ? r.contact_signing_public_key.toString('base64') : null,
      encryptedAlias: r.encrypted_alias ? r.encrypted_alias.toString('base64') : null
    }));
  });
}