const DB_NAME = 'SecureMessenger';
const DB_VERSION = 3;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('keys')) {
        db.createObjectStore('keys', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('messages')) {
        db.createObjectStore('messages', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('contacts')) {
        const cs = db.createObjectStore('contacts', { keyPath: 'usernameHash' });
        cs.createIndex('blocked', 'blocked', { unique: false });
      }
      if (!db.objectStoreNames.contains('servers')) {
        db.createObjectStore('servers', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('serverMessages')) {
        const sm = db.createObjectStore('serverMessages', { keyPath: 'id', autoIncrement: true });
        sm.createIndex('channelId', 'channelId', { unique: false });
      }
      if (!db.objectStoreNames.contains('readState')) {
        db.createObjectStore('readState', { keyPath: 'key' });
      }
    };
  });
}

// === KEYS (wrapped) ===
async function wrapKeyAsync(privateKeyBytes, publicKeyBytes, crv, usages, masterKey) {
  const masterCryptoKey = await crypto.subtle.importKey(
    'raw', masterKey, 'AES-GCM', false, ['wrapKey', 'unwrapKey']
  );
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    { kty: 'OKP', crv, d: bytesToBase64url(privateKeyBytes), x: bytesToBase64url(publicKeyBytes) },
    { name: crv === 'X25519' ? 'X25519' : 'Ed25519' }, true, usages
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrapped = await crypto.subtle.wrapKey('jwk', privateKey, masterCryptoKey, { name: 'AES-GCM', iv });
  return { wrapped: Array.from(new Uint8Array(wrapped)), iv: Array.from(iv) };
}

export async function storeKeys(identityExported, signingExported, masterKey) {
  const wrappedIdentity = await wrapKeyAsync(
    identityExported.privateKey, identityExported.publicKey, 'X25519', ['deriveBits'], masterKey
  );
  const wrappedSigning = await wrapKeyAsync(
    signingExported.privateKey, signingExported.publicKey, 'Ed25519', ['sign'], masterKey
  );

  const db = await openDB();
  const tx = db.transaction('keys', 'readwrite');
  tx.objectStore('keys').put({
    id: 'identity',
    publicKey: Array.from(identityExported.publicKey),
    wrappedPrivateKey: wrappedIdentity.wrapped,
    wrappedPrivateKeyIv: wrappedIdentity.iv,
    signingPublicKey: Array.from(signingExported.publicKey),
    wrappedSigningPrivateKey: wrappedSigning.wrapped,
    wrappedSigningPrivateKeyIv: wrappedSigning.iv,
    masterKey: Array.from(masterKey)
  });
  return txDone(tx);
}

export async function getKeys() {
  const db = await openDB();
  const tx = db.transaction('keys', 'readonly');
  const req = tx.objectStore('keys').get('identity');
  const result = await reqDone(req);
  if (!result) return null;

  const masterKey = new Uint8Array(result.masterKey);
  const masterCryptoKey = await crypto.subtle.importKey(
    'raw', masterKey, 'AES-GCM', false, ['wrapKey', 'unwrapKey']
  );

  const unwrapKey = async (wrappedBytes, ivBytes, crv, usages) => {
    const unwrapped = await crypto.subtle.unwrapKey(
      'jwk', new Uint8Array(wrappedBytes), masterCryptoKey,
      { name: 'AES-GCM', iv: new Uint8Array(ivBytes) },
      { name: crv === 'X25519' ? 'X25519' : 'Ed25519' }, true, usages
    );
    const jwk = await crypto.subtle.exportKey('jwk', unwrapped);
    return base64urlToBytes(jwk.d);
  };

  const privateKey = await unwrapKey(result.wrappedPrivateKey, result.wrappedPrivateKeyIv, 'X25519', ['deriveBits']);
  const signingPrivateKey = await unwrapKey(result.wrappedSigningPrivateKey, result.wrappedSigningPrivateKeyIv, 'Ed25519', ['sign']);

  return {
    publicKey: new Uint8Array(result.publicKey),
    privateKey: new Uint8Array(privateKey),
    signingPublicKey: new Uint8Array(result.signingPublicKey),
    signingPrivateKey: new Uint8Array(signingPrivateKey),
    masterKey
  };
}

export async function clearAllData() {
  const db = await openDB();
  const tx = db.transaction(['keys', 'messages', 'contacts', 'servers', 'serverMessages', 'readState'], 'readwrite');
  tx.objectStore('keys').clear();
  tx.objectStore('messages').clear();
  tx.objectStore('contacts').clear();
  tx.objectStore('servers').clear();
  tx.objectStore('serverMessages').clear();
  tx.objectStore('readState').clear();
  return txDone(tx);
}

// === CONTACTS ===
export async function storeContact(contact) {
  const db = await openDB();
  const tx = db.transaction('contacts', 'readwrite');
  tx.objectStore('contacts').put(contact);
  return txDone(tx);
}

export async function getContacts() {
  const db = await openDB();
  const tx = db.transaction('contacts', 'readonly');
  const req = tx.objectStore('contacts').getAll();
  return reqDone(req);
}

export async function deleteContact(usernameHash) {
  const db = await openDB();
  const tx = db.transaction('contacts', 'readwrite');
  tx.objectStore('contacts').delete(usernameHash);
  return txDone(tx);
}

export async function updateContact(contact) {
  const db = await openDB();
  const tx = db.transaction('contacts', 'readwrite');
  tx.objectStore('contacts').put(contact);
  return txDone(tx);
}

// === MESSAGES ===
export async function storeMessage(msg) {
  const db = await openDB();
  const tx = db.transaction('messages', 'readwrite');
  tx.objectStore('messages').put(msg);
  return txDone(tx);
}

export async function getMessages() {
  const db = await openDB();
  const tx = db.transaction('messages', 'readonly');
  const req = tx.objectStore('messages').getAll();
  return reqDone(req);
}

// === SERVERS ===
export async function storeServer(server) {
  const db = await openDB();
  const tx = db.transaction('servers', 'readwrite');
  tx.objectStore('servers').put(server);
  return txDone(tx);
}

export async function getServers() {
  const db = await openDB();
  const tx = db.transaction('servers', 'readonly');
  const req = tx.objectStore('servers').getAll();
  return reqDone(req);
}

export async function deleteServer(serverId) {
  const db = await openDB();
  const tx = db.transaction('servers', 'readwrite');
  tx.objectStore('servers').delete(serverId);
  return txDone(tx);
}

// === SERVER MESSAGES ===
export async function storeServerMessage(msg) {
  const db = await openDB();
  const tx = db.transaction('serverMessages', 'readwrite');
  tx.objectStore('serverMessages').put(msg);
  return txDone(tx);
}

export async function getServerMessages(channelId) {
  const db = await openDB();
  const tx = db.transaction('serverMessages', 'readonly');
  const req = tx.objectStore('serverMessages').index('channelId').getAll(channelId);
  return reqDone(req);
}

// === READ STATE ===
export async function setLastRead(key, sequenceNumber) {
  const db = await openDB();
  const tx = db.transaction('readState', 'readwrite');
  tx.objectStore('readState').put({ key, sequenceNumber, timestamp: Date.now() });
  return txDone(tx);
}

export async function getLastRead(key) {
  const db = await openDB();
  const tx = db.transaction('readState', 'readonly');
  const req = tx.objectStore('readState').get(key);
  const result = await reqDone(req);
  return result ? result.sequenceNumber : 0;
}

// === UTILS ===
function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function reqDone(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function base64urlToBytes(str) {
  const pad = '='.repeat((4 - str.length % 4) % 4);
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(base64);
  return new Uint8Array([...bin].map(c => c.charCodeAt(0)));
}

function bytesToBase64url(bytes) {
  const bin = String.fromCharCode(...bytes);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}