import {env} from '../services/runtime';
import {trackerUser,sameOrigin} from '../services/access';
import {validDate,localDate,parseArray} from '../services/tracker';
import {recordKind,saveManualRecord,updateManualRecord,removeManualRecord,RecordError} from '../services/records';
const headers={'Cache-Control':'no-store'};
export async function GET(request:Request){
 const user=await trackerUser(request);if(!user)return Response.json({error:'Sign in to view your entries.'},{status:401,headers});
 const date=new URL(request.url).searchParams.get('date')||localDate();
 if(!validDate(date))return Response.json({error:'Choose a valid date.'},{status:400,headers});
 try{
  const [meals,water,weights,workouts]=await Promise.all([
   env.DB.prepare('SELECT * FROM meals WHERE user_id=? AND date=? ORDER BY created_at DESC,rowid DESC').bind(user,date).all(),
   env.DB.prepare('SELECT * FROM water_intakes WHERE user_id=? AND date=? ORDER BY created_at DESC,rowid DESC').bind(user,date).all(),
   env.DB.prepare("SELECT * FROM body_weights WHERE user_id=? AND (date=? OR (record_type='reference' AND date IS NULL)) ORDER BY created_at DESC,rowid DESC").bind(user,date).all(),
   env.DB.prepare('SELECT * FROM workouts WHERE user_id=? AND date=? ORDER BY created_at DESC,rowid DESC').bind(user,date).all()
  ]);
  // Do not expose internal account identifiers to forms.
  const clean=(row:Record<string,unknown>)=>{const {user_id,record_order,...entry}=row;return entry;};
  return Response.json({date,meals:meals.results.map(r=>({...clean(r),ingredient_details:parseArray(r.ingredient_details)})),water:water.results.map(clean),weights:weights.results.map(clean),workouts:workouts.results.map(r=>({...clean(r),exercises:parseArray(r.exercises)}))},{headers});
 }catch{return Response.json({error:'Could not load entries. Try again.'},{status:503,headers});}
}
async function mutate(request:Request){
 if(!sameOrigin(request))return Response.json({error:'Request rejected.'},{status:403,headers});
 const user=await trackerUser(request);if(!user)return Response.json({error:'Sign in before saving entries.'},{status:401,headers});
 if(!request.headers.get('content-type')?.startsWith('application/json'))return Response.json({error:'Send a JSON record.'},{status:415,headers});
 try{
  const raw=await request.text();if(raw.length>150000)throw new RecordError('Entry is too large.',413);
  let body;try{body=JSON.parse(raw);}catch{throw new RecordError('Invalid record request.');}
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['kind','id','data'].includes(key)))throw new RecordError('Invalid record request.');
  const kind=recordKind(body.kind);
  if(typeof body.id!=='string'||body.id.length>128||!body.id)throw new RecordError('Entry ID is required.');
  if(request.method==='DELETE')return Response.json(await removeManualRecord(env.DB,user,kind,body.id),{headers});
  if(!body.data||typeof body.data!=='object'||Array.isArray(body.data))throw new RecordError('Entry details are required.');
  const result=request.method==='POST'?await saveManualRecord(env.DB,user,kind,body.data,body.id):await updateManualRecord(env.DB,user,kind,body.data,body.id);
  return Response.json(result,{headers});
 }catch(error){
  const message=error instanceof Error?error.message:'';
  const validation=error instanceof RecordError||/must be|required|too long|Choose|Ingredient|exercise|Each set|Repetitions/.test(message);
  return Response.json({error:validation?message:'Could not save the entry. Retry with the same submission.'},{status:error instanceof RecordError?error.status:validation?400:503,headers});
 }
}
export const POST=mutate,PATCH=mutate,DELETE=mutate;
