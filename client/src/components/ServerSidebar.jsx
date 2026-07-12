import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { getKeys, storeServer } from '../db/indexeddb';
import { generateGroupKey, encryptGroupKeyForMember, encryptWithGroupKey, b64 } from '../crypto/groupKeys';
import { importKeyPair } from '../crypto/keys';

const API = '/api';

const COLORS = [
  '#5865F2', '#EB459E', '#3BA55D', '#FAA61A', '#ED4245',
  '#45D6F6', '#9B59B6', '#E67E22', '#1ABC9C', '#E91E63'
];

function stringToColor(str) {
  if (!str) return '#5865F2';
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return COLORS[Math.abs(hash) % COLORS.length];
}

export default function ServerSidebar({ servers, loadServers }) {
  const [showCreate, setShowCreate] = useState(false);
  const [serverName, setServerName] = useState('');
  const [loading, setLoading] = useState(false);
  const { selectedServer, setSelectedServer, setSelectedContact, setSelectedChannel } = useApp();
  const navigate = useNavigate();

  async function createServer(e) {
  e.preventDefault();
    setLoading(true);
    try {
        const keys = await getKeys();
        const keyPair = await importKeyPair(keys.publicKey, keys.privateKey);

        // Generate raw group keys
        const serverKey = await generateGroupKey();        // Uint8Array(32)
        const generalKey = await generateGroupKey();        // Uint8Array(32)

        // Encrypt names with serverKey
        const encryptedServerName = await encryptWithGroupKey(serverKey, { name: serverName });
        const encryptedGeneralName = await encryptWithGroupKey(serverKey, { name: 'general' });

        // Encrypt group keys for self (X25519 + HKDF wrapping)
        const encryptedServerKey = await encryptGroupKeyForMember(serverKey, keys.publicKey);
        const encryptedGeneralKey = await encryptGroupKeyForMember(generalKey, keys.publicKey);

        // Hash for channel key verification
        const generalKeyHash = new Uint8Array(await crypto.subtle.digest('SHA-256', generalKey));

        const res = await fetch(`${API}/servers`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
            encryptedName: b64(new Uint8Array(encryptedServerName.ciphertext)),
            encryptedIcon: null,
            encryptedServerKey: b64(new Uint8Array(encryptedServerKey)),
            channels: [{
            encryptedName: b64(new Uint8Array(encryptedGeneralName.ciphertext)),
            channelKeyHash: b64(generalKeyHash),
            isPrivate: false,
            roleRequired: 'member',
            encryptedChannelKey: b64(new Uint8Array(encryptedGeneralKey))
            }]
        })
        });

        if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to create server');
        }
        const data = await res.json();

        // Store locally with real channel IDs from server response
        await storeServer({
        id: data.serverId,
        name: serverName,
        role: 'admin',
        serverKey: b64(serverKey),
        channels: (data.channels || []).map((ch, i) => ({
            id: ch.channelId,
            name: i === 0 ? 'general' : `channel-${i}`,
            channelKey: b64(generalKey)
        }))
        });

        setShowCreate(false);
        setServerName('');
        loadServers();
    } catch (err) {
        alert(err.message);
    } finally {
        setLoading(false);
    }
    }

  async function joinServer() {
    const code = prompt('Enter invite code:');
    if (!code) return;
    try {
      const keys = await getKeys();
      const keyPair = await importKeyPair(keys.publicKey, keys.privateKey);

      // Get invite info
      const infoRes = await fetch(`${API}/invites/${code}`);
      if (!infoRes.ok) throw new Error('Invalid invite');
      const info = await infoRes.json();

      // Decrypt key bundle from invite (in real app, key is in URL fragment)
      // For now, server sends it - this is a simplified flow
      const encryptedKeyBundle = fromB64(info.encryptedKeyBundle);
      // ... decrypt bundle to get serverKey and channelKeys

      // Re-encrypt for self
      const encryptedServerKey = await encryptGroupKeyForMember(serverKey, keys.publicKey);
      // ... upload join request

      alert('Joined server!');
      loadServers();
    } catch (err) {
      alert(err.message);
    }
  }

  return (
    <div className="server-sidebar">
      <div
        className={`server-pill ${!selectedServer ? 'active' : ''}`}
        onClick={() => {
          setSelectedServer(null);
          setSelectedChannel(null);
          navigate('/chat');
        }}
        title="Direct Messages"
      >
        <div className="server-icon home">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
            <polyline points="9 22 9 12 15 12 15 22"></polyline>
          </svg>
        </div>
      </div>

      <div className="server-divider" />

      {servers.map(s => (
        <div
          key={s.id}
          className={`server-pill ${selectedServer === s.id ? 'active' : ''}`}
          onClick={() => {
            setSelectedServer(s.id);
            setSelectedContact(null);
            setSelectedChannel(null);
            navigate(`/server/${s.id}`);
          }}
          title={s.name || 'Server'}
        >
          <div className="server-icon" style={{ background: stringToColor(s.name || 'S') }}>
            {(s.name || 'S')[0]?.toUpperCase()}
          </div>
        </div>
      ))}

      <div className="server-pill" onClick={() => setShowCreate(true)} title="Create Server">
        <div className="server-icon add">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
        </div>
      </div>

      <div className="server-pill" onClick={joinServer} title="Join Server">
        <div className="server-icon add">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path>
            <polyline points="10 17 15 12 10 7"></polyline>
            <line x1="15" y1="12" x2="3" y2="12"></line>
          </svg>
        </div>
      </div>

      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <h3>Create Server</h3>
            <form onSubmit={createServer}>
              <input
                placeholder="Server Name"
                value={serverName}
                onChange={e => setServerName(e.target.value)}
                required
                maxLength={100}
              />
              <div className="modal-actions">
                <button type="button" className="secondary-btn" onClick={() => setShowCreate(false)}>Cancel</button>
                <button type="submit" disabled={loading} className="primary-btn">
                  {loading ? 'Creating...' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function fromB64(str) {
  const b = atob(str);
  return new Uint8Array([...b].map(c => c.charCodeAt(0)));
}