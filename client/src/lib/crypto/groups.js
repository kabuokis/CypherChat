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

export async function generateChannelKey() {
  return crypto.getRandomValues(new Uint8Array(32));
}

export async function encryptChannelKey(channelKey, recipientPublicKey) {
  const ephemeral = x25519.keygen();
  const sharedSecret = x25519.getSharedSecret(ephemeral.secretKey, recipientPublicKey);
  const keyMaterial = hkdf(sha256, sharedSecret, new Uint8Array(0), 'channel-key-v1', 32);

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aesKey = await crypto.subtle.importKey('raw', keyMaterial, 'AES-GCM', false, ['encrypt']);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, channelKey);

  return {
    encryptedKey: new Uint8Array(encrypted),
    iv,
    ephemeralPublicKey: ephemeral.publicKey
  };
}

export async function decryptChannelKey(encryptedBundle, identityPrivateKey) {
  const { encryptedKey, iv, ephemeralPublicKey } = encryptedBundle;
  const sharedSecret = x25519.getSharedSecret(identityPrivateKey, ephemeralPublicKey);
  const keyMaterial = hkdf(sha256, sharedSecret, new Uint8Array(0), 'channel-key-v1', 32);

  const aesKey = await crypto.subtle.importKey('raw', keyMaterial, 'AES-GCM', false, ['decrypt']);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    encryptedKey
  );
  return new Uint8Array(decrypted);
}

export async function encryptGroupMessage(channelKey, content, signingPrivateKey, meta = {}) {
  const encoder = new TextEncoder();
  const payload = {
    content,
    timestamp: Date.now(),
    attachment: meta.attachment || null,
    replyTo: meta.replyTo || null
  };

  const payloadBytes = encoder.encode(JSON.stringify(payload));
  const signature = ed25519.sign(payloadBytes, signingPrivateKey);

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aesKey = await crypto.subtle.importKey('raw', channelKey, 'AES-GCM', false, ['encrypt']);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, payloadBytes);

  const bucket = getBucket(4 + payloadBytes.length);
  const padded = padBuffer(new Uint8Array(ciphertext), bucket);

  return {
    ciphertext: padded,
    iv,
    signature,
    paddingSize: bucket
  };
}

export async function decryptGroupMessage(ciphertext, iv, signature, channelKey, senderSigningPublicKey) {
  const aesKey = await crypto.subtle.importKey('raw', channelKey, 'AES-GCM', false, ['decrypt']);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, ciphertext);

  const payload = JSON.parse(new TextDecoder().decode(decrypted));
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));

  const isValid = ed25519.verify(signature, payloadBytes, senderSigningPublicKey);
  if (!isValid) {
    throw new Error('Invalid message signature');
  }

  return payload;
}

export async function encryptServerName(name, channelKey) {
  const encoder = new TextEncoder();
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const aesKey = await crypto.subtle.importKey('raw', channelKey, 'AES-GCM', false, ['encrypt']);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    aesKey,
    encoder.encode(name)
  );
  return {
    ciphertext: new Uint8Array(ciphertext),
    nonce
  };
}

export async function decryptServerName(ciphertext, nonce, channelKey) {
  const aesKey = await crypto.subtle.importKey('raw', channelKey, 'AES-GCM', false, ['decrypt']);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce },
    aesKey,
    ciphertext
  );
  return new TextDecoder().decode(decrypted);
}
