CREATE TABLE tracker_accounts (
  user_id TEXT PRIMARY KEY,
  cognito_subject TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE oauth_codes ADD COLUMN user_id TEXT;
ALTER TABLE oauth_tokens ADD COLUMN user_id TEXT;
