import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { storeContact, getContacts } from '../db/indexeddb';

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

export default function Contacts() {
  const [username, setUsername] = useState('');
  const [contacts, setContacts] = useState([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const navigate = useNavigate();

  useEffect(() => { load(); }, []);

  async function load() {
    setContacts(await getContacts());
  }

  async function handleAdd(e) {
    e.preventDefault();
    setError('');
    setSuccess('');
    try {
      const hash = await sha256(new TextEncoder().encode(username));
      const hashB64 = b64(hash);
      const res = await fetch(`${API}/contacts/search/${encodeURIComponent(hashB64)}`);
      if (!res.ok) throw new Error('User not found');

      let data;
      const ct = res.headers.get('content-type');
      if (ct && ct.includes('application/json')) {
        data = await res.json();
      } else {
        throw new Error('Unexpected server response');
      }

      await storeContact({ 
        usernameHash: hashB64, 
        username, 
        publicKey: data.publicKey,
        signingPublicKey: data.signingPublicKey
      });
      setSuccess(`Added ${username}`);
      setUsername('');
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="page-container">
      <a className="back-link" onClick={() => navigate('/chat')} style={{ cursor: 'pointer' }}>
        ← Back to Chat
      </a>

      <div className="page-card">
        <h2>Add Contact</h2>
        <p>Search for a user by their exact username to start an encrypted conversation.</p>
        <form onSubmit={handleAdd}>
          <input placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} required />
          {error && <div className="error">{error}</div>}
          {success && <div className="success">{success}</div>}
          <button type="submit">Search & Add</button>
        </form>
      </div>

      <div className="page-card">
        <h2>Your Contacts</h2>
        {contacts.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>No contacts yet.</p>
        ) : (
          contacts.map(c => (
            <div key={c.usernameHash} className="contact-item">
              <div className="contact-avatar" style={{ background: stringToColor(c.username) }}>
                {c.username?.[0]?.toUpperCase()}
              </div>
              <div className="contact-info">
                <div className="contact-name">{c.username}</div>
                <div className="contact-hash">{c.usernameHash.slice(0, 24)}...</div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

async function sha256(data) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data));
}

function b64(bytes) {
  return btoa(String.fromCharCode(...bytes));
}