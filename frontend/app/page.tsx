'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { LayoutGrid, LockKeyhole, Moon, RefreshCw, Sun } from 'lucide-react';
import { localDate, validDate, type Dashboard, type Meal, type Workout } from '../lib/tracker';
import {TrainingScreen,InsightsScreen,HistoryScreen,WaterScreen,MealDetails,WorkoutDetails} from './tracker-screens';
import WidgetSetup from './widget-setup';
import AccessScreen from './access-screen';
import type {TrackerTab} from './tracker-shell';
import { InstallTracker } from './install-tracker';
import DailyDashboard from './daily-dashboard';
import WeightDashboard from './weight-dashboard';

async function jsonResponse(response: Response) {
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Could not read the tracker response. Refresh and unlock with your access code.');
  return response.json() as Promise<Partial<Dashboard> & { error?: string; authorized?: boolean }>;
}

export default function Home() {
  const [date, setDate] = useState('');
  const [data, setData] = useState<Dashboard | null>(null);
  const [tab, setTab] = useState<'nutrition' | 'weight' | 'training' | 'analytics' | 'history'>('nutrition');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const [dark, setDark] = useState(false);
  const [access, setAccess] = useState<'checking' | 'locked' | 'unlocked'>('checking');
  const [code, setCode] = useState('');
  const [accessError, setAccessError] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [selectedMeal,setSelectedMeal]=useState<Meal|null>(null);
  const [selectedWorkout,setSelectedWorkout]=useState<Workout|null>(null);
  const [water,setWater]=useState(false);
  const [widgets,setWidgets]=useState(false);


  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get('date'), view = params.get('view');
    if (view && ['nutrition','weight','training','analytics','history'].includes(view)) setTab(view as typeof tab);
    if (q && validDate(q)) setDate(q);
    if(window.location.hash==='#water')setWater(true);
    if(view==='widgets')setWidgets(true);
    try { const saved = localStorage.getItem('lean-muscle-lavender-theme'); const next = saved === 'dark'; setDark(next); document.documentElement.dataset.theme = next ? 'dark' : 'light'; } catch {}
    const controller = new AbortController();
    fetch('/api/access', { cache: 'no-store', signal: controller.signal }).then(async r => {
      const body = await jsonResponse(r); if (!r.ok) throw new Error(body.error || 'Could not check access.'); return body;
    }).then(body => setAccess(body.authorized ? 'unlocked' : 'locked')).catch(e => {
      if (controller.signal.aborted) return; setAccess('locked'); setAccessError(e.message || 'Could not check access.');
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (access !== 'unlocked') return;
    const controller = new AbortController();
    setLoading(true); setError('');
    const query = date ? `date=${encodeURIComponent(date)}` : 'latest=1';
    fetch(`/api/dashboard?${query}`, { cache: 'no-store', signal: controller.signal }).then(async r => {
      const body = await jsonResponse(r);
      if (r.status === 401) { setData(null); setAccess('locked'); throw new Error(body.error || 'Unlock your tracker again.'); }
      if (!r.ok) throw new Error(body.error || 'Could not load entries.');
      if (!Array.isArray(body.meals) || !body.totals || !Array.isArray(body.weights) || !Array.isArray(body.workouts)) throw new Error('The saved data could not be read. Try refreshing the tracker.');
      return body as Dashboard;
    }).then(body => { if (!controller.signal.aborted) setData(body); }).catch(e => {
      if (!controller.signal.aborted) setError(e.message || 'Could not load entries.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [access, date, revision]);

  useEffect(() => {
    if (access !== 'unlocked') return;
    const refresh = () => { if (document.visibilityState === 'visible') setRevision(r => r + 1); };
    const timer = window.setInterval(refresh, 45000);
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [access]);

  function chooseView(next:TrackerTab){setTab(next);setSelectedMeal(null);setSelectedWorkout(null);setWater(false);setWidgets(false);const url=new URL(window.location.href);url.searchParams.set('view',next);url.hash='';window.history.replaceState(null,'',url);window.scrollTo({top:0,behavior:'instant'});}
  function chooseDate(next: string) {
    if (next && !validDate(next)) return;
    setDate(next);
    const url = new URL(window.location.href); next ? url.searchParams.set('date', next) : url.searchParams.delete('date'); window.history.replaceState(null, '', url);
    setRevision(r => r + 1);
  }
  function toggleTheme() {
    const next = !dark; setDark(next); document.documentElement.dataset.theme = next ? 'dark' : 'light';
    try { localStorage.setItem('lean-muscle-lavender-theme', next ? 'dark' : 'light'); } catch {}
  }
  async function unlock(event: FormEvent) {
    event.preventDefault(); setAccessError(''); setUnlocking(true);
    try {
      const r = await fetch('/api/access', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }), cache: 'no-store' });
      const body = await jsonResponse(r); if (!r.ok || !body.authorized) throw new Error(body.error || 'Could not unlock.');
      setCode(''); setAccess('unlocked');
    } catch (e) { setAccessError(e instanceof Error ? e.message : 'Could not unlock.'); } finally { setUnlocking(false); }
  }
  async function lock() {
    try { const r = await fetch('/api/access', { method: 'DELETE', cache: 'no-store' }); if (!r.ok) throw new Error('Could not lock. Try again.'); setData(null); setAccess('locked'); setSelectedMeal(null);setSelectedWorkout(null);setWater(false);setWidgets(false); } catch (e) { setError(e instanceof Error ? e.message : 'Could not lock.'); }
  }

  if (access !== 'unlocked') return <AccessScreen checking={access === 'checking'} code={code} onCode={setCode} onSubmit={unlock} error={accessError} busy={unlocking} dark={dark} onTheme={toggleTheme}/>;
  const today = data?.today || localDate(), viewDate = date || data?.date || today;
  const current = date && data?.date !== date ? null : data;
  const trackerActions = <><InstallTracker/><button className="icon-button" onClick={() => setRevision(r => r + 1)} disabled={loading} aria-label="Refresh saved data"><RefreshCw size={18} className={loading ? 'spin' : ''}/></button><button className="icon-button" onClick={toggleTheme} aria-label={dark ? 'Use light mode' : 'Use dark mode'}>{dark ? <Sun size={19}/> : <Moon size={19}/>}</button><button className="icon-button" onClick={lock} aria-label="Lock tracker"><LockKeyhole size={17}/></button><button className="icon-button widget-menu-button" onClick={()=>{setWidgets(true);setSelectedMeal(null);setSelectedWorkout(null);setWater(false);const url=new URL(window.location.href);url.searchParams.set('view','widgets');window.history.replaceState(null,'',url);}} aria-label="Custom Android widgets"><LayoutGrid size={18}/><span>Widgets</span></button></>;
  const props = {data,loading,error,originTab:tab,actions:trackerActions,onTab:chooseView,onRefresh:()=>setRevision(r=>r+1)};
  if(widgets && tab!=='history')return <WidgetSetup {...props} onBack={()=>chooseView(tab)}/>;
  if(selectedMeal && tab!=='history')return <MealDetails {...props} meal={current?.meals.find(m=>m.id===selectedMeal.id)||selectedMeal} onBack={()=>setSelectedMeal(null)}/>;
  if(selectedWorkout && tab!=='history')return <WorkoutDetails {...props} workout={data?.workouts.find(w=>w.id===selectedWorkout.id)||selectedWorkout} onBack={()=>setSelectedWorkout(null)}/>;
  if(water)return <WaterScreen {...props} data={current} date={viewDate} onBack={()=>{setWater(false);window.history.replaceState(null,'',window.location.pathname+window.location.search);}} onDate={chooseDate}/>;
  if(tab==='nutrition')return <DailyDashboard {...props} data={current} date={viewDate} today={today} onDate={chooseDate} onOpenMeal={setSelectedMeal} onWater={()=>{setWater(true);window.history.replaceState(null,'',window.location.pathname+window.location.search+'#water');}} renderMeal={(m)=> <button className="quiet-button" onClick={()=>setSelectedMeal(m)}>{m.name}</button>}/>;
  if(tab==='weight')return <WeightDashboard {...props} today={today}/>;
  if(tab==='training')return <TrainingScreen {...props} onWorkout={setSelectedWorkout} onDay={next=>{chooseDate(next);chooseView('nutrition');}}/>;
  if(tab==='analytics')return <InsightsScreen {...props} date={viewDate} onDate={next=>{chooseDate(next);chooseView('nutrition');}}/>;
  return <><div hidden={!!selectedMeal||!!selectedWorkout||widgets}><HistoryScreen {...props} onMeal={setSelectedMeal} onWorkout={setSelectedWorkout} onDay={next=>{chooseDate(next);chooseView('nutrition');}}/></div>{widgets?<WidgetSetup {...props} onBack={()=>chooseView(tab)}/>:selectedMeal?<MealDetails {...props} meal={selectedMeal} onBack={()=>setSelectedMeal(null)}/>:selectedWorkout?<WorkoutDetails {...props} workout={selectedWorkout} onBack={()=>setSelectedWorkout(null)}/>:null}</>;
}
