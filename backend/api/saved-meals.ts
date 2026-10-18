import {env} from '../services/runtime';
import {trackerUser,sameOrigin} from '../services/access';
import {textValue} from '../services/tracker';
import {RecordError} from '../services/records';
import {listUsualMeals,saveUsualMeal,removeUsualMeal} from '../services/saved-meals';
const headers={'Cache-Control':'no-store'};
async function handle(request:Request) {
 if(request.method!=='GET'&&!sameOrigin(request))return Response.json({error:'Request rejected.'},{status:403,headers});
 const user=await trackerUser(request);
 if(!user)return Response.json({error:'Sign in to manage your usual meals.'},{status:401,headers});
 try {
  if(request.method==='GET')return Response.json({meals:await listUsualMeals(env.DB,user)},{headers});
  if(!request.headers.get('content-type')?.startsWith('application/json'))throw new RecordError('Send JSON.',415);
  const raw=await request.text();if(raw.length>1000)throw new RecordError('Request is too large.',413);
  let body;try{body=JSON.parse(raw);}catch{throw new RecordError('Invalid request.');}
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>k!=='meal_id'))throw new RecordError('Supply only the meal ID.');
  const id=textValue(body.meal_id,'Meal ID',true,128);
  return Response.json(await (request.method==='POST'?saveUsualMeal(env.DB,user,id):removeUsualMeal(env.DB,user,id)),{headers});
 }catch(error) {
  const message=error instanceof Error?error.message:'';
  const validation=error instanceof RecordError||/must be|required|too long/.test(message);
  return Response.json({error:validation?message:'Could not update usual meals. Try again.'},{status:error instanceof RecordError?error.status:validation?400:503,headers});
 }
}
export const GET=handle,POST=handle,DELETE=handle;
