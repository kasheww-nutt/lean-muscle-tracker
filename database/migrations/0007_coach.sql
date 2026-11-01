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
