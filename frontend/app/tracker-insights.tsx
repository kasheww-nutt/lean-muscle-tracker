'use client';

import { useState } from 'react';
import { ArrowLeft, ArrowRight, CalendarDays, Droplets, Flame, Trophy } from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, ReferenceLine } from 'recharts';
import { calendarCells, chartDays, mealLogColor, shiftDate, type Dashboard } from '../lib/tracker';

const number = (n: number, digits = 0) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: digits });
const label = (date: string) => new Intl.DateTimeFormat('en-IN', { day:'numeric', month:'short', timeZone:'Asia/Kolkata' }).format(new Date(`${date}T12:00:00Z`));
const litres = (ml: number) => `${number(ml / 1000, 2)} L`;

export function WaterPanel({ data }: { data: Dashboard | null }) {
  return <section id="water" className="panel water-panel"><div className="water-summary"><div className="water-icon"><Droplets size={24} /></div><div><p className="eyebrow">WATER · SELECTED DAY</p><h2>{!data || !data.water.length ? '—' : litres(data.waterTotalMl)} <small>{data?.water.length ? `${number(data.waterTotalMl)} ml logged` : 'No intake logged yet'}</small></h2></div><span className="badge">{data ? data.water.length : '—'} entries</span></div><p className="muted small water-help">Tell ChatGPT “add 250 ml water” or give a measured bottle size. Entries add up across the day.</p>{!!data?.water.length && <details className="water-entries"><summary>View water entries</summary>{data.water.map(w => <div className="record-row" key={w.id}><div><strong>Water</strong>{w.note && <p>{w.note}</p>}</div><b>{number(w.amount_ml)} ml</b></div>)}</details>}</section>;
}

export function LoggingCalendar({ data, selectedDate, onSelect }: { data: Dashboard; selectedDate: string; onSelect: (date: string) => void }) {
  const [month, setMonth] = useState(selectedDate.slice(0,7));
  const days = new Map(data.loggingDays.map(d => [d.date,d]));
  const monthLabel = new Intl.DateTimeFormat('en-IN', {month:'long',year:'numeric',timeZone:'Asia/Kolkata'}).format(new Date(`${month}-01T12:00:00Z`));
  const move = (delta: number) => { const d = new Date(`${month}-01T12:00:00Z`); d.setUTCMonth(d.getUTCMonth()+delta); setMonth(d.toISOString().slice(0,7)); };
  const monthDays = data.loggingDays.filter(d=>d.date.startsWith(month) && d.date<=data.today);
  return <section className="panel calendar-panel"><div className="panel-heading"><div><h2>{monthLabel}</h2></div><div className="calendar-controls"><button className="icon-button" aria-label="Previous month" onClick={()=>move(-1)}><ArrowLeft size={16}/></button><button className="icon-button" aria-label="Next month" disabled={month>=data.today.slice(0,7)} onClick={()=>move(1)}><ArrowRight size={16}/></button></div></div><div className="calendar-meta"><span>{monthDays.length} days with records</span><button className="quiet-button" onClick={()=>setMonth(data.today.slice(0,7))}>This month</button></div><div className="calendar-grid" aria-label={`${monthLabel} meal logging calendar`}>{['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d=><span key={d} className="weekday">{d}</span>)}{calendarCells(month).map((date,index)=>{
    if (!date) return <span key={`blank-${index}`} className="calendar-blank"/>;
    const d = days.get(date), meals = d?.meal_count ?? 0, hasOther = Boolean(d && (d.water_count || d.workout_count || d.weight_count)), future = date>data.today;
    const description = `${label(date)}: ${meals} meals${d?.water_count ? `, ${d.water_count} water entries` : ''}${d?.workout_count ? `, ${d.workout_count} workouts` : ''}${d?.weight_count ? `, ${d.weight_count} weigh-ins` : ''}${!meals&&!hasOther ? ', no records' : ''}.`;
    return <button key={date} className={`calendar-day ${mealLogColor(meals)} ${date===selectedDate?'selected':''} ${date===data.today?'today':''}`} disabled={future} aria-label={description} aria-current={date===data.today?'date':undefined} title={description} onClick={()=>onSelect(date)}><span>{Number(date.slice(-2))}</span><small>{meals ? `${meals} meal${meals===1?'':'s'}` : hasOther ? 'Logged' : '—'}</small>{hasOther && <i className="other-log-dot"/>}</button>;
  })}</div><div className="calendar-legend"><span><i className="green"/>3+ meals</span><span><i className="yellow"/>2 meals</span><span><i className="red"/>1 meal</span><span><i className="neutral"/>No meals</span></div><p className="fine">Tap any day to see its meals and water. A dot marks water, training or a weigh-in. Colors count real meal entries, including snacks; they don’t indicate calorie goals or a complete food diary.</p></section>;
}

export default function TrackerInsights({ data, selectedDate, onSelect }: { data: Dashboard | null; selectedDate: string; onSelect: (date:string)=>void }) {
  const [range,setRange] = useState(7);
  const [session,setSession] = useState('');
  if (!data) return <div className="panel"><p className="muted">Loading your saved analytics…</p></div>;
  const rows = chartDays(data.history,data.volumeHistory,data.waterHistory,data.today,range,session);
  const sessions = [...new Set(data.volumeHistory.map(d=>d.session))].sort();
  const food = rows.filter(d=>d.calories!==null);
  const streak = data.streak;
  return <>
    <div className="insight-summary"><article><Flame size={21}/><span>Current streak<b>{streak.current} day{streak.current===1?'':'s'}</b></span></article><article><Trophy size={21}/><span>Best streak<b>{streak.longest} day{streak.longest===1?'':'s'}</b></span></article><article><CalendarDays size={21}/><span>Logged days<b>{streak.loggedDays}</b></span></article></div>
    <LoggingCalendar data={data} selectedDate={selectedDate} onSelect={onSelect}/>
    <details className="streak-definition"><summary>What counts toward a streak?</summary><p>A real meal, water entry, dated weigh-in or workout counts once per date. Yesterday can anchor your streak while today is in progress. Reference weights and fictional entries don’t count.</p></details>
    <div className="analytics-toolbar"><div><h2>Your trends</h2></div><div className="range-buttons" aria-label="Chart date range">{[7,30,90].map(n=><button key={n} aria-pressed={range===n} className={range===n?'active':''} onClick={()=>setRange(n)}>{n} days</button>)}</div></div>
    <p className="muted small chart-period">{label(shiftDate(data.today,1-range))} – {label(data.today)} · Logged values only; missing days are gaps. Meal totals can be partial.</p>
    <div className="analytics-grid">
      <TrendChart rows={rows} metric="calories" title="Logged calories" unit="kcal" color="var(--accent)" target={data.targets.caloriesMin} detail={food.length ? `${number(food.reduce((s,d)=>s+d.calories!,0)/food.length)} kcal average · ${food.length} logged food days` : 'No meals in this period'} onSelect={onSelect}/>
      <TrendChart rows={rows} metric="protein" title="Logged protein" unit="g" color="var(--warm)" target={data.targets.proteinMin} detail={food.length ? `${number(food.reduce((s,d)=>s+d.protein!,0)/food.length,1)} g average · logged food days only` : 'No meals in this period'} onSelect={onSelect}/>
      <TrendChart rows={rows} metric="volume" title="Lifted volume" unit="kg" color="var(--accent)" detail={session ? `${session} · daily session totals` : 'All session types · daily sum; exercise selection may differ'} onSelect={onSelect} controls={<select className="session-select" value={session} onChange={e=>setSession(e.target.value)} aria-label="Filter workout volume by session"><option value="">All sessions</option>{sessions.map(s=><option key={s} value={s}>{s}</option>)}</select>}/>
      <TrendChart rows={rows} metric="water" title="Logged water" unit="ml" color="var(--water)" detail="Measured water entries added per day" onSelect={onSelect}/>
    </div>
    <details className="panel chart-data"><summary>View exact logged values</summary><div className="table-scroll"><table><thead><tr><th>Date</th><th>kcal</th><th>Protein (g)</th><th>Volume (kg)</th><th>Water (ml)</th></tr></thead><tbody>{[...rows].reverse().filter(d=>d.calories!==null||d.volume!==null||d.water!==null).map(d=><tr key={d.date}><td><button className="text-button" onClick={()=>onSelect(d.date)}>{label(d.date)}</button></td>{[d.calories,d.protein,d.volume,d.water].map((v,i)=><td key={i}>{v===null?'—':number(v,1)}</td>)}</tr>)}</tbody></table></div><p className="fine">“—” means unlogged. Volume follows the selected session filter. Averages include only days with food records.</p></details>
  </>;
}
function InsightStat({label,value,detail}:{label:string;value:string;detail:string}) {return <article className="stat-card"><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;}
type ChartRow = ReturnType<typeof chartDays>[number];
export function TrendChart({ rows, metric, title, unit, color, target, detail, controls, onSelect }: {rows:ChartRow[];metric:'calories'|'protein'|'volume'|'water';title:string;unit:string;color:string;target?:number;detail:string;controls?:React.ReactNode;onSelect:(date:string)=>void}) {
  const hasData = rows.some(d=>d[metric]!==null);
  const [selected,setSelected] = useState<string|null>(null);
  const selectedRow = rows.find(d=>d.date===selected && d[metric]!==null);
  const axes = <><CartesianGrid stroke="var(--line)" strokeDasharray="3 5" vertical={false}/><XAxis dataKey="date" tickFormatter={label} tick={{fill:'var(--muted)',fontSize:10}} axisLine={false} tickLine={false} minTickGap={35}/><YAxis width={metric==='calories'||metric==='protein'?35:48} tick={{fill:'var(--muted)',fontSize:10}} axisLine={false} tickLine={false} tickFormatter={n=>number(n)} domain={[0,Math.max(target ?? 0,...rows.map(d=>d[metric]??0))*1.12]}/><Tooltip contentStyle={{background:'var(--panel)',border:'1px solid var(--line)',borderRadius:12,color:'var(--ink)',fontSize:12}} labelFormatter={v=>label(String(v))} formatter={v=>[`${number(Number(v),1)} ${unit}`,title]}/></>;
  const pointsClick = (state: {activeLabel?: string | number}) => { if (state.activeLabel) setSelected(String(state.activeLabel)); };
  return <section className="panel trend-panel"><div className="trend-heading"><div><h2>{title}</h2></div>{controls}</div><p className="muted small">{detail}</p>{target&&<p className="chart-target">{number(target)} {unit} target minimum</p>}{hasData ? <><div className="trend-chart" role="img" aria-label={`${title} for ${rows.length} days. Exact values available below.`}><ResponsiveContainer width="100%" height={190} minWidth={0}>{metric==='volume'||metric==='water' ? <BarChart data={rows} margin={{top:20,right:8,left:0,bottom:0}} onClick={pointsClick}>{axes}<Bar dataKey={metric} fill={color} radius={[4,4,0,0]} maxBarSize={28}/></BarChart> : <LineChart data={rows} margin={{top:20,right:8,left:0,bottom:0}} onClick={pointsClick}>{axes}{target && <ReferenceLine y={target} stroke="var(--muted)" strokeDasharray="4 4"/>}<Line dataKey={metric} type="linear" stroke={color} strokeWidth={2.5} dot={{r:3,fill:color,stroke:'var(--panel)',strokeWidth:1}} activeDot={{r:6}} connectNulls={false}/></LineChart>}</ResponsiveContainer></div>{selectedRow ? <button className="chart-selection" onClick={()=>onSelect(selectedRow.date)}>{label(selectedRow.date)} · {number(selectedRow[metric]!,1)} {unit}<span>View day →</span></button> : <p className="fine">Tap a chart point to inspect a date.{target ? ' Dashed line: minimum daily target.' : ''}</p>}</> : <div className="chart-empty"><span>No {metric==='volume'?'workout':metric==='water'?'water':'food'} records in this period.</span><small>Log through ChatGPT to start this chart.</small></div>}</section>;
}
