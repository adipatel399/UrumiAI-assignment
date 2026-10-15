CREATE TABLE IF NOT EXISTS schema_migrations(version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS platform_settings(key text PRIMARY KEY, value text NOT NULL);
CREATE TABLE IF NOT EXISTS users(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text UNIQUE NOT NULL,
  password_hash text NOT NULL, role text NOT NULL CHECK(role IN ('admin','member')),
  active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions(
  token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS api_keys(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id),
  name text NOT NULL, prefix text NOT NULL, token_hash text UNIQUE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz
);
CREATE TABLE IF NOT EXISTS invitations(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL, role text NOT NULL CHECK(role IN ('admin','member')),
  token_hash text UNIQUE NOT NULL, invited_by uuid NOT NULL REFERENCES users(id),
  expires_at timestamptz NOT NULL, accepted_at timestamptz
);
CREATE TABLE IF NOT EXISTS upstreams(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text UNIQUE NOT NULL, name text NOT NULL,
  url text NOT NULL, credential text, enabled boolean NOT NULL DEFAULT true,
  read_tools text[] NOT NULL DEFAULT '{}', status text NOT NULL DEFAULT 'Unreachable',
  last_error text, checked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS audit_log(
  id bigserial PRIMARY KEY, user_id uuid REFERENCES users(id), key_id uuid REFERENCES api_keys(id),
  server_id uuid, server_name text, tool text NOT NULL, timestamp timestamptz NOT NULL DEFAULT now(),
  duration_ms integer NOT NULL DEFAULT 0, outcome text NOT NULL, error_code text
);
CREATE INDEX IF NOT EXISTS audit_recent ON audit_log(timestamp DESC);
INSERT INTO schema_migrations(version) VALUES(1) ON CONFLICT DO NOTHING;

ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'external';
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS session_hash text;
CREATE INDEX IF NOT EXISTS audit_server ON audit_log(server_id);
INSERT INTO schema_migrations(version) VALUES(2) ON CONFLICT DO NOTHING;
