CREATE TABLE coach_profiles(user_id TEXT PRIMARY KEY,profile_json TEXT NOT NULL);
CREATE TABLE meal_plans(
 id TEXT PRIMARY KEY,user_id TEXT NOT NULL,date TEXT NOT NULL,planned_time TEXT NOT NULL DEFAULT '',
 meal_json TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','eaten','skipped')),
 created_at_ms BIGINT NOT NULL
);
CREATE INDEX meal_plans_user_date_idx ON meal_plans(user_id,date);
CREATE TABLE coach_answers(
 user_id TEXT NOT NULL,id TEXT NOT NULL,question_hash TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('pending','complete','failed')),
 answer_json TEXT NOT NULL DEFAULT '{}',created_at_ms BIGINT NOT NULL,PRIMARY KEY(user_id,id)
);
DO $$ DECLARE name TEXT; BEGIN
 FOREACH name IN ARRAY ARRAY['coach_profiles','meal_plans','coach_answers'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',name);
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON TABLE %I FROM anon',name); END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON TABLE %I FROM authenticated',name); END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='tracker_app') THEN
   EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE %I TO tracker_app',name);
   EXECUTE format('CREATE POLICY tracker_backend ON %I TO tracker_app USING (true) WITH CHECK (true)',name);
  END IF;
 END LOOP;
END $$;
