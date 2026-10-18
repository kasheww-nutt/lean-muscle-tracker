-- FIRST SETUP ONLY: empty Supabase tracker database. Run in Supabase SQL Editor.
BEGIN;
SELECT pg_advisory_xact_lock(673017543);
CREATE TABLE public.schema_migrations(name TEXT PRIMARY KEY,checksum TEXT NOT NULL,applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
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

INSERT INTO public.schema_migrations(name,checksum) VALUES ('0001_initial.sql','436e3ef2d01a14da109593747be1b76b0fe15e59954b4160109d1cf9abaf43e1');
CREATE TABLE tracker_accounts (
  user_id TEXT PRIMARY KEY,
  cognito_subject TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE oauth_codes ADD COLUMN user_id TEXT;
ALTER TABLE oauth_tokens ADD COLUMN user_id TEXT;

INSERT INTO public.schema_migrations(name,checksum) VALUES ('0002_accounts.sql','cd6bee7860cb0b3ca58178f4c285563334a888f9496568f881243130b4651abe');
CREATE TABLE saved_meals (
 user_id TEXT NOT NULL,
 id TEXT NOT NULL,
 meal_json TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS.US'),
 PRIMARY KEY(user_id,id)
);
ALTER TABLE saved_meals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE saved_meals FROM PUBLIC;
-- Existing deployments already have the restricted backend role. First setup
-- creates it after migrations and applies database-security.sql instead.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON TABLE saved_meals FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON TABLE saved_meals FROM authenticated; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='tracker_app') THEN
  GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE saved_meals TO tracker_app;
  CREATE POLICY tracker_backend ON saved_meals TO tracker_app USING (true) WITH CHECK (true);
 END IF;
END $$;

INSERT INTO public.schema_migrations(name,checksum) VALUES ('0003_saved_meals.sql','7d776dde544a04dc06149578ef1d1d4d90bb817072bf2c956d3eb8536856f98c');
COMMIT;
-- Run after the tracker migrations, as the Supabase database administrator.
-- Create the restricted role, then set its password privately in SQL Editor:
-- ALTER ROLE tracker_app PASSWORD '<your generated private password>';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='tracker_app') THEN
  CREATE ROLE tracker_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
 END IF;
END $$;
GRANT USAGE ON SCHEMA public TO tracker_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
DO $$
DECLARE name TEXT;
BEGIN
 FOREACH name IN ARRAY ARRAY['saved_meals','meals','water_intakes','body_weights','workouts','tracker_accounts','oauth_codes','oauth_tokens','widget_tokens','auth_attempts','schema_migrations'] LOOP
  EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated',name);
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',name);
  IF name='schema_migrations' THEN
   EXECUTE format('GRANT SELECT ON TABLE public.%I TO tracker_app',name);
  ELSE
   EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO tracker_app',name);
  END IF;
  -- The backend role is private. End-user isolation remains enforced by scoped queries.
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=name AND policyname='tracker_backend') THEN
   EXECUTE format('CREATE POLICY tracker_backend ON public.%I TO tracker_app USING (true) WITH CHECK (true)',name);
  END IF;
 END LOOP;
END $$;
GRANT USAGE, SELECT ON SEQUENCE public.meals_record_order_seq,public.water_intakes_record_order_seq,public.body_weights_record_order_seq,public.workouts_record_order_seq TO tracker_app;
