import { sql } from "drizzle-orm";
import { index, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const meals = sqliteTable("meals", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  date: text("date").notNull(),
  name: text("name").notNull(),
  ingredients: text("ingredients").notNull().default(""),
  ingredientDetails: text("ingredient_details").notNull().default("[]"),
  mealType: text("meal_type").notNull().default(""),
  calories: real("calories").notNull(),
  protein: real("protein").notNull(),
  carbs: real("carbs").notNull(),
  fat: real("fat").notNull(),
  isTest: integer("is_test").notNull().default(0),
  note: text("note").notNull().default(""),
  source: text("source").notNull().default("chatgpt"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("meals_user_date_idx").on(table.userId, table.date)]);

export const bodyWeights = sqliteTable("body_weights", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  date: text("date"),
  weightKg: real("weight_kg").notNull(),
  recordType: text("record_type").notNull().default("weigh_in"),
  context: text("context").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("body_weights_user_type_date_idx").on(table.userId, table.recordType, table.date)]);

export const workouts = sqliteTable("workouts", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  date: text("date").notNull(),
  session: text("session").notNull(),
  volumeKg: real("volume_kg").notNull(),
  details: text("details").notNull().default(""),
  exercises: text("exercises").notNull().default("[]"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("workouts_user_session_date_idx").on(table.userId, table.session, table.date)]);

export const waterIntakes = sqliteTable("water_intakes", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  date: text("date").notNull(),
  amountMl: real("amount_ml").notNull(),
  note: text("note").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("water_user_date_idx").on(table.userId, table.date)]);

// Read-only widget credentials are hashed; creating a new link replaces the old one.
export const widgetTokens = sqliteTable("widget_tokens", {
  userId: text("user_id").primaryKey(),
  tokenHash: text("token_hash").notNull(),
  expiresAt: integer("expires_at").notNull(),
});

// Frozen usual-meal snapshots, scoped to the signed-in account.
export const savedMeals = sqliteTable("saved_meals", {
  userId: text("user_id").notNull(),
  id: text("id").notNull(),
  mealJson: text("meal_json").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [primaryKey({columns:[table.userId,table.id]})]);
