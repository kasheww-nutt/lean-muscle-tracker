CREATE TABLE saved_meals (
 user_id TEXT NOT NULL,
 id TEXT NOT NULL,
 meal_json TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(user_id,id)
);
