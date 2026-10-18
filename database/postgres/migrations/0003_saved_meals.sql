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
