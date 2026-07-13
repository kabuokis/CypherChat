CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username_hash BYTEA NOT NULL UNIQUE,
  email_hash BYTEA,
  argon2_salt BYTEA NOT NULL,
  password_verifier BYTEA NOT NULL,
  identity_public_key BYTEA NOT NULL,
  signing_public_key BYTEA NOT NULL,
  totp_secret TEXT,
  totp_secret_hash BYTEA,
  recovery_codes_hash TEXT[],
  encrypted_key_backup BYTEA NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS challenges (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username_hash BYTEA NOT NULL,
  challenge BYTEA NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '5 minutes')
);

CREATE INDEX idx_challenges_username_hash ON challenges(username_hash);
CREATE INDEX idx_challenges_expires_at ON challenges(expires_at);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash BYTEA NOT NULL,
  device_info TEXT,
  last_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_token_hash ON sessions(token_hash);

-- Phase 2: Direct Messaging
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recipient_username_hash BYTEA NOT NULL,
  ciphertext_blob BYTEA NOT NULL,
  ephemeral_public_key BYTEA NOT NULL,
  padding_size INTEGER DEFAULT 1024,
  sequence_number BIGSERIAL,
  delivered BOOLEAN DEFAULT FALSE,
  expires_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_messages_recipient ON messages(recipient_username_hash);
CREATE INDEX idx_messages_expires_at ON messages(expires_at);
CREATE INDEX idx_messages_sequence ON messages(sequence_number);

CREATE TABLE IF NOT EXISTS contacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_username_hash BYTEA NOT NULL,
  contact_username_hash BYTEA NOT NULL,
  contact_public_key BYTEA NOT NULL,
  contact_signing_public_key BYTEA NOT NULL,
  encrypted_alias BYTEA,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(owner_username_hash, contact_username_hash)
);

CREATE INDEX idx_contacts_owner ON contacts(owner_username_hash);

-- Phase 3: Servers / Groups
CREATE TABLE IF NOT EXISTS servers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name_ciphertext BYTEA NOT NULL,
  name_nonce BYTEA NOT NULL,
  icon_url TEXT,
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invite_token_hash BYTEA UNIQUE,
  member_count INTEGER DEFAULT 1,
  max_members INTEGER DEFAULT 150,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_servers_owner ON servers(owner_id);
CREATE INDEX idx_servers_invite ON servers(invite_token_hash);

CREATE TABLE IF NOT EXISTS server_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'moderator', 'member')),
  joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  encrypted_username BYTEA,
  UNIQUE(server_id, user_id)
);

CREATE INDEX idx_members_server ON server_members(server_id);
CREATE INDEX idx_members_user ON server_members(user_id);

CREATE TABLE IF NOT EXISTS channels (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name_ciphertext BYTEA NOT NULL,
  name_nonce BYTEA NOT NULL,
  is_private BOOLEAN DEFAULT FALSE,
  required_role TEXT DEFAULT 'member' CHECK (required_role IN ('admin', 'moderator', 'member')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_channels_server ON channels(server_id);

CREATE TABLE IF NOT EXISTS channel_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  encrypted_key BYTEA NOT NULL,
  key_version INTEGER DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(channel_id, user_id, key_version)
);

CREATE INDEX idx_channel_keys_channel ON channel_keys(channel_id);
CREATE INDEX idx_channel_keys_user ON channel_keys(user_id);

CREATE TABLE IF NOT EXISTS server_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ciphertext_blob BYTEA NOT NULL,
  nonce BYTEA NOT NULL,
  signature BYTEA NOT NULL,
  padding_size INTEGER DEFAULT 1024,
  sequence_number BIGSERIAL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_server_messages_channel ON server_messages(channel_id);
CREATE INDEX idx_server_messages_sequence ON server_messages(sequence_number);
