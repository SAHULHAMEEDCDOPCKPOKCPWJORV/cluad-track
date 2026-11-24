// Sanity tests for the time-phased S-curve engine.  Run: npx tsx --test tests/scurve.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTimePhasedSCurve, calculateSectionSCurves } from '../src/lib/scurve';
import { WorkCalendar, addDays, toDate } from '../src/lib/calendar';
import type { Activity } from '../src/lib/types';

const HOLIDAYS = ['2026-09-04', '2026-10-02', '2026-10-20', '2026-11-08', '2026-11-24', '2026-12-25'];
const cal = new WorkCalendar(HOLIDAYS);
const TODAY = '2026-11-25';
const SECTIONS = ['Land', 'Engineering', 'Procurement', 'Civil', 'OHTL', 'Approvals', 'Grid', 'Commissioning'];

// Independent reference implementation (day-by-day loops, no index) used to check the engine.
const wdRef = (a: string, b: string) => { let n = 0; for (let d = a; d <= b; d = addDays(d, 1)) if (cal.isWorking(d)) n++; return n; };
const fracRef = (s: string, e: string, t: string) => (t < s ? 0 : t >= e ? 1 : wdRef(s, e) ? wdRef(s, t) / wdRef(s, e) : 0);
function plannedRef(acts: Activity[], t: string) {
  const d = acts.map((a) => Math.max(1, a.plannedDuration));
  const tot = d.reduce((x, y) => x + y, 0);
  return 100 * acts.reduce((s, a, i) => s + (d[i] / tot) * fracRef(a.plannedStartDate, a.plannedEndDate, t), 0);
}
const earnedRef = (acts: Activity[]) => {
  const d = acts.map((a) => Math.max(1, a.plannedDuration));
  const tot = d.reduce((x, y) => x + y, 0);
  return acts.reduce((s, a, i) => s + (d[i] / tot) * a.progressPercent, 0);
};

/** Deterministic N-activity schedule: finished work before today, some in progress, the rest in the future. */
function makeSchedule(n: number): Activity[] {
  const out: Activity[] = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < n; i++) {
    const start = addDays('2026-09-01', Math.floor((i / n) * 110));
    const dur = i % 17 === 0 ? 0 : 1 + Math.floor(rnd() * 20); // some same-day (0-duration) items
    const end = dur === 0 ? start : cal.finishFrom(start, dur);
    let progressPercent = 0, actualStartDate: string | null = null, actualEndDate: string | null = null;
    if (end < '2026-11-10') { progressPercent = 100; actualStartDate = addDays(start, 2); actualEndDate = addDays(end, 3); }
    else if (start < TODAY) { progressPercent = [25, 50, 75][i % 3]; actualStartDate = addDays(start, 1); }
    out.push({ activityId: `A-${i + 1}`, section: SECTIONS[i % SECTIONS.length], plannedDuration: dur, plannedStartDate: start, plannedEndDate: end, actualStartDate, actualEndDate, progressPercent });
  }
  return out;
}

const close = (a: number, b: number, eps = 2e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

function checkInvariants(acts: Activity[]) {
  const r = buildTimePhasedSCurve(acts, { cal, today: TODAY });
  assert.equal(r.activityCount, acts.length);
  close(r.weights.reduce((s, x) => s + x, 0), 1);
  assert.ok(!Object.is(r.variance, -0) && !(r.variance < 0 && r.variance.toFixed(2) === '-0.00'), 'no -0.00 variance');
  assert.equal(r.totalPlanDays, acts.reduce((s, a) => s + Math.max(1, a.plannedDuration), 0));
  assert.equal(r.baselineTarget, acts.map((a) => a.plannedEndDate).sort().at(-1));

  let prevP = -1, prevA = -1, prevF = -1;
  for (const p of r.points) {
    // planned matches the reference formula at every checkpoint and never goes down
    close(p.planned, Math.min(100, p.date >= r.baselineTarget ? 100 : plannedRef(acts, p.date)), 2e-6);
    assert.ok(p.planned >= prevP - 1e-9); prevP = p.planned;
    if (p.date > TODAY) assert.equal(p.actual, null, 'no actual after today');
    else { assert.ok(p.actual! >= prevA - 1e-9, 'actual never dips'); prevA = p.actual!; }
    if (p.date < TODAY) assert.equal(p.forecast, null, 'no forecast before today');
    else { assert.ok(p.forecast! >= prevF - 1e-9); assert.ok(p.forecast! <= 100); prevF = p.forecast!; }
    if (p.date >= r.baselineTarget) assert.equal(p.planned, 100);
  }
  const t = r.points.find((p) => p.date === TODAY)!;
  assert.ok(t, 'today is a checkpoint');
  close(t.actual!, earnedRef(acts), 2e-6); // Verified Actual today = sum(weight x progress)
  close(t.forecast!, t.actual!);              // forecast anchored at actual
  close(r.actualToday, t.actual!);
  close(r.plannedToday, t.planned);
  close(r.variance, r.actualToday - r.plannedToday);
  if (r.plannedToday > 0) close(r.spi!, r.actualToday / r.plannedToday);
  assert.equal(r.points.find((p) => p.date === r.forecastDate)!.forecast, 100);
  // weekly view = Sundays, monthly view = month ends: both present
  const dates = new Set(r.points.map((p) => p.date));
  const start = acts.map((a) => a.plannedStartDate).sort()[0];
  for (let d = '2026-08-30'; d <= r.baselineTarget; d = addDays(d, 7)) if (d >= start) assert.ok(dates.has(d), `Sunday ${d}`);
  for (const m of ['2026-09-30', '2026-10-31', '2026-11-30', '2026-12-31']) if (m >= start && m <= addDays(r.baselineTarget, 31)) assert.ok(dates.has(m), `month end ${m}`);
  assert.ok(toDate('2026-08-30').getUTCDay() === 0);
  return r;
}

test('124-activity schedule: weights, planned, actual, forecast, KPIs', () => {
  const acts = makeSchedule(124);
  const r = checkInvariants(acts);
  assert.equal(r.points[0].date >= acts.map((a) => a.plannedStartDate).sort()[0], true);
  assert.ok(r.plannedToday > 0 && r.plannedToday < 100);
  console.log(`124 acts: planned today ${r.plannedToday.toFixed(2)}%, actual ${r.actualToday.toFixed(2)}%, SPI ${r.spi!.toFixed(2)}, target ${r.baselineTarget}, forecast ${r.forecastDate}`);
});

test('adding activities re-weights everything and moves the baseline target', () => {
  const base = makeSchedule(124);
  const r1 = buildTimePhasedSCurve(base, { cal, today: TODAY });
  const added: Activity[] = [
    { activityId: 'NEW-1', section: 'Civil', plannedDuration: 10, plannedStartDate: '2026-12-01', plannedEndDate: cal.finishFrom('2026-12-01', 10), actualStartDate: null, actualEndDate: null, progressPercent: 0 },
    { activityId: 'NEW-2', section: 'Grid', plannedDuration: 0, plannedStartDate: '2027-01-20', plannedEndDate: '2027-01-20', actualStartDate: null, actualEndDate: null, progressPercent: 0 },
    { activityId: 'NEW-3', section: 'Land', plannedDuration: 3, plannedStartDate: '2026-11-02', plannedEndDate: cal.finishFrom('2026-11-02', 3), actualStartDate: '2026-11-02', actualEndDate: '2026-11-04', progressPercent: 100 },
  ];
  const acts = [...base, ...added];
  const r2 = checkInvariants(acts);
  assert.equal(r2.activityCount, 127);
  assert.equal(r2.totalPlanDays, r1.totalPlanDays + 10 + 1 + 3); // same-day activity counts as 1 day
  close(r2.weights[125], 1 / r2.totalPlanDays);                   // and is not zero-weighted
  assert.equal(r2.baselineTarget, '2027-01-20');
  assert.notEqual(r2.plannedToday.toFixed(6), r1.plannedToday.toFixed(6));
});

test('section curves are isolated and reach 100% at the section target', () => {
  const acts = makeSchedule(124);
  for (const s of SECTIONS) {
    const sub = acts.filter((a) => a.section === s);
    const r = checkInvariants(sub);
    assert.equal(r.activityCount, sub.length);
  }
});

test('in-progress work accrues linearly up to today; completed work over its actual dates', () => {
  const acts: Activity[] = [
    { activityId: 'X', section: 'S', plannedDuration: 10, plannedStartDate: '2026-11-02', plannedEndDate: cal.finishFrom('2026-11-02', 10), actualStartDate: '2026-11-02', actualEndDate: null, progressPercent: 50 },
    { activityId: 'Y', section: 'S', plannedDuration: 10, plannedStartDate: '2026-11-02', plannedEndDate: cal.finishFrom('2026-11-02', 10), actualStartDate: '2026-11-02', actualEndDate: '2026-11-13', progressPercent: 100 },
  ];
  const r = buildTimePhasedSCurve(acts, { cal, today: TODAY });
  close(r.actualToday, 75); // 0.5 x 50% + 0.5 x 100%
  const mid = r.points.find((p) => p.date === '2026-11-08')!; // Sunday
  const x = 0.5 * 50 * (wdRef('2026-11-02', '2026-11-08') / wdRef('2026-11-02', TODAY));
  const y = 0.5 * 100 * (wdRef('2026-11-02', '2026-11-08') / wdRef('2026-11-02', '2026-11-13'));
  close(mid.actual!, x + y, 2e-6);
});

test('edge cases: inverted dates and completed work dated in the future are flagged, not trusted', () => {
  const acts: Activity[] = [
    { activityId: 'INV', section: 'S', plannedDuration: 2, plannedStartDate: '2026-10-01', plannedEndDate: '2026-10-03', actualStartDate: '2026-10-10', actualEndDate: '2026-10-05', progressPercent: 100 },
    { activityId: 'FUT', section: 'S', plannedDuration: 2, plannedStartDate: '2026-12-01', plannedEndDate: '2026-12-02', actualStartDate: '2026-12-01', actualEndDate: '2026-12-02', progressPercent: 100 },
    { activityId: 'NS', section: 'S', plannedDuration: 4, plannedStartDate: '2026-12-10', plannedEndDate: '2026-12-15', actualStartDate: null, actualEndDate: null, progressPercent: 0 },
  ];
  const r = buildTimePhasedSCurve(acts, { cal, today: TODAY });
  assert.ok(r.anomalies.some((a) => a.startsWith('INV: actual end')));
  assert.ok(r.anomalies.some((a) => a.startsWith('FUT: 100% complete but actual end')));
  close(r.actualToday, 100 * (2 + 2) / 8); // both 100% items count today; nothing beyond today
  assert.equal(r.forecastDate, '2026-12-15');
  for (const p of r.points) if (p.date > TODAY) assert.equal(p.actual, null);
});

test('empty project and project not started yet', () => {
  assert.equal(buildTimePhasedSCurve([], { cal, today: TODAY }).points.length, 0);
  const r = buildTimePhasedSCurve([{ activityId: 'F', section: 'S', plannedDuration: 5, plannedStartDate: '2027-02-01', plannedEndDate: cal.finishFrom('2027-02-01', 5), actualStartDate: null, actualEndDate: null, progressPercent: 0 }], { cal, today: TODAY });
  assert.equal(r.plannedToday, 0);
  assert.equal(r.actualToday, 0);
  assert.equal(r.spi, null);
});

test('section cards: own weight pool, planned at today, forecast starts at actual, edits stay in their section', () => {
  const acts = makeSchedule(124);
  const before = calculateSectionSCurves(acts, { cal, today: TODAY });
  assert.equal(before.size, SECTIONS.length);
  for (const [name, r] of before) {
    const sub = acts.filter((a) => a.section === name);
    assert.equal(r.activityCount, sub.length);
    close(r.weights.reduce((s, x) => s + x, 0), 1);
    close(r.plannedToday, Math.min(100, plannedRef(sub, TODAY)), 2e-6);
    const t = r.points.find((p) => p.date === TODAY)!;
    assert.equal(t.forecast, t.actual);          // (b) forecast starts at ACTUAL
    assert.equal(r.actualToday, t.actual);        // ACTUAL card = curve at today
    let prev = -1;
    for (const p of r.points) if (p.actual != null) { assert.ok(p.actual >= prev); prev = p.actual; } // (a) no drops
    if (r.spi != null) close(r.spi, r.actualToday / r.plannedToday);
  }
  // (d) edit one Civil activity and add one: only Civil changes
  const edited = acts.map((a) => (a.activityId === acts.find((x) => x.section === 'Civil')!.activityId ? { ...a, plannedDuration: a.plannedDuration + 5, plannedEndDate: cal.finishFrom(a.plannedStartDate, a.plannedDuration + 5) } : a));
  edited.push({ activityId: 'NEW-C', section: 'Civil', plannedDuration: 4, plannedStartDate: '2026-12-10', plannedEndDate: cal.finishFrom('2026-12-10', 4), actualStartDate: null, actualEndDate: null, progressPercent: 0 });
  const after = calculateSectionSCurves(edited, { cal, today: TODAY });
  for (const name of SECTIONS) {
    const same = JSON.stringify(before.get(name)) === JSON.stringify(after.get(name));
    assert.equal(same, name !== 'Civil', name);
  }
  // ...and the overall curve picks the change up
  const o1 = buildTimePhasedSCurve(acts, { cal, today: TODAY });
  const o2 = buildTimePhasedSCurve(edited, { cal, today: TODAY });
  assert.equal(o2.activityCount, o1.activityCount + 1);
  assert.notEqual(o2.totalPlanDays, o1.totalPlanDays);
});

test('fully complete section shows 100.00 / 100.00 / variance 0.00 (never -0.00)', () => {
  const acts: Activity[] = [3, 7, 11, 5, 2, 9].map((d, i) => {
    const s = addDays('2026-09-01', i * 3);
    const e = cal.finishFrom(s, d);
    return { activityId: `L-${i}`, section: 'Land', plannedDuration: d, plannedStartDate: s, plannedEndDate: e, actualStartDate: s, actualEndDate: e, progressPercent: 100 };
  });
  const r = buildTimePhasedSCurve(acts, { cal, today: TODAY });
  assert.equal(r.plannedToday, 100);
  assert.equal(r.actualToday, 100);
  assert.equal(r.variance.toFixed(2), '0.00');
  assert.equal(r.spi, 1);
});
