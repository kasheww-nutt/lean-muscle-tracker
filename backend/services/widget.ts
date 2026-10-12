export async function widgetTokenHash(token: string) {
  const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)));
  return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
}
export function newWidgetToken(){return Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');}
export function widgetTexts(value:{date:string;calories:number|null;protein:number|null;waterMl:number|null;streak:number;weight:number|null;weightDate:string|null;volume:number|null;session:string|null;workoutDate:string|null}) {
 return {nutrition_text:`${value.date}\n${value.calories===null?'No meals logged':`${Math.round(value.calories).toLocaleString('en-IN')} kcal · ${value.protein} g protein`}`,water_text:`Water · ${value.date}\n${value.waterMl===null?'No intake logged':`${value.waterMl/1000} L logged`}`,streak_text:`${value.streak}-day logging streak`,weight_text:value.weight===null?'No dated weigh-in':`${value.weight} kg · ${value.weightDate}`,training_text:value.volume===null?'No training logged':`${value.session} · ${value.volume.toLocaleString('en-IN')} kg\n${value.workoutDate}`};
}
