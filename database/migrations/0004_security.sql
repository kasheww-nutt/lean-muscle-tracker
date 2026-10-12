CREATE TABLE auth_attempts (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, reset_at INTEGER NOT NULL);
CREATE TABLE oauth_codes (code_hash TEXT PRIMARY KEY, client_id TEXT NOT NULL, redirect_uri TEXT NOT NULL, challenge TEXT NOT NULL, resource TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE oauth_tokens (token_hash TEXT PRIMARY KEY, client_id TEXT NOT NULL, kind TEXT NOT NULL, resource TEXT NOT NULL, expires_at INTEGER NOT NULL);
