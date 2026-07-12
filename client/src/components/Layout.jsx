import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useState, useCallback } from 'react';
import { getServers, getKeys } from '../db/indexeddb';
import { useApp } from '../context/AppContext';
import ServerSidebar from './ServerSidebar';

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
    const { getKeys } = await import('../db/indexeddb');
    const keys = await getKeys();
    if (!keys || !keys.masterKey) return 'You';
    const encKey = await crypto.subtle.importKey('raw', keys.masterKey, 'AES-GCM', false, ['decrypt']);
    const b = atob(encrypted);
    const data = new Uint8Array([...b].map(c => c.charCodeAt(0)));
    const iv = data.slice(0, 12);
    const ciphertext = data.slice(12);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, encKey, ciphertext);
    return new TextDecoder().decode(plaintext);
  } catch (e) {
    return 'You';
  }
}

export default function Layout() {
  const [servers, setServers] = useState([]);
  const [myUsername, setMyUsername] = useState('You');
  const navigate = useNavigate();
  const location = useLocation();
  const { setSelectedContact, setSelectedServer, setSelectedChannel, serverData, selectedChannel, setSelectedChannel: selectChannel } = useApp();

  const loadServers = useCallback(async () => {
    const s = await getServers();
    setServers(s || []);
  }, []);

  useEffect(() => {
    const t = localStorage.getItem('token');
    if (!t) { navigate('/login', { replace: true }); return; }
    loadServers();
    decryptUsername().then(setMyUsername);
  }, [location.pathname, loadServers, navigate]);

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('username');
    setSelectedContact(null);
    setSelectedServer(null);
    setSelectedChannel(null);
    navigate('/login');
  };

  // Extract serverId from URL
  const serverId = location.pathname.split('/server/')[1]?.split('/')[0];

  const server = serverData?.server;
  const categories = serverData?.categories || {};
  const [collapsedCategories, setCollapsedCategories] = useState({});

  function toggleCategory(name) {
    setCollapsedCategories(prev => ({ ...prev, [name]: !prev[name] }));
  }

  return (
    <div className="discord-app">

      {/* Column 1 — server rail */}
      <ServerSidebar servers={servers} loadServers={loadServers} />

      {/* Column 2 — channel sidebar */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="logo">{server?.name || 'Server'}</div>
        </div>

        <div className="channel-list" style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          {Object.entries(categories).map(([catName, catChannels]) =>
            catChannels.length > 0 && (
              <div key={catName} className="channel-category">
                <div
                  className="category-header"
                  onClick={() => toggleCategory(catName)}
                  style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', cursor: 'pointer', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                    style={{ transform: collapsedCategories[catName] ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.15s', flexShrink: 0 }}>
                    <polyline points="6 9 12 15 18 9"></polyline>
                  </svg>
                  {catName}
                </div>
                {!collapsedCategories[catName] && (
                  <div>
                    {catChannels.map(ch => (
                      <div
                        key={ch.id}
                        className={`channel-item ${selectedChannel === ch.id ? 'active' : ''}`}
                        onClick={() => {
                          selectChannel(ch.id);
                          navigate(`/server/${serverId}/channel/${ch.id}`);
                        }}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px 4px 16px', cursor: 'pointer', borderRadius: 4, margin: '1px 8px', color: selectedChannel === ch.id ? 'var(--text-primary)' : 'var(--text-muted)' }}
                      >
                        {ch.isPrivate ? (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                            <rect x="3" y="11" width="18" height="11" rx="2"></rect>
                            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                          </svg>
                        ) : (
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                            <line x1="4" y1="9" x2="20" y2="9"></line>
                            <line x1="4" y1="15" x2="20" y2="15"></line>
                            <line x1="10" y1="3" x2="8" y2="21"></line>
                            <line x1="16" y1="3" x2="14" y2="21"></line>
                          </svg>
                        )}
                        <span style={{ fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {ch.name || 'channel'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          )}
          {Object.keys(categories).length === 0 && (
            <div style={{ padding: '16px', fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
              Loading channels...
            </div>
          )}
        </div>

        {/* User panel at bottom */}
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
      </aside>

      {/* Column 3 — chat area via Outlet */}
      <main className="main-content" style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
        <Outlet />
      </main>

    </div>
  );
}