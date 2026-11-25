// Activity-incharge performance: how much of the work due by today each person has actually delivered.
import type { Activity } from './types';
import type { WorkCalendar } from './calendar';
import type { ProjectAnalysis } from './schedule';

export const UNASSIGNED = 'Unassigned';

/** Planned % complete of one activity at the data date (linear over working days). */
export function plannedPctAt(a: Activity, cal: WorkCalendar, today: string): number {
  if (today < a.plannedStartDate) return 0;
  if (today >= a.plannedEndDate || a.isMilestone || a.plannedDuration <= 0) return today >= a.plannedEndDate ? 100 : 0;
  return Math.min(100, (cal.countWorking(a.plannedStartDate, today) / a.plannedDuration) * 100);
}

/**
 * Incharge performance % of one activity: a manual value when entered,
 * otherwise 100% when the activity is completed and 0% when it is not.
 */
export function activityPerformance(a: Activity, _cal?: WorkCalendar, _today?: string): number | null {
  if (a.inchargePerf != null && Number.isFinite(Number(a.inchargePerf))) return Number(a.inchargePerf);
  return a.progressPercent >= 100 ? 100 : 0;
}

export interface StaffStat {
  name: string;
  total: number;
  completed: number;
  onTime: number;
  inProgress: number;
  delayed: number;
  onHold: number;
  notDue: number;
  performance: number | null; // duration-weighted
  delayDays: number;
  avgDelay: number;
  missingReasons: number;
  reasons: { reason: string; count: number }[];
  sections: string[];
  band: 'High' | 'Good' | 'Average' | 'Low' | 'No work due';
  why: string[];
  rows: { activityId: string; name: string; perf: number | null; status: string; delay: number; reason: string; progress: number; due: number }[];
}

export const bandOf = (p: number | null): StaffStat['band'] => (p == null ? 'No work due' : p >= 90 ? 'High' : p >= 75 ? 'Good' : p >= 50 ? 'Average' : 'Low');
export const BAND_COLORS: Record<StaffStat['band'], string> = { High: '#10b981', Good: '#06b6d4', Average: '#10b981', Low: '#f43f5e', 'No work due': '#64748b' };

export function staffStats(acts: Activity[], cal: WorkCalendar, an: ProjectAnalysis): StaffStat[] {
  const today = an.today;
  const groups = new Map<string, Activity[]>();
  for (const a of acts) {
    const k = a.incharge?.trim() || UNASSIGNED;
    groups.set(k, [...(groups.get(k) ?? []), a]);
  }
  const out: StaffStat[] = [];
  for (const [name, list] of groups) {
    let wSum = 0, pSum = 0;
    const rows = list.map((a) => {
      const m = an.byId.get(a.activityId)!;
      const perf = activityPerformance(a, cal, today);
      if (perf != null) {
        const w = Math.max(1, a.plannedDuration);
        wSum += w;
        pSum += perf * w;
      }
      return { activityId: a.activityId, name: a.activityName, perf, status: m.status, delay: m.delayDays, reason: a.delayReason ?? '', progress: a.progressPercent, due: Math.round(plannedPctAt(a, cal, today)) };
    });
    const delayedRows = rows.filter((r) => r.status === 'Delayed');
    const completed = rows.filter((r) => r.status === 'Completed');
    const onTime = list.filter((a) => a.progressPercent >= 100 && (!a.actualEndDate || a.actualEndDate <= a.plannedEndDate)).length;
    const reasonMap = new Map<string, number>();
    for (const r of delayedRows) if (r.reason.trim()) reasonMap.set(r.reason.trim(), (reasonMap.get(r.reason.trim()) ?? 0) + 1);
    const reasons = [...reasonMap.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);
    const performance = wSum ? Math.round((pSum / wSum) * 10) / 10 : null;
    const delayDays = delayedRows.reduce((s, r) => s + r.delay, 0);
    const missingReasons = delayedRows.filter((r) => !r.reason.trim()).length;
    const st: StaffStat = {
      name, total: list.length, completed: completed.length, onTime, inProgress: rows.filter((r) => r.status === 'In Progress').length,
      delayed: delayedRows.length, onHold: rows.filter((r) => r.status === 'On Hold').length, notDue: rows.filter((r) => r.perf == null).length,
      performance, delayDays, avgDelay: delayedRows.length ? Math.round(delayDays / delayedRows.length) : 0, missingReasons, reasons,
      sections: [...new Set(list.map((a) => a.section))], band: bandOf(performance), why: [], rows,
    };
    st.why = explain(st);
    out.push(st);
  }
  return out.sort((a, b) => (b.performance ?? -1) - (a.performance ?? -1));
}

function explain(s: StaffStat): string[] {
  const w: string[] = [];
  if (s.performance == null) return [`None of the ${s.total} assigned activities are due yet.`];
  if (s.completed) w.push(`${s.completed} of ${s.total} activities completed${s.onTime ? `, ${s.onTime} on or ahead of time` : ''}.`);
  if (s.band === 'High' || s.band === 'Good') {
    if (!s.delayed) w.push('No activity is behind schedule.');
    else w.push(`Only ${s.delayed} delayed activit${s.delayed > 1 ? 'ies' : 'y'} (avg +${s.avgDelay} working days).`);
    if (s.inProgress) w.push(`${s.inProgress} activit${s.inProgress > 1 ? 'ies are' : 'y is'} progressing at or above the planned rate.`);
  } else {
    if (s.delayed) w.push(`${s.delayed} activit${s.delayed > 1 ? 'ies are' : 'y is'} delayed, adding ${s.delayDays} working days in total (avg +${s.avgDelay}).`);
    const behind = s.rows.filter((r) => r.perf != null && r.perf < 50 && r.status !== 'Completed').sort((a, b) => (a.perf ?? 0) - (b.perf ?? 0))[0];
    if (behind) w.push(`Furthest behind: "${behind.name}" is ${behind.progress}% done vs ${behind.due}% planned.`);
  }
  if (s.reasons.length) w.push(`Main delay reason: ${s.reasons[0].reason}${s.reasons[0].count > 1 ? ` (${s.reasons[0].count} activities)` : ''}.`);
  if (s.missingReasons) w.push(`${s.missingReasons} delayed activit${s.missingReasons > 1 ? 'ies have' : 'y has'} no delay reason entered.`);
  if (s.onHold) w.push(`${s.onHold} on hold.`);
  return w;
}
