import {numeric,textValue,validDate,TARGETS,scaleUsualMeal,type Macros,type UsualMeal} from '../services/tracker';
export const MODEL='@cf/meta/llama-3.2-3b-instruct';
export type CoachProfile={targets:Macros;diet:'any'|'vegetarian'|'vegan';avoid:string;available:string;mealsLeft:number;lastMeal:'unknown'|'recent'|'earlier';lastMealReportedAt:number;nextWorkoutDate:string;nextWorkoutTime:string;nextWorkoutSession:string};
export const defaultProfile=():CoachProfile=>({targets:{calories:TARGETS.caloriesMax,protein:TARGETS.proteinMax,carbs:TARGETS.carbs,fat:TARGETS.fat},diet:'any',avoid:'',available:'',mealsLeft:2,lastMeal:'unknown',lastMealReportedAt:0,nextWorkoutDate:'',nextWorkoutTime:'',nextWorkoutSession:''});
export function profileInput(input:unknown):CoachProfile {
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Profile is required.');
 const p=input as Record<string,unknown>,keys=Object.keys(defaultProfile());
 if(Object.keys(p).some(k=>!keys.includes(k)))throw Error('Unsupported profile field.');
 const targets=p.targets as Record<string,unknown>;
 if(!targets||typeof targets!=='object'||Array.isArray(targets)||Object.keys(targets).some(k=>!['calories','protein','carbs','fat'].includes(k)))throw Error('Targets are required.');
 const diet=p.diet??'any';if(!['any','vegetarian','vegan'].includes(String(diet)))throw Error('Choose a valid dietary preference.');
 const mealsLeft=numeric(p.mealsLeft,'Meals remaining',1,6);if(!Number.isInteger(mealsLeft))throw Error('Meals remaining must be a whole number.');
 const lastMeal=p.lastMeal??'unknown';if(!['unknown','recent','earlier'].includes(String(lastMeal)))throw Error('Choose a valid last-meal option.');
 const date=textValue(p.nextWorkoutDate,'Next workout date',false,10),time=textValue(p.nextWorkoutTime,'Next workout time',false,5);
 if(date&&!validDate(date))throw Error('Choose a valid next workout date.');
 if(time&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw Error('Choose a valid next workout time.');
 if(time&&!date)throw Error('Choose the next workout date before its time.');
 return {targets:{calories:numeric(targets.calories,'Calorie target',500,6000),protein:numeric(targets.protein,'Protein target',10,300),carbs:numeric(targets.carbs,'Carb target',0,1000),fat:numeric(targets.fat,'Fat target',0,300)},diet:diet as CoachProfile['diet'],avoid:textValue(p.avoid,'Foods to avoid',false,300),available:textValue(p.available,'Preferred available foods',false,300),mealsLeft,lastMeal:lastMeal as CoachProfile['lastMeal'],lastMealReportedAt:typeof p.lastMealReportedAt==='number'&&Number.isFinite(p.lastMealReportedAt)?p.lastMealReportedAt:0,nextWorkoutDate:date,nextWorkoutTime:time,nextWorkoutSession:textValue(p.nextWorkoutSession,'Next workout session',false,100)};
}
// Approximate per-100 g values for the named preparation, based on USDA
// FoodData Central SR Legacy entries. Recipe values are calculated, not AI output.
// Rice 168878; chicken 171477; lentils 172420; yogurt 171284; oats 173904;
// banana 173944; egg 173424. Values vary with brand, cooking and added oil.
const foods={
 rice:{name:'White rice, cooked',calories:130,protein:2.69,carbs:28.17,fat:0.28},
 chicken:{name:'Chicken breast, cooked without skin',calories:165,protein:31.02,carbs:0,fat:3.57},
 lentils:{name:'Lentils, cooked without added fat',calories:116,protein:9.02,carbs:20.13,fat:0.38},
 yogurt:{name:'Plain whole-milk yogurt',calories:61,protein:3.47,carbs:4.66,fat:3.25},
 oats:{name:'Oats, dry',calories:389,protein:16.89,carbs:66.27,fat:6.9},
 banana:{name:'Banana, raw edible portion',calories:89,protein:1.09,carbs:22.84,fat:0.33},
 egg:{name:'Whole egg, hard-boiled edible portion',calories:155,protein:12.58,carbs:1.12,fat:10.61},
} as const;
function recipe(id:string,name:string,diet:'vegan'|'vegetarian'|'any',parts:[keyof typeof foods,number][]) {
 const ingredient_details=parts.map(([key,grams])=>{const f=foods[key];return {name:f.name,quantity:`${grams} g`,basis:'Approximate USDA per-100 g reference; specified preparation',calories:f.calories*grams/100,protein:f.protein*grams/100,carbs:f.carbs*grams/100,fat:f.fat*grams/100};});
 const totals=ingredient_details.reduce((s,v)=>({calories:s.calories+v.calories,protein:s.protein+v.protein,carbs:s.carbs+v.carbs,fat:s.fat+v.fat}),{calories:0,protein:0,carbs:0,fat:0});
 return {id,diet,source:'reference recipe',...totals,name,meal_type:'Other',ingredients:ingredient_details.map(v=>v.quantity+' '+v.name).join('; '),ingredient_details,note:'Reference estimate; excludes unlisted oil, sauces and other additions. Check quantities before logging.'};
}
export const referenceMeals=[recipe('reference:chicken-rice','Chicken & rice','any',[['chicken',120],['rice',180]]),recipe('reference:dal-rice','Lentils & rice','vegan',[['lentils',200],['rice',150]]),recipe('reference:dal-curd-rice','Lentils, curd & rice','vegetarian',[['lentils',180],['yogurt',150],['rice',120]]),recipe('reference:oats-curd','Oats, yogurt & banana','vegetarian',[['oats',50],['yogurt',200],['banana',100]]),recipe('reference:eggs-rice','Eggs & rice','any',[['egg',100],['rice',180]])];
export type MealOption=UsualMeal & {id:string;servings:number;source:string;reason:string;score:number;base:UsualMeal};
export type PlanningInput={date:string;totals:Macros;mealCount:number;profile:CoachProfile;saved:(UsualMeal&{id:string})[];workout:{id:string;date:string;session:string;volume_kg:number}|null};
const terms=(s:string)=>s.toLowerCase().split(',').map(v=>v.trim()).filter(Boolean);
export function planMeals(input:PlanningInput,now=Date.now()) {
 const {profile,totals}=input,remaining=Object.fromEntries((['calories','protein','carbs','fat'] as const).map(k=>[k,Math.max(0,profile.targets[k]-totals[k])])) as Macros;
 const next=profile.nextWorkoutDate&&profile.nextWorkoutTime?Date.parse(`${profile.nextWorkoutDate}T${profile.nextWorkoutTime}:00+05:30`):null;
 const nextUpcoming=next!==null&&next>=now;
 const nextSoon=nextUpcoming&&next!-now<=24*3600000;
 const warnings=['Based only on logged meals. Unlogged food is unknown; remaining targets are not proof you need more food.','Meal estimates assume the listed recipe and proportional servings; added oil and uneven portions change nutrition.'];
 if(!input.mealCount)warnings.push('No meals logged for this date. Complete your food log before treating the target gap as meaningful.');
 if(profile.avoid)warnings.push('Food exclusions are name matching, not allergy screening. Verify ingredients and product labels yourself.');
 if(profile.diet!=='any'||profile.avoid)warnings.push('Saved meals with unverified dietary suitability are omitted. Reference recipes use the selected preference.');
 if(next!==null&&!nextUpcoming)warnings.push('The next-workout time is in the past; update it before using it for planning.');
 const candidates=[...referenceMeals,...input.saved.map(m=>({...m,id:'saved:'+m.id,diet:'unknown',source:'your saved meal'}))].filter(m=>{
  if(profile.diet==='vegan'&&m.diet!=='vegan')return false;
  if(profile.diet==='vegetarian'&&!['vegan','vegetarian'].includes(m.diet))return false;
  if(profile.avoid&&m.source==='your saved meal')return false;
  const description=(m.name+' '+m.ingredients).toLowerCase();
  return !terms(profile.avoid).some(term=>(['milk','dairy','curd','yogurt'].includes(term)?['milk','dairy','curd','yogurt']:term==='eggs'?['egg']: [term]).some(word=>description.includes(word)));
 });
 const perMeal={calories:remaining.calories/profile.mealsLeft,protein:remaining.protein/profile.mealsLeft,carbs:remaining.carbs/profile.mealsLeft};
 const options=candidates.map(m=>{
  let best:MealOption|null=null;
  for(const servings of [0.5,0.75,1,1.25,1.5,2]){
   const scaled=scaleUsualMeal(m,servings);
   const score=Math.abs(scaled.calories-perMeal.calories)/Math.max(100,perMeal.calories)+1.5*Math.abs(scaled.protein-perMeal.protein)/Math.max(15,perMeal.protein)+(nextSoon?0.5:0.2)*Math.abs(scaled.carbs-perMeal.carbs)/Math.max(30,perMeal.carbs)-terms(profile.available).filter(t=>(m.name+' '+m.ingredients).toLowerCase().includes(t)).length*0.15;
   if(!best||score<best.score)best={...scaled,base:m,id:m.id,servings,source:m.source,score,reason:`Ranked against your remaining logged targets across ${profile.mealsLeft} meal(s)${nextSoon?', with carbohydrate fit considered for your scheduled session within 24 hours':''}.`};
  }
  return best!;
 }).sort((a,b)=>a.score-b.score).slice(0,3);
 const lastMeal=now-profile.lastMealReportedAt>=0&&now-profile.lastMealReportedAt<2*3600000?profile.lastMeal:'unknown';
 const timing=lastMeal==='unknown'?'Your last meal time is unknown. Choose a practical next meal time; there is no personalised countdown here.':lastMeal==='recent'?'You reported a meal within the last two hours. Fit the next meal around comfort and your daily intake rather than forcing another meal immediately.':'You reported that your last meal was more than two hours ago. Plan your next normal meal around comfort and your daily targets.';
 return {remaining,options:remaining.calories>0||remaining.protein>0?options:[],timing,nextWorkout:profile.nextWorkoutDate?{date:profile.nextWorkoutDate,time:profile.nextWorkoutTime||null,session:profile.nextWorkoutSession||'Unspecified',upcoming:nextUpcoming}:null,nextWorkoutNote:nextSoon?'A session is scheduled within 24 hours. Suggestions consider carbohydrate fit but do not calculate exercise calorie replacement.':'No confirmed session within 24 hours. No future workout or extra calorie need is assumed.',warnings,targetStatus:remaining.calories===0&&remaining.protein===0?'Your logged calorie and protein targets are reached. No extra meal is prescribed.':'Suggestions fit user-set targets, not a medical or metabolic prescription.',sources:[{title:'USDA FoodData Central',url:'https://fdc.nal.usda.gov/'},{title:'ISSN position stand: protein and exercise',url:'https://doi.org/10.1186/s12970-017-0177-8'}]};
}
