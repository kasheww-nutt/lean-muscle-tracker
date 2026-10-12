CREATE TABLE `body_weights` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`date` text,
	`weight_kg` real NOT NULL,
	`record_type` text DEFAULT 'weigh_in' NOT NULL,
	`context` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `body_weights_user_type_date_idx` ON `body_weights` (`user_id`,`record_type`,`date`);--> statement-breakpoint
CREATE TABLE `meals` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`date` text NOT NULL,
	`name` text NOT NULL,
	`ingredients` text DEFAULT '' NOT NULL,
	`calories` real NOT NULL,
	`protein` real NOT NULL,
	`carbs` real NOT NULL,
	`fat` real NOT NULL,
	`is_test` integer DEFAULT 0 NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`source` text DEFAULT 'chatgpt' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `meals_user_date_idx` ON `meals` (`user_id`,`date`);--> statement-breakpoint
CREATE TABLE `workouts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`date` text NOT NULL,
	`session` text NOT NULL,
	`volume_kg` real NOT NULL,
	`details` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `workouts_user_session_date_idx` ON `workouts` (`user_id`,`session`,`date`);