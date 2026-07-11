import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { deriveKey } from '../crypto/argon2';
import { importKeyPair, importSigningKeyPair } from '../crypto/keys';
import { storeKeys } from '../db/indexeddb';

const API = '/api';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [step, setStep] = useState('password');
  const [challengeData, setChallengeData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  async function handlePassword(e) {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const usernameHash = await sha256(new TextEncoder().encode(username));
      const res = await fetch(`${API}/auth/login/challenge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usernameHash: b64(usernameHash) })
      });

      let data;
      const ct = res.headers.get('content-type');
      if (ct && ct.includes('application/json')) {
        data = await res.json();
      } else {
        const text = await res.text();
        throw new Error(text || `Server error: ${res.status}`);
      }

      const salt = fromB64(data.salt);
      const masterKey = await deriveKey(password, salt);
      const challenge = fromB64(data.challenge);
      const response = await hmacSHA256(masterKey, challenge);

      const payload = {
        usernameHash: b64(usernameHash),
        response: b64(response),
        requiresTOTP: data.requiresTOTP,
        salt: b64(salt)
      };

      setChallengeData(payload);
      if (data.requiresTOTP) setStep('totp');
      else await finishLogin(payload, masterKey);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleTOTP(e) {
    e.preventDefault();
    setLoading(true);
    await finishLogin({ ...challengeData, totpCode }, null);
    setLoading(false);
  }

  async function finishLogin(payload, cachedMasterKey) {
    try {
      const res = await fetch(`${API}/auth/login/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      let data;
      const ct = res.headers.get('content-type');
      if (ct && ct.includes('application/json')) {
        data = await res.json();
      } else {
        const text = await res.text();
        throw new Error(text || `Server error: ${res.status}`);
      }

      if (!res.ok) throw new Error(data.error || 'Login failed');

      const { token, encryptedKeyBackup, identityPublicKey, signingPublicKey } = data;

      const salt = fromB64(challengeData.salt);
      const masterKey = cachedMasterKey || await deriveKey(password, salt);

      const backupKey = await deriveBackupKey(masterKey, salt);
      const backupBytes = fromB64(encryptedKeyBackup);
      const iv = backupBytes.slice(0, 12);
      const cipher = backupBytes.slice(12);
      const backupPayload = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, backupKey, cipher);
      const backupJson = JSON.parse(new TextDecoder().decode(backupPayload));
      
      const pubBytes = fromB64(identityPublicKey);
      const sigPubBytes = fromB64(signingPublicKey);
      const identityPrivBytes = base64urlToBytes(backupJson.identity.d);
      const signingPrivBytes = base64urlToBytes(backupJson.signing.d);

      const keyPair = await importKeyPair(pubBytes, identityPrivBytes);
      const signingKeyPair = await importSigningKeyPair(sigPubBytes, signingPrivBytes);

      await storeKeys(
        { publicKey: pubBytes, privateKey: identityPrivBytes },
        { publicKey: sigPubBytes, privateKey: signingPrivBytes },
        masterKey
      );
      
      const encryptedUsername = await encryptUsername(username, masterKey);
      localStorage.setItem('token', token);
      localStorage.setItem('username', encryptedUsername);
      navigate('/chat');
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h2>Welcome back</h2>
        <p>Log in to your secure messenger.</p>
        {step === 'password' ? (
          <form onSubmit={handlePassword}>
            <input placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} required />
            <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} required />
            {error && <div className="error">{error}</div>}
            <button type="submit" disabled={loading}>{loading ? 'Authenticating...' : 'Log In'}</button>
          </form>
        ) : (
          <form onSubmit={handleTOTP}>
            <p style={{ marginBottom: 12, color: 'var(--text-secondary)' }}>Enter the 6-digit code from your authenticator</p>
            <input value={totpCode} onChange={e => setTotpCode(e.target.value)} maxLength={6} placeholder="000000" required />
            {error && <div className="error">{error}</div>}
            <button type="submit" disabled={loading}>{loading ? 'Verifying...' : 'Verify'}</button>
          </form>
        )}
        <p style={{ marginTop: 16, textAlign: 'center', fontSize: 13 }}>
          Need an account? <Link to="/register" style={{ color: '#5865F2', textDecoration: 'none' }}>Register</Link>
        </p>
      </div>
    </div>
  );
}

async function deriveBackupKey(masterKey, salt) {
  const base = await crypto.subtle.importKey('raw', masterKey, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode('backup') },
    base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']
  );
}

async function sha256(data) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data));
}

async function hmacSHA256(key, data) {
  const ckey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', ckey, data));
}

function b64(bytes) {
  return btoa(String.fromCharCode(...bytes));
}

function fromB64(str) {
  const b = atob(str);
  return new Uint8Array([...b].map(c => c.charCodeAt(0)));
}

function base64urlToBytes(str) {
  const pad = '='.repeat((4 - str.length % 4) % 4);
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(base64);
  return new Uint8Array([...bin].map(c => c.charCodeAt(0)));
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