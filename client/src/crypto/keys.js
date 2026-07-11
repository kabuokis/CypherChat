export async function generateIdentityKeyPair() {
  return await crypto.subtle.generateKey(
    { name: 'X25519' }, true, ['deriveBits']
  );
}

export async function generateSigningKeyPair() {
  return await crypto.subtle.generateKey(
    { name: 'Ed25519' }, true, ['sign', 'verify']
  );
}

export async function exportKeyPair(keyPair) {
  const pub = await crypto.subtle.exportKey('raw', keyPair.publicKey);
  const jwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
  return {
    publicKey: new Uint8Array(pub),
    privateKey: base64urlToBytes(jwk.d)
  };
}

export async function exportSigningKeyPair(keyPair) {
  const pub = await crypto.subtle.exportKey('raw', keyPair.publicKey);
  const jwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
  return {
    publicKey: new Uint8Array(pub),
    privateKey: base64urlToBytes(jwk.d)
  };
}

export async function importKeyPair(publicKeyRaw, privateKeyRaw) {
  const publicKey = await crypto.subtle.importKey(
    'raw', publicKeyRaw, { name: 'X25519' }, true, []
  );
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    {
      kty: 'OKP', crv: 'X25519',
      x: bytesToBase64url(publicKeyRaw),
      d: bytesToBase64url(privateKeyRaw)
    },
    { name: 'X25519' }, true, ['deriveBits']
  );
  return { publicKey, privateKey };
}

export async function importSigningKeyPair(publicKeyRaw, privateKeyRaw) {
  const publicKey = await crypto.subtle.importKey(
    'raw', publicKeyRaw, { name: 'Ed25519' }, true, ['verify']
  );
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    {
      kty: 'OKP', crv: 'Ed25519',
      x: bytesToBase64url(publicKeyRaw),
      d: bytesToBase64url(privateKeyRaw)
    },
    { name: 'Ed25519' }, true, ['sign']
  );
  return { publicKey, privateKey };
}

export async function importSigningPublicKey(rawBytes) {
  return await crypto.subtle.importKey(
    'raw', rawBytes, { name: 'Ed25519' }, true, ['verify']
  );
}

export async function importPublicKey(rawBytes) {
  return await crypto.subtle.importKey(
    'raw', rawBytes, { name: 'X25519' }, true, []
  );
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