// Editable example targets; no personal profile is bundled.
export const TARGETS = { caloriesMin: 2500, caloriesMax: 2800, proteinMin: 100, proteinMax: 120, carbs: 350, fat: 80 };
export type Macros = { calories: number; protein: number; carbs: number; fat: number };
export type Ingredient = { name: string; quantity: string; basis?: string; calories?: number; protein?: number; carbs?: number; fat?: number };
export type Exercise = { name: string; sets: { reps: number; load_kg: number }[] };
export type Meal = Macros & { id: string; date: string; name: string; meal_type: string; ingredients: string; ingredient_details: Ingredient[]; is_test: number; note: string; created_at: string };
export type Weight = { id: string; date: string; weight_kg: number; context: string };
export type Workout = { id: string; date: string; session: string; volume_kg: number; details: string; exercises: Exercise[] };
export type NutritionDay = Macros & { date: string; meal_count: number };
export type Water = { id: string; date: string; amount_ml: number; note: string; created_at: string };
export type WaterDay = { date: string; amount_ml: number; entry_count: number };
export type VolumeDay = { date: string; session: string; volume_kg: number; session_count: number };
export type LoggingDay = { date: string; meal_count: number; water_count: number; workout_count: number; weight_count: number };
export type LoggingStreak = { current: number; longest: number; loggedDays: number; lastDate: string | null };
export type WeightTrend = { current: { start: string; end: string; average: number; count: number }; previous: { start: string; end: string; average: number; count: number } | null; change: number | null };
export type Dashboard = { date: string; today: string; latestMealDate: string | null; latestLogDate: string | null; refreshedAt: string; totals: Macros; targets: typeof TARGETS; meals: Meal[]; history: NutritionDay[]; weights: Weight[]; weightTrend: WeightTrend | null; referenceWeight: { weight_kg: number; context: string } | null; workouts: Workout[]; comparisons: Record<string, { date: string; volume_kg: number; change: number; percent: number | null }>; water: Water[]; waterTotalMl: number; waterHistory: WaterDay[]; volumeHistory: VolumeDay[]; loggingDays: LoggingDay[]; streak: LoggingStreak };

export function mealLogColor(count: number) {
  return count >= 3 ? 'green' : count === 2 ? 'yellow' : count === 1 ? 'red' : 'neutral';
}
// Today may still be in progress. A streak through yesterday remains current.
export function loggingStreak(days: LoggingDay[], today: string): LoggingStreak {
  const dates = [...new Set(days.filter(d => validDate(d.date) && d.date <= today && d.meal_count + d.water_count + d.workout_count + d.weight_count > 0).map(d => d.date))].sort();
  let longest = 0, run = 0, previous = '';
  for (const date of dates) { run = previous && shiftDate(previous, 1) === date ? run + 1 : 1; longest = Math.max(longest, run); previous = date; }
  const set = new Set(dates);
  let cursor = set.has(today) ? today : shiftDate(today, -1), current = 0;
  while (set.has(cursor)) { current++; cursor = shiftDate(cursor, -1); }
  return { current, longest, loggedDays: dates.length, lastDate: dates.at(-1) ?? null };
}

export function calendarCells(month: string): (string | null)[] {
  const first = `${month}-01`;
  if (!validDate(first)) return [];
  const leading = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7;
  const rows: (string | null)[] = Array(leading).fill(null);
  for (let day = first; day.slice(0,7) === month; day = shiftDate(day, 1)) rows.push(day);
  while (rows.length % 7) rows.push(null);
  return rows;
}
export function chartDays(history: NutritionDay[], volumes: VolumeDay[], water: WaterDay[], end: string, count: number, session = '') {
  const nutrition = new Map(history.map(d => [d.date, d]));
  const hydration = new Map(water.map(d => [d.date, d]));
  const training = new Map<string, number>();
  for (const d of volumes) if (!session || d.session === session) training.set(d.date, (training.get(d.date) ?? 0) + Number(d.volume_kg));
  return Array.from({length: count}, (_, index) => {
    const date = shiftDate(end, index - count + 1), food = nutrition.get(date);
    return { date, calories: food ? Number(food.calories) : null, protein: food ? Number(food.protein) : null, volume: training.get(date) ?? null, water: hydration.has(date) ? Number(hydration.get(date)!.amount_ml) : null };
  });
}

export function localDate() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const p = Object.fromEntries(parts.map(v => [v.type, v.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
export function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
export function shiftDate(value: string, days: number) {
  const d = new Date(`${value}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
}
export function parseArray<T>(value: unknown): T[] {
  try { const parsed = typeof value === 'string' ? JSON.parse(value) : value; return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}
export function totalMeals(meals: Array<Macros & { is_test: number }>): Macros {
  return meals.filter(m => !Number(m.is_test)).reduce((s, m) => ({ calories: s.calories + Number(m.calories), protein: s.protein + Number(m.protein), carbs: s.carbs + Number(m.carbs), fat: s.fat + Number(m.fat) }), { calories: 0, protein: 0, carbs: 0, fat: 0 });
}
export function weightTrend(input: Weight[]): WeightTrend | null {
  const unique = [...new Map([...input].reverse().map(w => [w.date, w])).values()].sort((a, b) => b.date.localeCompare(a.date));
  if (!unique.length) return null;
  const latest = unique[0].date;
  const day = new Date(`${latest}T12:00:00Z`).getUTCDay();
  const start = shiftDate(latest, -((day + 6) % 7)), previousStart = shiftDate(start, -7);
  const group = (from: string, to: string) => {
    const rows = unique.filter(w => w.date >= from && w.date <= to);
    return rows.length ? { start: from, end: to, average: rows.reduce((s, w) => s + Number(w.weight_kg), 0) / rows.length, count: rows.length } : null;
  };
  const current = group(start, shiftDate(start, 6))!;
  const previous = group(previousStart, shiftDate(previousStart, 6));
  return { current, previous, change: previous && current.count >= 2 && previous.count >= 2 ? current.average - previous.average : null };
}
export function workoutComparisons(workouts: Workout[]): Dashboard['comparisons'] {
  const out: Dashboard['comparisons'] = {};
  for (const w of workouts) {
    const earlier = workouts.find(p => p.date < w.date && p.session.trim().toLowerCase() === w.session.trim().toLowerCase());
    if (earlier) { const change = Number(w.volume_kg) - Number(earlier.volume_kg); out[w.id] = { date: earlier.date, volume_kg: Number(earlier.volume_kg), change, percent: Number(earlier.volume_kg) > 0 ? change / Number(earlier.volume_kg) * 100 : null }; }
  }
  return out;
}
export function textValue(value: unknown, key: string, required = false, max = 10000) {
  if (value != null && typeof value !== 'string') throw new Error(`${key} must be text.`);
  const text = typeof value === 'string' ? value.trim() : '';
  if (required && !text) throw new Error(`${key} is required.`);
  if (text.length > max) throw new Error(`${key} is too long.`);
  return text;
}
export function numeric(value: unknown, key: string, min = 0, max = 100000) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${key} must be a number between ${min} and ${max}.`);
  return value;
}
export function validateIngredients(value: unknown): Ingredient[] {
  if (!Array.isArray(value) || value.length > 100) throw new Error('ingredient_details must be an array of at most 100 ingredients.');
  return value.map((item, i) => {
    if (!item || typeof item !== 'object') throw new Error(`Ingredient ${i + 1} is invalid.`);
    const ingredient: Ingredient = { name: textValue(item.name, 'Ingredient name', true, 200), quantity: textValue(item.quantity, 'Ingredient quantity', true, 300) };
    if (item.basis != null) ingredient.basis = textValue(item.basis, 'Ingredient basis', false, 200);
    for (const key of ['calories', 'protein', 'carbs', 'fat'] as const) if (item[key] != null) ingredient[key] = numeric(item[key], `Ingredient ${key}`);
    return ingredient;
  });
}
export function validateExercises(value: unknown): Exercise[] {
  if (!Array.isArray(value) || value.length > 100) throw new Error('exercises must be an array of at most 100 exercises.');
  return value.map(item => {
    if (!item || typeof item !== 'object' || !Array.isArray(item.sets) || !item.sets.length || item.sets.length > 50) throw new Error('Each exercise needs between 1 and 50 sets.');
    return { name: textValue(item.name, 'Exercise name', true, 200), sets: item.sets.map((set: { reps: number; load_kg: number }) => {
      if (!set || typeof set !== 'object') throw new Error('Each set must be an object.');
      const reps = numeric(set.reps, 'Repetitions', 1, 1000); if (!Number.isInteger(reps)) throw new Error('Repetitions must be a whole number.');
      return { reps, load_kg: numeric(set.load_kg, 'Set load', 0, 1000) };
    }) };
  });
}
