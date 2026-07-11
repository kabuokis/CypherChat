import { argon2id } from 'hash-wasm';

export async function deriveKey(password, salt, params = {}) {
  const hash = await argon2id({
    password,
    salt,
    parallelism: params.parallelism || 4,
    iterations: params.iterations || 3,
    memorySize: params.memory || 65536,
    hashLength: 32,
    outputType: 'binary'
  });
  return new Uint8Array(hash);
}