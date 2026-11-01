import {env} from '../services/runtime';
import {trackerUser,sameOrigin} from '../services/access';
import {localDate,textValue,numeric} from '../services/tracker';
import {RecordError} from '../services/records';
import {getContext,listPlans,saveProfile,savePlan,changePlan} from '../coach/service';
import {askCoach} from '../coach/assistant';
const headers={'Cache-Control':'no-store'};
async function handle(request:Request){
 if(request.method==='POST'&&!sameOrigin(request))return Response.json({error:'Request rejected.'},{status:403,headers});
 const user=await trackerUser(request);if(!user)return Response.json({error:'Sign in to use your coach.'},{status:401,headers});
 try{
  if(request.method==='GET'){
   const date=new URL(request.url).searchParams.get('date')||localDate(),context=await getContext(env.DB,user,date);
   return Response.json({...context,plans:await listPlans(env.DB,user,date),aiAvailable:!!env.AI&&process.env.COACH_AI_ENABLED==='true'},{headers});
  }
  if(!request.headers.get('content-type')?.startsWith('application/json'))throw new RecordError('Send JSON.',415);
  const raw=await request.text();if(raw.length>6000)throw new RecordError('Request is too large.',413);
  let body;try{body=JSON.parse(raw);}catch{throw new RecordError('Invalid request.');}
  if(!body||typeof body!=='object'||Array.isArray(body))throw new RecordError('Invalid request.');
  const action=body.action;
  const keys:Record<string,string[]>={profile:['action','profile'],plan:['action','id','date','optionId','time','servings'],eat:['action','id'],skip:['action','id'],ask:['action','id','date','question','consent']};
  if(typeof action!=='string'||!Object.hasOwn(keys,action)||Object.keys(body).some(k=>!keys[action].includes(k)))throw new RecordError('Choose a valid coach action.');
  if(action==='profile')return Response.json({profile:await saveProfile(env.DB,user,body.profile)},{headers});
  const id=textValue(body.id,'Submission ID',true,128);
  if(action==='eat'||action==='skip')return Response.json(await changePlan(env.DB,user,id,action),{headers});
  const date=textValue(body.date,'Date',true,10);
  if(action==='plan')return Response.json(await savePlan(env.DB,user,id,date,textValue(body.optionId,'Meal option',true,150),textValue(body.time,'Meal time',false,5),numeric(body.servings,'Servings',0.25,3)),{headers});
  if(typeof body.consent!=='boolean')throw new RecordError('Confirm AI consent.');
  return Response.json(await askCoach(env.DB,user,date,textValue(body.question,'Question',true,1200),id,body.consent,env.AI),{headers});
 }catch(error){
  const message=error instanceof Error?error.message:'';
  const validation=error instanceof RecordError||/must be|required|too long|Choose|Unsupported|Targets|Profile/.test(message);
  return Response.json({error:validation?message:'Coach is temporarily unavailable. Your records were not changed.'},{status:error instanceof RecordError?error.status:validation?400:503,headers});
 }
}
export const GET=handle,POST=handle;
