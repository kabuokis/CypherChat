import { writable, derived } from 'svelte/store';
import { getKeys, getContacts } from '$lib/crypto/db.js';
import {
  generateChannelKey,
  encryptChannelKey,
  decryptChannelKey,
  encryptServerName,
  decryptServerName
} from '$lib/crypto/groups.js';

function getToken() {
  return localStorage.getItem('cypherchat_token');
}

function createServersStore() {
  const { subscribe, set, update } = writable([]);
  const { subscribe: activeSub, set: setActive } = writable(null);
  const { subscribe: channelsSub, set: setChannels } = writable([]);
  const { subscribe: membersSub, set: setMembers } = writable([]);

  return {
    subscribe,
    activeServer: { subscribe: activeSub },
    channels: { subscribe: channelsSub },
    members: { subscribe: membersSub },

    init: async () => {
      const token = getToken();
      if (!token) return;
      try {
        const res = await fetch('/api/servers', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) return;
        const data = await res.json();
        set(data.servers || []);
      } catch (err) {
        console.error('Failed to load servers:', err);
      }
    },

    createServer: async (name, iconUrl = null) => {
      const token = getToken();
      if (!token) throw new Error('Not authenticated');

      const channelKey = await generateChannelKey();
      const { ciphertext: nameCipher, nonce: nameNonce } = await encryptServerName(name, channelKey);

      const res = await fetch('/api/servers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          nameCiphertext: btoa(String.fromCharCode(...nameCipher)),
          nameNonce: btoa(String.fromCharCode(...nameNonce)),
          iconUrl
        })
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to create server');
      }

      const { serverId } = await res.json();

      // Create default "general" channel
      await createChannelInternal(serverId, 'general', channelKey, false, 'member');

      // Store key locally
      await storeChannelKey(serverId, 'general', channelKey);

      // Refresh list
      await serversStore.init();
      return serverId;
    },

    selectServer: async (server) => {
      setActive(server);
      await serversStore.loadChannels(server.id);
      await serversStore.loadMembers(server.id);
    },

    loadChannels: async (serverId) => {
      const token = getToken();
      if (!token) return;
      try {
        const res = await fetch(`/api/channels?serverId=${serverId}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) return;
        const data = await res.json();
        setChannels(data.channels || []);
      } catch (err) {
        console.error('Failed to load channels:', err);
      }
    },

    loadMembers: async (serverId) => {
      const token = getToken();
      if (!token) return;
      try {
        const res = await fetch(`/api/servers/${serverId}/members`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) return;
        const data = await res.json();
        setMembers(data.members || []);
      } catch (err) {
        console.error('Failed to load members:', err);
      }
    },

    generateInvite: async (serverId) => {
      const token = getToken();
      if (!token) throw new Error('Not authenticated');

      const res = await fetch(`/api/servers/${serverId}/invite`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to generate invite');
      }

      const { inviteToken } = await res.json();
      return inviteToken;
    },

    joinServer: async (inviteToken) => {
      const token = getToken();
      if (!token) throw new Error('Not authenticated');

      // Step 1: Join server
      const res = await fetch('/api/servers/join', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ inviteToken })
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to join server');
      }

      const { serverId } = await res.json();

      // Step 2: Fetch and decrypt channel keys
      await serversStore.fetchAndDecryptKeys(serverId);

      // Refresh
      await serversStore.init();
      return serverId;
    },

    fetchAndDecryptKeys: async (serverId) => {
      const token = getToken();
      const keys = await getKeys();
      if (!keys.identityPrivateKey) throw new Error('Keys not found');

      const res = await fetch(`/api/channels/keys?serverId=${serverId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!res.ok) return;
      const data = await res.json();

      for (const k of data.keys || []) {
        try {
          const decrypted = await decryptChannelKey({
            encryptedKey: Uint8Array.from(atob(k.encryptedKey), c => c.charCodeAt(0)),
            iv: crypto.getRandomValues(new Uint8Array(12)), // Server stores raw encrypted key
            ephemeralPublicKey: new Uint8Array(32) // Placeholder - actual implementation needs full bundle
          }, keys.identityPrivateKey);
          await storeChannelKey(serverId, k.channelId, decrypted);
        } catch (e) {
          console.error('Failed to decrypt key for channel', k.channelId, e);
        }
      }
    },

    leaveServer: async (serverId) => {
      const token = getToken();
      if (!token) throw new Error('Not authenticated');

      const res = await fetch(`/api/servers/${serverId}/leave`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to leave server');
      }

      // Clear local keys
      await clearServerKeys(serverId);
      update(list => list.filter(s => s.id !== serverId));
      setActive(null);
    },

    kickMember: async (serverId, targetUserId) => {
      const token = getToken();
      if (!token) throw new Error('Not authenticated');

      const res = await fetch(`/api/servers/${serverId}/kick`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ targetUserId })
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to kick member');
      }

      // Trigger key rotation
      await serversStore.rotateKeys(serverId);
      await serversStore.loadMembers(serverId);
    },

    changeRole: async (serverId, targetUserId, newRole) => {
      const token = getToken();
      if (!token) throw new Error('Not authenticated');

      const res = await fetch(`/api/servers/${serverId}/role`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ targetUserId, newRole })
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to change role');
      }

      await serversStore.loadMembers(serverId);
    },

    rotateKeys: async (serverId) => {
      const token = getToken();
      if (!token) throw new Error('Not authenticated');

      // Get members
      const membersRes = await fetch(`/api/servers/${serverId}/members`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const membersData = await membersRes.json();
      const members = membersData.members || [];

      // Get channels
      const channelsRes = await fetch(`/api/channels?serverId=${serverId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const channelsData = await channelsRes.json();
      const channels = channelsData.channels || [];

      const channelKeys = [];

      for (const channel of channels) {
        const newKey = await generateChannelKey();
        const encryptedKeys = [];

        for (const member of members) {
          const pubKey = Uint8Array.from(atob(member.identityPublicKey), c => c.charCodeAt(0));
          const encrypted = await encryptChannelKey(newKey, pubKey);
          encryptedKeys.push({
            userId: member.userId,
            encryptedKey: btoa(String.fromCharCode(...encrypted.encryptedKey))
          });
        }

        channelKeys.push({
          channelId: channel.id,
          encryptedKeys
        });

        await storeChannelKey(serverId, channel.id, newKey);
      }

      // Upload rotated keys
      const res = await fetch(`/api/servers/${serverId}/rotate-keys`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ channelKeys })
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Key rotation failed');
      }
    },

    createChannel: async (serverId, name, isPrivate = false, requiredRole = 'member') => {
      const token = getToken();
      if (!token) throw new Error('Not authenticated');

      const channelKey = await generateChannelKey();

      // Get members to encrypt key for
      const membersRes = await fetch(`/api/servers/${serverId}/members`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const membersData = await membersRes.json();
      const members = membersData.members || [];

      const encryptedKeys = [];
      for (const member of members) {
        const pubKey = Uint8Array.from(atob(member.identityPublicKey), c => c.charCodeAt(0));
        const encrypted = await encryptChannelKey(channelKey, pubKey);
        encryptedKeys.push({
          userId: member.userId,
          encryptedKey: btoa(String.fromCharCode(...encrypted.encryptedKey))
        });
      }

      // Encrypt channel name
      const { ciphertext: nameCipher, nonce: nameNonce } = await encryptServerName(name, channelKey);

      const res = await fetch('/api/channels', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          serverId,
          nameCiphertext: btoa(String.fromCharCode(...nameCipher)),
          nameNonce: btoa(String.fromCharCode(...nameNonce)),
          isPrivate,
          requiredRole,
          encryptedKeys
        })
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to create channel');
      }

      const { channelId } = await res.json();
      await storeChannelKey(serverId, channelId, channelKey);
      await serversStore.loadChannels(serverId);
      return channelId;
    },

    deleteServer: async (serverId) => {
      const token = getToken();
      if (!token) throw new Error('Not authenticated');

      const res = await fetch(`/api/servers/${serverId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to delete server');
      }

      await clearServerKeys(serverId);
      update(list => list.filter(s => s.id !== serverId));
      setActive(null);
    }
  };
}

// Helper to create channel internally
async function createChannelInternal(serverId, name, channelKey, isPrivate, requiredRole) {
  const token = getToken();
  const { ciphertext: nameCipher, nonce: nameNonce } = await encryptServerName(name, channelKey);

  // Get members (just self for new server)
  const membersRes = await fetch(`/api/servers/${serverId}/members`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const membersData = await membersRes.json();
  const members = membersData.members || [];

  const encryptedKeys = [];
  for (const member of members) {
    const pubKey = Uint8Array.from(atob(member.identityPublicKey), c => c.charCodeAt(0));
    const encrypted = await encryptChannelKey(channelKey, pubKey);
    encryptedKeys.push({
      userId: member.userId,
      encryptedKey: btoa(String.fromCharCode(...encrypted.encryptedKey))
    });
  }

  await fetch('/api/channels', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      serverId,
      nameCiphertext: btoa(String.fromCharCode(...nameCipher)),
      nameNonce: btoa(String.fromCharCode(...nameNonce)),
      isPrivate,
      requiredRole,
      encryptedKeys
    })
  });
}

// IndexedDB helpers for channel keys
const DB_NAME = 'cypherchat';
const STORE_NAME = 'keys';

async function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 3);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
}

async function storeChannelKey(serverId, channelId, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const keyName = `channelKey:${serverId}:${channelId}`;
    store.put(key, keyName);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getChannelKey(serverId, channelId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(`channelKey:${serverId}:${channelId}`);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function clearServerKeys(serverId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const range = IDBKeyRange.bound(`channelKey:${serverId}:`, `channelKey:${serverId}:ÿ`);
    const req = store.openCursor(range);
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        store.delete(cursor.key);
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export const servers = createServersStore();
