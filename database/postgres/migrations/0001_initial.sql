CREATE TABLE meals (
  id TEXT PRIMARY KEY, record_order BIGSERIAL UNIQUE NOT NULL, user_id TEXT NOT NULL,
  date TEXT NOT NULL, name TEXT NOT NULL, ingredients TEXT NOT NULL DEFAULT '',
  ingredient_details TEXT NOT NULL DEFAULT '[]', meal_type TEXT NOT NULL DEFAULT '',
  calories DOUBLE PRECISION NOT NULL CHECK (calories >= 0),
  protein DOUBLE PRECISION NOT NULL CHECK (protein >= 0),
  carbs DOUBLE PRECISION NOT NULL CHECK (carbs >= 0),
  fat DOUBLE PRECISION NOT NULL CHECK (fat >= 0),
  is_test INTEGER NOT NULL DEFAULT 0 CHECK (is_test IN (0,1)),
  note TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'chatgpt',
  created_at TEXT NOT NULL DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS.US')
);
CREATE INDEX meals_user_date_idx ON meals(user_id,date);
CREATE TABLE body_weights (
  id TEXT PRIMARY KEY, record_order BIGSERIAL UNIQUE NOT NULL, user_id TEXT NOT NULL,
  date TEXT, weight_kg DOUBLE PRECISION NOT NULL CHECK (weight_kg BETWEEN 20 AND 300),
  record_type TEXT NOT NULL DEFAULT 'weigh_in' CHECK (record_type IN ('weigh_in','reference')),
  context TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS.US')
);
CREATE INDEX body_weights_user_type_date_idx ON body_weights(user_id,record_type,date);
CREATE TABLE workouts (
  id TEXT PRIMARY KEY, record_order BIGSERIAL UNIQUE NOT NULL, user_id TEXT NOT NULL,
  date TEXT NOT NULL, session TEXT NOT NULL, volume_kg DOUBLE PRECISION NOT NULL CHECK(volume_kg >= 0),
  details TEXT NOT NULL DEFAULT '', exercises TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS.US')
);
CREATE INDEX workouts_user_session_date_idx ON workouts(user_id,session,date);
CREATE TABLE water_intakes (
  id TEXT PRIMARY KEY, record_order BIGSERIAL UNIQUE NOT NULL, user_id TEXT NOT NULL,
  date TEXT NOT NULL, amount_ml DOUBLE PRECISION NOT NULL CHECK(amount_ml > 0 AND amount_ml <= 20000),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS.US')
);
CREATE INDEX water_user_date_idx ON water_intakes(user_id,date);
CREATE TABLE widget_tokens(user_id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, expires_at BIGINT NOT NULL);
CREATE TABLE auth_attempts(key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, reset_at BIGINT NOT NULL);
CREATE TABLE oauth_codes(code_hash TEXT PRIMARY KEY,client_id TEXT NOT NULL,redirect_uri TEXT NOT NULL,challenge TEXT NOT NULL,resource TEXT NOT NULL,expires_at BIGINT NOT NULL);
CREATE TABLE oauth_tokens(token_hash TEXT PRIMARY KEY,client_id TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('access','refresh')),resource TEXT NOT NULL,expires_at BIGINT NOT NULL);
CREATE INDEX oauth_codes_expiry_idx ON oauth_codes(expires_at);
CREATE INDEX oauth_tokens_expiry_idx ON oauth_tokens(expires_at);
