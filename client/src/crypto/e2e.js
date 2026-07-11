import { importPublicKey, importSigningPublicKey } from './keys.js';

const BUCKETS = [256, 1024, 4096, 16384];

export async function encryptMessage(recipientPublicKey, identityKeyPair, signingKeyPair, content, meta = {}) {
  const ephemeral = await crypto.subtle.generateKey(
    { name: 'X25519' }, true, ['deriveBits']
  );

  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'X25519', public: recipientPublicKey },
    ephemeral.privateKey, 256
  );

  const encKey = await hkdfToAES(new Uint8Array(sharedBits), 'message-v1');

  const senderPub = await crypto.subtle.exportKey('raw', identityKeyPair.publicKey);
  const senderSigningPub = await crypto.subtle.exportKey('raw', signingKeyPair.publicKey);

  const payloadObj = {
    senderPublicKey: Array.from(new Uint8Array(senderPub)),
    senderSigningPublicKey: Array.from(new Uint8Array(senderSigningPub)),
    content,
    timestamp: Date.now(),
    attachment: meta.attachment || null,
    expiresAt: meta.expiresAt || null,
  };

  // Sign the payload before encryption
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payloadObj));
  const signature = await crypto.subtle.sign('Ed25519', signingKeyPair.privateKey, payloadBytes);
  payloadObj.signature = Array.from(new Uint8Array(signature));

  const plaintext = new TextEncoder().encode(JSON.stringify(payloadObj));
  const padded = padToBucket(plaintext);

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, encKey, padded
  );

  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);

  const ephemeralPub = await crypto.subtle.exportKey('raw', ephemeral.publicKey);

  return {
    ephemeralPublicKey: Array.from(new Uint8Array(ephemeralPub)),
    ciphertext: Array.from(combined),
    paddingSize: padded.length
  };
}

export async function decryptMessage(identityKeyPair, ephemeralPubRaw, ciphertextRaw, trustedSigningPublicKey = null) {
  const ephemeralPub = await importPublicKey(new Uint8Array(ephemeralPubRaw));
  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'X25519', public: ephemeralPub },
    identityKeyPair.privateKey, 256
  );

  const decKey = await hkdfToAES(new Uint8Array(sharedBits), 'message-v1');

  const iv = ciphertextRaw.slice(0, 12);
  const ciphertext = ciphertextRaw.slice(12);

  const padded = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(iv) },
    decKey, new Uint8Array(ciphertext)
  );

  const plaintext = unpad(new Uint8Array(padded));
  const payload = JSON.parse(new TextDecoder().decode(plaintext));

  // Verify signature if a trusted signing key is provided
  if (payload.signature && trustedSigningPublicKey) {
    const { signature, ...payloadWithoutSig } = payload;
    const payloadBytes = new TextEncoder().encode(JSON.stringify(payloadWithoutSig));
    const sigBytes = new Uint8Array(signature);
    const sigPub = await importSigningPublicKey(trustedSigningPublicKey);

    const valid = await crypto.subtle.verify('Ed25519', sigPub, sigBytes, payloadBytes);
    if (!valid) {
      throw new Error('Invalid message signature: possible tampering detected');
    }
  }

  return payload;
}

async function hkdfToAES(sharedSecret, info) {
  const base = await crypto.subtle.importKey('raw', sharedSecret, 'HKDF', false, ['deriveKey']);
  return await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: new TextEncoder().encode(info) },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}

function padToBucket(data) {
  const header = 4;
  const total = data.length + header;
  const size = BUCKETS.find(b => b >= total) || BUCKETS[BUCKETS.length - 1];
  const buf = new Uint8Array(size);
  new DataView(buf.buffer).setUint32(0, data.length, true);
  buf.set(data, header);
  crypto.getRandomValues(buf.subarray(total));
  return buf;
}

function unpad(padded) {
  const len = new DataView(padded.buffer).getUint32(0, true);
  return padded.slice(4, 4 + len);
}