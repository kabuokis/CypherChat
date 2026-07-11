export async function generateGroupKey() {
  return crypto.getRandomValues(new Uint8Array(32));
}

export async function encryptGroupKeyForMember(groupKey, memberPublicKeyRaw) {
  const ephemeral = await crypto.subtle.generateKey(
    { name: 'X25519' }, true, ['deriveBits']
  );
  const memberPub = await crypto.subtle.importKey(
    'raw', memberPublicKeyRaw, { name: 'X25519' }, true, []
  );
  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'X25519', public: memberPub },
    ephemeral.privateKey, 256
  );
  const encKey = await hkdfToAES(new Uint8Array(sharedBits), 'group-key-v1');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, encKey, groupKey);

  const ephemeralPub = await crypto.subtle.exportKey('raw', ephemeral.publicKey);
  const combined = new Uint8Array(ephemeralPub.byteLength + iv.length + encrypted.byteLength);
  combined.set(new Uint8Array(ephemeralPub));
  combined.set(iv, ephemeralPub.byteLength);
  combined.set(new Uint8Array(encrypted), ephemeralPub.byteLength + iv.length);

  return combined; // Uint8Array
}

export async function decryptGroupKey(encryptedPackage, identityKeyPair) {
  const data = new Uint8Array(encryptedPackage);
  const ephemeralPub = data.slice(0, 32);
  const iv = data.slice(32, 44);
  const ciphertext = data.slice(44);

  const ephemeralKey = await crypto.subtle.importKey(
    'raw', ephemeralPub, { name: 'X25519' }, true, []
  );
  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'X25519', public: ephemeralKey },
    identityKeyPair.privateKey, 256
  );
  const decKey = await hkdfToAES(new Uint8Array(sharedBits), 'group-key-v1');
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, decKey, ciphertext);
  return new Uint8Array(decrypted);
}

export async function encryptWithGroupKey(groupKey, plaintext) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aesKey = await crypto.subtle.importKey('raw', groupKey, 'AES-GCM', false, ['encrypt']);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, aesKey, new TextEncoder().encode(JSON.stringify(plaintext))
  );
  return {
    ciphertext: new Uint8Array(ciphertext),  // ensure Uint8Array
    iv: new Uint8Array(iv)                     // ensure Uint8Array
  };
}

export async function decryptWithGroupKey(groupKey, ciphertext, iv) {
  const aesKey = await crypto.subtle.importKey('raw', groupKey, 'AES-GCM', false, ['decrypt']);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(iv) }, aesKey, new Uint8Array(ciphertext)
  );
  return JSON.parse(new TextDecoder().decode(decrypted));
}

async function hkdfToAES(sharedSecret, info) {
  const base = await crypto.subtle.importKey('raw', sharedSecret, 'HKDF', false, ['deriveKey']);
  return await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: new TextEncoder().encode(info) },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}

export function b64(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  const chunk = 65535;
  for (let i = 0; i < arr.length; i += chunk) {
    bin += String.fromCharCode(...arr.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export function fromB64(str) {
  const b = atob(str);
  return new Uint8Array([...b].map(c => c.charCodeAt(0)));
}