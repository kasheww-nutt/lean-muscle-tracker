'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, BarChart3, CalendarDays, ChevronRight, Clock3, CookingPot, Droplet, Drumstick, Dumbbell, Flame, Hamburger, House, Scale, UserRound } from 'lucide-react';
import { shiftDate, TARGETS, type Dashboard, type Meal } from '../lib/tracker';
import { DailyHeader, DailyNavigation, type TrackerTab } from './tracker-shell';
export { DailyHeader, DailyNavigation } from './tracker-shell';
export type { TrackerTab } from './tracker-shell';

const mealType = (meal: Meal) => meal.meal_type || meal.name.match(/^(Breakfast|Lunch|Dinner|Snack)\b/i)?.[1] || 'Meal';
const mealName = (meal: Meal) => meal.name.replace(/^(Breakfast|Lunch|Dinner|Snack)\s*[—–:-]\s*/i, '');
const n = (value: number) => value.toLocaleString('en-IN', { maximumFractionDigits: 1 });

export default function DailyDashboard({ data, date, today, loading, error, actions, onDate, onTab, onRefresh, renderMeal, onOpenMeal, onWater }: {
  data: Dashboard | null; date: string; today: string; loading: boolean; error: string; actions: ReactNode;
  onDate: (date: string) => void; onTab: (tab: TrackerTab) => void; onRefresh: () => void; renderMeal: (meal: Meal, index: number) => ReactNode; onOpenMeal: (meal: Meal) => void; onWater: () => void;
}) {

  const mealOrder = (meal: Meal) => /breakfast|morning/i.test(mealType(meal)) ? 0 : /lunch/i.test(mealType(meal)) ? 1 : /dinner/i.test(mealType(meal)) ? 3 : 2;
  const meals = (data?.meals.filter(meal => !Number(meal.is_test)) || []).sort((a, b) => mealOrder(a) - mealOrder(b));
  const tests = data?.meals.filter(meal => Number(meal.is_test)) || [];
  const totals = meals.length ? data?.totals : null;
  const targets = data?.targets || TARGETS;
  const dateText = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date(`${date}T12:00:00Z`));
  return <main className="lavender-daily">
    <DailyHeader loading={loading} connected={!!data} actions={actions}/>
    <section className="daily-content" aria-label="Daily dashboard" aria-busy={loading}>
      <h1>Your day, at a glance.</h1>
      <details className="daily-date"><summary><CalendarDays size={19}/><span>{dateText}</span></summary><div className="daily-date-menu"><label htmlFor="daily-date-input">Choose a day</label><input id="daily-date-input" type="date" value={date} onChange={event => onDate(event.target.value)}/><div><button aria-label="Previous day" onClick={() => onDate(shiftDate(date, -1))}><ArrowLeft size={18}/></button><button onClick={() => onDate(today)}>Today</button><button onClick={() => onDate('')}>Latest</button><button aria-label="Next day" disabled={date >= today} onClick={() => onDate(shiftDate(date, 1))}><ArrowRight size={18}/></button></div></div></details>
      {error && <div className="notice error" role="alert"><span>{error} {data && 'Showing the last successful refresh.'}</span><button onClick={onRefresh}>Retry</button></div>}
      <section className="daily-nutrition" aria-label="Estimated nutrition from logged meals">
        <div className="daily-calories"><div><strong>{totals ? n(totals.calories) : '—'}</strong><span>kcal</span></div><div className="daily-progress" role="progressbar" aria-label="Logged calories towards upper daily target" aria-valuemin={0} aria-valuemax={targets.caloriesMax} aria-valuenow={totals ? Math.min(totals.calories, targets.caloriesMax) : undefined}><i style={{width: `${totals ? Math.min(100, totals.calories / targets.caloriesMax * 100) : 0}%`}}/></div><p>{n(targets.caloriesMin)}–{n(targets.caloriesMax)} daily target</p></div>
        <div className="daily-macros"><div className="daily-protein"><strong>{totals ? n(totals.protein) : '—'}</strong><span>g <b>protein</b></span></div><p>{targets.proteinMin}–{targets.proteinMax} g target</p><div className="daily-secondary"><div><strong>{totals ? n(totals.carbs) : '—'} <small>g</small></strong><span>carbs</span></div><div><strong>{totals ? n(totals.fat) : '—'} <small>g</small></strong><span>fat</span></div></div></div>
      </section>
      <div className="daily-utilities"><button className="daily-utility" onClick={onWater}><span className="daily-utility-icon water"><Droplet size={26}/></span><span className="daily-utility-text"><span>Water</span><strong>{!data ? 'Loading…' : data.water.length ? `${n(data.waterTotalMl / 1000)} L logged` : 'No intake logged'}</strong></span><ChevronRight size={17}/></button><button className="daily-utility" onClick={() => onTab('analytics')}><span className="daily-utility-icon consistency"><Flame size={25}/></span><span className="daily-utility-text"><span>Consistency</span><strong>{data ? `${data.streak.current}-day streak` : 'Loading…'}</strong><small>{data ? `${meals.length} meal${meals.length === 1 ? '' : 's'} recorded` : 'Reading your logs…'}</small></span><ChevronRight size={17}/></button></div>
      <section className="daily-meals"><div className="daily-meals-heading"><h2>{date === today ? 'Meals today' : 'Meals for this day'}</h2><button onClick={() => onTab('analytics')}>See your trends <ArrowRight size={16}/></button></div>
        {!data ? <p className="daily-empty" role="status">{loading ? 'Loading your saved meals…' : 'Saved meals unavailable. Try refreshing.'}</p> : !meals.length ? <p className="daily-empty">No meals logged for this day yet. Tell ChatGPT what you ate to add a meal.</p> : <div className="daily-meal-list">{meals.map((meal, index) => {const type = mealType(meal);const Icon = /breakfast/i.test(type) ? CookingPot : /lunch/i.test(type) ? Hamburger : /dinner/i.test(type) ? Drumstick : CookingPot;return <button className="daily-meal daily-meal-button" key={meal.id} onClick={() => onOpenMeal(meal)}><span className="daily-meal-summary"><span className="daily-food-icon"><Icon size={25}/></span><span className="daily-meal-title"><strong>{type}</strong><span>{mealName(meal)}</span></span><span className="daily-meal-energy"><b>{n(meal.calories)}</b> kcal</span><ChevronRight className="daily-meal-chevron" size={17}/></span></button>;})}</div>}
        <p className="daily-estimate">{data && !meals.length ? 'Unlogged food is unknown, not zero.' : 'Estimated nutrition from logged meals.'}</p>
        {!!tests.length && <details className="daily-test"><summary>{tests.length} fictional entries · excluded from totals</summary>{tests.map(renderMeal)}</details>}
      </section>
    </section>
    <DailyNavigation selected="nutrition" onTab={onTab}/>
  </main>;
}
