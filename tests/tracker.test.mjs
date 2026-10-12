import test from 'node:test';
import assert from 'node:assert/strict';
import { validDate, shiftDate, totalMeals, weightTrend, workoutComparisons, validateIngredients, validateExercises, numeric, loggingStreak, mealLogColor, calendarCells, chartDays } from '../backend/services/tracker.ts';

test('Calendar dates reject impossible dates and handle month boundaries', () => {
  assert.equal(validDate('2026-02-29'), false);
  assert.equal(validDate('2028-02-29'), true);
  assert.equal(validDate('2026-13-01'), false);
  assert.equal(shiftDate('2026-03-01', -1), '2026-02-28');
});
test('Fictional entries never inflate confirmed daily intake', () => {
  assert.deepEqual(totalMeals([{ calories:1700,protein:52,carbs:150,fat:100,is_test:0 },{calories:200,protein:5,carbs:30,fat:8,is_test:1}]),{calories:1700,protein:52,carbs:150,fat:100});
});
test('Weekly comparison uses distinct dated readings in consecutive weeks', () => {
  const rows=[{date:'2026-10-10',weight_kg:57.1},{date:'2026-10-10',weight_kg:80},{date:'2026-10-08',weight_kg:56.9},{date:'2026-10-03',weight_kg:56.8},{date:'2026-10-01',weight_kg:56.8}];
  const trend=weightTrend(rows);
  assert.equal(trend.current.start,'2026-10-05'); assert.equal(trend.current.count,2);
  assert.equal(trend.current.average,57); assert.ok(Math.abs(trend.change-.2)<1e-8);
  assert.equal(weightTrend(rows.slice(0,2)).change,null);
  assert.equal(weightTrend([]),null);
});
test('Workout comparisons match session type and never compare a later or same-day session', () => {
  const comparisons=workoutComparisons([{id:'new',date:'2026-10-10',session:'Legs',volume_kg:4500},{id:'same',date:'2026-10-10',session:'legs',volume_kg:9000},{id:'upper',date:'2026-10-09',session:'Upper',volume_kg:10000},{id:'old',date:'2026-10-05',session:' legs ',volume_kg:4000}]);
  assert.equal(comparisons.new.change,500); assert.equal(comparisons.new.percent,12.5); assert.equal(comparisons.new.date,'2026-10-05'); assert.equal(comparisons.old,undefined);
});
test('Unknown ingredient macros remain unknown; invalid numerical input is rejected', () => {
  const ingredients=validateIngredients([{name:'Chicken',quantity:'135 g',basis:'raw'}]);
  assert.equal(ingredients[0].calories,undefined);
  for(const value of [NaN,Infinity,'52',null,-1]) assert.throws(()=>numeric(value,'protein'));
  assert.throws(()=>validateIngredients([{name:'Rice'}]));
  assert.throws(()=>validateExercises([{name:'Squat',sets:[{reps:2.5,load_kg:40}]}]));
  assert.deepEqual(validateExercises([{name:'Squat',sets:[{reps:10,load_kg:40}]}])[0].sets[0],{reps:10,load_kg:40});
});

test('Logging streak uses distinct activity dates, tolerates today in progress, and excludes future dates', () => {
  const day=(date,kind='meal')=>({date,meal_count:kind==='meal'?1:0,water_count:kind==='water'?1:0,workout_count:kind==='workout'?1:0,weight_count:kind==='weight'?1:0});
  const rows=[day('2026-10-10'),day('2026-10-10','water'),day('2026-10-09','water'),day('2026-10-08','workout'),day('2026-10-06','weight'),day('2026-10-12')];
  assert.deepEqual(loggingStreak(rows,'2026-10-11'),{current:3,longest:3,loggedDays:4,lastDate:'2026-10-10'});
  assert.equal(loggingStreak(rows,'2026-10-12').current,1);
  assert.equal(loggingStreak(rows.filter(d=>d.date!=='2026-10-12'),'2026-10-12').current,0);
  assert.equal(loggingStreak([...rows,day('2026-10-11')],'2026-10-11').current,4);
  assert.deepEqual(loggingStreak([{date:'2026-10-11',meal_count:0,water_count:0,workout_count:0,weight_count:0}],'2026-10-11'),{current:0,longest:0,loggedDays:0,lastDate:null});
});
test('Calendar is Monday-first, handles leap years, and applies requested meal colors',()=>{
  assert.deepEqual([0,1,2,3,6].map(mealLogColor),['neutral','red','yellow','green','green']);
  const october=calendarCells('2026-10');
  assert.deepEqual(october.slice(0,4),[null,null,null,'2026-10-01']);
  assert.equal(october.filter(Boolean).length,31);
  assert.equal(october.length%7,0);
  assert.equal(calendarCells('2028-02').filter(Boolean).length,29);
});
test('Chart timeline retains gaps and real zeros, sums daily volume, and filters session type',()=>{
  const nutrition=[{date:'2026-10-10',calories:2350,protein:67},{date:'2026-10-08',calories:0,protein:0}];
  const volume=[{date:'2026-10-10',session:'legs',volume_kg:4115},{date:'2026-10-10',session:'upper',volume_kg:1000}];
  const water=[{date:'2026-10-09',amount_ml:750}];
  const rows=chartDays(nutrition,volume,water,'2026-10-11',4);
  assert.deepEqual(rows.map(d=>d.date),['2026-10-08','2026-10-09','2026-10-10','2026-10-11']);
  assert.equal(rows[0].calories,0); assert.equal(rows[1].calories,null);
  assert.equal(rows[1].water,750); assert.equal(rows[2].water,null);
  assert.equal(rows[2].volume,5115); assert.equal(rows[3].volume,null);
  assert.equal(chartDays(nutrition,volume,water,'2026-10-11',4,'legs')[2].volume,4115);
});
