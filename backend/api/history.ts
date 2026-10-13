import { env } from '../services/runtime';
import { trackerUser } from '../services/access';
import { parseArray, validDate, type Meal, type Workout, type Water, type Weight, type Ingredient, type Exercise } from '../services/tracker';
export const dynamic = 'force-dynamic';
const headers = {'Cache-Control':'no-store'};
export async function GET(request: Request) {
  const owner = await trackerUser(request);
  if (!owner) return Response.json({error:'Unlock your tracker again.'},{status:401,headers});
  try {
    const db=env.DB;
    if(!db||!owner) return Response.json({error:'Storage unavailable.'},{status:503,headers});
    const url=new URL(request.url), before=url.searchParams.get('before'), q=(url.searchParams.get('q')||'').trim().slice(0,120), type=url.searchParams.get('type')||'all';
    if(before&&!validDate(before)) return Response.json({error:'Invalid history date.'},{status:400,headers});
    const tables=[{type:'meals',table:'meals',condition:'is_test = 0',columns:['name','ingredients','note','meal_type']},{type:'water',table:'water_intakes',condition:'1=1',columns:['note','CAST(amount_ml AS TEXT)']},{type:'training',table:'workouts',condition:'1=1',columns:['session','details']},{type:'weight',table:'body_weights',condition:"record_type = 'weigh_in'",columns:['context','CAST(weight_kg AS TEXT)']}].filter(t=>type==='all'||type===t.type);
    if(!tables.length) return Response.json({error:'Invalid record type.'},{status:400,headers});
    const bindings: (string|number)[]=[];
    const union=tables.map(t=>{bindings.push(owner);let search='';if(q){const cols=['date',...t.columns];search=` AND (${cols.map(c=>`${c} LIKE ? ESCAPE '\\'`).join(' OR ')})`;bindings.push(...cols.map(()=>`%${q.replace(/[\\%_]/g,'\\$&')}%`));}return `SELECT date FROM ${t.table} WHERE user_id = ? AND ${t.condition} AND date IS NOT NULL${search}`;}).join(' UNION ');
    if(before)bindings.push(before);
    const days=await db.prepare(`SELECT date FROM (${union}) ${before?'WHERE date < ?':''} ORDER BY date DESC LIMIT 31`).bind(...bindings).all<{date:string}>();
    const dates=(days.results||[]).slice(0,30).map(d=>d.date);
    if(!dates.length)return Response.json({days:[],meals:[],water:[],workouts:[],weights:[],next:null},{headers});
    const placeholders=dates.map(()=>'?').join(',');
    const [meals,water,workouts,weights]=await Promise.all([
      db.prepare(`SELECT * FROM meals WHERE user_id=? AND is_test=0 AND date IN (${placeholders}) ORDER BY date DESC, created_at ASC`).bind(owner,...dates).all<Meal>(),
      db.prepare(`SELECT * FROM water_intakes WHERE user_id=? AND date IN (${placeholders}) ORDER BY date DESC, created_at ASC`).bind(owner,...dates).all<Water>(),
      db.prepare(`SELECT * FROM workouts WHERE user_id=? AND date IN (${placeholders}) ORDER BY date DESC, created_at ASC`).bind(owner,...dates).all<Workout>(),
      db.prepare(`SELECT * FROM body_weights WHERE user_id=? AND record_type='weigh_in' AND date IN (${placeholders}) ORDER BY date DESC, created_at DESC`).bind(owner,...dates).all<Weight>(),
    ]);
    return Response.json({days:dates,meals:(meals.results||[]).map(m=>({...m,ingredient_details:parseArray<Ingredient>(m.ingredient_details)})),water:water.results||[],workouts:(workouts.results||[]).map(w=>({...w,exercises:parseArray<Exercise>(w.exercises)})),weights:weights.results||[],next:(days.results||[]).length>30?dates.at(-1):null},{headers});
  }catch{return Response.json({error:'Could not load history. Try again.'},{status:500,headers});}
}
