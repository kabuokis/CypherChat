'use strict';

const pool = require('../db');

const FAKE_PUBKEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAE=';
const FAKE_SIGN_PUBKEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAE=';

module.exports = async function (fastify, opts) {

  // GET /api/contacts/search — public, sealed response
  fastify.get('/search', {
    handler: async (request, reply) => {
      const { hash } = request.query;
      fastify.log.info(`[CONTACTS SEARCH] Received hash query param: ${hash ? hash.substring(0, 20) + '...' : 'UNDEFINED'}`);

      if (!hash) {
        fastify.log.info('[CONTACTS SEARCH] No hash provided, returning fake');
        return reply.code(200).send({
          found: false,
          identityPublicKey: FAKE_PUBKEY,
          signingPublicKey: FAKE_SIGN_PUBKEY
        });
      }

      try {
        const hashBuf = Buffer.from(hash, 'base64');
        fastify.log.info(`[CONTACTS SEARCH] Decoded hash buffer length: ${hashBuf.length}, hex: ${hashBuf.toString('hex').substring(0, 32)}...`);

        const result = await pool.query(
          'SELECT identity_public_key, signing_public_key FROM users WHERE username_hash = $1',
          [hashBuf]
        );

        fastify.log.info(`[CONTACTS SEARCH] DB query returned ${result.rows.length} rows`);

        if (result.rows.length === 0) {
          return reply.code(200).send({
            found: false,
            identityPublicKey: FAKE_PUBKEY,
            signingPublicKey: FAKE_SIGN_PUBKEY
          });
        }

        const user = result.rows[0];
        return reply.code(200).send({
          found: true,
          identityPublicKey: user.identity_public_key.toString('base64'),
          signingPublicKey: user.signing_public_key.toString('base64')
        });
      } catch (err) {
        fastify.log.error('[CONTACTS SEARCH ERROR]', err);
        return reply.code(200).send({
          found: false,
          identityPublicKey: FAKE_PUBKEY,
          signingPublicKey: FAKE_SIGN_PUBKEY
        });
      }
    }
  });

  // POST /api/contacts/add — authenticated
  fastify.post('/add', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      const { contactUsernameHash, contactPublicKey, contactSigningPublicKey, encryptedAlias } = request.body;

      if (!contactUsernameHash || !contactPublicKey || !contactSigningPublicKey) {
        return reply.code(400).send({ error: 'Missing required fields' });
      }

      const ownerBuf = Buffer.from(request.usernameHash, 'base64');
      const contactBuf = Buffer.from(contactUsernameHash, 'base64');
      const pubBuf = Buffer.from(contactPublicKey, 'base64');
      const signBuf = Buffer.from(contactSigningPublicKey, 'base64');
      const aliasBuf = encryptedAlias ? Buffer.from(encryptedAlias, 'base64') : null;

      try {
        await pool.query(
          `INSERT INTO contacts (owner_username_hash, contact_username_hash, contact_public_key, contact_signing_public_key, encrypted_alias)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (owner_username_hash, contact_username_hash) DO UPDATE SET
             contact_public_key = EXCLUDED.contact_public_key,
             contact_signing_public_key = EXCLUDED.contact_signing_public_key,
             encrypted_alias = EXCLUDED.encrypted_alias`,
          [ownerBuf, contactBuf, pubBuf, signBuf, aliasBuf]
        );
        return reply.code(201).send({ success: true });
      } catch (err) {
        fastify.log.error(err);
        return reply.code(500).send({ error: 'Failed to add contact' });
      }
    }
  });

  // GET /api/contacts/list — authenticated
  fastify.get('/list', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const result = await pool.query(
          `SELECT id, contact_username_hash, contact_public_key, contact_signing_public_key, encrypted_alias, created_at
           FROM contacts WHERE owner_username_hash = $1 ORDER BY created_at DESC`,
          [Buffer.from(request.usernameHash, 'base64')]
        );

        return reply.code(200).send({
          contacts: result.rows.map(c => ({
            id: c.id,
            contactUsernameHash: c.contact_username_hash.toString('base64'),
            contactPublicKey: c.contact_public_key.toString('base64'),
            contactSigningPublicKey: c.contact_signing_public_key.toString('base64'),
            encryptedAlias: c.encrypted_alias ? c.encrypted_alias.toString('base64') : null,
            createdAt: c.created_at
          }))
        });
      } catch (err) {
        fastify.log.error(err);
        return reply.code(500).send({ error: 'Failed to fetch contacts' });
      }
    }
  });
};
