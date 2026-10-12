import { env } from "../services/runtime";
import { authenticateMcp } from "../services/mcp-auth";
import { numeric, textValue, validateIngredients, validateExercises, parseArray, validDate as calendarDate, type Ingredient, type Exercise } from '../services/tracker';

export const dynamic = "force-dynamic";

type ToolArgs = Record<string, unknown>;
const ingredientSchema = { type: 'array', maxItems: 100, items: { type: 'object', properties: { name: { type: 'string' }, quantity: { type: 'string', description: 'Measured quantity or honest range, with units.' }, basis: { type: 'string', description: 'Raw/cooked, recipe portion, or estimation uncertainty.' }, calories: { type: 'number' }, protein: { type: 'number' }, carbs: { type: 'number' }, fat: { type: 'number' } }, required: ['name', 'quantity'], additionalProperties: false } };
const exerciseSchema = { type: 'array', maxItems: 100, items: { type: 'object', properties: { name: { type: 'string' }, sets: { type: 'array', items: { type: 'object', properties: { reps: { type: 'integer' }, load_kg: { type: 'number', description: 'External lifted load in kg; do not invent bodyweight load.' } }, required: ['reps', 'load_kg'], additionalProperties: false } } }, required: ['name', 'sets'], additionalProperties: false } };
const toolList = [
  {
    name: 'tracker_log_water',
    description: 'Add water actually consumed on a local date, in millilitres (1 litre = 1000 ml). This ADDS to the day’s total. If the user reports a cumulative daily total, first read tracker_get_day and log only the unrecorded difference; correct existing entries with tracker_update_water. Do not guess glass or bottle sizes. No fictional water entries.',
    inputSchema: { type: 'object', properties: { date: { type: 'string', description: 'YYYY-MM-DD in Asia/Kolkata; omit for today.' }, amount_ml: { type: 'number', exclusiveMinimum: 0, maximum: 20000 }, note: { type: 'string' } }, required: ['amount_ml'], additionalProperties: false },
  },
  {
    name: 'tracker_update_water',
    description: 'Correct a saved water entry using its exact ID from tracker_get_day. Only supplied fields change. Use this to avoid double counting a correction.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, date: { type: 'string' }, amount_ml: { type: 'number', exclusiveMinimum: 0, maximum: 20000 }, note: { type: 'string' } }, required: ['id'], additionalProperties: false },
  },
  {
    name: 'tracker_remove_water',
    description: 'Remove a water entry only when the user requests removal. Use its exact ID from tracker_get_day.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
  },
  {
    name: "tracker_log_meal",
    description: "Save a meal the user actually ate: local meal date, name/type, every ingredient and quantity including raw/cooked, meal calories/protein/carbs/fat, and uncertainty notes. Include ingredient_details with per-ingredient macros when supported; omit unknown macros rather than inventing them. Test entries require an explicitly fictional request and are excluded from real totals. Correct existing meals with tracker_update_meal.",
    inputSchema: { type: "object", properties: {
      date: { type: "string", description: "Meal date in YYYY-MM-DD, Asia/Kolkata local date. Omit to use today's local date." },
      name: { type: "string" }, ingredients: { type: "string", description: "Ingredients and quantities, including raw/cooked where known." },
      ingredient_details: ingredientSchema, meal_type: { type: 'string', enum: ['Breakfast', 'Lunch', 'Dinner', 'Snack', 'Other'] },
      calories: { type: "number" }, protein: { type: "number" }, carbs: { type: "number" }, fat: { type: "number" },
      is_test: { type: "boolean", description: "True only for a fictional example explicitly requested by the user." }, note: { type: "string" },
    }, required: ["name", "calories", "protein", "carbs", "fat"], additionalProperties: false },
  },
  {
    name: 'tracker_update_meal',
    description: 'Correct an existing meal using its exact ID from tracker_get_day. Only supplied fields change; preserve the date, original entry, and all other details. Use ingredient_details for structured quantities and optional ingredient macros. This does not add another meal.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, date: { type: 'string' }, name: { type: 'string' }, ingredients: { type: 'string' }, ingredient_details: ingredientSchema, meal_type: { type: 'string', enum: ['Breakfast', 'Lunch', 'Dinner', 'Snack', 'Other'] }, calories: { type: 'number' }, protein: { type: 'number' }, carbs: { type: 'number' }, fat: { type: 'number' }, note: { type: 'string' }, is_test: { type: 'boolean' } }, required: ['id'], additionalProperties: false },
  },
  {
    name: "tracker_log_weight",
    description: "Save a body-weight measurement. Use reference=true for an undated starting/reference weight; never invent its date.",
    inputSchema: { type: "object", properties: {
      date: { type: "string", description: "YYYY-MM-DD local date; omit for today's Asia/Kolkata date. Leave omitted with reference=true if the reference date is unknown." },
      weight_kg: { type: "number" }, reference: { type: "boolean" }, context: { type: "string" },
    }, required: ["weight_kg"], additionalProperties: false },
  },
  {
    name: "tracker_log_workout",
    description: "Save a completed workout: actual date, consistent session type, reported total volume and optional exercise names with each set's reps and external load in kg. If volume is omitted, calculate sets × reps × load from supplied exercises. Do not invent unsupplied sets or bodyweight load. Preserve differences in exercise selection in details so comparisons stay interpretable.",
    inputSchema: { type: "object", properties: {
      date: { type: "string", description: "YYYY-MM-DD local date; omit to use today's Asia/Kolkata date." },
      session: { type: "string" }, volume_kg: { type: "number" }, details: { type: "string" },
      exercises: exerciseSchema,
    }, required: ["session"], additionalProperties: false },
  },
  {
    name: 'tracker_get_history',
    description: 'Read recent logged nutrition days, water totals, dated weigh-ins, the undated reference weight, and completed workouts. Missing food and water days are unknown. Returns up to 90 records per category.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: "tracker_get_day",
    description: "Read a day's meals, confirmed nutrition totals, water entries with IDs and total ml, and the latest weight and workout records. Test meals are excluded from totals.",
    inputSchema: { type: "object", properties: { date: { type: "string", description: "YYYY-MM-DD local date; omit for today in Asia/Kolkata." } }, additionalProperties: false },
  },
  {
    name: "tracker_remove_meal",
    description: "Remove a meal entry after the user asks to correct or remove it. Use the exact meal ID from tracker_get_day.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
  },
];

function todayInKolkata() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}
function validDate(value: string) { return calendarDate(value); }
function finiteNumber(args: ToolArgs, key: string, min = 0) {
  return numeric(args[key], key, min);
}
function textArg(args: ToolArgs, key: string, required = false) {
  return textValue(args[key], key, required);
}
function dateArg(args: ToolArgs, reference = false) {
  if (args.date !== undefined && !textArg(args, 'date')) throw new Error('Provide a valid date or omit it.');
  const value = textArg(args, "date") || (reference ? "" : todayInKolkata());
  if (value && !validDate(value)) throw new Error("date must use YYYY-MM-DD.");
  return value;
}
function rpcError(id: unknown, code: number, message: string) { return Response.json({ jsonrpc: '2.0', id, error: { code, message } }); }
function jsonRpc(id: unknown, result: unknown) { return Response.json({ jsonrpc: "2.0", id, result }); }
function toolResult(value: unknown) { return { content: [{ type: "text", text: JSON.stringify(value) }] }; }

export async function POST(request: Request) {
  const user = await authenticateMcp(request);
  if (!user) return Response.json({ error: 'MCP authentication required.' }, {status:401,headers:{'Cache-Control':'no-store','WWW-Authenticate':`Bearer resource_metadata="${process.env.PUBLIC_BASE_URL || new URL(request.url).origin}/.well-known/oauth-protected-resource"`}});
  const requestOrigin = request.headers.get('origin');
  if (requestOrigin && requestOrigin !== (process.env.PUBLIC_BASE_URL || new URL(request.url).origin)) return new Response(null,{status:403});
  let rpcId: unknown = null;
  try {
    const requestBody = await request.json() as { jsonrpc?: string; id?: unknown; method?: string; params?: { protocolVersion?: string; name?: string; arguments?: ToolArgs } };
    if (!requestBody || requestBody.jsonrpc !== '2.0' || typeof requestBody.method !== 'string') return rpcError(null,-32600,'Invalid Request');
    rpcId = requestBody.id ?? null;
    if (requestBody.id !== undefined && typeof requestBody.id !== 'string' && typeof requestBody.id !== 'number') return rpcError(null,-32600,'Invalid request ID');
    if (requestBody.id === undefined) return new Response(null,{status:202});
    if (requestBody.method === 'initialize') {
      const versions = ['2025-03-26','2025-06-18','2025-11-25'];
      const version = requestBody.params?.protocolVersion;
      return jsonRpc(rpcId,{protocolVersion:versions.includes(String(version))?version:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'lean-muscle-tracker',version:'2.0.0'}});
    }
    if (requestBody.method === 'ping') return jsonRpc(rpcId,{});
    if (requestBody.method === "server/discover") return jsonRpc(rpcId, { supportedVersions: ["2025-11-25"], capabilities: { tools: {} } });
    if (requestBody.method === "tools/list") return jsonRpc(rpcId, { tools: toolList });
    if (requestBody.method !== "tools/call") return rpcError(rpcId, -32601, "Method not found");

    if (!env.DB) throw new Error("Tracker database is unavailable.");
    const args = requestBody.params?.arguments ?? {};
    if (!args || typeof args !== 'object' || Array.isArray(args)) return rpcError(rpcId,-32602,'Invalid arguments');
    const name = requestBody.params?.name;
    const userId = user.userId;
    if (!env.TRACKER_OWNER_ID || env.TRACKER_OWNER_ID !== userId) throw new Error('Only the tracker owner can access these records.');

    if (name === 'tracker_log_water') {
      const date = dateArg(args), amount = numeric(args.amount_ml, 'amount_ml', 0.01, 20000), id = crypto.randomUUID();
      await env.DB.prepare('INSERT INTO water_intakes (id,user_id,date,amount_ml,note) VALUES (?,?,?,?,?)').bind(id, userId, date, amount, textArg(args, 'note')).run();
      const total = await env.DB.prepare('SELECT SUM(amount_ml) AS amount_ml FROM water_intakes WHERE user_id = ? AND date = ?').bind(userId, date).first<{amount_ml:number}>();
      return jsonRpc(rpcId, toolResult({saved:true,id,date,amount_ml:amount,dailyTotalMl:total?.amount_ml ?? amount}));
    }
    if (name === 'tracker_update_water') {
      const id = textArg(args, 'id', true);
      const existing = await env.DB.prepare('SELECT id FROM water_intakes WHERE id = ? AND user_id = ?').bind(id,userId).first();
      if (!existing) throw new Error('Water entry not found. Read the day and use its exact ID.');
      const fields: string[] = [], values: (string|number)[] = [];
      if (args.amount_ml !== undefined) { fields.push('amount_ml = ?'); values.push(numeric(args.amount_ml, 'amount_ml', 0.01, 20000)); }
      if (args.date !== undefined) { fields.push('date = ?'); values.push(dateArg(args)); }
      if (args.note !== undefined) { fields.push('note = ?'); values.push(textArg(args,'note')); }
      if (!fields.length) throw new Error('Supply a water detail to correct.');
      await env.DB.prepare(`UPDATE water_intakes SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`).bind(...values,id,userId).run();
      return jsonRpc(rpcId,toolResult({updated:true,id}));
    }
    if (name === 'tracker_remove_water') {
      const id = textArg(args,'id',true);
      const result = await env.DB.prepare('DELETE FROM water_intakes WHERE id = ? AND user_id = ?').bind(id,userId).run();
      return jsonRpc(rpcId,toolResult({removed:(result.meta.changes ?? 0)>0,id}));
    }

    if (name === "tracker_log_meal") {
      if (args.is_test !== undefined && typeof args.is_test !== 'boolean') throw new Error('is_test must be true or false.');
      const date = dateArg(args);
      const meal = {
        id: crypto.randomUUID(), userId, date, name: textArg(args, "name", true),
        ingredients: textArg(args, "ingredients"), calories: finiteNumber(args, "calories"),
        protein: finiteNumber(args, "protein"), carbs: finiteNumber(args, "carbs"), fat: finiteNumber(args, "fat"),
        isTest: args.is_test === true ? 1 : 0, note: textArg(args, "note"), source: "chatgpt",
      };
      const ingredients = args.ingredient_details === undefined ? [] : validateIngredients(args.ingredient_details);
      const mealType = textArg(args, 'meal_type');
      if (mealType && !['Breakfast','Lunch','Dinner','Snack','Other'].includes(mealType)) throw new Error('Choose a valid meal type.');
      await env.DB.prepare("INSERT INTO meals (id,user_id,date,name,ingredients,calories,protein,carbs,fat,is_test,note,source,ingredient_details,meal_type) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind(meal.id, meal.userId, meal.date, meal.name, meal.ingredients, meal.calories, meal.protein, meal.carbs, meal.fat, meal.isTest, meal.note, meal.source, JSON.stringify(ingredients), mealType).run();
      const total = await env.DB.prepare("SELECT COALESCE(SUM(calories),0) AS calories, COALESCE(SUM(protein),0) AS protein FROM meals WHERE user_id=? AND date=? AND is_test=0")
        .bind(userId, date).first<{ calories: number; protein: number }>();
      return jsonRpc(rpcId, toolResult({ saved: true, id: meal.id, date, meal: meal.name, testEntry: meal.isTest === 1, dailyConfirmedTotals: total }));
    }

    if (name === 'tracker_update_meal') {
      const id = textArg(args, 'id', true);
      const existing = await env.DB.prepare('SELECT id FROM meals WHERE id = ? AND user_id = ?').bind(id, userId).first();
      if (!existing) throw new Error('Meal not found. Read the day and use its exact meal ID.');
      const values: (string | number)[] = [], fields: string[] = [];
      for (const key of ['name', 'ingredients', 'note', 'meal_type']) if (args[key] !== undefined) {
        const v = textArg(args, key, key === 'name');
        if (key === 'meal_type' && v && !['Breakfast','Lunch','Dinner','Snack','Other'].includes(v)) throw new Error('Choose a valid meal type.');
        fields.push(`${key} = ?`); values.push(v);
      }
      for (const key of ['calories','protein','carbs','fat']) if (args[key] !== undefined) { fields.push(`${key} = ?`); values.push(finiteNumber(args,key)); }
      if (args.date !== undefined) { fields.push('date = ?'); values.push(dateArg(args)); }
      if (args.ingredient_details !== undefined) { fields.push('ingredient_details = ?'); values.push(JSON.stringify(validateIngredients(args.ingredient_details))); }
      if (args.is_test !== undefined) { if (typeof args.is_test !== 'boolean') throw new Error('is_test must be true or false.'); fields.push('is_test = ?'); values.push(args.is_test ? 1 : 0); }
      if (!fields.length) throw new Error('Supply at least one meal detail to change.');
      await env.DB.prepare(`UPDATE meals SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`).bind(...values, id, userId).run();
      return jsonRpc(rpcId, toolResult({ updated: true, id, changed: fields.map(f=>f.split(' ')[0]) }));
    }

    if (name === "tracker_log_weight") {
      if (args.reference !== undefined && typeof args.reference !== 'boolean') throw new Error('reference must be true or false.');
      const reference = args.reference === true;
      const date = dateArg(args, reference);
      const id = crypto.randomUUID();
      const weightKg = finiteNumber(args, "weight_kg", 20);
      if (weightKg > 300) throw new Error("weight_kg must be 300 or less.");
      await env.DB.prepare("INSERT INTO body_weights (id,user_id,date,weight_kg,record_type,context) VALUES (?,?,?,?,?,?)")
        .bind(id, userId, date || null, weightKg, reference ? "reference" : "weigh_in", textArg(args, "context")).run();
      return jsonRpc(rpcId, toolResult({ saved: true, id, date: date || null, reference, weight_kg: weightKg }));
    }

    if (name === "tracker_log_workout") {
      const date = dateArg(args);
      const session = textArg(args, "session", true);
      const exercises = args.exercises === undefined ? [] : validateExercises(args.exercises);
      if (args.volume_kg === undefined && !exercises.length) throw new Error('Provide the reported volume_kg or the completed exercise sets.');
      const volumeKg = args.volume_kg === undefined ? exercises.reduce((s,e)=>s+e.sets.reduce((v,set)=>v+set.reps*set.load_kg,0),0) : finiteNumber(args, "volume_kg");
      const id = crypto.randomUUID();
      await env.DB.prepare("INSERT INTO workouts (id,user_id,date,session,volume_kg,details,exercises) VALUES (?,?,?,?,?,?,?)")
        .bind(id, userId, date, session, volumeKg, textArg(args, "details"), JSON.stringify(exercises)).run();
      const previous = await env.DB.prepare("SELECT date, volume_kg FROM workouts WHERE user_id=? AND lower(trim(session))=lower(trim(?)) AND date<? ORDER BY date DESC, created_at DESC LIMIT 1")
        .bind(userId, session, date).first<{ date: string; volume_kg: number }>();
      return jsonRpc(rpcId, toolResult({ saved: true, id, date, session, volume_kg: volumeKg, previousComparable: previous ?? null }));
    }

    if (name === "tracker_get_day") {
      const date = dateArg(args);
      const [dayMeals, totals, latestWeight, latestWorkout, water] = await Promise.all([
        env.DB.prepare("SELECT id,date,name,meal_type,ingredients,ingredient_details,calories,protein,carbs,fat,is_test,note FROM meals WHERE user_id=? AND date=? ORDER BY created_at DESC,rowid DESC").bind(userId, date).all(),
        env.DB.prepare("SELECT COALESCE(SUM(calories),0) AS calories, COALESCE(SUM(protein),0) AS protein, COALESCE(SUM(carbs),0) AS carbs, COALESCE(SUM(fat),0) AS fat FROM meals WHERE user_id=? AND date=? AND is_test=0").bind(userId, date).first(),
        env.DB.prepare("SELECT date,weight_kg,context FROM body_weights WHERE user_id=? AND record_type='weigh_in' ORDER BY date DESC,created_at DESC LIMIT 1").bind(userId).first(),
        env.DB.prepare("SELECT date,session,volume_kg FROM workouts WHERE user_id=? ORDER BY date DESC,created_at DESC LIMIT 1").bind(userId).first(),
        env.DB.prepare('SELECT id,date,amount_ml,note,created_at FROM water_intakes WHERE user_id=? AND date=? ORDER BY created_at ASC,rowid ASC').bind(userId,date).all<{id:string;date:string;amount_ml:number;note:string;created_at:string}>(),
      ]);
      return jsonRpc(rpcId, toolResult({ date, meals: (dayMeals.results ?? []).map(m=>({...m, ingredient_details:parseArray<Ingredient>(m.ingredient_details)})), confirmedTotals: totals, latestWeight: latestWeight ?? null, latestWorkout: latestWorkout ?? null, water:water.results ?? [], waterTotalMl:(water.results ?? []).reduce((s,w)=>s+Number(w.amount_ml),0) }));
    }

    if (name === 'tracker_get_history') {
      const [nutrition,weights,reference,workouts,water] = await Promise.all([
        env.DB.prepare('SELECT date,COUNT(*) AS meal_count,SUM(calories) AS calories,SUM(protein) AS protein,SUM(carbs) AS carbs,SUM(fat) AS fat FROM meals WHERE user_id=? AND is_test=0 GROUP BY date ORDER BY date DESC LIMIT 90').bind(userId).all(),
        env.DB.prepare("SELECT id,date,weight_kg,context FROM body_weights WHERE user_id=? AND record_type='weigh_in' ORDER BY date DESC,created_at DESC LIMIT 90").bind(userId).all(),
        env.DB.prepare("SELECT weight_kg,context FROM body_weights WHERE user_id=? AND record_type='reference' ORDER BY created_at DESC,rowid DESC LIMIT 1").bind(userId).first(),
        env.DB.prepare('SELECT id,date,session,volume_kg,details,exercises FROM workouts WHERE user_id=? ORDER BY date DESC,created_at DESC LIMIT 90').bind(userId).all(),
        env.DB.prepare('SELECT date,SUM(amount_ml) AS amount_ml,COUNT(*) AS entry_count FROM water_intakes WHERE user_id=? GROUP BY date ORDER BY date DESC LIMIT 90').bind(userId).all(),
      ]);
      return jsonRpc(rpcId,toolResult({nutrition:nutrition.results??[],weights:weights.results??[],referenceWeight:reference,workouts:(workouts.results??[]).map(w=>({...w,exercises:parseArray<Exercise>(w.exercises)})),water:water.results??[]}));
    }

    if (name === "tracker_remove_meal") {
      const id = textArg(args, "id", true);
      const result = await env.DB.prepare("DELETE FROM meals WHERE id=? AND user_id=?").bind(id, userId).run();
      return jsonRpc(rpcId, toolResult({ removed: (result.meta.changes ?? 0) > 0, id }));
    }

    return rpcError(rpcId, -32602, "Unknown tracker tool.");
  } catch (error) {
    const raw = error instanceof Error ? error.message : '';
    const message = /SQLITE|database|no such|constraint|syntax|disk/i.test(raw) ? 'Tracker storage request failed. Please retry.' : raw || 'Tracker request failed.';
    return jsonRpc(rpcId, { isError: true, content: [{ type: "text", text: message }] });
  }
}
