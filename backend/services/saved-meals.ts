import type {TrackerDatabase} from './database';
import {parseArray, textValue, numeric, validateIngredients, scaleUsualMeal, type UsualMeal} from './tracker';
import {RecordError, saveManualRecord} from './records';

export async function listUsualMeals(db:TrackerDatabase,userId:string) {
 const rows=await db.prepare('SELECT id,meal_json FROM saved_meals WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 200').bind(userId).all<{id:string;meal_json:string}>();
 return rows.results.map(row=>({...JSON.parse(row.meal_json) as UsualMeal,id:row.id}));
}
export async function saveUsualMeal(db:TrackerDatabase,userId:string,mealId:string) {
 const row=await db.prepare('SELECT * FROM meals WHERE id=? AND user_id=?').bind(mealId,userId).first<Record<string,unknown>>();
 if(!row)throw new RecordError('Meal not found in your account.',404);
 if(Number(row.is_test))throw new RecordError('Fictional meals cannot be saved as usual meals.');
 const meal:UsualMeal={name:textValue(row.name,'Meal name',true,200),meal_type:textValue(row.meal_type,'Meal type',false,30)||'Other',ingredients:textValue(row.ingredients,'Ingredients'),ingredient_details:validateIngredients(parseArray(row.ingredient_details)),note:textValue(row.note,'Note'),calories:numeric(row.calories,'Calories'),protein:numeric(row.protein,'Protein'),carbs:numeric(row.carbs,'Carbs'),fat:numeric(row.fat,'Fat')};
 // A snapshot survives edits/deletion of the original diary entry. Saving twice is harmless.
 await db.prepare('INSERT INTO saved_meals (user_id,id,meal_json) VALUES (?,?,?) ON CONFLICT(user_id,id) DO NOTHING').bind(userId,mealId,JSON.stringify(meal)).run();
 return {saved:true,id:mealId};
}
export async function getUsualMeal(db:TrackerDatabase,userId:string,id:string) {
 const row=await db.prepare('SELECT meal_json FROM saved_meals WHERE user_id=? AND id=?').bind(userId,id).first<{meal_json:string}>();
 if(!row)throw new RecordError('Usual meal not found in your account.',404);
 return JSON.parse(row.meal_json) as UsualMeal;
}
export async function removeUsualMeal(db:TrackerDatabase,userId:string,id:string) {
 const result=await db.prepare('DELETE FROM saved_meals WHERE user_id=? AND id=?').bind(userId,id).run();
 if(!result.meta.changes)throw new RecordError('Usual meal not found in your account.',404);
 return {removed:true,id};
}
export async function logUsualMeal(db:TrackerDatabase,userId:string,id:string,servings:number,date:string,submissionId:string,mealType?:string) {
 const meal=scaleUsualMeal(await getUsualMeal(db,userId,id),servings);
 return saveManualRecord(db,userId,'meal',{...meal,date,meal_type:mealType??meal.meal_type,is_test:false},submissionId,'chatgpt');
}
