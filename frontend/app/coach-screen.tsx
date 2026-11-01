'use client';
import {useEffect,useRef,useState,type FormEvent,type ReactNode} from 'react';
import {ArrowLeft,CalendarDays,Check,Clock3,MessageCircle,Sparkles,Utensils} from 'lucide-react';
import {localDate,scaleUsualMeal,type Macros,type UsualMeal,type CoachProfile,type MealOption} from '../lib/tracker';
import {DailyHeader} from './tracker-shell';
import './coach-screen.css';
type Plan={id:string;date:string;planned_time:string;status:string;meal:UsualMeal};
type Context={date:string;today:string;profile:CoachProfile;totals:Macros;mealCount:number;workout:{date:string;session:string;volume_kg:number}|null;aiAvailable:boolean;plans:Plan[];planning:{remaining:Macros;options:MealOption[];timing:string;nextWorkout:{date:string;time:string|null;session:string;upcoming:boolean}|null;nextWorkoutNote:string;warnings:string[];targetStatus:string;sources:{title:string;url:string}[]}};
const n=(value:number)=>value.toLocaleString('en-IN',{maximumFractionDigits:1});
export default function CoachScreen({actions,onBack,onExpired,onRecordsChanged,refreshKey}:{refreshKey:number;actions:ReactNode;onBack:()=>void;onExpired:()=>void;onRecordsChanged:(date:string)=>void}){
 const [date,setDate]=useState(localDate),[data,setData]=useState<Context|null>(null),[profile,setProfile]=useState<CoachProfile|null>(null),[revision,setRevision]=useState(0),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [tab,setTab]=useState<'plan'|'ask'>('plan'),[time,setTime]=useState(''),[portions,setPortions]=useState<Record<string,string>>({}),[question,setQuestion]=useState(''),[answer,setAnswer]=useState(''),[consent,setConsent]=useState(false);
 const pending=useRef(false),askId=useRef({key:'',id:''}),planIds=useRef(new Map<string,string>());
 async function call(body:unknown){
  const response=await fetch('/api/coach',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store'});
  if(response.status===401){onExpired();throw Error('Sign in again.');}
  const result=await response.json();if(!response.ok)throw Error(result.error||'Could not complete this request.');return result;
 }
 useEffect(()=>{
  const controller=new AbortController();setLoading(true);setData(null);setProfile(null);setAnswer('');setPortions({});planIds.current.clear();
  fetch('/api/coach?date='+encodeURIComponent(date),{cache:'no-store',signal:controller.signal}).then(async response=>{
   if(response.status===401){onExpired();throw Error('Sign in again.');}
   const result=await response.json();if(!response.ok)throw Error(result.error||'Could not load your coach.');return result as Context;
  }).then(result=>{if(!controller.signal.aborted){setData(result);setProfile(result.profile);setError('');}}).catch(e=>{if(!controller.signal.aborted)setError(e.message||'Could not load your coach.');}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return()=>controller.abort();
 },[date,revision,refreshKey]);
 async function perform(work:()=>Promise<void>){if(pending.current)return;pending.current=true;setBusy(true);setError('');setNotice('');try{await work();}catch(e){setError(e instanceof Error?e.message:'Request failed.');}finally{pending.current=false;setBusy(false);}}
 async function saveSettings(event:FormEvent){event.preventDefault();await perform(async()=>{await call({action:'profile',profile});setRevision(r=>r+1);setNotice('Preferences saved. Suggestions recalculated.');onRecordsChanged(date);});}
 async function plan(option:MealOption){await perform(async()=>{
  const servings=Number(portions[option.id]??option.servings),key=JSON.stringify({date,time,id:option.id,servings});
  if(!planIds.current.has(key))planIds.current.set(key,crypto.randomUUID());
  await call({action:'plan',id:planIds.current.get(key),date,time,optionId:option.id,servings});setNotice('Meal planned. Nothing has been added to your food log.');setRevision(r=>r+1);
 });}
 async function updatePlan(plan:Plan,action:'eat'|'skip'){
  if(action==='eat'&&!window.confirm('Confirm you ate the listed ingredients and portions. If they differ, cancel and log the actual meal using Log entry.'))return;
  await perform(async()=>{await call({action,id:plan.id});setRevision(r=>r+1);setNotice(action==='eat'?'Meal logged once. Your nutrition totals will refresh.':'Plan skipped. Food logs are unchanged.');if(action==='eat')onRecordsChanged(date);});
 }
 async function ask(event:FormEvent){event.preventDefault();await perform(async()=>{
  const key=JSON.stringify({date,question:question.trim()});if(askId.current.key!==key)askId.current={key,id:crypto.randomUUID()};
  const result=await call({action:'ask',id:askId.current.id,date,question:question.trim(),consent});setAnswer(result.answer);
 });}
 const field=(key:'avoid'|'available'|'nextWorkoutSession',label:string,max=300)=><label className="coach-field"><span>{label}</span><input maxLength={max} value={profile?.[key]||''} onChange={e=>setProfile(p=>p?{...p,[key]:e.target.value}:p)}/></label>;
 return <main className="lavender-daily coach-page"><DailyHeader loading={loading} connected={!!data} actions={actions}/>
  <div className="coach-title"><button className="icon-button" aria-label="Back to tracker" onClick={onBack}><ArrowLeft size={21}/></button><div><p className="eyebrow">YOUR NEXT STEP</p><h1>Meals & your coach</h1></div></div>
  <div className="coach-tabs"><button aria-pressed={tab==='plan'} onClick={()=>setTab('plan')}><Utensils size={18}/>Meal planner</button><button aria-pressed={tab==='ask'} onClick={()=>setTab('ask')}><MessageCircle size={18}/>Ask your coach</button></div>
  <label className="coach-field coach-date"><span><CalendarDays size={16}/>Planning date · India time</span><input type="date" required disabled={busy} value={date} onChange={e=>{if(e.target.value){setDate(e.target.value);setNotice('');}}}/></label>
  {error&&<p role="alert" className="coach-error">{error}</p>}{notice&&<p role="status" className="coach-notice">{notice}</p>}
  {loading?<p role="status">Reading your records…</p>:!data||!profile?<button className="quiet-button" onClick={()=>setRevision(r=>r+1)}>Retry</button>:<>
   <section className="coach-card coach-context"><h2>{data.workout?'After '+data.workout.session:'Plan around your day'}</h2><p>{data.workout?`Workout logged for ${data.workout.date}. Lifted volume is not used as calories burned.`:'No workout logged for this date. You can still plan a meal; no workout is assumed.'}</p><div className="coach-stats"><div><strong>{n(data.totals.calories)}</strong><span>kcal logged</span></div><div><strong>{n(data.totals.protein)} g</strong><span>protein logged</span></div><div><strong>{data.mealCount}</strong><span>meals recorded</span></div></div><p className="coach-small">Unlogged food is unknown. Targets are defaults until you review them below.</p></section>
   {tab==='plan'?<>
    <details className="coach-card coach-settings"><summary>Preferences, targets & next workout</summary><form onSubmit={saveSettings}><fieldset disabled={busy}>
     <p className="coach-small">Set your own daily targets. These are not calculated medical or metabolic requirements. They also update the dashboard targets.</p>
     <div className="coach-grid">{(['calories','protein','carbs','fat'] as const).map(k=><label className="coach-field" key={k}><span>{k==='calories'?'Calories (kcal)':k+' (g)'}</span><input required type="number" min={k==='calories'?500:k==='protein'?10:0} max={k==='calories'?6000:k==='protein'?300:k==='carbs'?1000:300} step="any" value={profile.targets[k]} onChange={e=>setProfile({...profile,targets:{...profile.targets,[k]:Number(e.target.value)}})}/></label>)}</div>
     <label className="coach-field"><span>Diet preference</span><select value={profile.diet} onChange={e=>setProfile({...profile,diet:e.target.value as CoachProfile['diet']})}><option value="any">Any</option><option value="vegetarian">Vegetarian · no eggs/meat</option><option value="vegan">Vegan</option></select></label>
     {field('avoid','Foods to avoid · comma separated')}{field('available','Prefer available ingredients · comma separated')}
     <p className="coach-small">Preferences match ingredient names; they do not certify allergy safety. Availability is a ranking preference, so check the full recipe.</p>
     <div className="coach-grid"><label className="coach-field"><span>Meals still planned today</span><input type="number" required min={1} max={6} value={profile.mealsLeft} onChange={e=>setProfile({...profile,mealsLeft:Number(e.target.value)})}/></label><label className="coach-field"><span>Last meal · your report</span><select value={profile.lastMeal} onChange={e=>setProfile({...profile,lastMeal:e.target.value as CoachProfile['lastMeal']})}><option value="unknown">Unknown / not supplied</option><option value="recent">Within the last 2 hours</option><option value="earlier">More than 2 hours ago</option></select></label></div>
     {field('nextWorkoutSession','Next planned workout · optional',100)}<div className="coach-grid"><label className="coach-field"><span>Next workout date</span><input type="date" value={profile.nextWorkoutDate} onChange={e=>setProfile({...profile,nextWorkoutDate:e.target.value,nextWorkoutTime:e.target.value?profile.nextWorkoutTime:''})}/></label><label className="coach-field"><span>Time · India time</span><input type="time" value={profile.nextWorkoutTime} onChange={e=>setProfile({...profile,nextWorkoutTime:e.target.value})}/></label></div><button className="coach-primary" type="submit">{busy?'Saving…':'Save preferences'}</button>
    </fieldset></form></details>
    <section className="coach-card"><h2><Clock3 size={19}/>When to eat</h2><p>{data.planning.timing}</p>{data.planning.nextWorkout&&<p>Next entered session: {data.planning.nextWorkout.session} · {data.planning.nextWorkout.date} {data.planning.nextWorkout.time||'(time not supplied)'}</p>}<p className="coach-small">{data.planning.nextWorkoutNote}</p></section>
    <section className="coach-options"><h2>What could fit next?</h2><p className="coach-small">Remaining against logged targets: {n(data.planning.remaining.calories)} kcal · {n(data.planning.remaining.protein)} g protein. {data.planning.targetStatus}</p>
     <label className="coach-field"><span>Planned meal time · optional, not a deadline</span><input type="time" disabled={busy} value={time} onChange={e=>setTime(e.target.value)}/></label>
     {!data.planning.options.length&&<p className="coach-card">No matching options. Review your targets and exclusions; do not force an extra meal.</p>}
     {data.planning.options.map(option=>{
      const amount=Number(portions[option.id]??option.servings);let preview:UsualMeal|null=null;try{if(amount>=0.25&&amount<=3)preview=scaleUsualMeal(option.base,amount);}catch{}
      return <article className="coach-card" key={option.id}><span className="coach-badge">{option.source}</span><h3>{option.name}</h3><p>{option.reason}</p><label className="coach-field"><span>Servings · relative to the base recipe</span><input type="number" min={0.25} max={3} step={0.25} disabled={busy} value={portions[option.id]??option.servings} onChange={e=>setPortions(v=>({...v,[option.id]:e.target.value}))}/></label>
       {preview&&<><p className="coach-macros">{n(preview.calories)} kcal · {n(preview.protein)} g protein</p><p className="coach-small">{n(preview.carbs)} g carbs · {n(preview.fat)} g fat</p><details><summary>Review ingredients & assumptions</summary><ul>{preview.ingredient_details.length?preview.ingredient_details.map((v,i)=><li key={i}>{v.name} · {v.quantity}</li>):<li>{preview.ingredients||'Ingredient quantities were not supplied.'}</li>}</ul><p className="coach-small">{preview.note||'Uses the saved meal’s original nutrition estimate.'}</p></details></>}
       <button className="coach-primary" disabled={busy||!preview} onClick={()=>plan(option)}>Plan this meal</button><p className="coach-small">Planning does not log food as eaten.</p>
      </article>;
     })}
    </section>
    <section className="coach-plans"><h2>Your meal plans</h2>{!data.plans.length?<p className="coach-small">No meals planned for this date.</p>:data.plans.map(plan=><article className="coach-card" key={plan.id}><div className="coach-plan-heading"><h3>{plan.meal.name}</h3><span className="coach-badge">{plan.status}</span></div><p>{plan.planned_time||'Time flexible'} · {n(plan.meal.calories)} kcal · {n(plan.meal.protein)} g protein</p><details><summary>Review planned portion</summary><p>{plan.meal.ingredients||'See your original saved meal.'}</p></details>{plan.status==='planned'&&<div className="coach-actions"><button className="coach-primary" disabled={busy||date!==data.today} onClick={()=>updatePlan(plan,'eat')}><Check size={16}/>I ate this portion</button><button className="quiet-button" disabled={busy} onClick={()=>updatePlan(plan,'skip')}>Skip plan</button></div>}{plan.status==='planned'&&date!==data.today&&<p className="coach-small">Use Log entry to record a meal eaten on another date.</p>}</article>)}</section>
    <details className="coach-card"><summary>How suggestions work</summary><p className="coach-small">Portions are ranked by calorie, protein and carbohydrate fit against your logged targets divided across remaining meals. Preferred ingredients improve ranking. A confirmed next session within 24 hours increases the weight given to carbohydrate fit. This does not predict recovery or calories burned.</p><ul>{data.planning.warnings.map(w=><li className="coach-small" key={w}>{w}</li>)}</ul>{data.planning.sources.map(s=><a className="coach-source" key={s.url} href={s.url} target="_blank" rel="noreferrer">{s.title}</a>)}</details>
   </>:<section className="coach-card coach-chat"><h2><Sparkles size={20}/>Ask about your records</h2><p>Questions about meals, logged targets and training—without opening ChatGPT.</p><p className="coach-small">Read-only guidance for general fitness. It cannot change your records. Nutrition values remain estimates.</p>{!data.aiAvailable&&<p className="coach-notice">AI is currently unavailable. The meal planner still works.</p>}
    <form onSubmit={ask}><label className="coach-field"><span>Your question</span><textarea required maxLength={1200} rows={4} value={question} disabled={busy} onChange={e=>setQuestion(e.target.value)} placeholder="Which of these meals fits my logged protein target?"/></label><label className="coach-consent"><input type="checkbox" checked={consent} disabled={busy} onChange={e=>setConsent(e.target.checked)}/><span>I agree to send this question and context for this date to Cloudflare AI: nutrition totals and targets, preferences, up to eight meal names, the latest session and next planned workout, and suggested meals. No email or ChatGPT history is sent.</span></label><button className="coach-primary" disabled={busy||!consent||!data.aiAvailable||!question.trim()} type="submit">{busy?'Thinking…':'Ask coach'}</button><p className="coach-small">Up to 10 questions per user per UTC day, subject to a shared daily limit and provider availability. Replies are generated by AI and may be wrong.</p></form>
    {answer&&<div className="coach-answer" role="status"><span className="coach-badge">Cloudflare AI · read-only</span><p>{answer}</p></div>}
   </section>}
  </>}
 </main>;
}
