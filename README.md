# CypherChat

A privacy-first, end-to-end encrypted messenger built for the web. Inspired by Discord's UX, built on Signal's threat model. The server is intentionally blind — it routes encrypted blobs and nothing else.

> **Status:** Phase 2 complete — 1:1 messaging, file/photo sharing, 2FA, multi-device login all working.

---

## Goals

**The core promise:** even if the server is hacked, subpoenaed, or run by bad actors, there is nothing useful to find. No message content, no photos, no contact lists, no real usernames — only encrypted bytes.

Specific non-goals that most "private" apps get wrong:

- No phone number or real name required to register
- No password stored or transmitted — ever
- No plaintext metadata on the server (contact lists are encrypted, usernames are hashed)
- No analytics, no telemetry, no third-party SDKs
- No read receipts or "last seen" timestamps stored server-side

---

## How it works

### Identity

On registration, the browser generates two keypairs using the WebCrypto API:

- **X25519 identity keypair** — used for ECDH key exchange to encrypt messages
- **Ed25519 signing keypair** — used to sign messages so recipients can verify sender identity

Both private keys are wrapped with AES-GCM (keyed from the user's password via Argon2) and stored in IndexedDB. The server never sees a private key.

### Login

No password is sent to the server. Instead:

1. Client fetches the user's Argon2 salt from the server
2. Client runs Argon2id locally to derive a 256-bit master key
3. Client computes `HMAC-SHA256(masterKey, serverChallenge)` and sends only the response
4. Server verifies the HMAC using the stored password verifier (the Argon2 output from registration)
5. On success, server returns the encrypted key backup blob — client decrypts it locally to recover the keypairs

The server stores: username hash, Argon2 salt, HMAC verifier, identity public key, signing public key, encrypted private key blob. No password. No plaintext username.

### Messaging

Each message uses ephemeral ECDH:

1. Sender generates a fresh X25519 ephemeral keypair
2. Derives a shared secret: `ECDH(ephemeralPrivate, recipientPublicKey)`
3. Derives an AES-256-GCM key via HKDF-SHA256
4. Encrypts the payload (content + sender public key + timestamp + attachment metadata)
5. Signs the payload with the Ed25519 signing key
6. Pads the ciphertext to fixed size buckets (256 / 1024 / 4096 / 16384 bytes) to prevent traffic analysis
7. Sends only `{ ephemeralPublicKey, ciphertext }` to the server

The server stores the ciphertext blob against the recipient's username hash. It cannot read the content, does not know who sent it (sealed sender), and deletes messages after delivery.

### File and photo sharing

Files are encrypted on the device before upload:

1. Random AES-256-GCM key and IV generated per file
2. Images: EXIF stripped via canvas redraw, converted to WebP, then encrypted
3. Encrypted blob uploaded directly to Cloudflare R2 via presigned URL — server never proxies the content
4. A blurred encrypted thumbnail (separate IV) is embedded in the message envelope
5. The blob URL + decryption key travel inside the encrypted message — server cannot link blob to any user

Tapping an image downloads and decrypts it on demand. The server only ever stores opaque ciphertext.

### Multi-device login

The encrypted key backup (both keypairs, AES-GCM encrypted with an HKDF-derived backup key) is stored server-side. Logging in on a new device fetches this blob and decrypts it locally using the master key derived from the password. The server holds encrypted bytes it cannot open.

---

## What the server knows

| Data | Server sees |
|---|---|
| Username | SHA-256 hash only |
| Password | Never |
| Private keys | AES-GCM encrypted blob — cannot decrypt |
| Message content | Never |
| Who sent a message | Never (sealed sender) |
| Photos / files | Encrypted ciphertext only |
| Contact list | Encrypted per contact |
| TOTP secret | AES-256-GCM encrypted at rest |
| Email | SHA-256 hash only (if provided) |

---

## Stack

**Client**
- React 18 + Vite
- WebCrypto API (all cryptographic operations)
- Argon2id via `hash-wasm` (WASM, runs in browser)
- `otpauth` for TOTP
- IndexedDB for local key and message storage

**Server**
- Node.js + Fastify
- PostgreSQL (messages, users, challenges, blob metadata)
- `@fastify/rate-limit` on all auth endpoints
- `@aws-sdk/client-s3` for Cloudflare R2 presigned URLs

**Infrastructure**
- Cloudflare R2 for encrypted blob storage
- Docker Compose for local Postgres

---

## Quick start

```bash
# 1. Start Postgres
docker-compose up -d

# 2. Configure environment
cp .env.example server/.env
# Edit server/.env — set JWT_SECRET to a random 32+ byte string
# R2 variables optional for local dev (file upload will be disabled)

# 3. Start server
cd server && npm install && npm run dev

# 4. Start client
cd client && npm install && npm run dev
```

Client runs at `http://localhost:5173`, server at `http://localhost:3000`.

For file uploads, configure Cloudflare R2 in `server/.env` — create a bucket, generate an API token with R2 read/write permissions, and optionally set a public custom domain as `R2_PUBLIC_URL`.

---

## Environment variables

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/messenger
JWT_SECRET=change-me-to-a-random-32-byte-string
CLIENT_URL=http://localhost:5173

# Cloudflare R2 (optional — file upload disabled without these)
R2_ENDPOINT=https://<accountid>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=your-r2-access-key
R2_SECRET_ACCESS_KEY=your-r2-secret-key
R2_BUCKET_NAME=cypherchat-blobs
R2_PUBLIC_URL=https://cdn.yourdomain.com
```

**Important:** `JWT_SECRET` is also used to derive the TOTP encryption key via scrypt. Use a strong random value in production and never rotate it without migrating TOTP secrets first.

---

## Security notes

- Argon2id parameters: 3 iterations, 64MB memory, parallelism 4. Intentionally slow (~1-2s in browser) to make brute-force expensive.
- All auth endpoints rate-limited to 5 requests per 15 minutes per IP.
- Challenges are single-use — consumed immediately on any verify attempt, success or failure.
- Messages are deleted from the server after delivery. History lives only in the recipient's local IndexedDB.
- Blob storage enforces a 9.5GB total cap with oldest-first eviction. Individual files capped at 5MB.
- Screen security and clipboard protection are the responsibility of the host OS — the app does not prevent screenshots.

---

## TODO

### Immediate (bugs / remaining fixes)

- [ ] **Thumbnail IV reuse** — `files.js` encrypts the blurred thumbnail with the same `fileIv` as the full image. AES-GCM nonce reuse with the same key leaks the XOR of both plaintexts. Fix: generate a separate `thumbIv`, store it as `thumbnailIv` in the attachment, and use it when decrypting the thumbnail in `Chat.jsx`
- [ ] **Encrypted username not decrypted on render** — `localStorage.getItem('username')` in `Chat.jsx` returns the encrypted base64 string, not the plaintext. Need a `decryptUsername(masterKey)` call after login and store the result in React state or sessionStorage
- [ ] **Signing key not yet used** — Ed25519 keypair is generated, stored, and registered but `e2e.js` `encryptMessage` does not yet sign the payload. Add `crypto.subtle.sign` over the plaintext payload before encryption and verify on decrypt

### Phase 3 — Servers / groups

- [ ] Group key model — one AES-256 key per channel, encrypted per member pubkey on join
- [ ] Create server (name, icon encrypted)
- [ ] Channels within a server, each with its own key
- [ ] Roles: admin, moderator, member
- [ ] Invite links — generate a signed token that grants access and delivers the channel key
- [ ] Member removal — triggers group key rotation for all remaining members
- [ ] Cap at 150 members for v1 to keep rotation cost manageable
- [ ] Private channels — role-gated, separate key from public channels
- [ ] Server member list stored as encrypted blob — server cannot enumerate members

### Phase 4 — Real-time

- [ ] Replace 5-second polling with WebSockets (server already has the structure for it)
- [ ] Typing indicators over WebSocket (ephemeral, never stored)
- [ ] Online presence — opt-in, not stored server-side
- [ ] Push notifications for new messages (web push API, payload encrypted)

### Phase 5 — Calling

- [ ] 1:1 audio/video via WebRTC (DTLS-SRTP, encrypted by default)
- [ ] Signalling via sealed sender — server relays SDP offers/answers without knowing who is calling who
- [ ] TURN relay so caller and recipient IPs are never exposed to each other
- [ ] Group calls up to ~8 people via SFU (mediasoup or Livekit)

### Hardening / polish

- [ ] Content Security Policy headers on all server responses
- [ ] Key fingerprint display — let users verify each other's identity public keys out-of-band
- [ ] Device linking via QR code (Option B multi-device) as alternative to password-based key backup
- [ ] Export / import encrypted key file for power users (Option C)
- [ ] Session management — list active sessions, revoke individual devices
- [ ] Account deletion — wipe all server data on request
- [ ] Disappearing messages TTL selector (UI exists, needs server-side expiry enforcement review)
- [ ] Tor mode toggle for high-risk users (routes all requests via Socks5 proxy)
- [ ] PWA manifest + service worker for installable web app
- [ ] Dark / light theme toggle (CSS variables already in place)
