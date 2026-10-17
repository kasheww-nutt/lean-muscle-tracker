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
 FOREACH name IN ARRAY ARRAY['meals','water_intakes','body_weights','workouts','tracker_accounts','oauth_codes','oauth_tokens','widget_tokens','auth_attempts','schema_migrations'] LOOP
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
