import { writable } from 'svelte/store';
import { getContacts, storeContact, deleteContact } from '$lib/crypto/db.js';
import { sha256 } from '@noble/hashes/sha2.js';

function createContactsStore() {
  const { subscribe, set, update } = writable([]);

  return {
    subscribe,
    init: async () => {
      const stored = await getContacts();
      set(stored);
      localStorage.setItem('cypherchat_contacts', JSON.stringify(stored));
    },
    loadFromServer: async () => {
      const token = localStorage.getItem('cypherchat_token');
      if (!token) return;

      try {
        const res = await fetch('/api/contacts/list', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) return;

        const data = await res.json();
      console.log('[CONTACTS ADD] Server response:', data);
        const stored = await getContacts();
        const storedMap = new Map(stored.map(c => [c.usernameHash, c]));

        for (const c of data.contacts) {
          const existing = storedMap.get(c.contactUsernameHash);
          if (existing) {
            existing.publicKey = c.contactPublicKey;
            existing.signingPublicKey = c.contactSigningPublicKey;
          }
        }

        set(stored);
        localStorage.setItem('cypherchat_contacts', JSON.stringify(stored));
      } catch (err) {
        console.error('Failed to load contacts:', err);
      }
    },
    addContact: async (username, alias) => {
      const encoder = new TextEncoder();
      const usernameHash = sha256(encoder.encode(username.normalize('NFKC').toLowerCase()));
      const usernameHashB64 = btoa(String.fromCharCode(...usernameHash));

      console.log('[CONTACTS ADD] Searching for username:', username);
      console.log('[CONTACTS ADD] Hash base64:', usernameHashB64);
      const res = await fetch(`/api/contacts/search?hash=${encodeURIComponent(usernameHashB64)}`);
      const data = await res.json();
      console.log('[CONTACTS ADD] Server response:', data);

      if (!data.found) {
        throw new Error('User not found');
      }

      const contact = {
        username,
        usernameHash: usernameHashB64,
        alias: alias || username,
        publicKey: data.identityPublicKey,
        signingPublicKey: data.signingPublicKey,
        addedAt: Date.now()
      };

      await storeContact(contact);
      update(contacts => {
        const idx = contacts.findIndex(c => c.usernameHash === contact.usernameHash);
        if (idx >= 0) contacts[idx] = contact;
        else contacts.push(contact);
        return contacts;
      });
      localStorage.setItem('cypherchat_contacts', JSON.stringify(await getContacts()));

      const token = localStorage.getItem('cypherchat_token');
      if (token) {
        await fetch('/api/contacts/add', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            contactUsernameHash: usernameHashB64,
            contactPublicKey: data.identityPublicKey,
            contactSigningPublicKey: data.signingPublicKey,
            encryptedAlias: null
          })
        });
      }

      return contact;
    },
    removeContact: async (usernameHash) => {
      await deleteContact(usernameHash);
      update(contacts => contacts.filter(c => c.usernameHash !== usernameHash));
      localStorage.setItem('cypherchat_contacts', JSON.stringify(await getContacts()));
    }
  };
}

export const contacts = createContactsStore();
