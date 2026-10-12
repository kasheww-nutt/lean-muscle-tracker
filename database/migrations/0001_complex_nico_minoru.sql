ALTER TABLE `meals` ADD `ingredient_details` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `meals` ADD `meal_type` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `workouts` ADD `exercises` text DEFAULT '[]' NOT NULL;