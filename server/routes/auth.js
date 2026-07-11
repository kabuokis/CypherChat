import crypto from 'crypto';
import { TOTP, Secret } from 'otpauth';

function getTOTPEncryptionKey() {
  const secret = process.env.JWT_SECRET || 'dev-secret-change-me-32-bytes-long!!';
  return crypto.scryptSync(secret, 'cypherchat-totp-salt-v1', 32);
}

function encryptTOTPSecret(plaintext) {
  if (!plaintext) return null;
  const key = getTOTPEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

function decryptTOTPSecret(ciphertext) {
  if (!ciphertext) return null;
  const data = Buffer.from(ciphertext, 'base64');
  const iv = data.slice(0, 12);
  const authTag = data.slice(12, 28);
  const encrypted = data.slice(28);
  const key = getTOTPEncryptionKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(encrypted) + decipher.final('utf8');
}

export default async function authRoutes(app, opts) {
  const db = app.db;

  app.post('/register', {
    config: {
      rateLimit: { max: 5, timeWindow: '15 minutes', keyGenerator: (req) => req.ip }
    }
  }, async (request, reply) => {
    const {
      usernameHash, emailHash, argon2Salt, passwordVerifier,
      identityPublicKey, signingPublicKey, encryptedKeyBackup,
      totpSecret, totpSecretHash, recoveryCodesHash
    } = request.body;

    if (!usernameHash || !argon2Salt || !passwordVerifier || !identityPublicKey || !signingPublicKey || !encryptedKeyBackup) {
      return reply.code(400).send({ error: 'Missing required fields' });
    }

    try {
      const result = await db.query(
        `INSERT INTO users (
          username_hash, email_hash, argon2_salt, password_verifier,
          identity_public_key, signing_public_key, totp_secret, totp_secret_hash,
          recovery_codes_hash, encrypted_key_backup
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [
          Buffer.from(usernameHash, 'base64'),
          emailHash ? Buffer.from(emailHash, 'base64') : null,
          Buffer.from(argon2Salt, 'base64'),
          Buffer.from(passwordVerifier, 'base64'),
          Buffer.from(identityPublicKey, 'base64'),
          Buffer.from(signingPublicKey, 'base64'),
          totpSecret ? encryptTOTPSecret(totpSecret) : null,
          totpSecretHash ? Buffer.from(totpSecretHash, 'base64') : null,
          recoveryCodesHash || [],
          Buffer.from(encryptedKeyBackup, 'base64')
        ]
      );

      const token = app.jwt.sign({ userId: result.rows[0].id, usernameHash });
      return { token, success: true };
    } catch (err) {
      if (err.code === '23505') {
        return reply.code(409).send({ error: 'Username already exists' });
      }
      console.error('Register error:', err);
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  app.post('/login/challenge', {
    config: {
      rateLimit: { max: 5, timeWindow: '15 minutes', keyGenerator: (req) => req.ip }
    }
  }, async (request, reply) => {
    const { usernameHash } = request.body;
    if (!usernameHash) {
      return reply.code(400).send({ error: 'Username required' });
    }

    const userResult = await db.query(
      'SELECT id, argon2_salt, password_verifier, totp_secret FROM users WHERE username_hash = $1',
      [Buffer.from(usernameHash, 'base64')]
    );

    if (userResult.rows.length === 0) {
      return {
        salt: crypto.randomBytes(16).toString('base64'),
        challenge: crypto.randomBytes(32).toString('base64'),
        requiresTOTP: false
      };
    }

    const user = userResult.rows[0];
    const challenge = crypto.randomBytes(32);
    await db.query(
      'INSERT INTO challenges (username_hash, challenge) VALUES ($1, $2)',
      [Buffer.from(usernameHash, 'base64'), challenge]
    );

    return {
      salt: user.argon2_salt.toString('base64'),
      challenge: challenge.toString('base64'),
      requiresTOTP: !!user.totp_secret
    };
  });

  app.post('/login/verify', {
    config: {
      rateLimit: { max: 5, timeWindow: '15 minutes', keyGenerator: (req) => req.ip }
    }
  }, async (request, reply) => {
    const { usernameHash, response, totpCode, recoveryCode } = request.body;
    if (!usernameHash || !response) {
      return reply.code(400).send({ error: 'Missing credentials' });
    }

    const userResult = await db.query(
      `SELECT id, password_verifier, totp_secret, totp_secret_hash,
        recovery_codes_hash, encrypted_key_backup, identity_public_key, signing_public_key
       FROM users WHERE username_hash = $1`,
      [Buffer.from(usernameHash, 'base64')]
    );

    if (userResult.rows.length === 0) {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }

    const user = userResult.rows[0];
    const challengeResult = await db.query(
      'SELECT challenge FROM challenges WHERE username_hash = $1 ORDER BY expires_at DESC LIMIT 1',
      [Buffer.from(usernameHash, 'base64')]
    );

    if (challengeResult.rows.length === 0) {
      return reply.code(401).send({ error: 'Challenge expired' });
    }

    const challenge = challengeResult.rows[0].challenge;

    // FIX: Consume challenge immediately — prevents replay even on failed attempts
    await db.query('DELETE FROM challenges WHERE username_hash = $1', [Buffer.from(usernameHash, 'base64')]);

    const expected = crypto.createHmac('sha256', user.password_verifier).update(challenge).digest();
    const provided = Buffer.from(response, 'base64');

    if (!crypto.timingSafeEqual(expected, provided)) {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }

    if (user.totp_secret) {
      const decryptedSecret = decryptTOTPSecret(user.totp_secret);
      if (totpCode) {
        const secret = Secret.fromBase32(decryptedSecret);
        const totp = new TOTP({ secret, digits: 6, period: 30 });
        if (totp.validate({ token: totpCode, window: 1 }) === null) {
          return reply.code(401).send({ error: 'Invalid TOTP code' });
        }
      } else if (recoveryCode) {
        const hash = crypto.createHash('sha256').update(recoveryCode).digest('hex');
        const codes = user.recovery_codes_hash || [];
        const idx = codes.indexOf(hash);
        if (idx === -1) {
          return reply.code(401).send({ error: 'Invalid recovery code' });
        }
        codes.splice(idx, 1);
        await db.query('UPDATE users SET recovery_codes_hash = $1 WHERE id = $2', [codes, user.id]);
      } else {
        return reply.code(401).send({ error: 'TOTP required' });
      }
    }

    const token = app.jwt.sign({ userId: user.id, usernameHash });
    return {
      token,
      encryptedKeyBackup: user.encrypted_key_backup.toString('base64'),
      identityPublicKey: user.identity_public_key.toString('base64'),
      signingPublicKey: user.signing_public_key.toString('base64')
    };
  });

  app.post('/totp/setup', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { totpSecret, totpSecretHash, recoveryCodesHash } = request.body;
    const { userId } = request.user;

    await db.query(
      `UPDATE users SET totp_secret = $1, totp_secret_hash = $2, recovery_codes_hash = $3
       WHERE id = $4`,
      [encryptTOTPSecret(totpSecret), Buffer.from(totpSecretHash, 'base64'), recoveryCodesHash, userId]
    );

    return { success: true };
  });
}