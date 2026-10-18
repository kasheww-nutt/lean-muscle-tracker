'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {Plus,X,Pencil,Trash2,Utensils,Droplets,Scale,Dumbbell,BookmarkPlus} from 'lucide-react';
import {localDate,scaleUsualMeal,type UsualMeal,type Ingredient,type Exercise} from '../lib/tracker';
import './manual-logger.css';

type Kind='meal'|'water'|'weight'|'workout';
type Entry={id:string;date:string|null;name?:string;session?:string;ingredients?:string;ingredient_details?:Ingredient[];calories?:number;protein?:number;carbs?:number;fat?:number;meal_type?:string;is_test?:number;note?:string;amount_ml?:number;weight_kg?:number;record_type?:string;context?:string;volume_kg?:number;details?:string;exercises?:Exercise[];source?:string};
type Entries={meals:Entry[];water:Entry[];weights:Entry[];workouts:Entry[]};
const kinds=[{key:'meal',label:'Meal',icon:Utensils},{key:'water',label:'Water',icon:Droplets},{key:'weight',label:'Weight',icon:Scale},{key:'workout',label:'Workout',icon:Dumbbell,BookmarkPlus}] as const;
const empty=():Entries=>({meals:[],water:[],weights:[],workouts:[]});
const collection={meal:'meals',water:'water',weight:'weights',workout:'workouts'} as const;
const text=(entry:Entry)=>Object.fromEntries(Object.entries(entry).filter(([,v])=>typeof v==='string'||typeof v==='number').map(([k,v])=>[k,String(v)]));

export default function ManualLogger({date,onSaved,onExpired}:{date:string;onSaved:(date:string)=>void;onExpired:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null),pending=useRef(false),submission=useRef('');
 const [open,setOpen]=useState(false),[kind,setKind]=useState<Kind>('meal'),[day,setDay]=useState(date||localDate());
 const [values,setValues]=useState<Record<string,string>>({}),[ingredients,setIngredients]=useState<Ingredient[]>([]),[exercises,setExercises]=useState<Exercise[]>([]);
 const [reference,setReference]=useState(false),[fictional,setFictional]=useState(false),[editing,setEditing]=useState<string|null>(null);
 const [entries,setEntries]=useState<Entries>(empty),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[revision,setRevision]=useState(0),[removeId,setRemoveId]=useState<string|null>(null);
 const [usualMeals,setUsualMeals]=useState<(UsualMeal & {id:string})[]>([]),[usualId,setUsualId]=useState(''),[servings,setServings]=useState('1'),[usualLoading,setUsualLoading]=useState(false),[usualError,setUsualError]=useState('');
 const reload=()=>setRevision(v=>v+1);
 function reset(){setUsualId('');setServings('1');setValues({});setIngredients([]);setExercises([]);setReference(false);setFictional(false);setEditing(null);setRemoveId(null);submission.current=crypto.randomUUID();}
 function close(){if(pending.current)return;dialog.current?.close();setOpen(false);}
 function launch(){reset();setDay(date||localDate());setError('');setMessage('');setEntries(empty());setOpen(true);dialog.current?.showModal();}
 useEffect(()=>{
  if(!open)return;const controller=new AbortController();setLoading(true);setEntries(empty());setError('');
  fetch('/api/records?date='+encodeURIComponent(day),{cache:'no-store',signal:controller.signal}).then(async response=>{
   if(response.status===401){close();onExpired();throw Error('Sign in again before logging.');}
   const data=await response.json();if(!response.ok)throw Error(data.error||'Could not load entries.');return data as Entries;
  }).then(data=>{if(!controller.signal.aborted)setEntries(data);}).catch(e=>{if(!controller.signal.aborted)setError(e.message||'Could not load entries.');}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return()=>controller.abort();
 },[open,day,revision]);
 useEffect(()=>{
  if(!open)return;const controller=new AbortController();setUsualLoading(true);setUsualError('');setUsualMeals([]);
  fetch('/api/saved-meals',{cache:'no-store',signal:controller.signal}).then(async response=>{
   if(response.status===401){dialog.current?.close();setOpen(false);onExpired();throw Error('Sign in again.');}
   const data=await response.json();if(!response.ok)throw Error(data.error||'Could not load usual meals.');return data.meals;
  }).then(data=>{if(!controller.signal.aborted)setUsualMeals(data);}).catch(e=>{if(!controller.signal.aborted)setUsualError(e.message);}).finally(()=>{if(!controller.signal.aborted)setUsualLoading(false);});
  return()=>controller.abort();
 },[open,revision]);
 function useUsual(){
  try{const selected=usualMeals.find(m=>m.id===usualId);if(!selected)throw Error('Choose a usual meal.');
   const scaled=scaleUsualMeal(selected,Number(servings));reset();setValues(text({id:'',date:day,...scaled}));setIngredients(scaled.ingredient_details);setFictional(false);setError('');setMessage('Usual meal loaded. Review the details, then save to log it.');
  }catch(e){setError(e instanceof Error?e.message:'Could not load this meal.');}
 }
 async function manageUsual(method:'POST'|'DELETE',id:string){
  if(pending.current)return;if(method==='DELETE'&&!window.confirm('Remove this usual meal? Logged entries will stay unchanged.'))return;
  pending.current=true;setBusy(true);setError('');setMessage('');
  try{await send(method,{meal_id:id},'/api/saved-meals');setUsualId('');setMessage(method==='POST'?'Saved to your usual meals. Your diary totals have not changed.':'Usual meal removed. Logged entries are unchanged.');reload();}
  catch(e){setError(e instanceof Error?e.message:'Could not update usual meals.');}finally{pending.current=false;setBusy(false);}
 }
 function update(key:string,value:string){setValues(old=>({...old,[key]:value}));setMessage('');}
 function edit(entry:Entry){reset();setEditing(entry.id);setValues(text(entry));setIngredients(entry.ingredient_details||[]);setExercises(entry.exercises||[]);setReference(entry.record_type==='reference');setFictional(entry.is_test===1);setMessage('');setError('');}
 async function send(method:string,body:unknown,url='/api/records'){
  const response=await fetch(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store'});
  if(response.status===401){dialog.current?.close();setOpen(false);onExpired();throw Error('Sign in again before logging.');}
  const result=await response.json();if(!response.ok)throw Error(result.error||'Could not save this entry.');return result;
 }
 async function save(event:FormEvent){
  event.preventDefault();if(pending.current)return;pending.current=true;setBusy(true);setError('');setMessage('');
  try{
   const number=(key:string)=>{if(values[key]===undefined||values[key].trim()==='')throw Error('Enter '+key.replaceAll('_',' ')+'.');const n=Number(values[key]);if(!Number.isFinite(n))throw Error('Enter a valid '+key.replaceAll('_',' ')+'.');return n;};
   let data:Record<string,unknown>={date:day};
   if(kind==='meal')data={...data,name:values.name||'',meal_type:values.meal_type||'Other',ingredients:values.ingredients||'',ingredient_details:ingredients,calories:number('calories'),protein:number('protein'),carbs:number('carbs'),fat:number('fat'),note:values.note||'',is_test:fictional};
   if(kind==='water')data={...data,amount_ml:number('amount_ml'),note:values.note||''};
   if(kind==='weight')data={...data,date:reference?null:day,weight_kg:number('weight_kg'),record_type:reference?'reference':'weigh_in',context:values.context||''};
   if(kind==='workout')data={...data,session:values.session||'',details:values.details||'',exercises,...(values.volume_kg?.trim()?{volume_kg:number('volume_kg')}:{})};
   await send(editing?'PATCH':'POST',{kind,id:editing||submission.current,data});
   const wasEditing=!!editing;reset();setMessage(wasEditing?'Entry updated.':'Entry saved.');reload();onSaved(day);
  }catch(e){setError(e instanceof Error?e.message:'Could not save this entry.');}
  finally{pending.current=false;setBusy(false);}
 }
 async function remove(id:string){
  if(pending.current)return;pending.current=true;setBusy(true);setError('');setMessage('');
  try{await send('DELETE',{kind,id});if(editing===id)reset();setRemoveId(null);setMessage('Entry deleted.');reload();onSaved(day);}catch(e){setError(e instanceof Error?e.message:'Could not delete entry.');}finally{pending.current=false;setBusy(false);}
 }
 const input=(key:string,label:string,options:{numeric?:boolean;min?:number;max?:number;required?:boolean}={})=><label className="manual-field" key={key}><span>{label}</span><input name={key} type={options.numeric?'number':'text'} inputMode={options.numeric?'decimal':undefined} step={options.numeric?'any':undefined} min={options.min} max={options.max} maxLength={options.numeric?undefined:200} required={options.required} value={values[key]||''} onChange={e=>update(key,e.target.value)}/></label>;
 const area=(key:string,label:string)=><label className="manual-field"><span>{label}</span><textarea name={key} maxLength={10000} rows={3} value={values[key]||''} onChange={e=>update(key,e.target.value)}/></label>;
 const list=entries[collection[kind]];
 return <><button className="manual-log-launch" onClick={launch}><Plus size={20}/><span>Log entry</span></button>
 <dialog ref={dialog} className="manual-dialog" aria-labelledby="manual-title" onCancel={e=>{if(pending.current)e.preventDefault();else setOpen(false);}} onClose={()=>setOpen(false)}>
  <header className="manual-heading"><div><p className="eyebrow">YOUR TRACKER</p><h2 id="manual-title">Log your progress</h2></div><button type="button" className="icon-button" aria-label="Close logging" disabled={busy} onClick={close}><X size={20}/></button></header>
  <p className="manual-intro">Log here or through ChatGPT. Both save to your account.</p>
  <div className="manual-tabs" aria-label="Entry type">{kinds.map(item=><button type="button" key={item.key} aria-pressed={kind===item.key} className={kind===item.key?'active':''} disabled={busy} onClick={()=>{setKind(item.key);reset();setError('');setMessage('');}}><item.icon size={18}/>{item.label}</button>)}</div>
  <label className="manual-field manual-day"><span>Entry date</span><input type="date" required value={day} disabled={busy} onChange={e=>{if(!e.target.value)return;setDay(e.target.value);setMessage('');}}/></label>
  {error&&<p role="alert" className="manual-error">{error}</p>}{message&&<p role="status" className="manual-success">{message}</p>}
  {kind==='meal'&&!editing&&<section className="manual-usual" aria-label="Your usual meals"><h3>Your usual meals</h3><p className="manual-help">Save a meal below once. Reuse its nutrition without estimating it again. One serving means the original logged portion.</p>
   {usualError?<p role="alert" className="manual-error">{usualError} <button type="button" className="quiet-button" disabled={busy} onClick={reload}>Retry</button></p>:usualLoading?<p role="status" className="manual-help">Loading usual meals…</p>:usualMeals.length?<>
    <label className="manual-field"><span>Choose a saved meal</span><select disabled={busy} value={usualId} onChange={e=>{setUsualId(e.target.value);setServings('1');}}><option value="">Choose a meal…</option>{usualMeals.map(meal=><option key={meal.id} value={meal.id}>{meal.name} · {meal.calories} kcal</option>)}</select></label>
    {usualId&&<><label className="manual-field"><span>Servings of the original portion</span><input type="number" min="0.1" max="10" step="any" disabled={busy} value={servings} onChange={e=>setServings(e.target.value)}/></label>
    <p className="manual-help">Nutrition and ingredient amounts scale proportionally. This assumes the same recipe; it does not identify ingredient substitutions.</p>
    {Number(servings)>=0.1&&Number(servings)<=10&&<p className="manual-usual-preview">{Math.round(usualMeals.find(m=>m.id===usualId)!.calories*Number(servings)*100)/100} kcal · {Math.round(usualMeals.find(m=>m.id===usualId)!.protein*Number(servings)*100)/100} g protein</p>}
    <div className="manual-inline-actions"><button type="button" className="quiet-button" disabled={busy} onClick={useUsual}>Use meal</button><button type="button" className="quiet-button manual-delete" disabled={busy} onClick={()=>manageUsual('DELETE',usualId)}>Remove from usuals</button></div></>}
   </>:<p className="manual-help">No usual meals yet. Add a meal, then tap “Save as usual” beside its entry.</p>}
  </section>}
  <form onSubmit={save}><fieldset disabled={busy} className="manual-fields"><legend>{editing?'Edit entry':'New '+kinds.find(k=>k.key===kind)!.label.toLowerCase()}</legend>
   {kind==='meal'&&<>{input('name','Meal name',{required:true})}<label className="manual-field"><span>Meal type</span><select value={values.meal_type||'Other'} onChange={e=>update('meal_type',e.target.value)}>{['Breakfast','Lunch','Dinner','Snack','Other'].map(t=><option key={t}>{t}</option>)}</select></label>{area('ingredients','Ingredients and quantities (optional)')}<p className="manual-help">Enter nutrition from the label or your own estimate. This form doesn’t calculate it from the meal name.</p><div className="manual-grid">{[['calories','Calories (kcal)'],['protein','Protein (g)'],['carbs','Carbs (g)'],['fat','Fat (g)']].map(([key,label])=>input(key,label,{numeric:true,min:0,max:100000,required:true}))}</div>
   <details className="manual-structured" onInvalidCapture={e=>{e.currentTarget.open=true;}}><summary>Ingredient breakdown (optional)</summary><p className="manual-help">Leave unknown ingredient macros blank.</p>{ingredients.map((ingredient,index)=><div className="manual-subrecord" key={index}><label className="manual-field"><span>Ingredient name</span><input required maxLength={200} value={ingredient.name} onChange={e=>setIngredients(items=>items.map((v,i)=>i===index?{...v,name:e.target.value}:v))}/></label><label className="manual-field"><span>Quantity, with units</span><input required maxLength={300} value={ingredient.quantity} onChange={e=>setIngredients(items=>items.map((v,i)=>i===index?{...v,quantity:e.target.value}:v))}/></label><label className="manual-field"><span>Raw/cooked or estimate basis</span><input maxLength={200} value={ingredient.basis||''} onChange={e=>setIngredients(items=>items.map((v,i)=>i===index?{...v,basis:e.target.value}:v))}/></label><div className="manual-grid">{(['calories','protein','carbs','fat'] as const).map(key=><label className="manual-field" key={key}><span>{key==='calories'?'Calories (kcal)':key+' (g)'}</span><input type="number" min={0} max={100000} step="any" value={ingredient[key]??''} onChange={e=>setIngredients(items=>items.map((v,i)=>{if(i!==index)return v;const next={...v};if(e.target.value==='')delete next[key];else next[key]=Number(e.target.value);return next;}))}/></label>)}</div><button type="button" className="quiet-button" onClick={()=>setIngredients(items=>items.filter((_,i)=>i!==index))}>Remove ingredient</button></div>)}<button type="button" className="quiet-button" disabled={ingredients.length>=100} onClick={()=>setIngredients(items=>[...items,{name:'',quantity:''}])}>Add ingredient</button></details>{area('note','Notes (optional)')}<label className="manual-checkbox"><input type="checkbox" checked={fictional} onChange={e=>setFictional(e.target.checked)}/>Fictional/test entry — excluded from nutrition totals</label></>}
   {kind==='water'&&<>{input('amount_ml','Water consumed (ml)',{numeric:true,min:0.01,max:20000,required:true})}<p className="manual-help">Each entry adds to your daily total. Enter the amount you just drank, not the running total.</p>{area('note','Notes (optional)')}</>}
   {kind==='weight'&&<>{input('weight_kg','Body weight (kg)',{numeric:true,min:20,max:300,required:true})}<label className="manual-checkbox"><input type="checkbox" checked={reference} onChange={e=>setReference(e.target.checked)}/>Undated starting/reference weight</label>{reference&&<p className="manual-help">Saved without a date; excluded from the dated weight trend.</p>}{area('context','Measurement context (optional)')}</>}
   {kind==='workout'&&<>{input('session','Session (e.g. Upper, Lower, Full body)',{required:true})}{input('volume_kg','Total lifted volume (kg · optional with exercise sets)',{numeric:true,min:0,max:100000})}<p className="manual-help">Volume = repetitions × external load, summed across sets. Leave the total blank to calculate from the sets below.</p>{exercises.map((exercise,index)=><div className="manual-subrecord" key={index}><label className="manual-field"><span>Exercise name</span><input required maxLength={200} value={exercise.name} onChange={e=>setExercises(items=>items.map((v,i)=>i===index?{...v,name:e.target.value}:v))}/></label>{exercise.sets.map((set,si)=><div className="manual-set" key={si}><label className="manual-field"><span>Reps · set {si+1}</span><input type="number" required min={1} max={1000} step={1} value={set.reps||''} onChange={e=>setExercises(items=>items.map((v,i)=>i===index?{...v,sets:v.sets.map((s,j)=>j===si?{...s,reps:Number(e.target.value)}:s)}:v))}/></label><label className="manual-field"><span>External load (kg)</span><input type="number" required min={0} max={1000} step="any" value={set.load_kg} onChange={e=>setExercises(items=>items.map((v,i)=>i===index?{...v,sets:v.sets.map((s,j)=>j===si?{...s,load_kg:Number(e.target.value)}:s)}:v))}/></label><button type="button" className="icon-button" aria-label={'Remove set '+(si+1)} onClick={()=>setExercises(items=>items.map((v,i)=>i===index?{...v,sets:v.sets.filter((_,j)=>j!==si)}:v))}><X size={16}/></button></div>)}<div className="manual-inline-actions"><button type="button" className="quiet-button" disabled={exercise.sets.length>=50} onClick={()=>setExercises(items=>items.map((v,i)=>i===index?{...v,sets:[...v.sets,{reps:0,load_kg:0}]}:v))}>Add set</button><button type="button" className="quiet-button" onClick={()=>setExercises(items=>items.filter((_,i)=>i!==index))}>Remove exercise</button></div></div>)}<button type="button" className="quiet-button" disabled={exercises.length>=100} onClick={()=>setExercises(items=>[...items,{name:'',sets:[{reps:0,load_kg:0}]}])}>Add exercise</button>{area('details','Workout notes (optional)')}</>}
   <div className="manual-save"><button className="primary-button" type="submit">{busy?'Saving…':editing?'Save changes':'Save entry'}</button>{editing&&<button type="button" className="quiet-button" onClick={()=>{reset();setError('');}}>Cancel edit</button>}</div>
  </fieldset></form>
  <section className="manual-existing" aria-label="Saved entries"><h3>{kind==='weight'?'Weigh-ins for this day & undated references':'Entries for '+day}</h3><p className="manual-help">You can edit entries added here or through ChatGPT.</p>{loading?<p role="status">Loading entries…</p>:!list.length?<p className="manual-help">No entries yet.</p>:list.map(entry=><article key={entry.id}><div><strong>{entry.name||entry.session||(kind==='water'?`${entry.amount_ml} ml`:`${entry.weight_kg} kg`)}</strong><small>{kind==='meal'?`${entry.calories} kcal · ${entry.source==='manual'?'Manual':'ChatGPT'}${entry.is_test?' · Test':''}`:kind==='workout'?`${entry.volume_kg} kg volume`:kind==='weight'?entry.record_type==='reference'?'Undated reference':entry.date:entry.note}</small></div><button type="button" className="icon-button" aria-label={'Edit '+(entry.name||entry.session||kind)} disabled={busy} onClick={()=>edit(entry)}><Pencil size={17}/></button><button type="button" className="icon-button manual-delete" aria-label={'Delete '+(entry.name||entry.session||kind)} disabled={busy} onClick={()=>setRemoveId(removeId===entry.id?null:entry.id)}><Trash2 size={17}/></button>{kind==='meal'&&!entry.is_test&&<button type="button" className="quiet-button manual-save-usual" disabled={busy||usualMeals.some(m=>m.id===entry.id)} onClick={()=>manageUsual('POST',entry.id)}><BookmarkPlus size={15}/>{usualMeals.some(m=>m.id===entry.id)?'Saved as usual':'Save as usual'}</button>}{removeId===entry.id&&<div className="manual-confirm"><span>Delete this entry permanently?</span><button type="button" className="quiet-button" disabled={busy} onClick={()=>remove(entry.id)}>Delete entry</button><button type="button" className="quiet-button" disabled={busy} onClick={()=>setRemoveId(null)}>Cancel</button></div>}</article>)}</section>
 </dialog></>;
}
