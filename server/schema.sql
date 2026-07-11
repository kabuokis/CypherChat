CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Users (existing + signing key)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username_hash BYTEA NOT NULL UNIQUE,
    email_hash BYTEA,
    argon2_salt BYTEA NOT NULL,
    password_verifier BYTEA NOT NULL,
    identity_public_key BYTEA NOT NULL,
    signing_public_key BYTEA NOT NULL,
    totp_secret TEXT,
    totp_secret_hash BYTEA,
    recovery_codes_hash TEXT[] DEFAULT '{}',
    encrypted_key_backup BYTEA NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Direct messages (existing)
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_username_hash BYTEA NOT NULL,
    ciphertext_blob BYTEA NOT NULL,
    ephemeral_public_key BYTEA NOT NULL,
    padding_size INTEGER NOT NULL DEFAULT 1024,
    sequence_number BIGSERIAL NOT NULL,
    delivered BOOLEAN DEFAULT FALSE,
    expires_at TIMESTAMP WITH TIME ZONE
);

-- Contacts (existing)
CREATE TABLE IF NOT EXISTS contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_username_hash BYTEA NOT NULL,
    contact_username_hash BYTEA NOT NULL,
    contact_public_key BYTEA,
    contact_signing_public_key BYTEA,
    encrypted_alias BYTEA,
    UNIQUE(owner_username_hash, contact_username_hash)
);

-- Challenges (existing)
CREATE TABLE IF NOT EXISTS challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username_hash BYTEA NOT NULL,
    challenge BYTEA NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() + INTERVAL '5 minutes'
);

-- Blobs (existing)
CREATE TABLE IF NOT EXISTS blobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    storage_key TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- SERVERS
CREATE TABLE IF NOT EXISTS servers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    encrypted_name BYTEA NOT NULL,
    encrypted_icon BYTEA,
    invite_code TEXT UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- SERVER MEMBERS
CREATE TABLE IF NOT EXISTS server_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    username_hash BYTEA NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    encrypted_server_key BYTEA NOT NULL,
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(server_id, user_id)
);

-- CHANNELS
CREATE TABLE IF NOT EXISTS channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    encrypted_name BYTEA NOT NULL,
    channel_key_hash BYTEA NOT NULL,
    is_private BOOLEAN DEFAULT FALSE,
    role_required TEXT DEFAULT 'member',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- CHANNEL KEYS (encrypted per member)
CREATE TABLE IF NOT EXISTS channel_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    encrypted_channel_key BYTEA NOT NULL,
    UNIQUE(channel_id, user_id)
);

-- SERVER MESSAGES
CREATE TABLE IF NOT EXISTS server_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    sender_username_hash BYTEA NOT NULL,
    ciphertext_blob BYTEA NOT NULL,
    iv BYTEA NOT NULL,
    sequence_number BIGSERIAL NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- INVITES
CREATE TABLE IF NOT EXISTS invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    code TEXT NOT NULL UNIQUE,
    encrypted_key_bundle BYTEA NOT NULL,
    uses_left INTEGER,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(recipient_username_hash);
CREATE INDEX IF NOT EXISTS idx_messages_expires ON messages(expires_at);
CREATE INDEX IF NOT EXISTS idx_contacts_owner ON contacts(owner_username_hash);
CREATE INDEX IF NOT EXISTS idx_challenges_user ON challenges(username_hash);
CREATE INDEX IF NOT EXISTS idx_blobs_expires ON blobs(expires_at);
CREATE INDEX IF NOT EXISTS idx_server_members_server ON server_members(server_id);
CREATE INDEX IF NOT EXISTS idx_server_members_user ON server_members(user_id);
CREATE INDEX IF NOT EXISTS idx_channels_server ON channels(server_id);
CREATE INDEX IF NOT EXISTS idx_channel_keys_channel ON channel_keys(channel_id);
CREATE INDEX IF NOT EXISTS idx_channel_keys_user ON channel_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_server_messages_channel ON server_messages(channel_id);
CREATE INDEX IF NOT EXISTS idx_invites_code ON invites(code);