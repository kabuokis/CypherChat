import { writable, derived } from 'svelte/store';
import { getKeys, getMessages, storeMessage, deleteMessage, getContacts } from '$lib/crypto/db.js';
import { decryptMessage } from '$lib/crypto/e2e.js';

function createMessagesStore() {
  const { subscribe, set, update } = writable([]);
  let pollInterval = null;

  async function pollInbox() {
    const token = localStorage.getItem('cypherchat_token');
    if (!token) return;

    try {
      const res = await fetch('/api/messages/inbox', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) return;

      const data = await res.json();
      console.log('[MSG CLIENT POLL] received', data.messages?.length || 0, 'messages');
      if (!data.messages || data.messages.length === 0) return;

      const keys = await getKeys();
      if (!keys.identityPrivateKey) return;

      const contacts = await getContacts();
      console.log('[DEBUG] contacts from IDB:', contacts.length, contacts.map(c => c.usernameHash));
      const stored = await getMessages();

      for (const msg of data.messages) {
        try {
          const ephemeralPub = Uint8Array.from(atob(msg.ephemeralPublicKey), c => c.charCodeAt(0));
          const ciphertext = Uint8Array.from(atob(msg.ciphertextBlob), c => c.charCodeAt(0));

          let decrypted = null;
          for (const c of contacts) {
            try {
              const trustedSignKey = Uint8Array.from(atob(c.signingPublicKey), c => c.charCodeAt(0));
              decrypted = await decryptMessage(keys.identityPrivateKey, ephemeralPub, ciphertext, trustedSignKey);
              decrypted.senderUsername = c.alias || c.username;
              decrypted.senderUsernameHash = c.usernameHash;
              break;
            } catch (e) {
              console.log('[DEBUG] decrypt attempt error:', e.message);
              continue;
            }
          }

          if (!decrypted) {
            console.log('[DEBUG] failed to decrypt, contacts tried:', contacts.length, contacts.map(c => c.usernameHash));
            decrypted = {
              content: '[Encrypted - unknown sender]',
              timestamp: msg.createdAt ? new Date(msg.createdAt).getTime() : Date.now(),
              senderUsername: 'Unknown',
              senderUsernameHash: null,
              unknown: true
            };
          }

          const messageObj = {
            id: msg.id,
            content: decrypted.content,
            timestamp: decrypted.timestamp,
            senderUsername: decrypted.senderUsername,
            senderUsernameHash: decrypted.senderUsernameHash,
            expiresAt: msg.expiresAt ? new Date(msg.expiresAt).getTime() : null,
            sequenceNumber: msg.sequenceNumber,
            delivered: true
          };

          if (!stored.find(m => m.id === messageObj.id)) {
            await storeMessage(messageObj);
          }
        } catch (err) {
          console.error('Failed to decrypt message:', err);
        }
      }

      const all = await getMessages();
      set(all);
    } catch (err) {
      console.error('Poll error:', err);
    }
  }

  function startPolling() {
    if (pollInterval) clearInterval(pollInterval);
    pollInbox();
    pollInterval = setInterval(pollInbox, 5000);
  }

  function stopPolling() {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  }

  return {
    subscribe,
    init: async () => {
      const stored = await getMessages();
      set(stored);
      startPolling();
    },
    sendMessage: async (recipientUsernameHash, recipientPublicKey, content, meta = {}) => {
      const token = localStorage.getItem('cypherchat_token');
      if (!token) throw new Error('Not authenticated');

      const { encryptMessage } = await import('$lib/crypto/e2e.js');
      const keys = await getKeys();
      if (!keys.identityPrivateKey || !keys.signingPrivateKey) {
        throw new Error('Keys not found');
      }

      const recipientPub = Uint8Array.from(atob(recipientPublicKey), c => c.charCodeAt(0));
      const encrypted = await encryptMessage(
        recipientPub,
        keys.identityPrivateKey,
        keys.signingPrivateKey,
        content,
        meta
      );

      console.log('[MSG CLIENT SEND] recipientHash b64:', btoa(String.fromCharCode(...recipientUsernameHash)));
      console.log('[MSG CLIENT SEND] recipientHash hex:', Array.from(recipientUsernameHash).map(b => b.toString(16).padStart(2,'0')).join('').substring(0, 32));
      const res = await fetch('/api/messages/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          recipientUsernameHash: btoa(String.fromCharCode(...recipientUsernameHash)),
          ciphertextBlob: btoa(String.fromCharCode(...encrypted.ciphertext)),
          ephemeralPublicKey: btoa(String.fromCharCode(...encrypted.ephemeralPublicKey)),
          paddingSize: encrypted.paddingSize,
          expiresAt: meta.expiresAt || null
        })
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to send message');
      }

      const sentMsg = {
        id: crypto.randomUUID(),
        content,
        timestamp: Date.now(),
        senderUsername: 'You',
        senderUsernameHash: keys.usernameHash ? btoa(String.fromCharCode(...keys.usernameHash)) : null,
        recipientUsernameHash: btoa(String.fromCharCode(...recipientUsernameHash)),
        expiresAt: meta.expiresAt ? new Date(meta.expiresAt).getTime() : null,
        sent: true
      };
      await storeMessage(sentMsg);
      update(msgs => [...msgs, sentMsg]);
    },
    cleanup: () => {
      stopPolling();
    }
  };
}

export const messages = createMessagesStore();

export const conversations = derived(messages, $messages => {
  const groups = {};
  for (const msg of $messages) {
    const key = msg.recipientUsernameHash || msg.senderUsernameHash || 'unknown';
    if (!groups[key]) groups[key] = [];
    groups[key].push(msg);
  }
  for (const key in groups) {
    groups[key].sort((a, b) => a.timestamp - b.timestamp);
  }
  return groups;
});