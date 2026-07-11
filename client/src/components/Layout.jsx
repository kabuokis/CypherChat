import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { getContacts, getKeys, getServers, getMessages, updateContact, deleteContact } from '../db/indexeddb';
import { useApp } from '../context/AppContext';
import ServerSidebar from './ServerSidebar';
import ContextMenu from './ContextMenu';

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

function fromB64(str) {
  const b = atob(str);
  return new Uint8Array([...b].map(c => c.charCodeAt(0)));
}

function b64(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  const chunk = 65535;
  for (let i = 0; i < arr.length; i += chunk) {
    bin += String.fromCharCode(...arr.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export default function Layout() {
  const [contacts, setContacts] = useState([]);
  const [servers, setServers] = useState([]);
  const [token, setToken] = useState(null);
  const [myUsername, setMyUsername] = useState('You');
  const [unreadMap, setUnreadMap] = useState({});
  const [showFriendModal, setShowFriendModal] = useState(false);
  const [friendModalContact, setFriendModalContact] = useState(null);
  const navigate = useNavigate();
  const location = useLocation();
  
  // NUCLEAR FIX: Check actual browser URL, not React Router's nested location
  const isServerView = typeof window !== 'undefined' && window.location.pathname.startsWith('/server/');
  
  const { selectedContact, setSelectedContact, selectedServer, setSelectedServer, selectedChannel, setSelectedChannel, contextMenu, setContextMenu } = useApp();

  const loadContacts = useCallback(async () => {
    const c = await getContacts();
    setContacts(c.filter(c => !c.blocked));
  }, []);

  const loadServers = useCallback(async () => {
    const s = await getServers();
    setServers(s);
  }, []);

  const computeUnread = useCallback(async () => {
    const msgs = await getMessages();
    const map = {};
    for (const c of contacts) {
      const lastRead = parseInt(localStorage.getItem(`lastRead:${c.usernameHash}`) || '0');
      const count = msgs.filter(m => !m.isMine && m.senderHash === c.usernameHash && m.timestamp > lastRead).length;
      if (count > 0) map[c.usernameHash] = count;
    }
    setUnreadMap(map);
  }, [contacts]);

  useEffect(() => {
    const t = localStorage.getItem('token');
    if (!t) {
      navigate('/login', { replace: true });
      return;
    }
    setToken(t);
    loadContacts();
    loadServers();
    decryptUsername().then(setMyUsername);
  }, [location.pathname, loadContacts, loadServers, navigate]);

  useEffect(() => {
    computeUnread();
    const id = setInterval(computeUnread, 5000);
    return () => clearInterval(id);
  }, [computeUnread]);

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('username');
    setSelectedContact(null);
    setSelectedServer(null);
    setSelectedChannel(null);
    navigate('/login');
  };

  const handleContextMenu = (e, contact) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      contact
    });
  };

  const openFriendModal = (contact) => {
    setFriendModalContact(contact);
    setShowFriendModal(true);
    setContextMenu(null);
  };

  const handleInviteToServer = async (contact, serverId) => {
    try {
      const res = await fetch(`/api/invites`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
          serverId,
          encryptedKeyBundle: b64(crypto.getRandomValues(new Uint8Array(32))),
          usesLeft: 1
        })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to create invite');
      }
      const { code } = await res.json();
      const inviteLink = `${window.location.origin}/invite/${code}`;
      await navigator.clipboard.writeText(inviteLink);
      alert(`Invite link copied to clipboard!\nShare it with ${contact.username}`);
    } catch (err) {
      alert('Failed to create invite: ' + err.message);
    }
  };

  const handleSetNickname = async (contact, nickname) => {
    const updated = { ...contact, nickname };
    await updateContact(updated);
    loadContacts();
  };

  const handleBlock = async (contact) => {
    const updated = { ...contact, blocked: true };
    await updateContact(updated);
    await deleteContact(contact.usernameHash);
    setShowFriendModal(false);
    loadContacts();
  };

  const handleRemove = async (contact) => {
    await deleteContact(contact.usernameHash);
    setShowFriendModal(false);
    loadContacts();
  };

  return (
    <div className="discord-app" onClick={() => setContextMenu(null)}>
      {/* Far left: Server list (always visible) */}
      <ServerSidebar servers={servers} loadServers={loadServers} />

      {/* Middle: DM sidebar (HIDDEN when in server view) */}
      {!isServerView && (
        <aside className="sidebar">
          <div className="sidebar-header">
            <div className="logo">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 8, flexShrink: 0 }}>
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
              </svg>
              CypherChat
            </div>
          </div>

          <div className="dm-section">
            <div className="section-header">
              <span>Direct Messages</span>
              <button className="add-btn" onClick={() => navigate('/contacts')} title="Add Contact">+</button>
            </div>
            <div className="dm-list">
              {contacts.map(c => (
                <div
                  key={c.usernameHash}
                  className={`dm-item ${selectedContact === c.usernameHash && !selectedServer ? 'active' : ''}`}
                  onClick={() => {
                    setSelectedContact(c.usernameHash);
                    setSelectedServer(null);
                    setSelectedChannel(null);
                    navigate('/chat');
                  }}
                  onContextMenu={(e) => handleContextMenu(e, c)}
                >
                  <div className="dm-avatar-wrapper">
                    <div className="dm-avatar" style={{ background: stringToColor(c.nickname || c.username) }}>
                      {(c.nickname || c.username)?.[0]?.toUpperCase() || '?'}
                    </div>
                    <div className="status-dot online" />
                    {unreadMap[c.usernameHash] > 0 && (
                      <div className="unread-badge">{unreadMap[c.usernameHash]}</div>
                    )}
                  </div>
                  <div className="dm-name">{c.nickname || c.username}</div>
                  <button className="dm-menu-btn" onClick={(e) => { e.stopPropagation(); handleContextMenu(e, c); }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                      <circle cx="12" cy="5" r="2" />
                      <circle cx="12" cy="12" r="2" />
                      <circle cx="12" cy="19" r="2" />
                    </svg>
                  </button>
                </div>
              ))}
              {contacts.length === 0 && (
                <div className="dm-empty">No conversations yet. Add a contact!</div>
              )}
            </div>
          </div>

          <div className="user-panel">
            <div className="user-avatar-wrapper">
              <div className="user-avatar" style={{ background: stringToColor(myUsername) }}>
                {myUsername[0]?.toUpperCase()}
              </div>
              <div className="status-dot online" />
            </div>
            <div className="user-info">
              <div className="user-name">{myUsername}</div>
              <div className="user-status">Online</div>
            </div>
            <button className="logout-btn" onClick={logout} title="Logout">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>
              </svg>
            </button>
          </div>
        </aside>
      )}

      {/* Main content area */}
      <main className="main-content">
        <Outlet />
      </main>

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          contact={contextMenu.contact}
          servers={servers}
          onClose={() => setContextMenu(null)}
          onSetNickname={handleSetNickname}
          onManageFriendship={openFriendModal}
          onInviteToServer={handleInviteToServer}
        />
      )}

      {/* Friendship Modal */}
      {showFriendModal && friendModalContact && (
        <div className="modal-overlay" onClick={() => setShowFriendModal(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <h3>Manage Friendship</h3>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>
              {friendModalContact.username}
            </p>
            <div className="friendship-actions">
              <button className="danger-btn" onClick={() => handleBlock(friendModalContact)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                </svg>
                Block User
              </button>
              <p className="action-desc">Removes from friends. Future friend requests will be automatically rejected.</p>

              <button className="secondary-btn" onClick={() => handleRemove(friendModalContact)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="8.5" cy="7" r="4" />
                  <line x1="18" y1="8" x2="23" y2="13" />
                  <line x1="23" y1="8" x2="18" y2="13" />
                </svg>
                Remove Friend
              </button>
              <p className="action-desc">Removes from friends list. You can add them again later.</p>
            </div>
            <button className="modal-close" onClick={() => setShowFriendModal(false)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}