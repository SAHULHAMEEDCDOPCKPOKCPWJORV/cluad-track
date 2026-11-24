'use client';
import { useMemo, useState } from 'react';
import { Activity as ActIcon, CheckCircle2, Clock, PauseCircle, AlertOctagon, CircleDashed, Gauge as GaugeIcon, TrendingUp, TrendingDown, Flag, CalendarClock, Route, Hourglass, ListChecks } from 'lucide-react';
import { useApp } from '../AppShell';
import { Card, C, STATUS_COLORS, DEPT_COLORS, Badge } from '../ui';
import { SCurveChart, Donut, Legendish, Gauge, Ring, HBars, DeptRadar, Sparkline } from '../charts';
import { fmt, fmtShort, toDate, addDays as addDaysIso } from '@/lib/calendar';
import { fmtSpi, periodProgress } from '@/lib/schedule';
import { VBars } from '../charts';
import { CountUp } from '../motion';
import { ShieldCheck, TriangleAlert, XCircle as XIcon } from 'lucide-react';
import { projectHealth } from '@/lib/report';
import { SCurvePanel } from '../SCurvePanel';
import { PageHeader } from '../Brand';
import { sectionColorMap, trimCurve } from '@/lib/sectionColors';
import { buildTimePhasedSCurve, type SCurveOptions } from '@/lib/scurve';

export default function Dashboard() {
const { model, activities, project } = useApp();
const m = model!;
const k = m.kpis;
const health = projectHealth(k);
const healthColor = health === 'On Track' ? C.emerald : health === 'At Risk' ? C.amber : C.rose;
// Overall S-curve, KPI tiles and section curves all come from the same time-phased engine and the active project's activities.
const scOpts = useMemo<SCurveOptions>(() => ({ cal: m.cal, today: m.today, hint: (a) => m.an.byId.get(a.activityId) }), [m]);
const sc = useMemo(() => buildTimePhasedSCurve(activities, scOpts), [activities, scOpts]);
const scSpi = { spi: sc.spi ?? 1, spiValid: sc.spi != null };
const fcDelay = sc.forecastDate > sc.baselineTarget ? m.cal.workingDiff(sc.baselineTarget, sc.forecastDate) : 0;

// Department-wise curves are shown only when the Excel / master schedule departments line up exactly with its sections
// (every department sits inside one section and every section inside one department). Otherwise a department such as LAND
// mixes activities from different sections, so only the section-wise curves are shown. The overall S-curve is always shown.
const deptMatchesSection = useMemo(() => {
const secOfDept = new Map<string, Set<string>>();
const deptOfSec = new Map<string, Set<string>>();
for (const a of activities) {
const d = String(a.department);
const s = String(a.section);
secOfDept.set(d, (secOfDept.get(d) ?? new Set<string>()).add(s));
deptOfSec.set(s, (deptOfSec.get(s) ?? new Set<string>()).add(d));
}
if (!secOfDept.size) return false;
return [...secOfDept.values()].every((x) => x.size === 1) && [...deptOfSec.values()].every((x) => x.size === 1);
}, [activities]);
const groupBy: 'department' | 'section' = deptMatchesSection ? 'department' : 'section';
const [curveMode, setCurveMode] = useState<'week' | 'month'>('month');
const sectionCurves = useMemo(
() => {
const groups = groupBy === 'department' ? m.depts : m.sections;
const colors = sectionColorMap(groups.map((s) => s.key));
return groups.map((s) => {
const r = buildTimePhasedSCurve(activities.filter((a) => a[groupBy] === s.key), scOpts);
return { s, r, color: groupBy === 'department' ? DEPT_COLORS[s.key] ?? C.amber : colors.get(s.key) ?? C.amber, curve: trimCurve(r.points) };
});
},
[m, activities, groupBy, scOpts],
);
// Weekly / monthly progress analysis: earned in each period and cumulative, from the same engine curve.
const [period, setPeriod] = useState<'week' | 'month'>('week');
const periods = useMemo(() => {
const rows = periodProgress(sc.points, period);
const cur = rows.findIndex((r) => (period === 'week' ? r.period >= m.today : r.period >= m.today.slice(0, 7)));
const ti = cur < 0 ? rows.length - 1 : cur;
const view = period === 'week' ? rows.slice(Math.max(0, ti - 16), ti + 8) : rows;
const label = (p: string) => (period === 'week' ? `${p.slice(8, 10)}-${p.slice(5, 7)}` : toDate(`${p}-01`).toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' }));
return view.map((r) => ({ ...r, label: label(r.period), Planned: Math.round(r.plannedEarned * 100) / 100, Actual: r.actualEarned == null ? 0 : Math.round(r.actualEarned * 100) / 100 }));
}, [m, sc, period]);
const milestones = activities.filter((a) => a.isMilestone);
const overdue = activities.filter((a) => a.progressPercent === 0 && a.plannedStartDate < m.today && a.status !== 'On Hold').length;
const spark = sc.points.filter((p) => p.actual != null).map((p) => p.actual as number);

const tiles = [
{ label: 'Overall Progress', value: `${sc.actualToday.toFixed(2)}%`, num: sc.actualToday, dec: 2, suf: '%', icon: <TrendingUp className="h-4 w-4" />, color: C.amber, ring: sc.actualToday },
{ label: 'Planned Progress', value: `${sc.plannedToday.toFixed(2)}%`, num: sc.plannedToday, dec: 2, suf: '%', icon: <ListChecks className="h-4 w-4" />, color: C.cyan, ring: sc.plannedToday },
{ label: 'Schedule Variance', value: `${sc.variance > 0 ? '+' : ''}${sc.variance.toFixed(2)} pp`, num: sc.variance, dec: 2, suf: ' pp', plus: true, icon: sc.variance >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />, color: sc.variance >= 0 ? C.emerald : C.rose },
{ label: 'SPI', value: fmtSpi(scSpi), num: scSpi.spiValid ? scSpi.spi : undefined, dec: 2, icon: <GaugeIcon className="h-4 w-4" />, color: !scSpi.spiValid ? C.slate ?? '#94a3b8' : scSpi.spi >= 0.95 ? C.emerald : scSpi.spi >= 0.85 ? C.amber : C.rose, ring: scSpi.spiValid ? Math.min(100, scSpi.spi * 100) : 0, hint: 'Earned value / planned value, from unrounded numbers. Shows n/a until some work is planned.' },
{ label: 'Total Activities', value: k.total, num: k.total, dec: 0, icon: <ActIcon className="h-4 w-4" />, color: C.violet },
{ label: 'Completed', value: k.completed, num: k.completed, dec: 0, icon: <CheckCircle2 className="h-4 w-4" />, color: STATUS_COLORS.Completed, ring: (k.completed / (k.total || 1)) * 100 },
{ label: 'In Progress', value: k.inProgress, num: k.inProgress, dec: 0, icon: <Clock className="h-4 w-4" />, color: STATUS_COLORS['In Progress'], ring: (k.inProgress / (k.total || 1)) * 100 },
{ label: 'Not Started', value: k.notStarted, num: k.notStarted, dec: 0, icon: <CircleDashed className="h-4 w-4" />, color: STATUS_COLORS['Not Started'], ring: (k.notStarted / (k.total || 1)) * 100 },
{ label: 'Delayed', value: k.delayed, num: k.delayed, dec: 0, icon: <AlertOctagon className="h-4 w-4" />, color: STATUS_COLORS.Delayed, ring: (k.delayed / (k.total || 1)) * 100 },
{ label: 'On Hold', value: k.onHold, num: k.onHold, dec: 0, icon: <PauseCircle className="h-4 w-4" />, color: STATUS_COLORS['On Hold'], ring: (k.onHold / (k.total || 1)) * 100 },
{ label: 'Critical Path Delays', value: k.criticalDelays, num: k.criticalDelays, dec: 0, icon: <Route className="h-4 w-4" />, color: k.criticalDelays ? C.rose : C.emerald },
{ label: 'Forecast Finish', value: fmt(sc.forecastDate), sub: fcDelay > 0 ? `+${fcDelay} wd · ${overdue} overdue not started` : 'On / ahead of plan', hint: `Latest forecast / actual finish in the schedule. Baseline target ${fmt(sc.baselineTarget)}.`, icon: <CalendarClock className="h-4 w-4" />, color: fcDelay > 0 ? C.rose : C.emerald },
{ label: 'Working Days Left', value: k.workingDaysRemaining, num: k.workingDaysRemaining, dec: 0, sub: `Planned finish ${fmt(sc.baselineTarget)}`, icon: <Hourglass className="h-4 w-4" />, color: C.gold },
];

return (
<div className="space-y-5">
<PageHeader title="Project Dashboard" badge={`${project!.capacityMw} MW • ${k.total} Work Packages`} subtitle={`${project!.name} • ${[project!.village, project!.district, project!.state].filter(Boolean).join(', ')} • ${fmt(project!.plannedStartDate)} to ${fmt(project!.plannedEndDate)}`} />
{/* Health hero */}
<div className="grid gap-4 xl:grid-cols-4">
<div className="relative overflow-hidden rounded-xl border border-dark-700 bg-gradient-to-br from-dark-800 via-dark-850 to-dark-900 p-5 xl:col-span-1">
<div className="absolute -right-10 -top-10 h-40 w-40 rounded-full blur-3xl" style={{ background: `${healthColor}33` }} />
<p className="text-xs uppercase tracking-widest text-slate-400">Project health</p>
<p className="mt-2 text-3xl font-bold" style={{ color: healthColor }}>{health}</p>
<p className="mt-2 text-sm text-slate-300">{project!.capacityMw} MW · {project!.projectType}</p>
<p className="text-xs text-slate-400">Data date {fmt(m.today)}</p>
<div className="mt-4"><Sparkline values={spark} color={healthColor} /></div>
<p className="text-[10px] uppercase tracking-wide text-slate-500">Actual progress trend</p>
</div>
<Card className="xl:col-span-1" bodyClass="p-3"><Gauge value={sc.actualToday} label="Physical progress %" color={C.amber} /></Card>
<Card className="xl:col-span-1" bodyClass="p-3"><Gauge value={Math.min(1.5, scSpi.spi)} max={1.5} display={fmtSpi(scSpi)} label="Schedule performance" color={!scSpi.spiValid ? '#94a3b8' : scSpi.spi >= 0.95 ? C.emerald : scSpi.spi >= 0.85 ? C.amber : C.rose} /></Card>
<Card className="xl:col-span-1" bodyClass="p-3"><Gauge value={(k.completed / (k.total || 1)) * 100} display={`${k.completed}/${k.total}`} label="Activities complete" color={C.emerald} /></Card>
</div>

{/* 13 KPIs */}
<div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-7">
{tiles.map((t, ti) => (
<div key={t.label} style={{ ['--i' as string]: ti }} title={'hint' in t ? (t as { hint?: string }).hint : undefined} className="sw-rise sw-lift flex items-center gap-3 rounded-xl border border-dark-700 bg-dark-850/80 p-3">
{t.ring != null ? (
<div className="relative">
<Ring value={t.ring} color={t.color} />
<span className="absolute inset-0 flex items-center justify-center" style={{ color: t.color }}>{t.icon}</span>
</div>
) : (
<div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full" style={{ background: `${t.color}22`, color: t.color }}>{t.icon}</div>
)}
<div className="min-w-0">
<div className="truncate text-[10px] uppercase tracking-wide text-slate-400">{t.label}</div>
<div className={`truncate font-bold text-white ${String(t.value).length > 8 ? 'text-sm' : 'text-lg'}`}>{'num' in t && t.num !== undefined ? <CountUp value={t.num} decimals={t.dec ?? 0} prefix={'plus' in t && t.num > 0 ? '+' : ''} suffix={'suf' in t ? t.suf : ''} /> : t.value}</div>
{t.sub && <div className="truncate text-[10px]" style={{ color: t.color }}>{t.sub}</div>}
</div>
</div>
))}
</div>

<AccuracyPanel v={m.validation} />

{fcDelay > 0 && (
<div className="rounded-xl border border-brand-rose/40 bg-brand-rose/10 px-4 py-3 text-sm text-rose-100">
<b>Why is the forecast finish {fmt(sc.forecastDate)}?</b> Baseline target is {fmt(sc.baselineTarget)}. The forecast is the latest actual / forecast finish in the schedule; {overdue} activities should already have started but still show 0% progress, so their remaining work is re-planned from today: +{fcDelay} working days.
{' '}Enter actual start/end dates and progress % in <b>Excel Import</b> and the forecast will update automatically.
</div>
)}
<div className="grid gap-4 xl:grid-cols-3">
<div className="xl:col-span-2">
<SCurvePanel plannedPct={sc.plannedToday} curve={sc.points} today={m.today} baseline={sc.baselineTarget} forecast={sc.forecastDate} actualPct={sc.actualToday} height={300} />
</div>
<Card title="Activity Status Distribution" subtitle={`${k.total} activities`}>
<Donut
height={220}
center={`${sc.actualToday.toFixed(2)}%`}
sub="complete"
data={(['Completed', 'In Progress', 'Not Started', 'Delayed', 'On Hold'] as const).map((s) => ({ name: s, value: { Completed: k.completed, 'In Progress': k.inProgress, 'Not Started': k.notStarted, Delayed: k.delayed, 'On Hold': k.onHold }[s], color: STATUS_COLORS[s] }))}
/>
<div className="mt-3">
<Legendish items={[
{ name: 'Completed', value: k.completed, color: STATUS_COLORS.Completed },
{ name: 'In Progress', value: k.inProgress, color: STATUS_COLORS['In Progress'] },
{ name: 'Not Started', value: k.notStarted, color: STATUS_COLORS['Not Started'] },
{ name: 'Delayed', value: k.delayed, color: STATUS_COLORS.Delayed },
{ name: 'On Hold', value: k.onHold, color: STATUS_COLORS['On Hold'] },
]} />
</div>
</Card>
</div>

<div className="grid gap-4 xl:grid-cols-3">
<Card title={period === 'week' ? 'Weekly Progress Analysis' : 'Monthly Progress Analysis'} subtitle={period === 'week' ? 'Planned vs achieved % earned per week (week ending Sunday) · last 16 + next 8 weeks' : 'Planned vs achieved % earned per month, with cumulative totals'} className="xl:col-span-2"
right={<div className="flex rounded-lg border border-dark-600 bg-dark-900 p-1 text-xs">{(['week', 'month'] as const).map((k2) => <button key={k2} onClick={() => setPeriod(k2)} className={`rounded-md px-3 py-1 font-semibold ${period === k2 ? 'bg-brand-blue text-white' : 'text-slate-400 hover:text-white'}`}>{k2 === 'week' ? 'Weekly' : 'Monthly'}</button>)}</div>}>
<VBars data={periods.map((r) => ({ label: r.label, Planned: r.Planned, Actual: r.Actual }))} xKey="label" height={230} unit="%" bars={[{ key: 'Planned', name: period === 'week' ? 'Planned / week' : 'Planned / month', color: C.cyan }, { key: 'Actual', name: period === 'week' ? 'Achieved / week' : 'Achieved / month', color: C.amber }]} />
<div className="mt-3 max-h-56 overflow-auto rounded-lg border border-dark-700">
<table className="grid-table w-full text-xs">
<thead className="sticky top-0"><tr>{[period === 'week' ? 'Week ending' : 'Month', 'Planned earned', 'Planned cumulative', 'Actual earned', 'Actual cumulative', 'Variance'].map((h) => <th key={h} className="px-2 py-1.5 text-center text-slate-300">{h}</th>)}</tr></thead>
<tbody>
{periods.map((r) => {
const cur = period === 'week' ? r.period >= m.today && addDaysIso(r.period, -6) <= m.today : r.period === m.today.slice(0, 7);
return (
<tr key={r.period} className={cur ? 'font-semibold' : ''}>
<td className={`px-2 py-1 text-center font-mono ${cur ? 'text-solar-gold' : 'text-slate-300'}`}>{period === 'week' ? fmt(r.period) : r.label}{cur ? ' ◀' : ''}</td>
<td className="px-2 py-1 text-center font-mono text-cyan-300">{r.plannedEarned.toFixed(2)}</td>
<td className="px-2 py-1 text-center font-mono text-slate-200">{r.plannedCumulative.toFixed(2)}%</td>
<td className="px-2 py-1 text-center font-mono text-emerald-300">{r.actualEarned == null ? '—' : r.actualEarned.toFixed(2)}</td>
<td className="px-2 py-1 text-center font-mono text-slate-200">{r.actualCumulative == null ? '—' : `${r.actualCumulative.toFixed(2)}%`}</td>
<td className={`px-2 py-1 text-center font-mono ${r.actualCumulative == null ? 'text-slate-500' : r.actualCumulative - r.plannedCumulative < -0.005 ? 'text-rose-300' : 'text-emerald-300'}`}>{r.actualCumulative == null ? '—' : (r.actualCumulative - r.plannedCumulative).toFixed(2)}</td>
</tr>
);
})}
</tbody>
</table>
</div>
</Card>
<Card title="Department Performance Radar" subtitle="Planned vs actual % by department">
<DeptRadar data={m.depts.map((d) => ({ dept: d.key, planned: d.planned, actual: d.actual }))} height={250} />
</Card>
</div>

<Card title="Section Progress" subtitle="Actual vs planned to date, with white tick at planned">
<div className="grid gap-x-8 gap-y-3 md:grid-cols-2">
{m.sections.map((s) => {
const color = !s.spiValid ? C.slate : s.spi >= 0.95 ? C.emerald : s.spi >= 0.85 ? C.amber : C.rose;
return (
<div key={s.key}>
<div className="mb-1 flex items-center justify-between text-xs">
<span className="truncate text-slate-200">{s.key}</span>
<span className="font-mono text-slate-400"><span style={{ color }}>{s.actual.toFixed(2)}%</span> / {s.planned.toFixed(2)}% · SPI {fmtSpi(s)}</span>
</div>
<div className="relative h-3 overflow-hidden rounded-full bg-dark-700">
<div className="sw-grow absolute h-full rounded-full bg-brand-cyan/30" style={{ width: `${s.planned}%` }} />
<div className="sw-grow absolute h-full rounded-full" style={{ width: `${s.actual}%`, background: color, ['--i' as string]: 2 }} />
</div>
</div>
);
})}
</div>
</Card>

<div>
<div className="mb-3 flex flex-wrap items-center justify-between gap-2">
<h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-300">{groupBy === 'department' ? 'Department-wise' : 'Section-wise'} Individual S-Curves <span className="rounded bg-dark-700 px-2 py-0.5 font-mono text-[10px] normal-case text-slate-400">{sectionCurves.length} curves · {activities.length} activities · planned vs actual vs forecast</span></h2>
<div className="flex flex-wrap gap-2">
<div className="flex rounded-lg border border-dark-600 bg-dark-900 p-1 text-xs">
{(['month', 'week'] as const).map((k) => (
<button key={k} onClick={() => setCurveMode(k)} className={`rounded-md px-3 py-1 font-semibold ${curveMode === k ? 'bg-brand-blue text-white' : 'text-slate-400 hover:text-white'}`}>{k === 'month' ? 'Monthly' : 'Weekly'}</button>
))}
</div>
</div>
</div>
<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
{sectionCurves.map(({ s, r, curve, color }, i) => {
const rs = { spi: r.spi ?? 1, spiValid: r.spi != null };
return (
<div key={s.key} className="sw-rise" style={{ ['--i' as string]: i }}>
<SCurvePanel compact mode={curveMode} curve={curve} today={m.today} baseline={r.baselineTarget} forecast={r.forecastDate} actualPct={r.actualToday} plannedPct={r.plannedToday} height={210} accent={color}
title={<><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-bold !text-slate-950" style={{ background: color }}>{i + 1}</span><span className="truncate" style={{ color }} title={s.key}>{s.key}</span></>}
badge={<span className="ml-1 shrink-0"><Badge color={!rs.spiValid ? C.slate : rs.spi >= 0.95 ? C.emerald : rs.spi >= 0.85 ? C.amber : C.rose}>SPI {fmtSpi(rs)}</Badge></span>} />
</div>
);
})}
</div>
</div>

<div className="grid gap-4 xl:grid-cols-2">
<Card title="Section Planned vs Actual" subtitle="Percent complete by section">
<HBars data={m.sections.map((s) => ({ name: s.key, Planned: s.planned, Actual: s.actual }))} keys={[{ key: 'Planned', name: 'Planned', color: C.cyan }, { key: 'Actual', name: 'Actual', color: C.amber }]} max={100} />
</Card>
<Card title="Key Milestones" subtitle="Planned vs forecast dates">
<div className="relative space-y-0">
{milestones.map((a) => {
const mm = m.an.byId.get(a.activityId)!;
const late = mm.slip > 0;
const color = mm.status === 'Completed' ? C.emerald : late ? C.rose : C.cyan;
return (
<div key={a.id} className="flex items-center gap-3 border-l-2 py-2 pl-4" style={{ borderColor: `${color}66` }}>
<Flag className="-ml-[25px] h-4 w-4 shrink-0 rounded-full bg-dark-850" style={{ color }} />
<div className="min-w-0 flex-1">
<div className="truncate text-sm text-slate-100">{a.activityName}</div>
<div className="text-[11px] text-slate-400">{a.activityId} · {a.section}</div>
</div>
<div className="text-right text-xs">
<div className="font-mono text-slate-300">{fmt(a.plannedEndDate)}</div>
<div className="font-mono" style={{ color }}>{mm.status === 'Completed' ? 'Achieved' : late ? `${fmt(mm.forecastEnd)} (+${mm.slip}d)` : 'On track'}</div>
</div>
</div>
);
})}
</div>
</Card>
</div>

<Card title="Department Scoreboard">
<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
{m.depts.map((d) => (
<div key={d.key} className="rounded-lg border border-dark-700 bg-dark-900 p-3">
<div className="flex items-center justify-between">
<span className="text-sm font-bold" style={{ color: DEPT_COLORS[d.key] ?? C.amber }}>{d.key}</span>
<span className="text-[10px] text-slate-500">{d.total} acts</span>
</div>
<div className="mt-2 flex items-center gap-2">
<Ring value={d.actual} color={DEPT_COLORS[d.key] ?? C.amber} size={40} />
<div className="text-xs">
<div className="font-semibold text-white">{d.actual}%</div>
<div className="text-slate-500">plan {d.planned}%</div>
</div>
</div>
<div className="mt-2 flex gap-1 text-[10px]">
<Badge color={C.emerald}>{d.completed} done</Badge>
{d.delayed > 0 && <Badge color={C.rose}>{d.delayed} late</Badge>}
</div>
</div>
))}
</div>
</Card>
</div>
);
}

function AccuracyPanel({ v }: { v: import('@/lib/schedule').ValidationReport }) {
const [open, setOpen] = useState(false);
const color = v.verdict === 'Verified' ? C.emerald : v.verdict === 'Failed' ? C.rose : C.amber;
const Icon = v.verdict === 'Verified' ? ShieldCheck : v.verdict === 'Failed' ? XIcon : TriangleAlert;
const pass = v.checks.filter((c) => c.status === 'pass').length;
return (
<div className="sw-rise rounded-xl border bg-dark-850/80 p-4" style={{ borderColor: `${color}55` }}>
<button onClick={() => setOpen(!open)} className="flex w-full flex-wrap items-center gap-3 text-left">
<span className="flex h-9 w-9 items-center justify-center rounded-full" style={{ background: `${color}22`, color }}><Icon className="h-5 w-5" /></span>
<span className="min-w-0 flex-1">
<span className="block text-sm font-semibold text-white">Calculation check: <span style={{ color }}>{v.verdict}</span></span>
<span className="block text-xs text-slate-400">{pass} of {v.checks.length} checks passed · history coverage {v.historyCoverage.toFixed(0)}% · weights: {v.weightSource === 'approved' ? 'stored per activity' : 'fallback from duration'}</span>
</span>
<span className="text-xs text-slate-400">{open ? 'Hide details' : 'Show details'}</span>
</button>
{open && (
<ul className="mt-3 space-y-1.5 border-t border-dark-700 pt-3 text-xs">
{v.checks.map((c) => (
<li key={c.id} className="flex gap-2">
<span className="mt-0.5 h-2 w-2 shrink-0 rounded-full" style={{ background: c.status === 'pass' ? C.emerald : c.status === 'warn' ? C.amber : C.rose }} />
<span><b className="text-slate-100">{c.label}.</b> <span className="text-slate-400">{c.detail}</span></span>
</li>
))}
</ul>
)}
</div>
);
}
