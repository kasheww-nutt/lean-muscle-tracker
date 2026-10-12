'use client';

import { useState, type ReactNode } from 'react';
import { BarChart3, ChevronRight, Info, Scale, Target, TrendingUp } from 'lucide-react';
import { shiftDate, type Dashboard, type Weight } from '../lib/tracker';
import { DailyHeader, DailyNavigation, type TrackerTab } from './daily-dashboard';
import './lavender-weight.css';

const number = (n: number, digits = 1) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: digits });
const dateLabel = (date: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date(`${date}T12:00:00Z`));
const daysApart = (a: string, b: string) => (new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / 86400000;

export default function WeightDashboard({data, today, loading, error, actions, onTab, onRefresh}: {
  data: Dashboard | null; today: string; loading: boolean; error: string; actions: ReactNode; onTab: (tab: TrackerTab) => void; onRefresh: () => void;
}) {
  const [range, setRange] = useState<7 | 30 | 90>(7);
  const latest = data?.weights[0];
  const trend = data?.weightTrend;
  const from = shiftDate(today, 1 - range);
  const rows = (data?.weights || []).filter(w => w.date >= from && w.date <= today).slice().sort((a, b) => a.date.localeCompare(b.date));
  return <main className="lavender-daily lavender-weight">
    <DailyHeader loading={loading} connected={!!data} actions={actions}/>
    <section className="daily-content" aria-label="Body weight dashboard" aria-busy={loading}>
      <h1>Steady growth, in view.</h1><p className="weight-subtitle">Your weight & weekly averages</p>
      {error && <div className="notice error" role="alert"><span>{error} {data && 'Showing the last successful refresh.'}</span><button onClick={onRefresh}>Retry</button></div>}
      <section className="weight-reference" aria-label="Undated reference weight"><span className="weight-reference-icon"><Scale size={29}/></span><div><strong>{data?.referenceWeight ? number(data.referenceWeight.weight_kg) : '—'} <small>kg</small></strong><p>Reference weight</p></div><div className="weight-reference-date"><span>{!data ? 'Loading…' : data.referenceWeight ? 'Date not supplied' : 'Not recorded'}</span></div></section>
      <div className="weight-utilities"><article className="weight-latest"><span className="weight-card-icon"><TrendingUp size={26}/></span><div><span>Latest weigh-in</span><strong>{latest ? `${number(latest.weight_kg)} kg` : '—'}</strong><small>{latest ? dateLabel(latest.date) : !data ? 'Loading readings…' : 'No dated reading yet'}</small></div></article><details className="weight-aim"><summary><span className="weight-card-icon peach"><Target size={25}/></span><span><span>Gain aim</span><strong>0.1–0.25 <small>kg / week</small></strong></span><ChevronRight size={17}/></summary><p>Illustrative weekly gain aim; customize this display for your own goals. Compare weekly averages once each consecutive week has at least two dated readings.</p></details></div>
      <section className="weight-trend-card"><div className="weight-trend-heading"><h2>Weight trend</h2><div className="weight-ranges" aria-label="Weight chart range">{([7,30,90] as const).map(days => <button key={days} aria-pressed={range === days} className={range === days ? 'active' : ''} onClick={() => setRange(days)}>{days} days</button>)}</div></div><WeightPlot rows={rows} from={from} to={today} range={range} reference={data?.referenceWeight?.weight_kg} loading={!data && loading} hasHistory={!!data?.weights.length}/>{!!rows.length && <p className="weight-chart-caption">{dateLabel(from)} – {dateLabel(today)} · kg · Dated readings only</p>}</section>
      <section className="weight-weekly"><h2>Weekly averages</h2><WeekRow label={trend && trend.current.end < today ? 'Latest logged week' : 'This week'} week={trend?.current} rows={data?.weights || []}/><WeekRow label="Previous week" week={trend?.previous} rows={data?.weights || []} peach/>{trend?.change !== null && trend?.change !== undefined ? <p className="weight-comparison"><b>{trend.change > 0 ? '+' : ''}{number(trend.change, 2)} kg</b> versus the preceding week.</p> : <p className="weight-weekly-note">Two readings in each week unlock a comparison.</p>}</section>
      <p className="weight-reference-note"><Info size={15}/><span>The undated reference stays separate from chart measurements.</span></p>
      {!!data?.weights.length && <details className="weight-history"><summary>Weigh-in history <span>{data.weights.length} readings</span><ChevronRight size={17}/></summary><div>{data.weights.map(w => <article className="weight-history-row" key={w.id}><div><strong>{dateLabel(w.date)}</strong>{w.context && <p>{w.context}</p>}</div><b>{number(w.weight_kg)} kg</b></article>)}</div></details>}
    </section>
    <DailyNavigation selected="weight" onTab={onTab}/>
  </main>;
}

function WeekRow({label, week, rows, peach = false}: { label: string; week: { start: string; end: string; average: number; count: number } | null | undefined; rows: Weight[]; peach?: boolean }) {
  return <details className="weight-week-row"><summary><span className={`weight-card-icon${peach ? ' peach' : ''}`}><BarChart3 size={23}/></span><span className="weight-week-label"><span>{label}</span><strong>{week ? `${number(week.average, 2)} kg` : '—'}</strong></span><ChevronRight size={17}/></summary><div className="weight-week-detail">{week ? <><p>{dateLabel(week.start)} – {dateLabel(week.end)} · {week.count} dated reading{week.count === 1 ? '' : 's'}</p>{rows.filter(w => w.date >= week.start && w.date <= week.end).map(w => <div key={w.id}><span>{dateLabel(w.date)}</span><b>{number(w.weight_kg)} kg</b></div>)}</> : <p>No dated readings for this week yet. Tell ChatGPT your weight and measurement date.</p>}</div></details>;
}

function WeightPlot({rows, from, to, range, reference, loading, hasHistory}: {rows: Weight[]; from: string; to: string; range: number; reference?: number; loading: boolean; hasHistory: boolean}) {
  const values = rows.map(w => Number(w.weight_kg));
  const base = Math.floor((reference || 55) / 5) * 5;
  const min = rows.length ? Math.floor((Math.min(...values) - .5) * 2) / 2 : base - 10;
  const max = rows.length ? Math.ceil((Math.max(...values) + .5) * 2) / 2 : base + 10;
  const points = rows.map(w => ({w, x: 35 + daysApart(from, w.date) / Math.max(1, range - 1) * 515, y: 168 - (Number(w.weight_kg) - min) / (max - min) * 148}));
  const ticks = range === 7 ? 7 : 4;
  return <div className="weight-plot"><svg viewBox="0 0 570 205" role="img" aria-label={rows.length ? `Body weight: ${rows.map(w => `${dateLabel(w.date)}, ${number(w.weight_kg)} kg`).join('; ')}` : loading ? 'Loading dated weight measurements' : 'No dated weight measurements in the selected range'}><title>Dated body-weight measurements. The undated reference is excluded.</title>{[0,1,2,3,4].map(i => <g key={i}><line x1="35" x2="550" y1={20 + i * 37} y2={20 + i * 37}/><text x="3" y={24 + i * 37}>{number(max - i * (max - min) / 4)}</text></g>)}{Array.from({length:ticks},(_,i) => {const offset = Math.round(i / (ticks - 1) * (range - 1));const d = shiftDate(from, offset);const x = 35 + offset / (range - 1) * 515;return <g key={d}><line x1={x} x2={x} y1="20" y2="168"/><text x={x} y="191" textAnchor="middle">{range === 7 ? new Intl.DateTimeFormat('en-GB', {weekday:'short', timeZone:'Asia/Kolkata'}).format(new Date(`${d}T12:00:00Z`)) : new Intl.DateTimeFormat('en-GB', {day:'numeric', month:'short', timeZone:'Asia/Kolkata'}).format(new Date(`${d}T12:00:00Z`))}</text></g>;})}<path className="weight-axis" d="M35 20V168H550"/>{points.slice(1).map((p,i) => <line key={p.w.id} className="weight-measurement-line" x1={points[i].x} x2={p.x} y1={points[i].y} y2={p.y} style={{strokeDasharray:daysApart(points[i].w.date,p.w.date)>1 ? '4 4' : 'none'}}/>)}{points.map(p => <circle key={p.w.id} cx={p.x} cy={p.y} r="4" className="weight-measurement-dot"><title>{dateLabel(p.w.date)}: {number(p.w.weight_kg)} kg</title></circle>)}</svg>{!rows.length && <div className="weight-plot-empty" role="status"><Scale size={30}/><strong>{loading ? 'Loading your weigh-ins…' : hasHistory ? 'No readings in this range.' : 'Your first weigh-in starts the trend.'}</strong><p>{hasHistory ? 'Try a wider range or log a new dated reading in ChatGPT.' : 'Tell ChatGPT your weight and measurement date.'}</p></div>}</div>;
}
