import { x25519 } from '@noble/curves/ed25519.js';
import { ed25519 } from '@noble/curves/ed25519.js';

export function generateIdentityKeyPair() {
  const { secretKey, publicKey } = x25519.keygen();
  return {
    privateKey: secretKey,
    publicKey
  };
}

export function generateSigningKeyPair() {
  const { secretKey, publicKey } = ed25519.keygen();
  return {
    privateKey: secretKey,
    publicKey
  };
}

export function exportKeyPair(identityPrivateKey, signingPrivateKey) {
  const combined = new Uint8Array(64);
  combined.set(identityPrivateKey, 0);
  combined.set(signingPrivateKey, 32);
  return combined;
}

export function importKeyPair(combined) {
  return {
    identityPrivateKey: combined.slice(0, 32),
    signingPrivateKey: combined.slice(32, 64)
  };
}

export function importSigningKeyPair(signingPrivateKey) {
  const publicKey = ed25519.getPublicKey(signingPrivateKey);
  return { privateKey: signingPrivateKey, publicKey };
}

export function importPublicKey(bytes) {
  return bytes.slice();
}

export function importSigningPublicKey(bytes) {
  return bytes.slice();
}
