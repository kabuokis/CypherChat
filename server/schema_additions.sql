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
