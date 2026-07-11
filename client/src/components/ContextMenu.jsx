import { useState } from 'react';

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

export default function ContextMenu({ x, y, contact, servers, onClose, onSetNickname, onManageFriendship, onInviteToServer }) {
  const [showNickname, setShowNickname] = useState(false);
  const [nickname, setNickname] = useState(contact.nickname || '');
  const [showInvite, setShowInvite] = useState(false);

  // Prevent menu from going off-screen
  const style = {
    top: Math.min(y, window.innerHeight - 200),
    left: Math.min(x, window.innerWidth - 220)
  };

  return (
    <div className="context-menu" style={style} onClick={e => e.stopPropagation()}>
      {!showNickname && !showInvite && (
        <>
          <div className="context-item" onClick={() => setShowNickname(true)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
            Set Nickname
          </div>

          <div className="context-item" onClick={() => setShowInvite(true)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
              <circle cx="8.5" cy="7" r="4"></circle>
              <line x1="20" y1="8" x2="20" y2="14"></line>
              <line x1="23" y1="11" x2="17" y2="11"></line>
            </svg>
            Invite to Server
          </div>

          <div className="context-divider" />

          <div className="context-item danger" onClick={() => { onManageFriendship(contact); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
              <circle cx="9" cy="7" r="4"></circle>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
            </svg>
            Manage Friendship
          </div>
        </>
      )}

      {showNickname && (
        <div className="context-submenu">
          <input
            value={nickname}
            onChange={e => setNickname(e.target.value)}
            placeholder="Nickname"
            autoFocus
            onKeyDown={e => {
              if (e.key === 'Enter') {
                onSetNickname(contact, nickname);
                onClose();
              }
              if (e.key === 'Escape') setShowNickname(false);
            }}
          />
          <div className="context-actions">
            <button onClick={() => setShowNickname(false)}>Cancel</button>
            <button onClick={() => { onSetNickname(contact, nickname); onClose(); }}>Save</button>
          </div>
        </div>
      )}

      {showInvite && (
        <div className="context-submenu">
          <div className="context-subheader">Choose Server</div>
          {servers.length === 0 && <div className="context-empty">No servers</div>}
          {servers.map(s => (
            <div
              key={s.id}
              className="context-item"
              onClick={() => { onInviteToServer(contact, s.id); onClose(); }}
            >
              <div className="server-mini-icon" style={{ background: stringToColor(s.name || 'S') }}>
                {(s.name || 'S')[0]?.toUpperCase()}
              </div>
              {s.name || 'Unnamed Server'}
            </div>
          ))}
          <div className="context-actions">
            <button onClick={() => setShowInvite(false)}>Back</button>
          </div>
        </div>
      )}
    </div>
  );
}