import { env } from '../services/runtime';
import { trackerUser } from '../services/access';
import { TARGETS, localDate, validDate, parseArray, totalMeals, weightTrend, workoutComparisons, loggingStreak, type Water, type WaterDay, type VolumeDay, type LoggingDay, type Meal, type Weight, type Workout, type NutritionDay, type Ingredient, type Exercise } from '../services/tracker';

export const dynamic = 'force-dynamic';
const noStore = { 'Cache-Control': 'no-store' };
export async function GET(request: Request) {
  try {
    const ownerId = await trackerUser(request);
    if (!ownerId) return Response.json({ error: 'Your access session expired. Unlock your tracker again.' }, { status: 401, headers: noStore });
    const db = env.DB;
    if (!db || !ownerId) return Response.json({ error: 'Tracker storage is unavailable. Your saved entries have not been changed.' }, { status: 503, headers: noStore });
    const url = new URL(request.url), today = localDate(), requested = url.searchParams.get('date');
    if (requested && !validDate(requested)) return Response.json({ error: 'Choose a valid calendar date.' }, { status: 400, headers: noStore });
    const [historyRows, latestActivity] = await Promise.all([
      db.prepare('SELECT date, SUM(calories) AS calories, SUM(protein) AS protein, SUM(carbs) AS carbs, SUM(fat) AS fat, COUNT(*) AS meal_count FROM meals WHERE user_id = ? AND is_test = 0 GROUP BY date ORDER BY date DESC').bind(ownerId).all<NutritionDay>(),
      db.prepare(`SELECT MAX(date) AS date FROM (
        SELECT date FROM meals WHERE user_id = ? AND is_test = 0
        UNION ALL SELECT date FROM water_intakes WHERE user_id = ?
        UNION ALL SELECT date FROM workouts WHERE user_id = ?
        UNION ALL SELECT date FROM body_weights WHERE user_id = ? AND record_type = 'weigh_in'
      ) WHERE date <= ?`).bind(ownerId,ownerId,ownerId,ownerId,today).first<{date:string|null}>(),
    ]);
    const history = historyRows.results ?? [], latestMealDate = history[0]?.date ?? null;
    const latestLogDate = latestActivity?.date ?? null;
    const date = requested || latestLogDate || today;
    const [mealRows, weightRows, referenceRows, workoutRows, waterRows, waterHistoryRows, volumeRows, activityRows] = await Promise.all([
      db.prepare('SELECT * FROM meals WHERE user_id = ? AND date = ? ORDER BY created_at ASC, rowid ASC').bind(ownerId, date).all<Meal>(),
      db.prepare("SELECT id, date, weight_kg, context FROM body_weights WHERE user_id = ? AND record_type = 'weigh_in' ORDER BY date DESC, created_at DESC, rowid DESC LIMIT 180").bind(ownerId).all<Weight>(),
      db.prepare("SELECT weight_kg, context FROM body_weights WHERE user_id = ? AND record_type = 'reference' ORDER BY created_at DESC, rowid DESC LIMIT 1").bind(ownerId).all(),
      db.prepare('SELECT * FROM workouts WHERE user_id = ? ORDER BY date DESC, created_at DESC, rowid DESC LIMIT 90').bind(ownerId).all<Workout>(),
      db.prepare('SELECT * FROM water_intakes WHERE user_id = ? AND date = ? ORDER BY created_at ASC, rowid ASC').bind(ownerId, date).all<Water>(),
      db.prepare('SELECT date, SUM(amount_ml) AS amount_ml, COUNT(*) AS entry_count FROM water_intakes WHERE user_id = ? GROUP BY date ORDER BY date DESC').bind(ownerId).all<WaterDay>(),
      db.prepare('SELECT date, lower(trim(session)) AS session, SUM(volume_kg) AS volume_kg, COUNT(*) AS session_count FROM workouts WHERE user_id = ? GROUP BY date, lower(trim(session)) ORDER BY date DESC').bind(ownerId).all<VolumeDay>(),
      db.prepare(`SELECT date, SUM(meal_count) AS meal_count, SUM(water_count) AS water_count, SUM(workout_count) AS workout_count, SUM(weight_count) AS weight_count FROM (
        SELECT date, COUNT(*) AS meal_count, 0 AS water_count, 0 AS workout_count, 0 AS weight_count FROM meals WHERE user_id = ? AND is_test = 0 GROUP BY date
        UNION ALL SELECT date, 0, COUNT(*), 0, 0 FROM water_intakes WHERE user_id = ? GROUP BY date
        UNION ALL SELECT date, 0, 0, COUNT(*), 0 FROM workouts WHERE user_id = ? GROUP BY date
        UNION ALL SELECT date, 0, 0, 0, COUNT(*) FROM body_weights WHERE user_id = ? AND record_type = 'weigh_in' AND date IS NOT NULL GROUP BY date
      ) GROUP BY date ORDER BY date DESC`).bind(ownerId, ownerId, ownerId, ownerId).all<LoggingDay>(),
    ]);
    const meals = (mealRows.results ?? []).map(m => ({ ...m, ingredient_details: parseArray<Ingredient>(m.ingredient_details) }));
    const workouts = (workoutRows.results ?? []).map(w => ({ ...w, exercises: parseArray<Exercise>(w.exercises) }));
    const weights = [...new Map((weightRows.results ?? []).map(w => [w.date, w] as const).reverse()).values()].sort((a, b) => b.date.localeCompare(a.date));
    const water = waterRows.results ?? [], loggingDays = activityRows.results ?? [];
    return Response.json({ date, today, latestMealDate, latestLogDate, refreshedAt: new Date().toISOString(), totals: totalMeals(meals), targets: TARGETS, meals, history, weights, weightTrend: weightTrend(weights), referenceWeight: referenceRows.results?.[0] ?? null, workouts, comparisons: workoutComparisons(workouts), water, waterTotalMl: water.reduce((s,w) => s + Number(w.amount_ml), 0), waterHistory: waterHistoryRows.results ?? [], volumeHistory: volumeRows.results ?? [], loggingDays, streak: loggingStreak(loggingDays, today) }, { headers: noStore });
  } catch (error) {
    console.error('Tracker dashboard failed', error instanceof Error ? error.message : 'Unknown error');
    return Response.json({ error: 'Could not load your saved entries. Try refreshing in a moment.' }, { status: 500, headers: noStore });
  }
}
