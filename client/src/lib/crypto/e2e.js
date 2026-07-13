import { x25519 } from '@noble/curves/ed25519.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { hkdf } from '@noble/hashes/hkdf.js';

const PADDING_BUCKETS = [256, 1024, 4096, 16384];

function getBucket(size) {
  for (const bucket of PADDING_BUCKETS) {
    if (size <= bucket) return bucket;
  }
  return PADDING_BUCKETS[PADDING_BUCKETS.length - 1];
}

function padBuffer(buffer, targetSize) {
  // Prepend 4-byte little-endian length, then payload, then random padding
  const view = new DataView(new ArrayBuffer(4));
  view.setUint32(0, buffer.length, true);
  const lengthBytes = new Uint8Array(view.buffer);

  const totalNeeded = 4 + buffer.length;
  const padSize = Math.max(targetSize, totalNeeded);
  const padded = new Uint8Array(padSize);
  padded.set(lengthBytes, 0);
  padded.set(buffer, 4);
  if (padSize > totalNeeded) {
    padded.set(crypto.getRandomValues(new Uint8Array(padSize - totalNeeded)), totalNeeded);
  }
  return padded;
}

export async function encryptMessage(recipientPublicKey, identityPrivateKey, signingPrivateKey, content, meta = {}) {
  const encoder = new TextEncoder();

  // 1. Fresh ephemeral X25519 keypair
  const ephemeral = x25519.keygen();

  // 2. ECDH
  const sharedSecret = x25519.getSharedSecret(ephemeral.secretKey, recipientPublicKey);

  // 3. HKDF-SHA256(sharedSecret, salt=empty, info="message-v1", dkLen=32)
  const keyMaterial = hkdf(sha256, sharedSecret, new Uint8Array(0), 'message-v1', 32);

  // 4. Derive sender public keys
  const senderPublicKey = x25519.getPublicKey(identityPrivateKey);
  const senderSigningPublicKey = ed25519.getPublicKey(signingPrivateKey);

  // 5. Build payload (without signature)
  const payload = {
    senderPublicKey: Array.from(senderPublicKey),
    senderSigningPublicKey: Array.from(senderSigningPublicKey),
    content,
    timestamp: Date.now(),
    attachment: meta.attachment || null,
    expiresAt: meta.expiresAt || null
  };

  const payloadBytes = encoder.encode(JSON.stringify(payload));

  // 6. Ed25519 sign payload bytes
  const signature = ed25519.sign(payloadBytes, signingPrivateKey);

  // 7. Add signature to payload
  const signedPayload = {
    ...payload,
    signature: Array.from(signature)
  };

  const signedBytes = encoder.encode(JSON.stringify(signedPayload));

  // 8. Pad with length prefix so decryption is exact
  const bucket = getBucket(4 + signedBytes.length);
  const paddedBytes = padBuffer(signedBytes, bucket);

  // 9. AES-256-GCM encrypt with random 12-byte IV
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aesKey = await crypto.subtle.importKey('raw', keyMaterial, 'AES-GCM', false, ['encrypt']);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, paddedBytes);

  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);

  return {
    ephemeralPublicKey: ephemeral.publicKey,
    ciphertext: combined,
    paddingSize: bucket
  };
}

export async function decryptMessage(identityPrivateKey, ephemeralPubRaw, ciphertextRaw, trustedSigningPublicKey) {
  const decoder = new TextDecoder();

  // 1. ECDH
  const sharedSecret = x25519.getSharedSecret(identityPrivateKey, ephemeralPubRaw);

  // 2. HKDF
  const keyMaterial = hkdf(sha256, sharedSecret, new Uint8Array(0), 'message-v1', 32);

  // 3. AES-256-GCM decrypt
  const iv = ciphertextRaw.slice(0, 12);
  const encrypted = ciphertextRaw.slice(12);
  const aesKey = await crypto.subtle.importKey('raw', keyMaterial, 'AES-GCM', false, ['decrypt']);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, encrypted);

  // 4. Read length prefix (first 4 bytes) then extract exact payload
  const decryptedBytes = new Uint8Array(decrypted);
  const view = new DataView(decryptedBytes.buffer, decryptedBytes.byteOffset, 4);
  const payloadLen = view.getUint32(0, true);
  const stripped = decoder.decode(decryptedBytes.slice(4, 4 + payloadLen));

  // 5. Parse JSON
  const signedPayload = JSON.parse(stripped);

  // 6. Extract and verify signature
  const { signature, ...payload } = signedPayload;
  const payloadBytes = new TextEncoder().encode(JSON.stringify({
    senderPublicKey: payload.senderPublicKey,
    senderSigningPublicKey: payload.senderSigningPublicKey,
    content: payload.content,
    timestamp: payload.timestamp,
    attachment: payload.attachment,
    expiresAt: payload.expiresAt
  }));
  const sigBytes = new Uint8Array(signature);

  const isValid = ed25519.verify(sigBytes, payloadBytes, trustedSigningPublicKey);
  if (!isValid) {
    throw new Error('Invalid message signature');
  }

  return payload;
}