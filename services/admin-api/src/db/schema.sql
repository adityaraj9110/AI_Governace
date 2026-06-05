-- ============================================
-- AI FinOps Gateway — V1 Database Schema
-- PostgreSQL 16+
-- ============================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================
-- USERS
-- ============================================
CREATE TABLE users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  password_hash TEXT,  -- bcrypt hash (for credentials login)
  role        TEXT NOT NULL DEFAULT 'viewer'
                CHECK (role IN ('admin', 'developer', 'analyst', 'viewer')),
  avatar_url  TEXT,
  status      TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'inactive', 'suspended')),
  last_login  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);

-- ============================================
-- PROVIDERS
-- ============================================
CREATE TABLE providers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT UNIQUE NOT NULL,        -- e.g. 'openai', 'anthropic', 'gemini'
  display_name    TEXT NOT NULL,               -- e.g. 'OpenAI', 'Anthropic', 'Google Gemini'
  base_url        TEXT NOT NULL,               -- user-provided base URL
  api_key_encrypted TEXT NOT NULL,             -- user's provider API key (encrypted at rest)
  api_key_prefix  TEXT,                        -- first 8 chars for display (sk-xxxx••••)
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'inactive', 'error')),
  models          JSONB DEFAULT '[]'::jsonb,   -- discovered models from provider API
  config          JSONB DEFAULT '{}'::jsonb,   -- provider-specific config
  added_by        UUID REFERENCES users(id),   -- who added this provider
  last_verified   TIMESTAMPTZ,                 -- last time models were refreshed
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- VIRTUAL KEYS
-- ============================================
CREATE TABLE virtual_keys (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  key_prefix  TEXT NOT NULL,                -- first 8 chars of the key (for display: vk-xxxx...)
  key_hash    TEXT UNIQUE NOT NULL,          -- SHA-256 of the full vk-xxxx key
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  provider_id UUID REFERENCES providers(id),
  config      JSONB DEFAULT '{}'::jsonb,    -- allowed_models, rate_limits, etc.
  status      TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'revoked', 'expired')),
  last_used   TIMESTAMPTZ,
  total_requests BIGINT DEFAULT 0,
  total_cost  NUMERIC(12,4) DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now(),
  expires_at  TIMESTAMPTZ,
  revoked_at  TIMESTAMPTZ
);

CREATE INDEX idx_vkeys_hash ON virtual_keys(key_hash);
CREATE INDEX idx_vkeys_user ON virtual_keys(user_id);
CREATE INDEX idx_vkeys_status ON virtual_keys(status);

-- ============================================
-- COST EVENTS (V1: PostgreSQL, later → ClickHouse)
-- ============================================
CREATE TABLE cost_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id        UUID NOT NULL,
  virtual_key_id    UUID REFERENCES virtual_keys(id),
  user_id           UUID REFERENCES users(id),
  provider          TEXT NOT NULL,
  model             TEXT NOT NULL,
  prompt_tokens     INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens      INTEGER NOT NULL DEFAULT 0,
  cost_usd          NUMERIC(12, 6) NOT NULL DEFAULT 0,
  latency_ms        INTEGER NOT NULL DEFAULT 0,
  status_code       SMALLINT NOT NULL DEFAULT 200,
  environment       TEXT DEFAULT 'production',
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_cost_events_user ON cost_events(user_id);
CREATE INDEX idx_cost_events_key ON cost_events(virtual_key_id);
CREATE INDEX idx_cost_events_date ON cost_events(created_at);
CREATE INDEX idx_cost_events_provider ON cost_events(provider);
CREATE INDEX idx_cost_events_model ON cost_events(model);

-- ============================================
-- PROMPT LOGS (V1: PostgreSQL, later → Kafka → ClickHouse)
-- ============================================
CREATE TABLE prompt_logs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id        UUID NOT NULL,
  virtual_key_id    UUID REFERENCES virtual_keys(id),
  user_id           UUID REFERENCES users(id),
  provider          TEXT NOT NULL,
  model             TEXT NOT NULL,
  prompt_preview    TEXT,                     -- first 200 chars of prompt
  prompt_full       TEXT,                     -- full prompt (could be large)
  response_preview  TEXT,                     -- first 200 chars of response
  response_full     TEXT,                     -- full response
  prompt_tokens     INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  total_tokens      INTEGER DEFAULT 0,
  cost_usd          NUMERIC(12, 6) DEFAULT 0,
  latency_ms        INTEGER DEFAULT 0,
  status_code       SMALLINT DEFAULT 200,
  metadata          JSONB DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_prompt_logs_date ON prompt_logs(created_at DESC);
CREATE INDEX idx_prompt_logs_user ON prompt_logs(user_id);
CREATE INDEX idx_prompt_logs_model ON prompt_logs(model);

-- ============================================
-- SESSIONS (for NextAuth.js)
-- ============================================
CREATE TABLE sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_token TEXT UNIQUE NOT NULL,
  user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
  expires       TIMESTAMPTZ NOT NULL
);

CREATE TABLE accounts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID REFERENCES users(id) ON DELETE CASCADE,
  type                TEXT NOT NULL,
  provider            TEXT NOT NULL,
  provider_account_id TEXT NOT NULL,
  refresh_token       TEXT,
  access_token        TEXT,
  expires_at          INTEGER,
  token_type          TEXT,
  scope               TEXT,
  id_token            TEXT,
  session_state       TEXT,
  UNIQUE(provider, provider_account_id)
);
