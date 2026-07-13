'use strict';

const pool = require('../db');
const crypto = require('crypto');
const { TOTP } = require('otpauth');

const RATE_LIMIT = { max: 5, timeWindow: '15 minutes' };
const AUTH_ERROR = { error: 'Invalid credentials or account not found' };
const TOTP_ERROR = { error: 'Invalid TOTP code or recovery code' };

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest();
}

function hmacSha256(key, message) {
  return crypto.createHmac('sha256', key).update(message).digest();
}

function generateToken(fastify, userId, usernameHash, sessionId, sessionToken) {
  return fastify.jwt.sign(
    { userId, usernameHash, sessionId, sessionToken },
    { expiresIn: '30d' }
  );
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
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

module.exports = async function (fastify, opts) {

  // POST /api/auth/register
  fastify.post('/register', {
    handler: async (request, reply) => {
      const {
        usernameHash,
        emailHash,
        argon2Salt,
        passwordVerifier,
        identityPublicKey,
        signingPublicKey,
        encryptedKeyBackup
      } = request.body;

      if (!usernameHash || !argon2Salt || !passwordVerifier || !identityPublicKey || !signingPublicKey || !encryptedKeyBackup) {
        return reply.code(400).send({ error: 'Missing required fields' });
      }

      const usernameHashBuf = Buffer.from(usernameHash, 'base64');
      const saltBuf = Buffer.from(argon2Salt, 'base64');
      const verifierBuf = Buffer.from(passwordVerifier, 'base64');
      const idPubBuf = Buffer.from(identityPublicKey, 'base64');
      const signPubBuf = Buffer.from(signingPublicKey, 'base64');
      const keyBackupBuf = Buffer.from(encryptedKeyBackup, 'base64');
      const emailBuf = emailHash ? Buffer.from(emailHash, 'base64') : null;

      try {
        const insertResult = await pool.query(
          `INSERT INTO users (username_hash, email_hash, argon2_salt, password_verifier, identity_public_key, signing_public_key, encrypted_key_backup)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id`,
          [usernameHashBuf, emailBuf, saltBuf, verifierBuf, idPubBuf, signPubBuf, keyBackupBuf]
        );

        const userId = insertResult.rows[0].id;
        const sessionToken = crypto.randomBytes(32).toString('base64');
        const tokenHash = sha256(sessionToken);
        const sessionResult = await pool.query(
          `INSERT INTO sessions (user_id, token_hash, device_info)
           VALUES ($1, $2, $3) RETURNING id`,
          [userId, tokenHash, request.headers['user-agent'] || 'unknown']
        );
        const sessionId = sessionResult.rows[0].id;

        const token = generateToken(fastify, userId, usernameHash, sessionId, sessionToken);
        return reply.code(201).send({ token });
      } catch (err) {
        if (err.code === '23505') {
          return reply.code(409).send({ error: 'Username already taken' });
        }
        fastify.log.error(err);
        return reply.code(500).send({ error: 'Registration failed' });
      }
    }
  });

  // POST /api/auth/login/challenge
  fastify.post('/login/challenge', {
    handler: async (request, reply) => {
      const { usernameHash } = request.body;
      if (!usernameHash) {
        return reply.code(400).send(AUTH_ERROR);
      }

      const usernameHashBuf = Buffer.from(usernameHash, 'base64');

      try {
        const userResult = await pool.query(
          'SELECT id, argon2_salt, totp_secret IS NOT NULL AS totp_enabled FROM users WHERE username_hash = $1',
          [usernameHashBuf]
        );

        if (userResult.rows.length === 0) {
          return reply.code(401).send(AUTH_ERROR);
        }

        const user = userResult.rows[0];
        const challenge = crypto.randomBytes(32);

        await pool.query(
          `INSERT INTO challenges (username_hash, challenge)
           VALUES ($1, $2)`,
          [usernameHashBuf, challenge]
        );

        return reply.code(200).send({
          salt: user.argon2_salt.toString('base64'),
          challenge: challenge.toString('base64'),
          requiresTOTP: user.totp_enabled
        });
      } catch (err) {
        fastify.log.error(err);
        return reply.code(500).send(AUTH_ERROR);
      }
    }
  });

  // POST /api/auth/login/verify
  fastify.post('/login/verify', {
    handler: async (request, reply) => {
      const { usernameHash, hmacResponse, totpCode, recoveryCode } = request.body;
      if (!usernameHash || !hmacResponse) {
        return reply.code(400).send(AUTH_ERROR);
      }

      const usernameHashBuf = Buffer.from(usernameHash, 'base64');
      const hmacBuf = Buffer.from(hmacResponse, 'base64');

      try {
        const challengeResult = await pool.query(
          `SELECT id, challenge FROM challenges
           WHERE username_hash = $1 AND expires_at > NOW()
           ORDER BY created_at DESC NULLS LAST LIMIT 1`,
          [usernameHashBuf]
        );

        if (challengeResult.rows.length === 0) {
          return reply.code(401).send(AUTH_ERROR);
        }

        const challengeRow = challengeResult.rows[0];
        const challenge = challengeRow.challenge;

        await pool.query('DELETE FROM challenges WHERE id = $1', [challengeRow.id]);
        await pool.query('DELETE FROM challenges WHERE expires_at <= NOW()');

        const userResult = await pool.query(
          `SELECT id, password_verifier, totp_secret, totp_secret_hash, recovery_codes_hash,
                  encrypted_key_backup, identity_public_key, signing_public_key
           FROM users WHERE username_hash = $1`,
          [usernameHashBuf]
        );

        if (userResult.rows.length === 0) {
          return reply.code(401).send(AUTH_ERROR);
        }

        const user = userResult.rows[0];
        const expectedHmac = hmacSha256(user.password_verifier, challenge);

        if (!crypto.timingSafeEqual(expectedHmac, hmacBuf)) {
          return reply.code(401).send(AUTH_ERROR);
        }

        if (user.totp_secret) {
          let totpValid = false;

          if (totpCode) {
            const decryptedSecret = decryptServerData(user.totp_secret);
            const totp = new TOTP({
              secret: decryptedSecret,
              digits: 6,
              period: 30,
              algorithm: 'SHA1'
            });
            totpValid = totp.validate({ token: totpCode, window: 1 }) !== null;
          }

          if (!totpValid && recoveryCode) {
            const recoveryCodes = user.recovery_codes_hash || [];
            const codeHash = sha256(recoveryCode).toString('base64');
            const idx = recoveryCodes.indexOf(codeHash);
            if (idx !== -1) {
              totpValid = true;
              recoveryCodes.splice(idx, 1);
              await pool.query(
                'UPDATE users SET recovery_codes_hash = $1 WHERE id = $2',
                [recoveryCodes, user.id]
              );
            }
          }

          if (!totpValid) {
            return reply.code(401).send(TOTP_ERROR);
          }
        }

        const sessionToken = crypto.randomBytes(32).toString('base64');
        const tokenHash = sha256(sessionToken);
        const sessionResult = await pool.query(
          `INSERT INTO sessions (user_id, token_hash, device_info)
           VALUES ($1, $2, $3) RETURNING id`,
          [user.id, tokenHash, request.headers['user-agent'] || 'unknown']
        );
        const sessionId = sessionResult.rows[0].id;

        const token = generateToken(fastify, user.id, usernameHash, sessionId, sessionToken);

        return reply.code(200).send({
          token,
          encryptedKeyBackup: user.encrypted_key_backup.toString('base64'),
          identityPublicKey: user.identity_public_key.toString('base64'),
          signingPublicKey: user.signing_public_key.toString('base64')
        });
      } catch (err) {
        fastify.log.error(err);
        return reply.code(500).send(AUTH_ERROR);
      }
    }
  });

  // POST /api/auth/totp/setup
  fastify.post('/totp/setup', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      const { totpSecret, totpSecretHash, recoveryCodesHash } = request.body;
      if (!totpSecret || !totpSecretHash || !recoveryCodesHash || !Array.isArray(recoveryCodesHash)) {
        return reply.code(400).send({ error: 'Missing TOTP setup fields' });
      }

      const encryptedSecret = encryptServerData(totpSecret);
      const secretHashBuf = Buffer.from(totpSecretHash, 'base64');

      try {
        await pool.query(
          `UPDATE users
           SET totp_secret = $1,
               totp_secret_hash = $2,
               recovery_codes_hash = $3
           WHERE id = $4`,
          [encryptedSecret, secretHashBuf, recoveryCodesHash, request.userId]
        );
        return reply.code(200).send({ success: true });
      } catch (err) {
        fastify.log.error(err);
        return reply.code(500).send({ error: 'TOTP setup failed' });
      }
    }
  });

  // DELETE /api/auth/account
  fastify.delete('/account', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        await pool.query('DELETE FROM users WHERE id = $1', [request.userId]);
        return reply.code(200).send({ success: true });
      } catch (err) {
        fastify.log.error(err);
        return reply.code(500).send({ error: 'Account deletion failed' });
      }
    }
  });

  // GET /api/auth/sessions
  fastify.get('/sessions', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const result = await pool.query(
          `SELECT id, device_info, last_seen, created_at
           FROM sessions WHERE user_id = $1 ORDER BY last_seen DESC`,
          [request.userId]
        );
        return reply.code(200).send({
          sessions: result.rows.map(s => ({
            id: s.id,
            deviceInfo: s.device_info,
            lastSeen: s.last_seen,
            createdAt: s.created_at,
            current: s.id === request.sessionId
          }))
        });
      } catch (err) {
        fastify.log.error(err);
        return reply.code(500).send({ error: 'Failed to fetch sessions' });
      }
    }
  });

  // DELETE /api/auth/sessions/:id
  fastify.delete('/sessions/:id', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      const { id } = request.params;
      try {
        const result = await pool.query(
          'DELETE FROM sessions WHERE id = $1 AND user_id = $2 RETURNING id',
          [id, request.userId]
        );
        if (result.rowCount === 0) {
          return reply.code(404).send({ error: 'Session not found' });
        }
        return reply.code(200).send({ success: true });
      } catch (err) {
        fastify.log.error(err);
        return reply.code(500).send({ error: 'Failed to revoke session' });
      }
    }
  });
};
