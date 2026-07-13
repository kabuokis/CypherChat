const DB_NAME = 'cypherchat';
const DB_VERSION = 2;
const STORE_NAME = 'keys';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
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

export async function storeKeys(identityPrivateKey, signingPrivateKey, usernameHash) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(identityPrivateKey, 'identityPrivateKey');
    store.put(signingPrivateKey, 'signingPrivateKey');
    if (usernameHash) store.put(usernameHash, 'usernameHash');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getKeys() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const identityReq = store.get('identityPrivateKey');
    const signingReq = store.get('signingPrivateKey');
    const usernameReq = store.get('usernameHash');

    const results = {};
    identityReq.onsuccess = () => { results.identityPrivateKey = identityReq.result; };
    signingReq.onsuccess = () => { results.signingPrivateKey = signingReq.result; };
    usernameReq.onsuccess = () => { results.usernameHash = usernameReq.result; };

    tx.oncomplete = () => resolve(results);
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearAllData() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// --- Message storage ---
export async function storeMessage(message) {
  const db = await openDB();
  const messages = await getMessages();
  messages.push(message);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(messages, 'messages');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getMessages() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get('messages');
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteMessage(id) {
  const db = await openDB();
  const messages = (await getMessages()).filter(m => m.id !== id);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(messages, 'messages');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// --- Contact storage ---
export async function storeContact(contact) {
  const db = await openDB();
  const contacts = await getContacts();
  const idx = contacts.findIndex(c => c.usernameHash === contact.usernameHash);
  if (idx >= 0) contacts[idx] = contact;
  else contacts.push(contact);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(contacts, 'contacts');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getContacts() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get('contacts');
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteContact(usernameHash) {
  const db = await openDB();
  const contacts = (await getContacts()).filter(c => c.usernameHash !== usernameHash);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(contacts, 'contacts');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
