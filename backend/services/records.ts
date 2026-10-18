import type {TrackerDatabase} from './database';
import {numeric,textValue,validDate,localDate,validateIngredients,validateExercises} from './tracker';

export type RecordKind = 'meal' | 'water' | 'weight' | 'workout';
const tables = {meal:'meals',water:'water_intakes',weight:'body_weights',workout:'workouts'};
const fields:Record<RecordKind,string[]> = {
 meal:['date','name','ingredients','ingredient_details','meal_type','calories','protein','carbs','fat','is_test','note'],
 water:['date','amount_ml','note'],weight:['date','weight_kg','record_type','context'],
 workout:['date','session','volume_kg','details','exercises']
};
export class RecordError extends Error {
 status:number;
 constructor(message:string,status=400){super(message);this.status=status;}
}
export function recordKind(value:unknown):RecordKind {
 if(typeof value!=='string'||!Object.hasOwn(tables,value))throw new RecordError('Choose meal, water, weight or workout.');
 return value as RecordKind;
}
function values(kind:RecordKind,input:Record<string,unknown>,partial=false) {
 const result:Record<string,string|number|null>={};
 for(const key of Object.keys(input))if(!fields[kind].includes(key))throw new RecordError('Unsupported record field: '+key);
 for(const key of fields[kind]){
  if(partial&&input[key]===undefined)continue;
  const value=input[key];
  if(key==='date'){
   const reference=kind==='weight'&&input.record_type==='reference';
   if(reference&&(value===null||value===undefined||value===''))result.date=null;
   else {const date=value===undefined&&!partial?localDate():textValue(value,'Date',true,10);if(!validDate(date))throw new RecordError('Choose a valid date.');result.date=date;}
  }else if(['calories','protein','carbs','fat','volume_kg','amount_ml','weight_kg'].includes(key)){
   if(key==='volume_kg'&&value===undefined){
    const exercises=validateExercises(input.exercises??[]);
    if(!exercises.length)throw new RecordError('Enter workout volume or completed exercise sets.');
    result[key]=numeric(exercises.reduce((sum,e)=>sum+e.sets.reduce((v,s)=>v+s.reps*s.load_kg,0),0),'Workout volume');
   }else result[key]=numeric(value,key,key==='weight_kg'?20:key==='amount_ml'?0.01:0,key==='weight_kg'?300:key==='amount_ml'?20000:100000);
  }else if(key==='ingredient_details')result[key]=JSON.stringify(validateIngredients(value??[]));
  else if(key==='exercises')result[key]=JSON.stringify(validateExercises(value??[]));
  else if(key==='is_test') {if(value!==undefined&&typeof value!=='boolean')throw new RecordError('Test entry must be true or false.');result[key]=value?1:0;}
  else if(key==='meal_type'){const type=textValue(value,'Meal type',false,30)||'Other';if(!['Breakfast','Lunch','Dinner','Snack','Other'].includes(type))throw new RecordError('Choose a valid meal type.');result[key]=type;}
  else if(key==='record_type'){const type=value??'weigh_in';if(type!=='weigh_in'&&type!=='reference')throw new RecordError('Choose weigh-in or reference weight.');result[key]=type;}
  else result[key]=textValue(value,key,['name','session'].includes(key),['name','session'].includes(key)?200:10000);
 }
 if(!Object.keys(result).length)throw new RecordError('Supply at least one detail to change.');
 return result;
}
export async function saveManualRecord(db:TrackerDatabase,userId:string,kind:RecordKind,input:Record<string,unknown>,id:string,source:'manual'|'chatgpt'='manual'){
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id))throw new RecordError('Invalid submission identifier.');
 const record=values(kind,input);if(kind==='meal')record.source=source;
 const columns=Object.keys(record),bound=Object.values(record);
 await db.prepare(`INSERT INTO ${tables[kind]} (id,user_id,${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')},?,?) ON CONFLICT(id) DO NOTHING`).bind(id,userId,...bound).run();
 // Stable submission IDs allow a retry without silently adding a duplicate.
 const saved=await db.prepare(`SELECT ${columns.join(',')} FROM ${tables[kind]} WHERE id=? AND user_id=?`).bind(id,userId).first<Record<string,unknown>>();
 if(!saved||columns.some(key=>saved[key]!==record[key]))throw new RecordError('This submission ID was already used. Start a new entry.',409);
 return {saved:true,id,date:record.date};
}
export async function updateManualRecord(db:TrackerDatabase,userId:string,kind:RecordKind,input:Record<string,unknown>,id:string){
 const existing=await db.prepare(`SELECT record_type FROM body_weights WHERE id=? AND user_id=?`).bind(kind==='weight'?id:'',userId).first<{record_type:string}>();
 const found=kind==='weight'?existing:await db.prepare(`SELECT id FROM ${tables[kind]} WHERE id=? AND user_id=?`).bind(id,userId).first();
 if(!found)throw new RecordError('Entry not found in your account.',404);
 const normalized=kind==='weight'?{...input,record_type:input.record_type??existing!.record_type}:input;
 const record=values(kind,normalized,true);
 if(kind==='weight'&&record.record_type==='weigh_in'&&input.date===undefined&&existing?.record_type==='reference')throw new RecordError('Enter a date for this weigh-in.');
 if(kind==='weight'&&record.record_type==='reference'&&input.date===undefined)record.date=null;
 if(kind==='workout'&&input.exercises!==undefined&&input.volume_kg===undefined){
  const exercises=validateExercises(input.exercises);if(!exercises.length)throw new RecordError('Enter workout volume or completed exercise sets.');
  record.volume_kg=numeric(exercises.reduce((sum,e)=>sum+e.sets.reduce((v,s)=>v+s.reps*s.load_kg,0),0),'Workout volume');
 }
 const changed=await db.prepare(`UPDATE ${tables[kind]} SET ${Object.keys(record).map(key=>key+'=?').join(',')} WHERE id=? AND user_id=?`).bind(...Object.values(record),id,userId).run();
 if(!changed.meta.changes)throw new RecordError('Entry not found in your account.',404);
 return {updated:true,id};
}
export async function removeManualRecord(db:TrackerDatabase,userId:string,kind:RecordKind,id:string){
 const result=await db.prepare(`DELETE FROM ${tables[kind]} WHERE id=? AND user_id=?`).bind(id,userId).run();
 if(!result.meta.changes)throw new RecordError('Entry not found in your account.',404);
 return {removed:true,id};
}
