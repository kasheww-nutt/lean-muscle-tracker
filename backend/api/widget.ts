import { env } from '../services/runtime';
import { hasTrackerAccess, sameOrigin } from '../services/access';
import { localDate, loggingStreak, type LoggingDay } from '../services/tracker';
import { newWidgetToken, widgetTokenHash, widgetTexts } from '../services/widget';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer'};
export async function POST(request:Request){
 if(!sameOrigin(request)||!await hasTrackerAccess(request))return Response.json({error:'Unlock the tracker first.'},{status:401,headers});
 try{const token=newWidgetToken(),expires=Date.now()+90*86400000;await env.DB!.prepare('INSERT INTO widget_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET token_hash=excluded.token_hash, expires_at=excluded.expires_at').bind(env.TRACKER_OWNER_ID,await widgetTokenHash(token),expires).run();return Response.json({token,expiresAt:new Date(expires).toISOString()},{headers});}catch{return Response.json({error:'Could not create a widget link.'},{status:500,headers});}
}
export async function DELETE(request:Request){
 if(!sameOrigin(request)||!await hasTrackerAccess(request))return Response.json({error:'Unlock the tracker first.'},{status:401,headers});
 try{await env.DB!.prepare('DELETE FROM widget_tokens WHERE user_id=?').bind(env.TRACKER_OWNER_ID).run();return Response.json({revoked:true},{headers});}catch{return Response.json({error:'Could not revoke widget access.'},{status:500,headers});}
}
export async function GET(request:Request){
 try{const url=new URL(request.url),key=url.searchParams.get('key');
 if(!key){if(!await hasTrackerAccess(request))return Response.json({error:'Widget authorization required.'},{status:401,headers});const row=await env.DB!.prepare('SELECT expires_at FROM widget_tokens WHERE user_id=?').bind(env.TRACKER_OWNER_ID).first<{expires_at:number}>();return Response.json({enabled:!!row&&row.expires_at>Date.now(),expiresAt:row?new Date(row.expires_at).toISOString():null},{headers});}
 if(!/^[a-f0-9]{64}$/.test(key))return Response.json({error:'Invalid widget link.'},{status:401,headers});
 const owner=env.TRACKER_OWNER_ID;const allowed=await env.DB!.prepare('SELECT expires_at FROM widget_tokens WHERE user_id=? AND token_hash=?').bind(owner,await widgetTokenHash(key)).first<{expires_at:number}>();
 if(!allowed||allowed.expires_at<=Date.now())return Response.json({error:'Widget link expired or revoked.'},{status:401,headers});
 const today=localDate();const latest=await env.DB!.prepare('SELECT MAX(date) AS date FROM meals WHERE user_id=? AND is_test=0 AND date<=?').bind(owner,today).first<{date:string|null}>();const date=url.searchParams.get('day')==='latest'?(latest?.date||today):today;
 const [food,water,weight,workout,activities]=await Promise.all([
 env.DB!.prepare('SELECT COUNT(*) AS count, SUM(calories) AS calories, SUM(protein) AS protein FROM meals WHERE user_id=? AND date=? AND is_test=0').bind(owner,date).first<{count:number;calories:number|null;protein:number|null}>(),
 env.DB!.prepare('SELECT COUNT(*) AS count, SUM(amount_ml) AS amount FROM water_intakes WHERE user_id=? AND date=?').bind(owner,date).first<{count:number;amount:number|null}>(),
 env.DB!.prepare("SELECT date,weight_kg FROM body_weights WHERE user_id=? AND record_type='weigh_in' AND date<=? ORDER BY date DESC,created_at DESC LIMIT 1").bind(owner,today).first<{date:string;weight_kg:number}>(),
 env.DB!.prepare('SELECT date,session,volume_kg FROM workouts WHERE user_id=? AND date<=? ORDER BY date DESC,created_at DESC LIMIT 1').bind(owner,today).first<{date:string;session:string;volume_kg:number}>(),
 env.DB!.prepare(`SELECT date,SUM(meal_count) AS meal_count,SUM(water_count) AS water_count,SUM(workout_count) AS workout_count,SUM(weight_count) AS weight_count FROM (
 SELECT date,1 AS meal_count,0 AS water_count,0 AS workout_count,0 AS weight_count FROM meals WHERE user_id=? AND is_test=0
 UNION ALL SELECT date,0,1,0,0 FROM water_intakes WHERE user_id=?
 UNION ALL SELECT date,0,0,1,0 FROM workouts WHERE user_id=?
 UNION ALL SELECT date,0,0,0,1 FROM body_weights WHERE user_id=? AND record_type='weigh_in'
 ) WHERE date IS NOT NULL GROUP BY date`).bind(owner,owner,owner,owner).all<LoggingDay>()]);
 const value={date,calories:food?.count?food.calories:null,protein:food?.count?food.protein:null,waterMl:water?.count?water.amount:null,streak:loggingStreak(activities.results||[],today).current,weight:weight?.weight_kg??null,weightDate:weight?.date??null,volume:workout?.volume_kg??null,session:workout?.session??null,workoutDate:workout?.date??null};
 return Response.json({...value,...widgetTexts(value),updatedAt:new Date().toISOString()},{headers});
 }catch{return Response.json({error:'Widget summary unavailable.'},{status:500,headers});}
}
