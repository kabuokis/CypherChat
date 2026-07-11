import { useState, useEffect, useRef, useCallback } from 'react';
import { getKeys } from '../db/indexeddb';
import { getContacts, storeMessage, getMessages } from '../db/indexeddb';
import { encryptMessage, decryptMessage } from '../crypto/e2e';
import { importKeyPair, importSigningKeyPair, importPublicKey } from '../crypto/keys';
import { stripExifAndEncrypt, decryptFile, formatBytes } from '../crypto/files';
import { useApp } from '../context/AppContext';

const API = '/api';
const MAX_FILE_BYTES = 5 * 1024 * 1024;

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

const TTL_OPTIONS = [
  { label: 'Off', value: 0 },
  { label: '1 min', value: 60 },
  { label: '1 hr', value: 3600 },
  { label: '1 day', value: 86400 },
  { label: '1 week', value: 604800 },
];

const ChatBubbleIcon = () => (
  <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
  </svg>
);

const UploadIcon = () => (
  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
    <polyline points="17 8 12 3 7 8"></polyline>
    <line x1="12" y1="3" x2="12" y2="15"></line>
  </svg>
);

const ImageIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
    <circle cx="8.5" cy="8.5" r="1.5"></circle>
    <polyline points="21 15 16 10 5 21"></polyline>
  </svg>
);

const PaperclipIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>
  </svg>
);

const ClockIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"></circle>
    <polyline points="12 6 12 12 16 14"></polyline>
  </svg>
);

const SpinnerIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'spin 1s linear infinite' }}>
    <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    <line x1="12" y1="2" x2="12" y2="6"></line>
    <line x1="12" y1="18" x2="12" y2="22"></line>
    <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line>
    <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line>
    <line x1="2" y1="12" x2="6" y2="12"></line>
    <line x1="18" y1="12" x2="22" y2="12"></line>
    <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line>
    <line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line>
  </svg>
);

async function getDecryptedUsername() {
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

export default function Chat() {
  const [messages, setMessages] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [ttl, setTtl] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [pendingAttachment, setPendingAttachment] = useState(null);
  const [myUsername, setMyUsername] = useState('You');
  const { selectedContact } = useApp();
  const interval = useRef(null);
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const dropZoneRef = useRef(null);

  useEffect(() => {
    init();
    getDecryptedUsername().then(setMyUsername);
    // NOTE: 5-second polling is a temporary measure. WebSockets will eliminate
    // predictable timing metadata and remove the "active user" beacon pattern.
    interval.current = setInterval(pollMessages, 5000);
    return () => clearInterval(interval.current);
  }, []);

  useEffect(() => {
    if (selectedContact) {
      loadContacts();
      setPendingAttachment(null);
      setInput('');
    }
  }, [selectedContact]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function loadContacts() {
    const c = await getContacts();
    setContacts(c);
  }

  async function init() {
    const [c, m] = await Promise.all([getContacts(), getMessages()]);
    setContacts(c);
    const valid = m.filter(msg => !msg.expiresAt || msg.expiresAt > Date.now());
    setMessages(valid.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)));
  }

  async function pollMessages() {
    const token = localStorage.getItem('token');
    if (!token) return;
    const keys = await getKeys();
    if (!keys) return;

    try {
      const res = await fetch(`${API}/messages/inbox`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) return;
      const inbox = await res.json();

      const keyPair = await importKeyPair(keys.publicKey, keys.privateKey);
      const decrypted = [];

      for (const msg of inbox) {
        try {
          const payload = await decryptMessage(
            keyPair,
            fromB64(msg.ephemeralPublicKey),
            fromB64(msg.ciphertextBlob),
            null
          );
          
          const isMine = payload.senderPublicKey.every((b, i) => b === keys.publicKey[i]);
          
          // Verify signature against trusted contact signing key
          if (!isMine && payload.senderSigningPublicKey && payload.signature) {
            const senderPubBytes = new Uint8Array(payload.senderPublicKey);
            const contact = contacts.find(c => {
              const cPub = fromB64(c.publicKey);
              return cPub.every((b, i) => b === senderPubBytes[i]);
            });
            
            if (contact && contact.signingPublicKey) {
              const trustedSigPub = fromB64(contact.signingPublicKey);
              const sigPub = await crypto.subtle.importKey(
                'raw', trustedSigPub, { name: 'Ed25519' }, true, ['verify']
              );
              const { signature, ...payloadWithoutSig } = payload;
              const payloadBytes = new TextEncoder().encode(JSON.stringify(payloadWithoutSig));
              const sigBytes = new Uint8Array(signature);
              const valid = await crypto.subtle.verify('Ed25519', sigPub, sigBytes, payloadBytes);
              if (!valid) {
                console.error('Signature verification failed for message', msg.id);
                continue;
              }
            }
          }
          
          decrypted.push({
            id: msg.id,
            content: payload.content,
            timestamp: payload.timestamp,
            isMine,
            sequenceNumber: msg.sequenceNumber,
            attachment: payload.attachment || null,
            expiresAt: payload.expiresAt || null,
          });
        } catch (e) {
          console.error('decrypt failed', e);
        }
      }

      if (decrypted.length > 0) {
        setMessages(prev => {
          const map = new Map([...prev, ...decrypted].map(m => [m.id, m]));
          const all = Array.from(map.values()).sort((a, b) => a.timestamp - b.timestamp);
          return all.filter(m => !m.expiresAt || m.expiresAt > Date.now());
        });
        await Promise.all(decrypted.map(m => storeMessage(m)));
      }
    } catch (err) {
      console.error('poll error', err);
    }
  }

  async function handleSend(e) {
    e.preventDefault();
    if (!selectedContact) return;

    const text = input.trim();
    if (!text && !pendingAttachment) return;

    await sendMessage(text || '', pendingAttachment);
    setPendingAttachment(null);
    setInput('');
  }

  async function sendMessage(text, attachment) {
    if (!selectedContact) return;
    setLoading(true);

    try {
      const keys = await getKeys();
      let contact = contacts.find(c => c.usernameHash === selectedContact);
      if (!contact) {
        const freshContacts = await getContacts();
        setContacts(freshContacts);
        contact = freshContacts.find(c => c.usernameHash === selectedContact);
      }
      if (!contact) throw new Error('Contact not found. Add them first.');

      const recipientPub = await importPublicKey(fromB64(contact.publicKey));
      const keyPair = await importKeyPair(keys.publicKey, keys.privateKey);
      const signingKeyPair = await importSigningKeyPair(keys.signingPublicKey, keys.signingPrivateKey);

      const expiresAt = ttl > 0 ? Date.now() + ttl * 1000 : null;

      const encrypted = await encryptMessage(recipientPub, keyPair, signingKeyPair, text, {
        attachment,
        expiresAt,
      });

      const res = await fetch(`${API}/messages/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
          recipientUsernameHash: contact.usernameHash,
          ciphertextBlob: b64(new Uint8Array(encrypted.ciphertext)),
          ephemeralPublicKey: b64(new Uint8Array(encrypted.ephemeralPublicKey)),
          paddingSize: encrypted.paddingSize,
          expiresAt,
        })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Send failed');
      }

      const now = Date.now();
      const msg = {
        content: text,
        isMine: true,
        timestamp: now,
        id: crypto.randomUUID(),
        sequenceNumber: now,
        attachment: attachment || null,
        expiresAt: expiresAt || null,
      };
      setMessages(prev => [...prev, msg].sort((a, b) => a.timestamp - b.timestamp));
      await storeMessage(msg);

      if (expiresAt) {
        setTimeout(() => {
          setMessages(prev => prev.filter(m => m.id !== msg.id));
        }, ttl * 1000);
      }
    } catch (err) {
      console.error('send error', err);
      alert(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function processFile(file) {
    if (!file) return;

    if (file.size > MAX_FILE_BYTES) {
      alert(`File too large. Maximum is 5MB. Your file: ${(file.size / 1024 / 1024).toFixed(1)}MB`);
      return;
    }

    setUploading(true);

    try {
      const encrypted = await stripExifAndEncrypt(file, 0.75);

      if (encrypted.originalSize) {
        const saved = ((1 - encrypted.size / encrypted.originalSize) * 100).toFixed(0);
        console.log(`Compressed: ${formatBytes(encrypted.originalSize)} → ${formatBytes(encrypted.size)} (${saved}% smaller)`);
      }

      const presignRes = await fetch(`${API}/blobs/presign`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
          filename: encrypted.filename,
          contentType: encrypted.mimeType,
          estimatedSize: encrypted.estimatedUploadSize,
        })
      });

      if (!presignRes.ok) {
        const err = await presignRes.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to get upload URL');
      }

      const { putUrl, getUrl } = await presignRes.json();

      await fetch(putUrl, {
        method: 'PUT',
        body: encrypted.ciphertext,
        headers: { 'Content-Type': encrypted.mimeType },
      });

      const attachment = {
        blobUrl: getUrl,
        blobKey: b64(encrypted.key),
        blobIv: b64(encrypted.iv),
        thumbnail: encrypted.thumbnail ? b64(encrypted.thumbnail) : null,
        thumbnailIv: encrypted.thumbnailIv ? b64(encrypted.thumbnailIv) : null,
        mimeType: encrypted.mimeType,
        filename: encrypted.filename,
        size: encrypted.size,
        isImage: encrypted.isImage,
      };

      setPendingAttachment(attachment);
    } catch (err) {
      alert('Upload failed: ' + err.message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleFileSelect(e) {
    const file = e.target.files?.[0];
    if (file) await processFile(file);
  }

  function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }

  function handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }

  async function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);

    const file = e.dataTransfer.files?.[0];
    if (file) await processFile(file);
  }

  function removePendingAttachment() {
    setPendingAttachment(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  const activeContact = contacts.find(c => c.usernameHash === selectedContact);

  if (!selectedContact) {
    return (
      <div className="chat-empty">
        <div className="empty-icon">
          <ChatBubbleIcon />
        </div>
        <h2>Welcome to CypherChat</h2>
        <p>Select a contact from the sidebar to start an end-to-end encrypted conversation. No server can read your messages.</p>
      </div>
    );
  }

  return (
    <div
      className="chat-container"
      ref={dropZoneRef}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {dragOver && (
        <div className="drop-overlay">
          <div className="drop-content">
            <div className="drop-icon">
              <UploadIcon />
            </div>
            <div className="drop-text">Drop file to upload</div>
          </div>
        </div>
      )}

      <header className="chat-header">
        <div
          className="chat-header-avatar"
          style={{ background: stringToColor(activeContact?.username) }}
        >
          {activeContact?.username?.[0]?.toUpperCase()}
        </div>
        <div>
          <div className="chat-header-name">{activeContact?.username || 'Unknown'}</div>
          <div className="chat-header-status">End-to-end encrypted • Sealed sender</div>
        </div>
      </header>

      <div className="message-list">
        {messages.length === 0 && (
          <div className="chat-empty" style={{ padding: '32px 0' }}>
            <p>No messages yet. Say something!</p>
          </div>
        )}
        {messages.map((m, i) => (
          <MessageRow
            key={i}
            msg={m}
            activeContact={activeContact}
            myUsername={myUsername}
          />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {pendingAttachment && (
        <div className="pending-attachment">
          <div className="pending-info">
            {pendingAttachment.isImage ? <ImageIcon /> : <PaperclipIcon />}
            <span className="pending-name">{pendingAttachment.filename}</span>
            <span className="pending-size">{formatBytes(pendingAttachment.size)}</span>
          </div>
          <button className="pending-remove" onClick={removePendingAttachment} title="Remove">✕</button>
        </div>
      )}

      <form className="chat-input-area" onSubmit={handleSend}>
        <div className="chat-input-wrapper">
          <input
            type="file"
            ref={fileInputRef}
            style={{ display: 'none' }}
            onChange={handleFileSelect}
          />

          <button
            type="button"
            className="attach-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || !!pendingAttachment}
          >
            <span className="tooltip">Attach file (max 5MB)</span>
            {uploading ? <SpinnerIcon /> : '+'}
          </button>

          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            rows={1}
            placeholder={pendingAttachment
              ? `Add a message (optional)...`
              : `Message @${activeContact?.username || 'user'}`
            }
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend(e);
              }
            }}
          />

          <button
            type="submit"
            disabled={loading || (!input.trim() && !pendingAttachment)}
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
  );
}

function MessageRow({ msg, activeContact, myUsername }) {
  const [revealed, setRevealed] = useState(false);
  const [decryptedUrl, setDecryptedUrl] = useState(null);
  const [countdown, setCountdown] = useState(null);

  useEffect(() => {
    if (!msg.expiresAt) return;
    const update = () => {
      const diff = msg.expiresAt - Date.now();
      if (diff <= 0) return;
      const mins = Math.floor(diff / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      setCountdown(`${mins}m ${secs}s`);
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [msg.expiresAt]);

  const handleReveal = useCallback(async () => {
    if (!msg.attachment || decryptedUrl) return;
    try {
      const res = await fetch(msg.attachment.blobUrl);
      const blob = await res.blob();
      const buf = await blob.arrayBuffer();
      const key = fromB64(msg.attachment.blobKey);
      const iv = fromB64(msg.attachment.blobIv);
      const plain = await decryptFile(new Uint8Array(buf), key, iv);
      const url = URL.createObjectURL(new Blob([plain], { type: msg.attachment.mimeType }));
      setDecryptedUrl(url);
      setRevealed(true);
    } catch (e) {
      console.error('decrypt failed', e);
      alert('Failed to decrypt file');
    }
  }, [msg.attachment, decryptedUrl]);

  return (
    <div className="message-row">
      <div
        className="message-avatar"
        style={{ background: stringToColor(msg.isMine ? myUsername : activeContact?.username) }}
      >
        {msg.isMine ? myUsername[0]?.toUpperCase() : activeContact?.username?.[0]?.toUpperCase()}
      </div>
      <div className="message-content">
        <div className="message-header">
          <span className="message-author">
            {msg.isMine ? myUsername : activeContact?.username}
          </span>
          <span className="message-time">
            {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>

        {msg.content && <div className="message-text">{msg.content}</div>}

        {msg.attachment && (
          <div className="attachment-row" onClick={handleReveal} style={{ cursor: 'pointer' }}>
            {msg.attachment.isImage ? (
              <div>
                {msg.attachment.thumbnail && !revealed && (
                  <img
                    src={`data:image/webp;base64,${msg.attachment.thumbnail}`}
                    alt="encrypted thumbnail"
                    className="file-thumbnail"
                    style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 4 }}
                  />
                )}
                {revealed && decryptedUrl && (
                  <img
                    src={decryptedUrl}
                    alt={msg.attachment.filename}
                    style={{ maxWidth: 300, maxHeight: 200, borderRadius: 4, display: 'block' }}
                  />
                )}
                {!revealed && <span className="file-meta">Tap to reveal image</span>}
              </div>
            ) : (
              <div className="file-card">
                <div className="file-info">
                  <div className="file-name">{msg.attachment.filename}</div>
                  <div className="file-meta">{formatBytes(msg.attachment.size)}</div>
                  {!revealed && <div className="file-meta">Tap to download</div>}
                  {revealed && <div className="file-meta" style={{ color: 'var(--green)' }}>Downloaded</div>}
                </div>
              </div>
            )}
          </div>
        )}

        {msg.expiresAt && (
          <div className="ttl-badge">
            <ClockIcon />
            {countdown || 'expired'}
          </div>
        )}
      </div>
    </div>
  );
}

function b64(bytes) {
  return btoa(String.fromCharCode(...bytes));
}

function fromB64(str) {
  const b = atob(str);
  return new Uint8Array([...b].map(c => c.charCodeAt(0)));
}