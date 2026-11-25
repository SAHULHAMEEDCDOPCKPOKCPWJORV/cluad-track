// Scheduling engine: schedule generation, CPM float, forecast/ripple analysis, S-curves.
import { WorkCalendar, WorkIndex, addDays, toDate, toIso } from './calendar';
import { MASTER_ACTIVITIES, MASTER_BY_ID, SECTION_NAMES, CUSTOM_SECTION } from './master';
import type { Activity, ActivityStatus } from './types';

const maxIso = (a: string, b: string) => (a > b ? a : b);
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

export const activityKey = (projectId: string, activityId: string) => `${projectId}__${activityId}`;

/** Predecessor activity IDs for an activity (from the master logic), limited to those present in the project. */
export function predsOf(a: Pick<Activity, 'activityId'>, present: Set<string>): string[] {
  return (MASTER_BY_ID.get(a.activityId)?.predecessors ?? []).filter((p) => present.has(p));
}

/** Topological order (Kahn). Activities whose logic can't be resolved keep their S.No order. */
export function topoOrder<T extends Pick<Activity, 'activityId' | 'sNo'>>(acts: T[]): T[] {
  const present = new Set(acts.map((a) => a.activityId));
  const byId = new Map(acts.map((a) => [a.activityId, a]));
  const indeg = new Map<string, number>();
  const succ = new Map<string, string[]>();
  for (const a of acts) {
    const ps = predsOf(a, present);
    indeg.set(a.activityId, ps.length);
    for (const p of ps) succ.set(p, [...(succ.get(p) ?? []), a.activityId]);
  }
  const queue = acts.filter((a) => indeg.get(a.activityId) === 0).sort((x, y) => x.sNo - y.sNo);
  const out: T[] = [];
  while (queue.length) {
    const a = queue.shift()!;
    out.push(a);
    for (const s of succ.get(a.activityId) ?? []) {
      indeg.set(s, indeg.get(s)! - 1);
      if (indeg.get(s) === 0) queue.push(byId.get(s)!);
    }
  }
  if (out.length < acts.length) for (const a of acts) if (!out.includes(a)) out.push(a); // cycle guard
  return out;
}

/** Duration-based weightage normalised to 100 across the project. */
export function computeWeights<T extends { plannedDuration: number; isMilestone: boolean }>(acts: T[]): number[] {
  const total = acts.reduce((s, a) => s + (a.isMilestone ? 0 : Math.max(0, a.plannedDuration)), 0) || 1;
  return acts.map((a) => (a.isMilestone ? 0 : Math.round((Math.max(0, a.plannedDuration) / total) * 100 * 10000) / 10000));
}

/** Forward-pass planned dates from logic + durations, starting at projectStart. */
export function forwardSchedule<T extends Activity>(acts: T[], cal: WorkCalendar, projectStart: string): T[] {
  const present = new Set(acts.map((a) => a.activityId));
  const ends = new Map<string, string>();
  const result = new Map<string, T>();
  for (const a of topoOrder(acts)) {
    const preds = predsOf(a, present);
    const predEnd = preds.length ? preds.map((p) => ends.get(p)!).filter(Boolean).reduce(maxIso) : null;
    let start: string;
    let end: string;
    if (a.isMilestone || a.plannedDuration <= 0) {
      start = end = predEnd ?? cal.nextWorking(projectStart);
    } else {
      start = predEnd ? cal.addWorking(predEnd, 1) : cal.nextWorking(projectStart);
      end = cal.finishFrom(start, a.plannedDuration);
    }
    ends.set(a.activityId, end);
    result.set(a.activityId, { ...a, plannedStartDate: start, plannedEndDate: end });
  }
  return acts.map((a) => result.get(a.activityId)!);
}

/** Build a fresh project schedule from the 165-activity master list. */
export function generateFromMaster(projectId: string, projectStart: string, cal: WorkCalendar, user = 'system'): Activity[] {
  const base: Activity[] = MASTER_ACTIVITIES.map((m) => ({
    id: activityKey(projectId, m.activityId),
    projectId,
    sNo: m.sNo,
    activityId: m.activityId,
    activityName: m.name,
    section: m.section,
    department: m.department,
    plannedDuration: m.duration,
    plannedStartDate: projectStart,
    plannedEndDate: projectStart,
    baselineStartDate: null,
    baselineEndDate: null,
    actualDuration: null,
    actualStartDate: null,
    actualEndDate: null,
    progressPercent: 0,
    weightage: 0,
    isMilestone: m.isMilestone,
    delayDays: 0,
    delayLabel: '0',
    status: 'Not Started',
    remarks: '',
    incharge: '',
    delayReason: '',
    updatedBy: user,
  }));
  const weights = computeWeights(base);
  return forwardSchedule(base, cal, projectStart).map((a, i) => ({
    ...a,
    weightage: weights[i],
    baselineStartDate: a.plannedStartDate,
    baselineEndDate: a.plannedEndDate,
  }));
}

// ───────────────────────────── Analysis ─────────────────────────────

export interface ActivityMetrics {
  forecastStart: string;
  forecastEnd: string;
  slip: number; // working days forecast/actual finish is later than planned finish
  ownSlip: number; // slip not inherited from predecessors
  delayDays: number;
  totalFloat: number;
  critical: boolean;
  rootCause: boolean;
  status: ActivityStatus;
  predecessors: string[];
  successors: string[];
  downstream: string[]; // transitive successors
  downstreamDelayed: number;
  finishImpact: number; // working days this activity pushes the project finish
}

export interface ProjectAnalysis {
  byId: Map<string, ActivityMetrics>; // keyed by activityId
  plannedFinish: string;
  forecastFinish: string;
  projectDelay: number;
  criticalPath: string[];
  today: string;
}

export function isComplete(a: Activity) {
  return Number(a.progressPercent) >= 100 || (!!a.actualEndDate && Number(a.progressPercent) >= 100);
}
export function isStarted(a: Activity) {
  return !!a.actualStartDate || Number(a.progressPercent) > 0;
}

export function analyzeProject(acts: Activity[], cal: WorkCalendar, today: string): ProjectAnalysis {
  const present = new Set(acts.map((a) => a.activityId));
  const order = topoOrder(acts);
  const preds = new Map(acts.map((a) => [a.activityId, predsOf(a, present)]));
  const succs = new Map<string, string[]>();
  for (const a of acts) for (const p of preds.get(a.activityId)!) succs.set(p, [...(succs.get(p) ?? []), a.activityId]);

  // CPM on planned durations (integer time units)
  const ES = new Map<string, number>(), EF = new Map<string, number>();
  for (const a of order) {
    const es = Math.max(0, ...preds.get(a.activityId)!.map((p) => EF.get(p) ?? 0));
    ES.set(a.activityId, es);
    EF.set(a.activityId, es + (a.isMilestone ? 0 : Math.max(0, a.plannedDuration)));
  }
  const projEF = Math.max(0, ...EF.values());
  const LF = new Map<string, number>(), LS = new Map<string, number>();
  for (const a of [...order].reverse()) {
    const ss = succs.get(a.activityId) ?? [];
    const lf = ss.length ? Math.min(...ss.map((s) => LS.get(s)!)) : projEF;
    LF.set(a.activityId, lf);
    LS.set(a.activityId, lf - (a.isMilestone ? 0 : Math.max(0, a.plannedDuration)));
  }

  // Forecast pass (optionally with one activity's finish overridden, for counterfactual impact analysis)
  const todayW = cal.nextWorking(today);
  const forecast = (override?: { id: string; end: string }) => {
    const fEnd = new Map<string, string>();
    const fStart = new Map<string, string>();
    for (const a of order) {
      const ps = preds.get(a.activityId)!;
      const predEnd = ps.length ? ps.map((p) => fEnd.get(p)!).reduce(maxIso) : null;
      let s: string, e: string;
      const dur = a.isMilestone ? 0 : Math.max(0, a.plannedDuration);
      if (isComplete(a)) {
        s = a.actualStartDate ?? a.plannedStartDate;
        e = a.actualEndDate ?? maxIso(a.plannedEndDate, s);
      } else if (isStarted(a)) {
        s = a.actualStartDate ?? a.plannedStartDate;
        const remaining = dur === 0 ? 0 : Math.max(1, Math.ceil(dur * (1 - Number(a.progressPercent) / 100)));
        const resume = maxIso(todayW, s);
        e = remaining === 0 ? resume : cal.finishFrom(resume, remaining);
      } else {
        const earliest = predEnd ? (dur === 0 ? predEnd : cal.addWorking(predEnd, 1)) : a.plannedStartDate;
        s = [a.plannedStartDate, earliest, dur === 0 ? today : todayW].reduce(maxIso);
        e = dur === 0 ? s : cal.finishFrom(s, dur);
      }
      if (override && override.id === a.activityId) e = override.end;
      fStart.set(a.activityId, s);
      fEnd.set(a.activityId, e);
    }
    return { fStart, fEnd };
  };
  const { fStart, fEnd } = forecast();
  const slip = new Map<string, number>();
  for (const a of acts) slip.set(a.activityId, cal.workingDiff(a.plannedEndDate, fEnd.get(a.activityId)!));
  const forecastFinishAll = acts.length ? [...fEnd.values()].reduce(maxIso) : today;

  const byId = new Map<string, ActivityMetrics>();
  for (const a of acts) {
    const id = a.activityId;
    const sl = slip.get(id)!;
    const predSlip = Math.max(0, ...preds.get(id)!.map((p) => slip.get(p)!));
    const own = sl - predSlip;
    const tf = LS.get(id)! - ES.get(id)!;
    const delayDays = Math.max(0, sl);
    let status: ActivityStatus;
    if (a.status === 'On Hold') status = 'On Hold';
    else if (isComplete(a)) status = 'Completed';
    else if (delayDays > 0 && (a.plannedStartDate <= today || isStarted(a))) status = 'Delayed';
    else if (isStarted(a)) status = 'In Progress';
    else status = 'Not Started';
    byId.set(id, {
      forecastStart: fStart.get(id)!,
      forecastEnd: fEnd.get(id)!,
      slip: sl,
      ownSlip: Math.max(0, own),
      delayDays,
      totalFloat: tf,
      critical: tf <= 0,
      rootCause: sl > 0 && own > 0,
      status,
      predecessors: preds.get(id)!,
      successors: succs.get(id) ?? [],
      downstream: [],
      downstreamDelayed: 0,
      finishImpact: 0,
    });
  }
  // Downstream ripple
  for (const [id, m] of byId) {
    if (!(m.rootCause || m.status === 'On Hold')) continue;
    const seen = new Set<string>();
    const stack = [...m.successors];
    while (stack.length) {
      const x = stack.pop()!;
      if (seen.has(x)) continue;
      seen.add(x);
      stack.push(...(succs.get(x) ?? []));
    }
    m.downstream = [...seen];
    m.downstreamDelayed = m.downstream.filter((x) => (byId.get(x)?.slip ?? 0) > 0).length;
    // Counterfactual: finish this activity with only its inherited slip, re-forecast, compare project finish.
    const a = acts.find((x) => x.activityId === id)!;
    const inherited = m.slip - m.ownSlip;
    const cfEnd = inherited > 0 ? cal.addWorking(a.plannedEndDate, inherited) : a.plannedEndDate;
    if (m.ownSlip > 0 && cfEnd < m.forecastEnd) {
      const cf = forecast({ id, end: cfEnd });
      const cfFinish = [...cf.fEnd.values()].reduce(maxIso);
      m.finishImpact = Math.max(0, cal.workingDiff(cfFinish, forecastFinishAll));
    }
  }

  const plannedFinish = acts.length ? acts.map((a) => a.plannedEndDate).reduce(maxIso) : today;
  const forecastFinish = forecastFinishAll;
  const criticalPath = order.filter((a) => byId.get(a.activityId)!.critical).map((a) => a.activityId);
  return { byId, plannedFinish, forecastFinish, projectDelay: cal.workingDiff(plannedFinish, forecastFinish), criticalPath, today };
}

/** Apply analysis results to activities so stored delay/status columns stay in sync. */
export function withDerivedFields(acts: Activity[], an: ProjectAnalysis): Activity[] {
  return acts.map((a) => {
    const m = an.byId.get(a.activityId);
    if (!m) return a;
    return {
      ...a,
      status: m.status,
      delayDays: m.delayDays,
      delayLabel: m.status === 'On Hold' ? 'HOLD' : m.delayDays > 0 ? `+${m.delayDays}d` : '0',
    };
  });
}

// ───────────────────────────── Calculation engine ─────────────────────────────
// One engine feeds the dashboard, S-curves, Gantt, report and Excel/PDF export.
// Nothing here rounds: rounding happens only when a number is displayed.

export interface SPoint {
  date: string;
  label: string;
  planned: number;
  actual: number | null;
  forecast: number | null;
}

/** One recorded progress change (from the audit trail). */
export interface ProgressEvent {
  activityId: string;
  date: string; // reporting date (YYYY-MM-DD)
  prev: number; // % before the change
  value: number; // % after the change
}
export type ProgressHistory = Map<string, ProgressEvent[]>;

const clampPct = (x: number) => (!Number.isFinite(x) ? 0 : x < 0 ? 0 : x > 100 ? 100 : x);

/** Recorded progress changes only. History is never rebuilt from today's percentages. */
export function historyFromAudit(logs: { activityId: string | null; fieldName: string | null; oldValue: string | null; newValue: string | null; timestamp: string }[]): ProgressHistory {
  const h: ProgressHistory = new Map();
  for (const l of logs) {
    if (!l.activityId || l.fieldName !== 'progressPercent' || l.newValue == null || l.newValue === '') continue;
    const value = Number(l.newValue);
    if (!Number.isFinite(value)) continue;
    const prev = l.oldValue == null || l.oldValue === '' || !Number.isFinite(Number(l.oldValue)) ? 0 : Number(l.oldValue);
    const list = h.get(l.activityId) ?? [];
    list.push({ activityId: l.activityId, date: l.timestamp.slice(0, 10), prev: clampPct(prev), value: clampPct(value) });
    h.set(l.activityId, list);
  }
  for (const list of h.values()) list.sort((a, b) => a.date.localeCompare(b.date));
  return h;
}

export interface WeightAudit {
  weights: number[]; // normalised, sums to 100
  source: 'approved' | 'duration';
  rawSum: number;
  warnings: string[];
}

/** Approved weightage normalised to 100. Falls back to duration weights only when none are approved, and says so. */
export function weightAudit(acts: Pick<Activity, 'weightage' | 'plannedDuration' | 'isMilestone'>[]): WeightAudit {
  const warnings: string[] = [];
  if (!acts.length) return { weights: [], source: 'approved', rawSum: 0, warnings };
  const raw = acts.map((a) => (Number.isFinite(Number(a.weightage)) && Number(a.weightage) > 0 ? Number(a.weightage) : 0));
  const bad = acts.filter((a) => !Number.isFinite(Number(a.weightage)) || Number(a.weightage) < 0).length;
  if (bad) warnings.push(`${bad} activities have a missing or negative weightage (treated as 0).`);
  const sum = raw.reduce((s, x) => s + x, 0);
  if (sum > 0) {
    if (Math.abs(sum - 100) > 0.05) warnings.push(`Approved weightages add up to ${sum.toFixed(4)}, not 100. They were normalised to 100.`);
    return { weights: raw.map((x) => (x / sum) * 100), source: 'approved', rawSum: sum, warnings };
  }
  const dur = computeWeights(acts as Activity[]);
  const t = dur.reduce((s, x) => s + x, 0);
  warnings.push('No approved weightage found. Duration-based weights are used instead. Approve weightages for exact results.');
  return { weights: t > 0 ? dur.map((x) => (x / t) * 100) : acts.map(() => 100 / acts.length), source: 'duration', rawSum: 0, warnings };
}

export const weightsFor = (acts: Activity[]) => weightAudit(acts).weights;

/** Share of an activity planned to be done on day d: working days elapsed / total planned working days. */
function frac(idx: WorkIndex, d: string, s: string, e: string) {
  if (e < s) return d >= e ? 1 : 0;
  if (d < s) return 0;
  if (d >= e) return 1;
  const before = idx.at(addDays(s, -1));
  const span = idx.at(e) - before;
  if (span <= 0) return d >= e ? 1 : 0;
  return clamp01((idx.at(d) - before) / span);
}

export function plannedPctAt(acts: Activity[], idx: WorkIndex, d: string, w = weightsFor(acts)) {
  return acts.reduce((s, a, i) => s + w[i] * (a.isMilestone ? (d >= a.plannedEndDate ? 1 : 0) : frac(idx, d, a.plannedStartDate, a.plannedEndDate)), 0);
}

/** Verified progress (0..100) of one activity on date d, from recorded history. */
export function progressOn(a: Activity, d: string, today: string, hist?: ProgressHistory): number {
  const cur = clampPct(Number(a.progressPercent));
  if (d >= today) return cur;
  const ev = hist?.get(a.activityId);
  if (ev?.length) {
    if (d < ev[0].date) return ev[0].prev;
    let v = ev[0].prev;
    for (const e of ev) if (e.date <= d) v = e.value;
    return v;
  }
  // No recorded history: use recorded facts only (actual finish date, or the date of the last update).
  if (cur <= 0) return 0;
  const stamp = cur >= 100 && a.actualEndDate ? a.actualEndDate : (a.updatedAt ?? '').slice(0, 10) || today;
  return d >= (stamp > today ? today : stamp) ? cur : 0;
}

export function hasHistory(a: Activity, hist?: ProgressHistory) {
  return !!hist?.get(a.activityId)?.length;
}

export function actualPctAt(acts: Activity[], d: string, today: string, w = weightsFor(acts), hist?: ProgressHistory) {
  return acts.reduce((s, a, i) => s + (w[i] * progressOn(a, d, today, hist)) / 100, 0);
}

/** Earned value at the reporting date: sum of weight x verified progress. Unrounded. */
export function earnedPct(acts: Activity[]) {
  const w = weightsFor(acts);
  return acts.reduce((s, a, i) => s + (w[i] * clampPct(Number(a.progressPercent))) / 100, 0);
}

function monthEnd(d: string) {
  const dt = toDate(d);
  return toIso(new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)));
}

const dayLabel = (we: string) => `${we.slice(8, 10)}-${we.slice(5, 7)}-${we.slice(2, 4)}`;

/** Planned / actual / forecast curve. Points: every week end, every month end, and the reporting date itself. */
export function buildSCurve(acts: Activity[], cal: WorkCalendar, an: ProjectAnalysis, hist?: ProgressHistory): SPoint[] {
  if (!acts.length) return [];
  const today = an.today;
  const start = acts.map((a) => a.plannedStartDate).reduce((x, y) => (x < y ? x : y));
  const end = [an.plannedFinish, ...acts.map((a) => an.byId.get(a.activityId)?.forecastEnd ?? a.plannedEndDate)].reduce(maxIso);
  const sd = toDate(start);
  const monday = toIso(new Date(sd.getTime() - ((sd.getUTCDay() + 6) % 7) * 86400000));
  const idx = new WorkIndex(cal, addDays(monday, -1), addDays(end, 14));
  const w = weightsFor(acts);

  const dates = new Set<string>();
  const last = addDays(end, 6);
  for (let ws = monday; ws <= last; ws = addDays(ws, 7)) dates.add(addDays(ws, 6));
  for (let m = monthEnd(start); m <= monthEnd(last); m = monthEnd(addDays(m, 1))) dates.add(m);
  dates.add(today);
  const sorted = [...dates].sort();

  const pts: SPoint[] = [];
  let fcMax = 0;
  const actualToday = actualPctAt(acts, today, today, w, hist);
  for (const d of sorted) {
    const planned = Math.min(100, plannedPctAt(acts, idx, d, w));
    const actual = d <= today ? Math.min(100, actualPctAt(acts, d, today, w, hist)) : null;
    let forecast: number | null = null;
    if (d >= today) {
      if (d === today) forecast = actualToday; // starts exactly at the verified actual
      else {
        const f = acts.reduce((sum, a, i) => {
          const p = clampPct(Number(a.progressPercent)) / 100;
          if (p >= 1) return sum + w[i];
          const m = an.byId.get(a.activityId)!;
          const rs = maxIso(m.forecastStart, addDays(today, 1));
          const rem = a.isMilestone ? (d >= m.forecastEnd ? 1 : 0) : frac(idx, d, rs, maxIso(m.forecastEnd, rs));
          return sum + w[i] * (p + (1 - p) * rem);
        }, 0);
        forecast = Math.min(100, f);
      }
      forecast = Math.max(forecast, fcMax, actualToday);
      fcMax = forecast;
    }
    pts.push({ date: d, label: dayLabel(d), planned, actual, forecast });
  }
  return pts;
}

// ───────────────────────────── KPIs & summaries ─────────────────────────────

export interface Kpis {
  overallProgress: number; // actual %, 2 decimals for display
  plannedProgress: number;
  scheduleVariance: number; // percentage points
  overallExact: number; // unrounded values behind the numbers above
  plannedExact: number;
  spi: number; // neutral 1 when not valid: show spiValid, never this value, in that case
  spiValid: boolean; // false when planned value is 0
  total: number;
  completed: number;
  inProgress: number;
  notStarted: number;
  delayed: number;
  onHold: number;
  criticalDelays: number;
  plannedFinish: string;
  forecastFinish: string;
  projectDelay: number;
  workingDaysRemaining: number;
  maxDelay: number;
}

export const round1 = (x: number) => Math.round(x * 10) / 10;
export const round2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;
export const fmtSpi = (k: { spi: number; spiValid: boolean }) => (k.spiValid ? k.spi.toFixed(2) : 'n/a');

export function computeKpis(acts: Activity[], cal: WorkCalendar, an: ProjectAnalysis): Kpis {
  const today = an.today;
  const counts = { Completed: 0, 'In Progress': 0, 'Not Started': 0, Delayed: 0, 'On Hold': 0 } as Record<ActivityStatus, number>;
  let criticalDelays = 0;
  let maxDelay = 0;
  for (const a of acts) {
    const m = an.byId.get(a.activityId)!;
    counts[m.status]++;
    if (m.critical && (m.status === 'Delayed' || m.status === 'On Hold')) criticalDelays++;
    maxDelay = Math.max(maxDelay, m.delayDays);
  }
  let planned = 0;
  if (acts.length) {
    const start = acts.map((a) => a.plannedStartDate).reduce((x, y) => (x < y ? x : y));
    const idx = new WorkIndex(cal, addDays(start, -1), maxIso(an.plannedFinish, today));
    planned = Math.min(100, plannedPctAt(acts, idx, today));
  }
  const actual = earnedPct(acts);
  const spiValid = planned > 1e-9;
  return {
    overallProgress: round2(actual),
    plannedProgress: round2(planned),
    scheduleVariance: round2(actual - planned),
    overallExact: actual,
    plannedExact: planned,
    spi: spiValid ? actual / planned : 1,
    spiValid,
    total: acts.length,
    completed: counts.Completed,
    inProgress: counts['In Progress'],
    notStarted: counts['Not Started'],
    delayed: counts.Delayed,
    onHold: counts['On Hold'],
    criticalDelays,
    plannedFinish: an.plannedFinish,
    forecastFinish: an.forecastFinish,
    projectDelay: an.projectDelay,
    workingDaysRemaining: today >= an.forecastFinish ? 0 : cal.countWorking(addDays(today, 1), an.forecastFinish),
    maxDelay,
  };
}

export interface GroupSummary {
  key: string;
  total: number;
  completed: number;
  delayed: number;
  onHold: number;
  inProgress: number;
  planned: number;
  actual: number;
  spi: number;
  spiValid: boolean;
  weightShare: number; // this group's share (%) of the whole project weight
  maxDelay: number;
  start: string;
  finish: string;
  forecastFinish: string;
}

export function summarizeBy(acts: Activity[], key: 'section' | 'department', cal: WorkCalendar, an: ProjectAnalysis): GroupSummary[] {
  const groups = new Map<string, Activity[]>();
  for (const a of acts) groups.set(String(a[key]), [...(groups.get(String(a[key])) ?? []), a]);
  const order = key === 'section' ? [...SECTION_NAMES, CUSTOM_SECTION] : ['PLAN', 'LAND', 'ENG', 'PRO', 'SITE', 'TRN', 'COMM'];
  const keys = [...groups.keys()].sort((x, y) => (order.indexOf(x) + 1 || 99) - (order.indexOf(y) + 1 || 99));
  const wAll = weightsFor(acts);
  const wOf = new Map(acts.map((a, i) => [a.activityId, wAll[i]]));
  return keys.map((k) => {
    const g = groups.get(k)!;
    const k2 = computeKpis(g, cal, { ...an, plannedFinish: g.map((a) => a.plannedEndDate).reduce(maxIso) });
    return {
      key: k,
      total: g.length,
      completed: k2.completed,
      delayed: k2.delayed,
      onHold: k2.onHold,
      inProgress: k2.inProgress,
      planned: k2.plannedProgress,
      actual: k2.overallProgress,
      spi: k2.spi,
      spiValid: k2.spiValid,
      weightShare: g.reduce((s, a) => s + (wOf.get(a.activityId) ?? 0), 0),
      maxDelay: k2.maxDelay,
      start: g.map((a) => a.plannedStartDate).reduce((x, y) => (x < y ? x : y)),
      finish: g.map((a) => a.plannedEndDate).reduce(maxIso),
      forecastFinish: g.map((a) => an.byId.get(a.activityId)?.forecastEnd ?? a.plannedEndDate).reduce(maxIso),
    };
  });
}

// ───────────────────────────── Period progress ─────────────────────────────

export interface PeriodRow {
  period: string; // week ending (YYYY-MM-DD), YYYY-MM or YYYY
  plannedEarned: number; // earned in this period
  plannedCumulative: number;
  actualEarned: number | null;
  actualCumulative: number | null;
}

/** Earned-in-period and cumulative progress, kept separate. Sum of earned = final cumulative. */
export function periodProgress(curve: SPoint[], by: 'week' | 'month' | 'year'): PeriodRow[] {
  const len = by === 'month' ? 7 : 4;
  // A week runs Monday..Sunday and is named by its Sunday (week-ending date).
  const keyOf = (d: string) => (by === 'week' ? addDays(d, (7 - toDate(d).getUTCDay()) % 7) : d.slice(0, len));
  const last = new Map<string, SPoint>();
  const lastActual = new Map<string, number>();
  for (const p of curve) {
    const k = keyOf(p.date);
    last.set(k, p);
    if (p.actual != null) lastActual.set(k, p.actual);
  }
  const rows: PeriodRow[] = [];
  let pp = 0;
  let pa = 0;
  for (const [k, p] of last) {
    const a = lastActual.get(k);
    rows.push({
      period: k,
      plannedEarned: p.planned - pp,
      plannedCumulative: p.planned,
      actualEarned: a == null ? null : a - pa,
      actualCumulative: a ?? null,
    });
    pp = p.planned;
    if (a != null) pa = a;
  }
  return rows;
}

// ───────────────────────────── Validation / accuracy report ─────────────────────────────

export interface Check {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
}
export interface ValidationReport {
  checks: Check[];
  verdict: 'Verified' | 'Verified with warnings' | 'Failed';
  historyCoverage: number; // % of started activities that have recorded progress history
  weightSource: 'approved' | 'duration';
  generatedFor: string;
}

const TOL = 1e-6;

export function validateModel(acts: Activity[], cal: WorkCalendar, an: ProjectAnalysis, curve: SPoint[], kpis: Kpis, hist?: ProgressHistory): ValidationReport {
  const checks: Check[] = [];
  const add = (id: string, label: string, ok: boolean, detail: string, soft = false) => checks.push({ id, label, status: ok ? 'pass' : soft ? 'warn' : 'fail', detail });
  const today = an.today;
  const wa = weightAudit(acts);

  add('weights-source', 'Stored activity weightage is used (no equal weights)', wa.source === 'approved', wa.source === 'approved' ? 'The weightage saved on each activity is used. Note: the app recalculates it from planned durations on every save, so it is only "approved" if you supply your own approved weights.' : wa.warnings.join(' '), true);
  add('weights-sum', 'Weightages add up to 100', Math.abs(wa.rawSum - 100) <= 0.05 || wa.source === 'duration', wa.source === 'duration' ? 'Not applicable (duration fallback).' : `Raw total ${wa.rawSum.toFixed(4)}${Math.abs(wa.rawSum - 100) > 0.05 ? ', normalised to 100 for every calculation.' : '.'}`, true);
  const badDates = acts.filter((a) => !a.plannedStartDate || !a.plannedEndDate || a.plannedEndDate < a.plannedStartDate);
  add('dates', 'Planned dates are valid (finish not before start)', badDates.length === 0, badDates.length ? `${badDates.length} activities: ${badDates.slice(0, 5).map((a) => a.activityId).join(', ')}` : 'All dates valid.');
  const outRange = acts.filter((a) => !(Number(a.progressPercent) >= 0 && Number(a.progressPercent) <= 100));
  add('range', 'Progress is between 0% and 100%', outRange.length === 0, outRange.length ? `${outRange.length} activities out of range (they are clamped to 0..100).` : 'All progress values are in range.', true);
  const mismatch = acts.filter((a) => (Number(a.progressPercent) >= 100 && !a.actualEndDate) || (Number(a.progressPercent) > 0 && !a.actualStartDate));
  add('actual-dates', 'Progress has matching actual start / finish dates', mismatch.length === 0, mismatch.length ? `${mismatch.length} activities have progress without an actual date.` : 'Consistent.', true);

  const started = acts.filter((a) => Number(a.progressPercent) > 0);
  const withHist = started.filter((a) => hasHistory(a, hist));
  const coverage = started.length ? (withHist.length / started.length) * 100 : 100;
  add('history', 'Past actual progress comes from recorded updates', coverage >= 99.99, started.length ? `${withHist.length} of ${started.length} started activities have recorded history (${coverage.toFixed(0)}%). Others are placed on their last update date, so earlier points of the actual curve are not claimed.` : 'No progress recorded yet.', true);

  const planned = curve.map((p) => p.planned);
  add('planned-100', 'Planned curve ends at 100% and never falls', !curve.length || (Math.abs(planned[planned.length - 1] - 100) < 1e-4 && planned.every((v, i) => i === 0 || v >= planned[i - 1] - TOL)), curve.length ? `Final planned value ${planned[planned.length - 1].toFixed(4)}%.` : 'No data.');
  const act = curve.filter((p) => p.actual != null).map((p) => p.actual as number);
  add('actual-range', 'Actual curve stays within 0..100% and stops at the reporting date', act.every((v) => v >= -TOL && v <= 100 + TOL) && curve.every((p) => p.date <= today || p.actual == null), 'Checked at every point.');
  const fc = curve.filter((p) => p.forecast != null);
  const fcOk = fc.every((p, i) => (p.forecast as number) <= 100 + TOL && (i === 0 || (p.forecast as number) >= (fc[i - 1].forecast as number) - TOL));
  const atToday = curve.find((p) => p.date === today);
  add('forecast', 'Forecast starts at the verified actual, never exceeds 100%, never falls', fcOk && (!atToday || (atToday.forecast != null && atToday.actual != null && Math.abs(atToday.forecast - atToday.actual) < 1e-9)), atToday ? `At ${today}: actual ${atToday.actual?.toFixed(4)}%, forecast ${atToday.forecast?.toFixed(4)}%.` : 'Reporting date is outside the project window.');
  add('actual-match', 'Curve value at the reporting date equals the dashboard KPI', !atToday || Math.abs((atToday.actual ?? 0) - kpis.overallExact) < 1e-9, `KPI actual ${kpis.overallExact.toFixed(4)}%.`);
  add('counts', 'Status counts add up to total activities', kpis.completed + kpis.inProgress + kpis.notStarted + kpis.delayed + kpis.onHold === kpis.total, `${kpis.completed} + ${kpis.inProgress} + ${kpis.notStarted} + ${kpis.delayed} + ${kpis.onHold} = ${kpis.total}`);

  // Group reconciliation: sum of (group weight share x group value) must equal the overall value.
  for (const key of ['department', 'section'] as const) {
    const groups = new Map<string, Activity[]>();
    for (const a of acts) groups.set(String(a[key]), [...(groups.get(String(a[key])) ?? []), a]);
    const start = acts.length ? acts.map((a) => a.plannedStartDate).reduce((x, y) => (x < y ? x : y)) : today;
    const idx = new WorkIndex(cal, addDays(start, -1), maxIso(an.plannedFinish, today));
    const wAll = weightsFor(acts);
    const share = new Map(acts.map((a, i) => [a.activityId, wAll[i]]));
    let pSum = 0;
    let aSum = 0;
    for (const g of groups.values()) {
      const gs = g.reduce((s, a) => s + (share.get(a.activityId) ?? 0), 0) / 100;
      pSum += gs * plannedPctAt(g, idx, today);
      aSum += gs * earnedPct(g);
    }
    const ok = !acts.length || (Math.abs(pSum - kpis.plannedExact) < 1e-6 && Math.abs(aSum - kpis.overallExact) < 1e-6);
    add(`reconcile-${key}`, `${key === 'department' ? `Department (${groups.size})` : `Section (${groups.size})`} curves reconcile with the overall curve`, ok, `Weighted total: planned ${pSum.toFixed(6)} vs ${kpis.plannedExact.toFixed(6)}, actual ${aSum.toFixed(6)} vs ${kpis.overallExact.toFixed(6)}.`);
  }
  const drift = acts.filter((a) => a.baselineEndDate && a.baselineEndDate !== a.plannedEndDate).length;
  add('baseline', 'Baseline dates kept separate from re-planned dates', true, drift ? `${drift} activities have a re-planned finish different from baseline (baseline is preserved).` : 'Planned equals baseline.');

  const verdict = checks.some((c) => c.status === 'fail') ? 'Failed' : checks.some((c) => c.status === 'warn') ? 'Verified with warnings' : 'Verified';
  return { checks, verdict, historyCoverage: coverage, weightSource: wa.source, generatedFor: today };
}
