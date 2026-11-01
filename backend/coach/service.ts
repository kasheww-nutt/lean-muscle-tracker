import type {TrackerDatabase} from '../services/database';
import {parseArray,localDate,validDate,scaleUsualMeal,type Ingredient,type Macros,type UsualMeal} from '../services/tracker';
import {RecordError,saveManualRecord} from '../services/records';
import {listUsualMeals} from '../services/saved-meals';
import {defaultProfile,profileInput,planMeals,type CoachProfile} from './planner';
const uuid=(id:string)=>{if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id))throw new RecordError('Invalid submission ID.');return id;};
export async function getProfile(db:TrackerDatabase,user:string):Promise<CoachProfile>{const row=await db.prepare('SELECT profile_json FROM coach_profiles WHERE user_id=?').bind(user).first<{profile_json:string}>();return row?profileInput(JSON.parse(row.profile_json)):defaultProfile();}
export async function saveProfile(db:TrackerDatabase,user:string,value:unknown){const profile={...profileInput(value),lastMealReportedAt:Date.now()};await db.prepare('INSERT INTO coach_profiles(user_id,profile_json) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET profile_json=excluded.profile_json').bind(user,JSON.stringify(profile)).run();return profile;}
export async function getContext(db:TrackerDatabase,user:string,date:string){
 if(!validDate(date))throw new RecordError('Choose a valid date.');
 const [meals,workout,profile,saved]=await Promise.all([
  db.prepare('SELECT name,meal_type,calories,protein,carbs,fat FROM meals WHERE user_id=? AND date=? AND is_test=0 ORDER BY created_at DESC,rowid DESC LIMIT 100').bind(user,date).all<{name:string;meal_type:string}&Macros>(),
  db.prepare('SELECT id,date,session,volume_kg FROM workouts WHERE user_id=? AND date=? ORDER BY created_at DESC,rowid DESC LIMIT 1').bind(user,date).first<{id:string;date:string;session:string;volume_kg:number}>(),getProfile(db,user),listUsualMeals(db,user)
 ]);
 // Aggregate separately: the assistant's bounded meal list must not truncate daily totals.
 const totals=await db.prepare('SELECT COALESCE(SUM(calories),0) AS calories,COALESCE(SUM(protein),0) AS protein,COALESCE(SUM(carbs),0) AS carbs,COALESCE(SUM(fat),0) AS fat,COUNT(*) AS count FROM meals WHERE user_id=? AND date=? AND is_test=0').bind(user,date).first<Macros&{count:number}>();
 const input={date,totals:{calories:totals!.calories,protein:totals!.protein,carbs:totals!.carbs,fat:totals!.fat},mealCount:totals!.count,profile,saved:saved.slice(0,20),workout};
 return {...input,meals:meals.results,planning:planMeals(input),today:localDate()};
}
export async function listPlans(db:TrackerDatabase,user:string,date:string){
 const rows=await db.prepare('SELECT id,date,planned_time,meal_json,status FROM meal_plans WHERE user_id=? AND date=? ORDER BY created_at_ms DESC,id DESC LIMIT 50').bind(user,date).all<{id:string;date:string;planned_time:string;meal_json:string;status:string}>();
 return rows.results.map(({meal_json,...p})=>({...p,meal:JSON.parse(meal_json) as UsualMeal}));
}
export async function savePlan(db:TrackerDatabase,user:string,id:string,date:string,optionId:string,time:string,servings:number){
 uuid(id);if(time&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw new RecordError('Choose a valid meal time.');
 const existing=await db.prepare('SELECT date,planned_time,meal_json FROM meal_plans WHERE user_id=? AND id=?').bind(user,id).first<{date:string;planned_time:string;meal_json:string}>();
 if(existing){const old=JSON.parse(existing.meal_json);if(existing.date!==date||existing.planned_time!==time||old.optionId!==optionId||old.servings!==servings)throw new RecordError('Submission ID already used.',409);return {planned:true,id};}
 const context=await getContext(db,user,date),option=context.planning.options.find(v=>v.id===optionId);
 if(!option)throw new RecordError('Refresh suggestions before saving this meal.');
 const adjusted=scaleUsualMeal(option.base,servings);
 const meal={...adjusted,name:option.name,meal_type:option.meal_type,ingredient_details:adjusted.ingredient_details,calories:adjusted.calories,protein:adjusted.protein,carbs:adjusted.carbs,fat:adjusted.fat,ingredients:adjusted.ingredients,note:option.note,optionId,servings,source:option.source};
 const result=await db.prepare('INSERT INTO meal_plans(id,user_id,date,planned_time,meal_json,created_at_ms) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(id,user,date,time,JSON.stringify(meal),Date.now()).run();
 if(!result.meta.changes){const row=await db.prepare('SELECT id FROM meal_plans WHERE user_id=? AND id=? AND meal_json=? AND date=? AND planned_time=?').bind(user,id,JSON.stringify(meal),date,time).first();if(!row)throw new RecordError('Submission ID already used.',409);}
 return {planned:true,id};
}
export async function changePlan(db:TrackerDatabase,user:string,id:string,action:'eat'|'skip'){
 uuid(id);if(!db.transaction)throw new RecordError('Transactional storage is unavailable.',503);
 return db.transaction(async tx=>{
  const plan=await tx.prepare('UPDATE meal_plans SET status=status WHERE user_id=? AND id=? RETURNING meal_json,date,status').bind(user,id).first<{meal_json:string;date:string;status:string}>();
  if(!plan)throw new RecordError('Plan not found in your account.',404);
  if(plan.status==='skipped'&&action==='eat')throw new RecordError('This plan was skipped. Create a new plan to log it.',409);
  if(plan.status==='eaten'&&action==='skip')throw new RecordError('This meal is already logged. Edit or delete it in Log entry.',409);
  if(action==='eat'){
   if(plan.date!==localDate())throw new RecordError('Only a plan for today can be marked eaten. Use Log entry to record another date.');
   if(plan.status!=='eaten'){
    const value=JSON.parse(plan.meal_json) as UsualMeal;
    const meal={date:plan.date,name:value.name,meal_type:value.meal_type,ingredients:value.ingredients,ingredient_details:parseArray<Ingredient>(value.ingredient_details),calories:value.calories,protein:value.protein,carbs:value.carbs,fat:value.fat,note:value.note,is_test:false};
    await saveManualRecord(tx,user,'meal',meal,id);
   }
  }
  await tx.prepare('UPDATE meal_plans SET status=? WHERE user_id=? AND id=?').bind(action==='eat'?'eaten':'skipped',user,id).run();
  return {id,status:action==='eat'?'eaten':'skipped',date:plan.date};
 });
}
