import { useParams, useNavigate } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { getServers, getKeys, storeServerMessage, getServerMessages, setLastRead } from '../db/indexeddb';
import { decryptWithGroupKey, encryptWithGroupKey, b64, fromB64 } from '../crypto/groupKeys';
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

const ChevronIcon = ({ collapsed }) => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.15s', flexShrink: 0 }}>
    <polyline points="6 9 12 15 18 9"></polyline>
  </svg>
);

const HashIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="4" y1="9" x2="20" y2="9"></line>
    <line x1="4" y1="15" x2="20" y2="15"></line>
    <line x1="10" y1="3" x2="8" y2="21"></line>
    <line x1="16" y1="3" x2="14" y2="21"></line>
  </svg>
);

const LockIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
    <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
  </svg>
);

const SpeakerIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
    <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
  </svg>
);

export default function ServerView() {
  const { serverId } = useParams();
  const { selectedChannel, setSelectedChannel } = useApp();
  const [server, setServer] = useState(null);
  const [channels, setChannels] = useState([]);
  const [categories, setCategories] = useState({});
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [collapsedCategories, setCollapsedCategories] = useState({});
  const [myRole, setMyRole] = useState('member');
  const messagesEndRef = useRef(null);
  const interval = useRef(null);

  useEffect(() => {
    loadServer();
    interval.current = setInterval(pollMessages, 3000);
    return () => clearInterval(interval.current);
  }, [serverId]);

  useEffect(() => {
    if (selectedChannel) {
      loadChannelMessages();
      setLastRead(`server:${serverId}:${selectedChannel}`, Date.now());
    }
  }, [selectedChannel]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function loadServer() {
    const servers = await getServers();
    let s = servers.find(srv => srv.id === serverId);

    if (!s) {
      // Fetch from server
      const res = await fetch(`${API}/servers/${serverId}/keys`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      if (!res.ok) {
        setServer({ error: true });
        return;
      }
      const data = await res.json();
      // For now, use placeholder - in production decrypt names
      s = {
        id: serverId,
        name: 'Server',
        role: 'member',
        serverKey: data.encryptedServerKey,
        channels: data.channels.map(c => ({
          id: c.channelId,
          name: 'channel',
          channelKey: c.encryptedChannelKey,
          isPrivate: c.isPrivate,
          roleRequired: c.roleRequired,
          type: 'text'
        }))
      };
    }

    setServer(s);
    setMyRole(s.role || 'member');

    // Build categories
    const defaultCategories = {
      'TEXT CHANNELS': s.channels.filter(c => c.type !== 'voice' && !c.isPrivate),
      'VOICE CHANNELS': s.channels.filter(c => c.type === 'voice'),
    };
    if (s.channels.some(c => c.isPrivate)) {
      defaultCategories['PRIVATE'] = s.channels.filter(c => c.isPrivate);
    }
    setCategories(defaultCategories);
    setChannels(s.channels);

    // Auto-select first channel
    if (!selectedChannel && s.channels.length > 0) {
      const first = s.channels.find(c => !c.isPrivate) || s.channels[0];
      setSelectedChannel(first.id);
    }
  }

  async function loadChannelMessages() {
    if (!selectedChannel) return;
    const local = await getServerMessages(selectedChannel);
    setMessages(local.sort((a, b) => a.sequenceNumber - b.sequenceNumber));

    const lastSeq = local.length > 0 ? local[local.length - 1].sequenceNumber : 0;
    const res = await fetch(`${API}/channels/${selectedChannel}/messages?after=${lastSeq}`, {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
    });
    if (!res.ok) return;
    const inbox = await res.json();

    const serverData = await getServers().then(s => s.find(sv => sv.id === serverId));
    const channel = serverData?.channels.find(c => c.id === selectedChannel);
    if (!channel) return;

    const channelKey = fromB64(channel.channelKey);
    const decrypted = [];

    for (const msg of inbox) {
      try {
        const payload = await decryptWithGroupKey(
          channelKey,
          fromB64(msg.ciphertextBlob),
          fromB64(msg.iv)
        );
        decrypted.push({
          id: msg.id,
          content: payload.content,
          senderUsernameHash: msg.senderUsernameHash,
          timestamp: new Date(msg.createdAt).getTime(),
          sequenceNumber: msg.sequenceNumber,
          channelId: selectedChannel
        });
      } catch (e) {
        console.error('decrypt failed', e);
      }
    }

    if (decrypted.length > 0) {
      await Promise.all(decrypted.map(m => storeServerMessage(m)));
      setMessages(prev => {
        const map = new Map([...prev, ...decrypted].map(m => [m.id, m]));
        return Array.from(map.values()).sort((a, b) => a.sequenceNumber - b.sequenceNumber);
      });
    }
  }

  async function pollMessages() {
    if (!selectedChannel) return;
    loadChannelMessages();
  }

  async function sendMessage(e) {
    e.preventDefault();
    if (!input.trim() || !selectedChannel) return;

    const serverData = await getServers().then(s => s.find(sv => sv.id === serverId));
    const channel = serverData?.channels.find(c => c.id === selectedChannel);
    if (!channel) return;

    setLoading(true);
    try {
      const channelKey = fromB64(channel.channelKey);
      const encrypted = await encryptWithGroupKey(channelKey, { content: input.trim() });

      const res = await fetch(`${API}/channels/${selectedChannel}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
          ciphertextBlob: b64(new Uint8Array(encrypted.ciphertext)),
          iv: b64(new Uint8Array(encrypted.iv))
        })
      });

      if (!res.ok) throw new Error('Send failed');

      const msg = {
        id: crypto.randomUUID(),
        content: input.trim(),
        senderUsernameHash: 'self',
        timestamp: Date.now(),
        sequenceNumber: Date.now(),
        channelId: selectedChannel,
        isMine: true
      };
      setMessages(prev => [...prev, msg]);
      await storeServerMessage(msg);
      setInput('');
    } catch (err) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  }

  function toggleCategory(name) {
    setCollapsedCategories(prev => ({ ...prev, [name]: !prev[name] }));
  }

  if (!server) {
    return (
      <div className="chat-empty">
        <div className="empty-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
        </div>
        <h2>Loading server...</h2>
      </div>
    );
  }

  if (server.error) {
    return (
      <div className="chat-empty">
        <h2>Server not found</h2>
        <p>You may not be a member of this server.</p>
      </div>
    );
  }

  return (
    <div className="server-view">
      {/* Channel Sidebar - LEFT side, replaces DM sidebar */}
      <div className="channel-sidebar">
        <div className="server-header">
          <span className="server-name">{server.name}</span>
          <ChevronIcon collapsed={false} />
        </div>

        <div className="channel-list">
          {Object.entries(categories).map(([catName, catChannels]) => (
            catChannels.length > 0 && (
              <div key={catName} className="channel-category">
                <div className="category-header" onClick={() => toggleCategory(catName)}>
                  <ChevronIcon collapsed={!!collapsedCategories[catName]} />
                  <span>{catName}</span>
                </div>
                {!collapsedCategories[catName] && (
                  <div className="category-channels">
                    {catChannels.map(ch => (
                      <div
                        key={ch.id}
                        className={`channel-item ${selectedChannel === ch.id ? 'active' : ''}`}
                        onClick={() => setSelectedChannel(ch.id)}
                      >
                        {ch.type === 'voice' ? <SpeakerIcon /> : (ch.isPrivate ? <LockIcon /> : <HashIcon />)}
                        <span className="channel-name">{ch.name || 'channel'}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          ))}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="chat-container">
        <header className="chat-header">
          {selectedChannel && (
            <>
              <HashIcon />
              <div className="chat-header-name">
                {channels.find(c => c.id === selectedChannel)?.name || 'general'}
              </div>
            </>
          )}
        </header>

        <div className="message-list">
          {messages.length === 0 && (
            <div className="chat-empty" style={{ padding: '32px 0' }}>
              <p>No messages yet. Say something!</p>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className="message-row">
              <div
                className="message-avatar"
                style={{ background: stringToColor(m.senderUsernameHash) }}
              >
                {m.senderUsernameHash === 'self' ? 'Y' : m.senderUsernameHash.slice(0, 2).toUpperCase()}
              </div>
              <div className="message-content">
                <div className="message-header">
                  <span className="message-author">
                    {m.senderUsernameHash === 'self' ? 'You' : 'User'}
                  </span>
                  <span className="message-time">
                    {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <div className="message-text">{m.content}</div>
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <form className="chat-input-area" onSubmit={sendMessage}>
          <div className="chat-input-wrapper">
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder={`Message #${channels.find(c => c.id === selectedChannel)?.name || 'general'}`}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage(e);
                }
              }}
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="send-btn"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"></line>
                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
              </svg>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}