'use client';
import type { ReactNode } from 'react';
import { BarChart3, Clock3, Dumbbell, House, Scale, UserRound } from 'lucide-react';
export type TrackerTab = 'nutrition' | 'weight' | 'training' | 'analytics' | 'history';
const sections = [{ key: 'nutrition', name: 'Daily', icon: House }, { key: 'weight', name: 'Weight', icon: Scale }, { key: 'training', name: 'Training', icon: Dumbbell }, { key: 'analytics', name: 'Insights', icon: BarChart3 }, { key: 'history', name: 'History', icon: Clock3 }] as const;

export function DailyHeader({ loading, connected, actions }: { loading: boolean; connected: boolean; actions: ReactNode }) {
  return <header className="daily-header"><a href="/" className="daily-brand" aria-label="Lean Muscle home"><img src="/icons/lean-loop-v3.svg" width="38" height="30" alt=""/><span>Lean Muscle</span></a><details className="daily-account"><summary aria-label="Tracker settings"><UserRound size={21}/></summary><div className="daily-account-menu"><strong>Your tracker</strong><p>{loading ? 'Refreshing saved records…' : connected ? 'Synced with ChatGPT' : 'Connecting…'}</p><div>{actions}</div></div></details></header>;
}

export function DailyNavigation({ selected, onTab }: { selected: TrackerTab; onTab: (tab: TrackerTab) => void }) {
  return <nav className="daily-navigation" aria-label="Tracker sections">{sections.map(section => <button key={section.key} className={section.key === selected ? 'selected' : ''} aria-current={section.key === selected ? 'page' : undefined} onClick={() => onTab(section.key)}><section.icon size={22}/><span>{section.name}</span></button>)}</nav>;
}
