import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { deriveKey } from '../crypto/argon2';
import { generateIdentityKeyPair, generateSigningKeyPair, exportKeyPair, exportSigningKeyPair } from '../crypto/keys';
import { storeKeys, clearAllData } from '../db/indexeddb';

const API = '/api';

function validatePassword(pw) {
  if (pw.length < 12) return 'Password must be at least 12 characters';
  if (!/[A-Z]/.test(pw)) return 'Password must contain an uppercase letter';
  if (!/[a-z]/.test(pw)) return 'Password must contain a lowercase letter';
  if (!/[0-9]/.test(pw)) return 'Password must contain a number';
  if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(pw)) return 'Password must contain a special character like @';
  return null;
}

export default function Register() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');

    const pwError = validatePassword(password);
    if (pwError) {
      setError(pwError);
      setLoading(false);
      return;
    }

    try {
      const identityKeyPair = await generateIdentityKeyPair();
      const signingKeyPair = await generateSigningKeyPair();
      const identityExported = await exportKeyPair(identityKeyPair);
      const signingExported = await exportSigningKeyPair(signingKeyPair);

      const salt = crypto.getRandomValues(new Uint8Array(16));
      const masterKey = await deriveKey(password, salt);
      const passwordVerifier = masterKey;

      const backupKey = await deriveBackupKey(masterKey, salt);
      const iv = crypto.getRandomValues(new Uint8Array(12));

      const identityPrivJwk = await crypto.subtle.exportKey('jwk', identityKeyPair.privateKey);
      const signingPrivJwk = await crypto.subtle.exportKey('jwk', signingKeyPair.privateKey);
      const backupPayload = new TextEncoder().encode(JSON.stringify({
        identity: identityPrivJwk,
        signing: signingPrivJwk
      }));
      const encryptedPriv = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv }, backupKey, backupPayload
      );

      const backup = new Uint8Array(iv.length + encryptedPriv.byteLength);
      backup.set(iv);
      backup.set(new Uint8Array(encryptedPriv), iv.length);

      const usernameHash = await sha256(new TextEncoder().encode(username));
      const emailHash = email ? await sha256(new TextEncoder().encode(email)) : null;

      const res = await fetch(`${API}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          usernameHash: b64(usernameHash),
          emailHash: emailHash ? b64(emailHash) : null,
          argon2Salt: b64(salt),
          passwordVerifier: b64(passwordVerifier),
          identityPublicKey: b64(identityExported.publicKey),
          signingPublicKey: b64(signingExported.publicKey),
          encryptedKeyBackup: b64(backup)
        })
      });

      let data;
      const contentType = res.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        data = await res.json();
      } else {
        const text = await res.text();
        throw new Error(text || `Server error: ${res.status}`);
      }

      if (!res.ok) throw new Error(data.error || `Registration failed (${res.status})`);

      const { token } = data;
      await clearAllData(); // wipe old account data
      await storeKeys(identityExported, signingExported, masterKey);

      const encryptedUsername = await encryptUsername(username, masterKey);
      localStorage.setItem('token', token);
      localStorage.setItem('username', encryptedUsername);
      navigate('/chat');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h2>Create Account</h2>
        <p>Your keys are generated in the browser. We never see your password.</p>
        <form onSubmit={handleSubmit}>
          <input placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} required />
          <input type="password" placeholder="Password (12+ chars, A-Z, a-z, 0-9, special)" value={password} onChange={e => setPassword(e.target.value)} required />
          <input type="email" placeholder="Email (optional)" value={email} onChange={e => setEmail(e.target.value)} />
          {error && <div className="error">{error}</div>}
          <button type="submit" disabled={loading}>{loading ? 'Generating keys...' : 'Register'}</button>
        </form>
        <p style={{ marginTop: 16, textAlign: 'center', fontSize: 13 }}>
          Already have an account? <Link to="/login" style={{ color: '#5865F2', textDecoration: 'none' }}>Log in</Link>
        </p>
      </div>
    </div>
  );
}

async function deriveBackupKey(masterKey, salt) {
  const base = await crypto.subtle.importKey('raw', masterKey, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode('backup') },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}

async function sha256(data) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data));
}

function b64(bytes) {
  return btoa(String.fromCharCode(...bytes));
}

async function encryptUsername(username, masterKey) {
  const encKey = await crypto.subtle.importKey('raw', masterKey, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    encKey,
    new TextEncoder().encode(username)
  );
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return b64(combined);
}