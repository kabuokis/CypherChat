# Phase 3 — Server/Group Features — Implementation Complete

## What's Been Built

### Database Schema
- `servers` — encrypted name, icon, owner, invite hash, member count (max 150)
- `server_members` — role (admin/moderator/member), encrypted username
- `channels` — encrypted name, privacy settings, role requirements
- `channel_keys` — per-member encrypted AES-256 keys with versioning
- `server_messages` — signed, encrypted group messages with sequence numbers

### Server API
| Endpoint | Auth | Description |
|----------|------|-------------|
| POST /api/servers | ✓ | Create server (encrypted name) |
| GET /api/servers | ✓ | List my servers |
| GET /api/servers/:id | ✓ | Get server details |
| GET /api/servers/:id/members | ✓ | List members with pubkeys |
| POST /api/servers/:id/invite | ✓ admin/mod | Generate invite token |
| POST /api/servers/join | ✓ | Join via invite (150 cap enforced) |
| POST /api/servers/:id/leave | ✓ | Leave server |
| POST /api/servers/:id/kick | ✓ higher role | Kick member |
| POST /api/servers/:id/role | ✓ admin | Promote/demote |
| POST /api/servers/:id/rotate-keys | ✓ admin | Rotate all channel keys |
| DELETE /api/servers/:id | ✓ owner | Delete server |
| POST /api/channels | ✓ admin/mod | Create channel |
| GET /api/channels | ✓ | List channels (role-filtered) |
| GET /api/channels/keys | ✓ | Get my encrypted keys |
| POST /api/channels/:id/messages | ✓ | Send group message |
| GET /api/channels/:id/messages | ✓ | Fetch messages |

### Client Crypto
- `generateChannelKey()` — random AES-256 key
- `encryptChannelKey()` — ECDH+X25519 per-member encryption
- `decryptChannelKey()` — decrypt with identity private key
- `encryptGroupMessage()` — AES-GCM + Ed25519 signature
- `decryptGroupMessage()` — decrypt + verify signature
- `encryptServerName()` / `decryptServerName()` — name encryption

### Client Stores
- `servers` — server list, active server, channels, members
- `serverMessages` — polling, send/receive for group chats
- IndexedDB storage for channel keys

### UI Components
- **ServerSidebar** — server icons, create/join modals, member count badges
- **MemberList** — avatars, roles, kick/promote/demote buttons, admin panel toggle
- **ChannelCreator** — modal with privacy + role requirements
- **Updated Chat** — unified DM/server view, invite generation, channel switching

### Security Properties
| Threat | Mitigation |
|--------|-----------|
| Server reads messages | AES-GCM encrypted, server only stores ciphertext |
| Server enumerates members | Usernames encrypted per-server |
| Server reads server names | Names encrypted with channel key |
| Kicked member reads future messages | Immediate key rotation on kick |
| Privilege escalation | Server-side role hierarchy enforcement |
| Member cap bypass | Atomic check-and-increment at 150 |
| Message forgery | Ed25519 signatures on all group messages |

## Migration
Run the new schema additions against your existing database:
```bash
psql $DATABASE_URL -f server/schema_additions.sql
```

Or if starting fresh, the full `schema.sql` includes all Phase 2 + Phase 3 tables.
