// Time-phased S-curve engine for the overall project and for each section.
// Everything is computed from the activities passed in (one project, or one section of it):
// no activity or section counts are hard-coded anywhere.
import type { Activity } from './types';
import { addDays, toDate, toIso, type WorkCalendar } from './calendar';
import type { SPoint } from './schedule';

export interface ForecastHint {
  forecastStart?: string;
  forecastEnd?: string;
}

export interface SCurveOptions {
  /** Working calendar: Sundays and the project's holidays are non-working. */
  cal: Pick<WorkCalendar, 'isWorking'>;
  /** Reporting date (YYYY-MM-DD). Actual is only computed up to this date, forecast only from it. */
  today: string;
  /** Optional engine re-planned dates for unfinished activities (used when the sheet has no forecast finish). */
  hint?: (a: Activity) => ForecastHint | undefined;
}

export interface SCurveResult {
  points: SPoint[];
  /** Weight of each activity (0..1, same order as the input), summing to 1. */
  weights: number[];
  totalPlanDays: number;
  activityCount: number;
  /** max(planned end): planned reaches 100% here. */
  baselineTarget: string;
  /** Latest forecast / actual finish of the work. */
  forecastDate: string;
  plannedToday: number;
  actualToday: number;
  /** actual - planned at today, percentage points. */
  variance: number;
  /** actual / planned at today; null while nothing is planned yet. */
  spi: number | null;
  /** Data problems worth reviewing (inverted dates, completed work dated in the future, ...). */
  anomalies: string[];
}

const maxIso = (a: string, b: string) => (a > b ? a : b);
const minIso = (a: string, b: string) => (a < b ? a : b);
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const dayLabel = (d: string) => `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(2, 4)}`;

/** Cumulative working-day counter over a date range, so each lookup is O(1). */
class DayIndex {
  private cum = new Map<string, number>();
  private total = 0;
  private from: string;
  private to: string;
  constructor(cal: Pick<WorkCalendar, 'isWorking'>, from: string, to: string) {
    this.from = from;
    this.to = to;
    let n = 0;
    for (let d = from; d <= to; d = addDays(d, 1)) {
      if (cal.isWorking(d)) n++;
      this.cum.set(d, n);
    }
    this.total = n;
  }
  private at(d: string) {
    if (d < this.from) return 0;
    if (d > this.to) return this.total;
    return this.cum.get(d) ?? 0;
  }
  /** Working days from a to b, both inclusive (0 when b < a). */
  wd(a: string, b: string) {
    return b < a ? 0 : this.at(b) - this.at(addDays(a, -1));
  }
  /** Share of the working days in [s, e] that have passed by the end of day t (0 before s, 1 from e). */
  frac(s: string, e: string, t: string) {
    if (t < s) return 0;
    if (t >= e) return 1;
    const n = this.wd(s, e);
    return n > 0 ? clamp01(this.wd(s, t) / n) : 0;
  }
}

function monthEnd(d: string) {
  const dt = toDate(d);
  return toIso(new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)));
}

/**
 * Planned baseline, actual earned and forecast curve.
 * Checkpoints: every Sunday (weekly view), every month end (monthly view), today, the baseline target and the forecast date.
 */
export function buildTimePhasedSCurve(acts: Activity[], opt: SCurveOptions): SCurveResult {
  const { cal, today } = opt;
  const empty: SCurveResult = {
    points: [], weights: [], totalPlanDays: 0, activityCount: 0, baselineTarget: today, forecastDate: today,
    plannedToday: 0, actualToday: 0, variance: 0, spi: null, anomalies: [],
  };
  if (!acts.length) return empty;

  const anomalies: string[] = [];
  const dates = acts.flatMap((a) => [a.plannedStartDate, a.plannedEndDate, a.actualStartDate, a.actualEndDate].filter((x): x is string => !!x));
  const lo = addDays([...dates, today].reduce(minIso), -1);
  const hi = addDays([...dates, today].reduce(maxIso), 120);
  const idx = new DayIndex(cal, lo, hi);

  // 2. Weights: planned duration (at least 1 day) over the total planned days of these activities.
  const days = acts.map((a) => {
    const d = Number(a.plannedDuration);
    return Math.max(1, Number.isFinite(d) && d > 0 ? d : idx.wd(a.plannedStartDate, a.plannedEndDate));
  });
  const totalPlanDays = days.reduce((s, d) => s + d, 0);
  const w = days.map((d) => d / totalPlanDays);

  // Per-activity inputs, normalised once.
  const rows = acts.map((a, i) => {
    const p = clamp01(Number(a.progressPercent) / 100);
    const ps = a.plannedStartDate;
    const pe = maxIso(a.plannedEndDate, ps);
    if (a.plannedEndDate < a.plannedStartDate) anomalies.push(`${a.activityId}: planned end ${a.plannedEndDate} is before planned start ${ps}`);
    if (a.actualStartDate && a.actualEndDate && a.actualEndDate < a.actualStartDate) anomalies.push(`${a.activityId}: actual end ${a.actualEndDate} is before actual start ${a.actualStartDate}`);

    // Actual earning window (only up to today).
    let as: string | null = null;
    let ae: string | null = null;
    if (p > 0) {
      if (p >= 1) {
        ae = a.actualEndDate ? minIso(a.actualEndDate, today) : today;
        if (a.actualEndDate && a.actualEndDate > today) anomalies.push(`${a.activityId}: 100% complete but actual end ${a.actualEndDate} is after today`);
      } else {
        ae = today; // in progress: earned so far is spread up to today
      }
      as = minIso(a.actualStartDate ?? ps, ae);
      if (a.actualStartDate && a.actualStartDate > today) anomalies.push(`${a.activityId}: ${Math.round(p * 100)}% progress but actual start ${a.actualStartDate} is after today`);
    }

    // Forecast window for the remaining (1 - p) of the work.
    let fs = today;
    let fe = today;
    if (p < 1) {
      const h = opt.hint?.(a);
      fs = maxIso(addDays(today, 1), a.actualStartDate ?? h?.forecastStart ?? ps);
      const sheetFinish = a.actualEndDate && a.actualEndDate > today ? a.actualEndDate : null;
      fe = maxIso(sheetFinish ?? h?.forecastEnd ?? pe, fs);
    }
    return { a, i, p, ps, pe, as, ae, fs, fe };
  });

  const baselineTarget = rows.map((r) => r.pe).reduce(maxIso);
  const open = rows.filter((r) => r.p < 1);
  const forecastDate = open.length ? open.map((r) => r.fe).reduce(maxIso) : rows.map((r) => r.ae ?? r.pe).reduce(maxIso);

  // 3. Planned baseline %.
  const plannedAt = (t: string) => {
    if (t >= baselineTarget) return 100;
    return Math.min(100, 100 * rows.reduce((s, r) => s + w[r.i] * idx.frac(r.ps, r.pe, t), 0));
  };
  // 4. Raw actual earned % (t <= today).
  const rawActualAt = (t: string) =>
    Math.min(100, 100 * rows.reduce((s, r) => {
      if (r.p <= 0 || !r.as || !r.ae || t < r.as) return s;
      return s + w[r.i] * r.p * idx.frac(r.as, r.ae, t);
    }, 0));
  // 5. Raw forecast % (t > today).
  const rawForecastAt = (t: string) =>
    Math.min(100, 100 * rows.reduce((s, r) => s + w[r.i] * (r.p >= 1 ? 1 : r.p + (1 - r.p) * idx.frac(r.fs, r.fe, t)), 0));

  // Checkpoints.
  const start = rows.map((r) => r.ps).reduce(minIso);
  const last = maxIso(maxIso(baselineTarget, forecastDate), today);
  const set = new Set<string>();
  const sd = toDate(start);
  const firstSunday = addDays(start, (7 - sd.getUTCDay()) % 7);
  for (let d = firstSunday; d <= addDays(last, 6); d = addDays(d, 7)) set.add(d);
  for (let m = monthEnd(start); m <= monthEnd(last); m = monthEnd(addDays(m, 1))) set.add(m);
  set.add(today);
  set.add(baselineTarget);
  set.add(forecastDate);
  const sorted = [...set].filter((d) => d >= start).sort();

  const points: SPoint[] = [];
  let act = 0;
  let fc = 0;
  let actualToday = 0;
  for (const t of sorted) {
    const planned = plannedAt(t);
    let actual: number | null = null;
    let forecast: number | null = null;
    if (t <= today) {
      act = Math.max(act, rawActualAt(t)); // never dips before today
      actual = act;
    }
    if (t === today) {
      actualToday = act;
      fc = act;
      forecast = act;
    } else if (t > today) {
      if (!actualToday && today < start) actualToday = 0;
      fc = t >= forecastDate ? 100 : Math.max(fc, actualToday, rawForecastAt(t));
      forecast = fc;
    }
    points.push({ date: t, label: dayLabel(t), planned, actual, forecast } as SPoint);
  }

  const plannedToday = today < start ? 0 : plannedAt(today);
  if (today < start) actualToday = 0;
  return {
    points, weights: w, totalPlanDays, activityCount: acts.length, baselineTarget, forecastDate,
    plannedToday, actualToday, variance: actualToday - plannedToday,
    spi: plannedToday > 0 ? actualToday / plannedToday : null,
    anomalies,
  };
}
