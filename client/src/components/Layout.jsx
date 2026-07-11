import { Outlet, useNavigate, useLocation, useParams } from 'react-router-dom';
import { useEffect, useState, useCallback } from 'react';
import { getContacts, getKeys } from '../db/indexeddb';
import { useApp } from '../context/AppContext';

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

async function decryptUsername() {
  const encrypted = localStorage.getItem('username');
  if (!encrypted) return 'You';
  try {
    const keys = await getKeys();
    if (!keys || !keys.masterKey) return 'You';
    const encKey = await crypto.subtle.importKey('raw', keys.masterKey, 'AES-GCM', false, ['decrypt']);
    const data = fromB64(encrypted);
    const iv = data.slice(0, 12);
    const ciphertext = data.slice(12);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, encKey, ciphertext);
    return new TextDecoder().decode(plaintext);
  } catch (e) {
    return 'You';
  }
}

export default function Layout() {
  const [contacts, setContacts] = useState([]);
  const [myUsername, setMyUsername] = useState('You');
  const navigate = useNavigate();
  const location = useLocation();
  const { selectedContact, setSelectedContact } = useApp();

  // True when we're inside a server route
  const inServer = location.pathname.startsWith('/server/');

  const loadContacts = useCallback(async () => {
    const c = await getContacts();
    setContacts(c);
  }, []);

  useEffect(() => {
    const t = localStorage.getItem('token');
    if (!t) {
      navigate('/login', { replace: true });
      return;
    }
    loadContacts();
    decryptUsername().then(setMyUsername);
  }, [location.pathname, loadContacts, navigate]);

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('username');
    setSelectedContact(null);
    navigate('/login');
  };

  return (
    <div className="discord-app">

      {/* Column 1 — server rail (always visible) */}
      <ServerRail navigate={navigate} location={location} />

      {/* Column 2 — DM list OR server channel list depending on route */}
      {inServer ? (
        <ServerChannelSidebar />
      ) : (
        <DMSidebar
          contacts={contacts}
          selectedContact={selectedContact}
          setSelectedContact={setSelectedContact}
          navigate={navigate}
        />
      )}

      {/* Column 3 — main content area */}
      <div className="main-content">
        <UserPanel myUsername={myUsername} logout={logout} />
        <Outlet />
      </div>

    </div>
  );
}

// ----- Column 1: server icon rail -----
function ServerRail({ navigate, location }) {
  const [servers, setServers] = useState([]);

  useEffect(() => {
    // TODO: load servers from your API / IndexedDB
    // setServers(await getServers());
  }, []);

  const isDMs = !location.pathname.startsWith('/server/');

  return (
    <nav className="server-rail">
      {/* DM button */}
      <button
        className={`server-icon ${isDMs ? 'active' : ''}`}
        onClick={() => navigate('/chat')}
        title="Direct Messages"
      >
        💬
      </button>

      <div className="server-rail-divider" />

      {/* Server icons */}
      {servers.map(s => (
        <button
          key={s.id}
          className={`server-icon ${location.pathname.startsWith(`/server/${s.id}`) ? 'active' : ''}`}
          onClick={() => navigate(`/server/${s.id}`)}
          title={s.name}
          style={{ background: stringToColor(s.name) }}
        >
          {s.name?.[0]?.toUpperCase()}
        </button>
      ))}

      {/* Create server button */}
      <button
        className="server-icon server-icon-add"
        onClick={() => navigate('/servers/create')}
        title="Create Server"
      >
        +
      </button>
    </nav>
  );
}

// ----- Column 2a: DM sidebar -----
function DMSidebar({ contacts, selectedContact, setSelectedContact, navigate }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="logo">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 8, flexShrink: 0 }}>
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
          </svg>
          Direct Messages
        </div>
      </div>

      <div className="dm-section">
        <div className="section-header">
          <span>Conversations</span>
          <button className="add-btn" onClick={() => navigate('/contacts')} title="Add Contact">+</button>
        </div>
        <div className="dm-list">
          {contacts.map(c => (
            <div
              key={c.usernameHash}
              className={`dm-item ${selectedContact === c.usernameHash ? 'active' : ''}`}
              onClick={() => {
                setSelectedContact(c.usernameHash);
                navigate('/chat');
              }}
            >
              <div className="dm-avatar" style={{ background: stringToColor(c.username) }}>
                {c.username?.[0]?.toUpperCase() || '?'}
              </div>
              <div className="dm-name">{c.username}</div>
            </div>
          ))}
          {contacts.length === 0 && (
            <div className="dm-empty">No conversations yet. Add a contact!</div>
          )}
        </div>
      </div>
    </aside>
  );
}

// ----- Column 2b: server channel sidebar -----
function ServerChannelSidebar() {
  const { serverId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [server, setServer] = useState(null);
  const [channels, setChannels] = useState([]);

  useEffect(() => {
    if (!serverId) return;
    // TODO: load server info and channels from your API
    // const data = await fetchServer(serverId);
    // setServer(data.server);
    // setChannels(data.channels);
  }, [serverId]);

  const activeChannelId = location.pathname.split('/channel/')[1];

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="logo">{server?.name || 'Server'}</div>
      </div>

      <div className="dm-section">
        <div className="section-header">
          <span>Channels</span>
          {/* TODO: show only if user is admin */}
          <button className="add-btn" title="Create Channel">+</button>
        </div>
        <div className="dm-list">
          {channels.map(ch => (
            <div
              key={ch.id}
              className={`dm-item ${activeChannelId === ch.id ? 'active' : ''}`}
              onClick={() => navigate(`/server/${serverId}/channel/${ch.id}`)}
            >
              <span style={{ marginRight: 8, opacity: 0.6 }}>#</span>
              <div className="dm-name">{ch.name}</div>
            </div>
          ))}
          {channels.length === 0 && (
            <div className="dm-empty">No channels yet.</div>
          )}
        </div>
      </div>
    </aside>
  );
}

// ----- User panel (bottom of column 3) -----
function UserPanel({ myUsername, logout }) {
  return (
    <div className="user-panel">
      <div className="user-avatar" style={{ background: stringToColor(myUsername) }}>
        {myUsername[0]?.toUpperCase()}
      </div>
      <div className="user-info">
        <div className="user-name">{myUsername}</div>
        <div className="user-status">Online</div>
      </div>
      <button className="logout-btn" onClick={logout} title="Logout">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
        </svg>
      </button>
    </div>
  );
}

function fromB64(str) {
  const b = atob(str);
  return new Uint8Array([...b].map(c => c.charCodeAt(0)));
}
