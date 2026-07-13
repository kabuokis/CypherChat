import { argon2id } from 'hash-wasm';

export async function deriveKey(password, salt) {
  const encoder = new TextEncoder();
  const passwordBytes = encoder.encode(password.normalize('NFKC'));

  const hashHex = await argon2id({
    password: passwordBytes,
    salt,
    parallelism: 4,
    iterations: 3,
    memorySize: 64 * 1024,
    hashLength: 32,
    outputType: 'hex'
  });

  const result = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    result[i] = parseInt(hashHex.substr(i * 2, 2), 16);
  }
  return result;
}
