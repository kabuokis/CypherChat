import { useParams, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { getKeys, storeServer } from '../db/indexeddb';
import { decryptGroupKey, decryptWithGroupKey, encryptGroupKeyForMember, b64, fromB64 } from '../crypto/groupKeys';
import { importKeyPair } from '../crypto/keys';

export default function InviteAccept() {
  const { code } = useParams();
  const navigate = useNavigate();
  const [invite, setInvite] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const token = localStorage.getItem('token');

  useEffect(() => { fetchInvite(); }, [code]);

  async function fetchInvite() {
    try {
      const res = await fetch(`/api/invites/${code}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(err.error || 'Invalid or expired invite link.');
        return;
      }
      setInvite(await res.json());
    } catch (e) {
      setError('Could not reach the server.');
    } finally {
      setLoading(false);
    }
  }

  async function handleJoin() {
    if (!token) {
      sessionStorage.setItem('pendingInvite', code);
      navigate('/login');
      return;
    }
    setJoining(true);
    try {
      const keys = await getKeys();
      const keyPair = await importKeyPair(keys.publicKey, keys.privateKey);

      // Unpack bundle: [2 bytes keyLen][encryptedAesKey][12 bytes iv][ciphertext]
      const bundleBytes = fromB64(invite.encryptedKeyBundle);
      const keyLen = new DataView(bundleBytes.buffer, bundleBytes.byteOffset).getUint16(0, false);
      const encryptedAesKey = bundleBytes.slice(2, 2 + keyLen);
      const iv = bundleBytes.slice(2 + keyLen, 2 + keyLen + 12);
      const ciphertext = bundleBytes.slice(2 + keyLen + 12);

      // Decrypt the AES key using our identity private key
      const bundleAesKey = await decryptGroupKey(encryptedAesKey, keyPair);

      // Decrypt the bundle payload
      const bundle = await decryptWithGroupKey(bundleAesKey, ciphertext, iv);
      // bundle = { serverKey, serverName, channels: [{id, key, name}] }

      const serverKeyRaw = fromB64(bundle.serverKey);

      // Re-encrypt server key for self
      const encryptedServerKey = await encryptGroupKeyForMember(serverKeyRaw, keys.publicKey);

      // Re-encrypt each channel key for self
      const encryptedChannelKeys = await Promise.all(
        (bundle.channels || []).map(async ch => ({
          channelId: ch.id,
          encryptedChannelKey: b64(new Uint8Array(
            await encryptGroupKeyForMember(fromB64(ch.key), keys.publicKey)
          ))
        }))
      );

      // Join the server
      const res = await fetch(`/api/invites/${code}/join`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          encryptedServerKey: b64(new Uint8Array(encryptedServerKey)),
          encryptedChannelKeys
        })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to join server');
      }

      const data = await res.json();

      // Store server locally with decrypted names from bundle
      await storeServer({
        id: data.serverId,
        name: bundle.serverName || 'Server',
        role: 'member',
        serverKey: b64(serverKeyRaw),
        channels: (bundle.channels || []).map(ch => ({
          id: ch.id,
          name: ch.name || 'channel',
          channelKey: ch.key,
          type: 'text',
          isPrivate: false
        }))
      });

      navigate(`/server/${data.serverId}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setJoining(false);
    }
  }

  if (loading) return (
    <div style={styles.page}>
      <div style={styles.card}>
        <p style={styles.sub}>Loading invite...</p>
      </div>
    </div>
  );

  if (error) return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
        <h2 style={styles.title}>Invite Error</h2>
        <p style={styles.sub}>{error}</p>
        <button style={styles.btnSecondary} onClick={() => navigate(token ? '/chat' : '/login')}>
          {token ? 'Go to Chat' : 'Log In'}
        </button>
      </div>
    </div>
  );

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={{ fontSize: 48, marginBottom: 8 }}>🔐</div>
        <p style={styles.eyebrow}>You've been invited to join</p>
        <h2 style={styles.title}>a CypherChat server</h2>
        <p style={styles.sub}>End-to-end encrypted · Private by design</p>
        {invite.usesLeft !== null && (
          <p style={styles.meta}>{invite.usesLeft} use{invite.usesLeft !== 1 ? 's' : ''} remaining</p>
        )}
        {!token ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
            <button style={styles.btnPrimary} onClick={() => { sessionStorage.setItem('pendingInvite', code); navigate('/login'); }}>
              Log in to Accept
            </button>
            <button style={styles.btnSecondary} onClick={() => { sessionStorage.setItem('pendingInvite', code); navigate('/register'); }}>
              Create Account
            </button>
          </div>
        ) : (
          <button style={{ ...styles.btnPrimary, opacity: joining ? 0.7 : 1 }} onClick={handleJoin} disabled={joining}>
            {joining ? 'Joining...' : 'Accept Invite'}
          </button>
        )}
      </div>
    </div>
  );
}

const styles = {
  page: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-primary, #1a1b1e)', fontFamily: 'var(--font-sans, system-ui, sans-serif)' },
  card: { background: 'var(--surface-0, #2b2d31)', border: '0.5px solid var(--border, #3a3b3f)', borderRadius: 16, padding: '40px 32px', width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, textAlign: 'center' },
  eyebrow: { fontSize: 13, color: 'var(--text-muted, #72767d)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 },
  title: { fontSize: 22, fontWeight: 700, color: 'var(--text-primary, #f2f3f5)', margin: 0 },
  sub: { fontSize: 14, color: 'var(--text-secondary, #b5bac1)', margin: 0 },
  meta: { fontSize: 12, color: 'var(--text-muted, #72767d)', margin: 0 },
  btnPrimary: { width: '100%', padding: '12px 0', borderRadius: 8, border: 'none', background: '#5865F2', color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer', marginTop: 8 },
  btnSecondary: { width: '100%', padding: '12px 0', borderRadius: 8, border: '0.5px solid var(--border, #3a3b3f)', background: 'transparent', color: 'var(--text-secondary, #b5bac1)', fontSize: 15, fontWeight: 500, cursor: 'pointer' },
};