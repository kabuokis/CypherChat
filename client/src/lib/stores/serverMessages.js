import { writable, derived } from 'svelte/store';
import { getChannelKey } from '$lib/stores/servers.js';
import { getKeys, getContacts } from '$lib/crypto/db.js';
import { encryptGroupMessage, decryptGroupMessage } from '$lib/crypto/groups.js';

function getToken() {
  return localStorage.getItem('cypherchat_token');
}

function createServerMessagesStore() {
  const { subscribe, set, update } = writable([]);
  let pollInterval = null;

  async function pollChannel(serverId, channelId) {
    const token = getToken();
    if (!token) return;

    try {
      const res = await fetch(`/api/channels/${channelId}/messages?limit=50`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) return;

      const data = await res.json();
      const keys = await getKeys();
      const channelKey = await getChannelKey(serverId, channelId);
      if (!channelKey) return;

      const contacts = await getContacts();
      const contactMap = new Map(contacts.map(c => [c.usernameHash, c]));

      const decrypted = [];
      for (const msg of data.messages || []) {
        try {
          const sender = contactMap.get(msg.senderId);
          if (!sender) continue;

          const ciphertext = Uint8Array.from(atob(msg.ciphertextBlob), c => c.charCodeAt(0));
          const iv = Uint8Array.from(atob(msg.nonce), c => c.charCodeAt(0));
          const signature = Uint8Array.from(atob(msg.signature), c => c.charCodeAt(0));
          const senderSignKey = Uint8Array.from(atob(sender.signingPublicKey), c => c.charCodeAt(0));

          const payload = await decryptGroupMessage(ciphertext, iv, signature, channelKey, senderSignKey);
          decrypted.push({
            id: msg.id,
            ...payload,
            senderId: msg.senderId,
            senderName: sender.alias || sender.username,
            channelId,
            sequenceNumber: msg.sequenceNumber
          });
        } catch (e) {
          console.error('Failed to decrypt group message:', e);
        }
      }

      decrypted.sort((a, b) => a.sequenceNumber - b.sequenceNumber);
      set(decrypted);
    } catch (err) {
      console.error('Poll error:', err);
    }
  }

  return {
    subscribe,

    startPolling: (serverId, channelId) => {
      if (pollInterval) clearInterval(pollInterval);
      pollChannel(serverId, channelId);
      pollInterval = setInterval(() => pollChannel(serverId, channelId), 5000);
    },

    stopPolling: () => {
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
      set([]);
    },

    sendMessage: async (serverId, channelId, content, meta = {}) => {
      const token = getToken();
      if (!token) throw new Error('Not authenticated');

      const keys = await getKeys();
      if (!keys.identityPrivateKey || !keys.signingPrivateKey) {
        throw new Error('Keys not found');
      }

      const channelKey = await getChannelKey(serverId, channelId);
      if (!channelKey) throw new Error('Channel key not found');

      const encrypted = await encryptGroupMessage(
        channelKey,
        content,
        keys.signingPrivateKey,
        meta
      );

      const res = await fetch(`/api/channels/${channelId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          ciphertextBlob: btoa(String.fromCharCode(...encrypted.ciphertext)),
          nonce: btoa(String.fromCharCode(...encrypted.iv)),
          signature: btoa(String.fromCharCode(...encrypted.signature)),
          paddingSize: encrypted.paddingSize
        })
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to send message');
      }

      update(msgs => [...msgs, {
        id: crypto.randomUUID(),
        content,
        timestamp: Date.now(),
        senderId: keys.usernameHash,
        senderName: 'You',
        channelId,
        sent: true
      }]);
    }
  };
}

export const serverMessages = createServerMessagesStore();
