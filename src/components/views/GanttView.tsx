'use client';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { ChevronDown, ChevronRight, Search, Route, Columns2, Table2, MoveHorizontal, Plus, Columns3 } from 'lucide-react';
import { useApp } from '../AppShell';
import { Card, C, STATUS_COLORS, SERIES, Select, Input, StatusBadge } from '../ui';
import { PageHeader } from '../Brand';
import { AddActivityModal } from './ScheduleSheet';
import { GanttInsights } from '../GanttInsights';
import { SCurvePanel } from '../SCurvePanel';
import { Flag } from 'lucide-react';
import { addDays, diffDays, fmt, toDate, toIso } from '@/lib/calendar';
import { SECTION_NAMES, CUSTOM_SECTION } from '@/lib/master';
import { DEPARTMENTS, STATUSES } from '@/lib/types';
import { sectionColorMap } from '@/lib/sectionColors';

const ROW = 46;
const SROW = 36;
const HEAD = 56;
const ORDER = [...SECTION_NAMES, CUSTOM_SECTION];
type Layout = 'split' | 'table' | 'timeline';
type Zoom = 'day' | 'week' | 'month';
const PPD: Record<Zoom, number> = { day: 30, week: 18, month: 5 };
const dmon = (iso: string) => toDate(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });
const monY = (iso: string) => toDate(iso).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });

export default function GanttView() {
  const { activities, model, project, cal, user, setView, holidays } = useApp();
  const m = model!;
  const [layout, setLayout] = useState<Layout>('split');
  const [zoom, setZoom] = useState<Zoom>('week');
  const [section, setSection] = useState('');
  const [dept, setDept] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [criticalOnly, setCriticalOnly] = useState(false);
  const [showBaseline, setShowBaseline] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [addOpen, setAddOpen] = useState(false);
  const [fullHeight, setFullHeight] = useState(true);
  const ppd = PPD[zoom];

  const COLS = layout === 'timeline'
    ? [{ k: 'wbs', l: 'WBS ID', w: 62 }, { k: 'name', l: 'Activity Name', w: 250 }]
    : [{ k: 'wbs', l: 'WBS ID', w: 58 }, { k: 'name', l: 'Activity Name', w: 225 }, { k: 'ps', l: 'Start Date', w: 84 }, { k: 'pe', l: 'End Date', w: 84 },
      { k: 'pd', l: 'Planned Duration (Days)', w: 70 }, { k: 'ad', l: 'Actual Duration (Days)', w: 70 }, { k: 'pr', l: '% Complete', w: 62 }, { k: 'st', l: 'Status', w: 98 },
      ...(layout === 'table' ? [{ k: 'as', l: 'Actual Start', w: 92 }, { k: 'ae', l: 'Actual End', w: 92 }, { k: 'dl', l: 'Delay', w: 64 }, { k: 'fl', l: 'Float', w: 60 }, { k: 'fe', l: 'Forecast End', w: 100 }] : [])];
  const LEFT_W = COLS.reduce((s, c) => s + c.w, 0);

  const { start, bottom, top, totalDays } = useMemo(() => {
    const all = activities.flatMap((a) => [a.plannedStartDate, a.plannedEndDate, a.actualStartDate ?? a.plannedStartDate, a.actualEndDate ?? a.plannedEndDate, m.an.byId.get(a.activityId)?.forecastEnd ?? a.plannedEndDate]);
    const min = all.reduce((x, y) => (x < y ? x : y));
    const max = all.reduce((x, y) => (x > y ? x : y));
    const sd = toDate(min);
    const s = zoom === 'month' ? `${min.slice(0, 7)}-01` : toIso(new Date(sd.getTime() - ((sd.getUTCDay() + 6) % 7) * 86400000));
    const end = addDays(max, zoom === 'month' ? 45 : 14);
    const b: { label: string; sub?: string; start: string; days: number; off?: boolean }[] = [];
    const t: { label: string; days: number }[] = [];
    const pushTop = (label: string, days: number) => { if (t.length && t[t.length - 1].label === label) t[t.length - 1].days += days; else t.push({ label, days }); };
    if (zoom === 'month') {
      for (let d = s; d <= end; ) {
        const dt = toDate(d);
        const next = toIso(new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 1)));
        const days = diffDays(d, next);
        b.push({ label: dt.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }), start: d, days });
        pushTop(String(dt.getUTCFullYear()), days);
        d = next;
      }
    } else {
      let w = 1;
      for (let d = s; d <= end; d = addDays(d, 7), w++) {
        const lab = `W${w}: ${dmon(d)}-${dmon(addDays(d, 6))}`;
        if (zoom === 'week') {
          b.push({ label: `W${w}`, sub: dmon(d), start: d, days: 7 });
          pushTop(monY(addDays(d, 3)), 7);
        } else {
          for (let i = 0; i < 7; i++) { const di = addDays(d, i); b.push({ label: di.slice(8), sub: toDate(di).toLocaleDateString('en-GB', { weekday: 'narrow', timeZone: 'UTC' }), start: di, days: 1, off: !cal.isWorking(di) }); }
          t.push({ label: lab, days: 7 });
        }
      }
    }
    return { start: s, bottom: b, top: t, totalDays: b.reduce((x, y) => x + y.days, 0) };
  }, [activities, m, zoom, cal]);

  const x = (iso: string) => diffDays(start, iso) * ppd;
  const w = (a: string, b: string) => Math.max(zoom === 'month' ? 3 : 6, (diffDays(a, b) + 1) * ppd);
  const timelineW = layout === 'table' ? 0 : totalDays * ppd;
  const scroller = useRef<HTMLDivElement>(null);
  // Open the timeline at the reporting date (a few weeks of history visible to its left).
  useEffect(() => {
    if (scroller.current && layout !== 'table') scroller.current.scrollLeft = Math.max(0, x(m.today) - 21 * ppd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, layout, start]);

  const filtered = activities.filter((a) => {
    const mm = m.an.byId.get(a.activityId)!;
    if (section && a.section !== section) return false;
    if (dept && a.department !== dept) return false;
    if (status && mm.status !== status) return false;
    if (criticalOnly && !mm.critical) return false;
    if (q && !`${a.activityId} ${a.activityName}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });
  const groups = [...new Set(filtered.map((a) => a.section))].sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99));
  const toggle = (s: string) => setCollapsed((c) => { const n = new Set(c); if (n.has(s)) n.delete(s); else n.add(s); return n; });

  const wd = cal.countWorking(project!.plannedStartDate, project!.plannedEndDate);
  const allSecs = [...new Set(activities.map((a) => a.section))].sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99));
  // Same colour per section as the Dashboard and Excel Import pages; works for any section names from the project's own Excel.
  const secColors = sectionColorMap(allSecs);
  const colorOf = (sc: string) => secColors.get(sc) ?? SERIES[0];
  const wbsOf = useMemo(() => {
    const mp = new Map<string, string>();
    allSecs.forEach((sc, i) => activities.filter((a) => a.section === sc).sort((a, b) => a.sNo - b.sNo).forEach((a, j) => mp.set(a.activityId, `${i + 1}.${j + 1}`)));
    return mp;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activities]);
  const sundays = useMemo(() => { const out: string[] = []; for (let d = start; d <= addDays(start, totalDays); d = addDays(d, 1)) if (toDate(d).getUTCDay() === 0) out.push(d); return out; }, [start, totalDays]);
  const hol = useMemo(() => holidays.filter((h) => h.date >= start && h.date <= addDays(start, totalDays)), [holidays, start, totalDays]);
  const gridBg = undefined; // clean timeline: no background grid lines

  const seg = (v: Layout, label: string, icon: React.ReactNode) => (
    <button onClick={() => setLayout(v)} className={clsx('flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm', layout === v ? 'bg-brand-blue font-semibold text-white' : 'text-slate-400 hover:text-white')}>{icon}{label}</button>
  );

  return (
    <div className="space-y-4">
      <PageHeader title="Interactive Multi-Color Gantt Chart & Schedule" badge={`${project!.capacityMw} MW • ${wd} Days (${activities.length} Work Packages)`}
        subtitle={<span className="font-mono uppercase">Project: <b className="text-solar-gold">{project!.name}</b> • Timeline: <b className="text-slate-200">{fmt(project!.plannedStartDate)}</b> to <b className="text-slate-200">{fmt(project!.plannedEndDate)}</b> ({wd} days • {activities.length} work packages)</span>} />

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-dark-600 bg-dark-900 p-1">{seg('split', 'Split View', <Columns2 className="h-4 w-4" />)}{seg('table', 'Full Table', <Table2 className="h-4 w-4" />)}{seg('timeline', 'Full Timeline', <MoveHorizontal className="h-4 w-4" />)}</div>
        <div className="relative w-52"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter activities..." className="w-full pl-9" /></div>
        <Select value={section} onChange={(e) => setSection(e.target.value)} className="w-auto min-w-[200px]"><option value="">All Sections ({new Set(activities.map((a) => a.section)).size})</option>{allSecs.map((s, i) => <option key={s} value={s}>{i + 1}. {s}</option>)}</Select>
        {user.canEdit && <button onClick={() => setAddOpen(true)} className="flex items-center gap-1.5 rounded-lg bg-solar-amber px-3 py-2 text-sm font-semibold text-dark-950 hover:bg-solar-gold"><Plus className="h-4 w-4" />Add Activity</button>}
        {user.canEdit && <button onClick={() => setView('schedule')} className="flex items-center gap-1.5 rounded-lg border border-brand-cyan/50 px-3 py-2 text-sm font-semibold text-cyan-300 hover:bg-brand-cyan/10"><Columns3 className="h-4 w-4" />Column Edit</button>}
        {layout !== 'table' && (
          <div className="flex rounded-lg border border-dark-600 bg-dark-900 p-1">
            {(['week', 'month', 'day'] as Zoom[]).map((z) => <button key={z} onClick={() => setZoom(z)} className={clsx('rounded-md px-4 py-1.5 text-sm font-semibold', zoom === z ? 'bg-solar-amber text-dark-950 shadow' : 'text-slate-300 hover:text-white')}>{z === 'week' ? 'Weekly View' : z === 'month' ? 'Monthly View' : 'Daily'}</button>)}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Section-wise Gantt">
        <button onClick={() => setSection('')} className={clsx('rounded-full border px-3 py-1 text-xs font-semibold', !section ? 'border-solar-amber bg-solar-amber/15 text-solar-gold' : 'border-dark-600 text-slate-300 hover:border-dark-500')}>All sections · {activities.length}</button>
        {allSecs.map((sc, i) => {
          const col = colorOf(sc);
          const n = activities.filter((a) => a.section === sc).length;
          return (
            <button key={sc} onClick={() => setSection(section === sc ? '' : sc)} className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold" style={section === sc ? { borderColor: col, background: `${col}26`, color: col } : { borderColor: 'rgb(var(--dk-600))' }}>
              <span className="h-2 w-2 rounded-full" style={{ background: col }} /><span className={section === sc ? '' : 'text-slate-300'}>{i + 1}. {sc}</span><span className="font-mono text-[10px] text-slate-500">{n}</span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-300">
        <Select value={dept} onChange={(e) => setDept(e.target.value)} className="w-auto py-1.5 text-xs"><option value="">All departments</option>{DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}</Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto py-1.5 text-xs"><option value="">All statuses</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}</Select>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={criticalOnly} onChange={(e) => setCriticalOnly(e.target.checked)} className="accent-emerald-500" /><Route className="h-3.5 w-3.5 text-brand-rose" />Critical path only</label>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={showBaseline} onChange={(e) => setShowBaseline(e.target.checked)} className="accent-emerald-500" />Baseline</label>
        <label className="flex items-center gap-1.5" title="Show every section and activity on the page without an inner scroll bar"><input type="checkbox" checked={fullHeight} onChange={(e) => setFullHeight(e.target.checked)} className="accent-emerald-500" />Show full chart</label>
        <span className="text-slate-500">{filtered.length} of {activities.length} activities</span>
        <div className="ml-auto flex flex-wrap gap-3 text-[11px] text-slate-400">
          <span className="flex items-center gap-1"><span className="h-2.5 w-5 rounded-sm bg-blue-500" />Planned</span>
          <span className="flex items-center gap-1"><span className="h-2.5 w-5 rounded-sm bg-emerald-400" />Actual progress</span>
          <span className="flex items-center gap-1"><span className="h-2.5 w-5 rounded-sm border border-rose-500 bg-rose-950" />Delay</span>
          {zoom === 'day' && <span className="flex items-center gap-1"><span className="h-2.5 w-3 rounded-sm" style={{ background: 'repeating-linear-gradient(45deg, rgba(196,118,52,.5) 0 2px, transparent 2px 4px)' }} />Sunday / holiday</span>}
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rotate-45 bg-solar-gold" />Milestone</span>
          <span className="flex items-center gap-1"><span className="h-3 w-0.5 bg-solar-gold" />Today</span>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-dark-700 bg-[#0b111c]">
        <div ref={scroller} className={clsx('overflow-auto', !fullHeight && 'max-h-[74vh]')}>
          <div style={{ width: LEFT_W + timelineW }} className="relative text-xs">
            <div className="sticky top-0 z-20 flex border-b border-dark-600 bg-dark-850">
              <div className="gantt-cells gantt-head sticky left-0 z-30 flex border-r border-dark-600 bg-dark-850" style={{ width: LEFT_W }}>
                {COLS.map((c) => <div key={c.k} className={clsx('flex items-end px-2 pb-2 text-[10.5px] font-bold leading-tight text-slate-200', c.k !== 'name' && c.k !== 'wbs' && 'justify-center text-center')} style={{ width: c.w, height: HEAD }}>{c.l}</div>)}
              </div>
              {layout !== 'table' && (
                <div style={{ width: timelineW }}>
                  <div className="flex h-7 border-b border-dark-700">{top.map((t, i) => <div key={i} className="truncate border-r border-dark-600 px-2 pt-1 text-[12px] font-bold text-white" style={{ width: t.days * ppd }}>{t.label}</div>)}</div>
                  <div className="flex h-[30px]">
                    {bottom.map((b) => {
                      const cur = b.start <= m.today && m.today < addDays(b.start, b.days);
                      return <div key={b.start} className={clsx('flex flex-col items-center justify-center overflow-hidden whitespace-nowrap border-r border-dark-700/60 leading-tight', cur ? 'bg-solar-amber/15 text-solar-gold' : b.off ? 'text-slate-500' : 'text-slate-200')} style={{ width: b.days * ppd }} title={zoom === 'week' ? `Week ${b.label.slice(1)}: ${dmon(b.start)} – ${dmon(addDays(b.start, 6))}` : b.label}>
                        <span className={clsx('font-semibold', zoom === 'day' ? 'text-[10px]' : 'text-[11px]')}>{b.label}</span>
                        {b.sub && <span className={clsx('font-mono', zoom === 'day' ? 'text-[8px] text-slate-500' : 'text-[10px] text-slate-400')}>{b.sub}</span>}
                      </div>;
                    })}
                  </div>
                </div>
              )}
            </div>

            {layout !== 'table' && (
              <>
                {zoom === 'day' && bottom.filter((b) => b.off).map((b) => <div key={b.start} className="pointer-events-none absolute bottom-0 bg-white/[0.03]" style={{ top: HEAD, left: LEFT_W + x(b.start), width: ppd }} />)}
                {zoom === 'day' && sundays.map((d) => <div key={d} title="Sunday - non-working day" className="pointer-events-none absolute bottom-0" style={{ top: HEAD, left: LEFT_W + x(d), width: ppd, background: 'var(--sun-hatch)', borderLeft: '1px solid var(--sun-edge)', borderRight: '1px solid var(--sun-edge)' }} />)}
                {zoom === 'day' && hol.map((h) => (
                  <div key={h.date} className="pointer-events-none absolute bottom-0 z-[5]" style={{ top: HEAD, left: LEFT_W + x(h.date), width: Math.max(2, ppd) }}>
                    <div className="h-full w-full bg-emerald-400/10" />
                    <span className="absolute left-0 top-1 z-10 flex items-center gap-0.5 whitespace-nowrap text-[10px] font-semibold text-emerald-300"><Flag className="h-3.5 w-3.5 fill-emerald-400/40" />{h.name}</span>
                  </div>
                ))}
                <div className="pointer-events-none absolute bottom-0 z-[6] border-l-2 border-dashed border-rose-500/80" style={{ top: HEAD, left: LEFT_W + x(m.today) + ppd / 2 }} />
              </>
            )}

            {groups.map((g) => {
              const rows = filtered.filter((a) => a.section === g);
              const sum = m.sections.find((s) => s.key === g);
              const color = colorOf(g);
              const isCol = collapsed.has(g);
              const secStatus = !sum ? 'Not Started' : sum.completed === sum.total ? 'Completed' : sum.delayed > 0 ? 'Delayed' : sum.actual > 0 || sum.inProgress > 0 ? 'In Progress' : 'Not Started';
              const allRows = activities.filter((a) => a.section === g);
              const aStarts = allRows.map((a) => a.actualStartDate).filter(Boolean) as string[];
              const aEnds = allRows.filter((a) => a.actualStartDate).map((a) => a.actualEndDate ?? (m.today > a.actualStartDate! ? m.today : a.actualStartDate!));
              const secAd = aStarts.length ? cal.countWorking(aStarts.reduce((p, q) => (p < q ? p : q)), aEnds.reduce((p, q) => (p > q ? p : q))) : 0;
              const secCells: Record<string, React.ReactNode> = {
                wbs: <span className="flex items-center gap-1 font-mono font-bold text-white">{isCol ? <ChevronRight className="h-3.5 w-3.5 text-slate-400" /> : <ChevronDown className="h-3.5 w-3.5 text-slate-400" />}{allSecs.indexOf(g) + 1}.0</span>,
                name: <span className="truncate text-[13px] font-bold text-white">{g}</span>,
                ps: sum ? fmt(sum.start) : '', pe: sum ? fmt(sum.finish) : '', pd: sum ? cal.countWorking(sum.start, sum.finish) : '', ad: secAd,
                pr: sum ? <span className="font-semibold text-solar-gold">{sum.actual.toFixed(2)}%</span> : '', st: <StatusBadge status={secStatus} />,
                as: aStarts.length ? fmt(aStarts.reduce((p, q) => (p < q ? p : q))) : '—', ae: '', dl: sum && sum.forecastFinish > sum.finish ? <span className="text-brand-rose">+{cal.workingDiff(sum.finish, sum.forecastFinish)}d</span> : '0', fl: '', fe: sum ? fmt(sum.forecastFinish) : '',
              };
              const sw = sum ? w(sum.start, sum.finish) : 0;
              return (
                <Fragment key={g}>
                  <div className="flex border-b border-dark-700 bg-dark-800" style={{ height: SROW }}>
                    <div onClick={() => toggle(g)} role="button" className="gantt-cells sticky left-0 z-[15] flex cursor-pointer border-r border-dark-700 bg-dark-800 font-mono hover:bg-dark-800" style={{ width: LEFT_W }}>
                      {COLS.map((c) => <div key={c.k} className={clsx('flex items-center overflow-hidden whitespace-nowrap px-2', c.k !== 'name' && c.k !== 'wbs' && 'justify-center text-slate-300')} style={{ width: c.w }}>{secCells[c.k]}</div>)}
                    </div>
                    {layout !== 'table' && (
                      <div className="relative" style={{ width: timelineW, background: gridBg }}>
                        {sum && <>
                          <div className="absolute top-[14px] h-[6px] rounded-sm" style={{ left: x(sum.start), width: sw, background: 'linear-gradient(90deg,#38bdf8,#7dd3fc)', boxShadow: '0 0 8px rgba(56,189,248,.45)' }} />
                          <div className="absolute top-[9px] h-[16px] w-[2px] bg-sky-300" style={{ left: x(sum.start) }} />
                          <div className="absolute top-[9px] h-[16px] w-[2px] bg-sky-300" style={{ left: x(sum.start) + sw - 2 }} />
                          {sum.forecastFinish > sum.finish && <div className="absolute top-[17px] border-t border-dashed border-rose-400" style={{ left: x(sum.start) + sw, width: diffDays(sum.finish, sum.forecastFinish) * ppd }} />}
                          <span className="absolute top-[9px] whitespace-nowrap pl-2 text-[12px] font-semibold text-sky-100" style={{ left: Math.max(x(sum.start) + sw, x(sum.forecastFinish) + ppd) }}>{g}</span>
                        </>}
                      </div>
                    )}
                  </div>
                  {!isCol && rows.map((a) => {
                    const mm = m.an.byId.get(a.activityId)!;
                    const fs = mm.forecastStart, fe = mm.forecastEnd;
                    const ad = a.actualStartDate && a.actualEndDate ? cal.countWorking(a.actualStartDate, a.actualEndDate) : a.actualStartDate ? cal.countWorking(a.actualStartDate, m.today > a.actualStartDate ? m.today : a.actualStartDate) : 0;
                    const pct = Number(a.progressPercent);
                    const cells: Record<string, React.ReactNode> = {
                      wbs: <span className="pl-3 text-slate-400">{wbsOf.get(a.activityId)}</span>,
                      name: <span className={clsx('truncate pl-3 font-sans text-[12.5px]', mm.critical ? 'text-rose-200' : 'text-slate-100')}>{a.activityName}{a.isMilestone && <span className="ml-1 rounded bg-solar-amber/20 px-1 text-[9px] text-solar-gold">★</span>}</span>,
                      ps: fmt(a.plannedStartDate), pe: fmt(a.plannedEndDate),
                      pd: <span>{a.isMilestone ? 0 : a.plannedDuration}</span>,
                      ad: <span>{ad}</span>,
                      pr: <span className="font-semibold text-slate-100">{pct}%</span>,
                      st: <StatusBadge status={mm.status} />,
                      as: <span className="text-cyan-300">{fmt(a.actualStartDate) || '—'}</span>, ae: <span className="text-cyan-300">{fmt(a.actualEndDate) || '—'}</span>,
                      dl: mm.delayDays > 0 ? <span className="text-brand-rose">+{mm.delayDays}d</span> : '0',
                      fl: `${mm.totalFloat}d`, fe: <span className={mm.slip > 0 ? 'text-brand-rose' : 'text-slate-300'}>{fmt(fe)}</span>,
                    };
                    const pe = x(a.plannedEndDate) + ppd;
                    const delayed = mm.slip > 0 && !a.isMilestone;
                    const bx = pe + 40;
                    const aFrom = a.actualStartDate ?? (pct > 0 ? a.plannedStartDate : null);
                    const aToRaw = pct >= 100 && a.actualEndDate ? a.actualEndDate : fe;
                    const aTo = aFrom && aToRaw < aFrom ? aFrom : aToRaw;
                    const showLabels = true;
                    return (
                      <div key={a.id} className="group flex border-b border-dark-800 hover:bg-dark-800/40" style={{ height: ROW }}>
                        <div className="gantt-cells sticky left-0 z-[15] flex border-r border-dark-700 bg-[#0b111c] font-mono group-hover:bg-dark-750" style={{ width: LEFT_W }}>
                          {COLS.map((c) => <div key={c.k} className={clsx('flex items-center overflow-hidden whitespace-nowrap px-2', c.k !== 'name' && c.k !== 'wbs' && 'justify-center text-slate-300')} style={{ width: c.w }}>{cells[c.k]}</div>)}
                        </div>
                        {layout !== 'table' && (
                          <div className="relative" style={{ width: timelineW, background: gridBg }} title={`${a.activityId} ${a.activityName}\nPlanned ${fmt(a.plannedStartDate)} → ${fmt(a.plannedEndDate)}\nForecast ${fmt(fs)} → ${fmt(fe)}\nProgress ${pct}% · ${mm.status}${mm.delayDays ? ` · +${mm.delayDays}d` : ''}${mm.critical ? ' · CRITICAL PATH' : ''}`}>
                            {a.isMilestone ? (
                              <>
                                <div className="absolute top-[14px] h-4 w-4 rotate-45 border-2 border-emerald-300" style={{ left: x(fe) + ppd / 2 - 8, background: mm.status === 'Completed' ? '#34d399' : 'rgb(var(--dk-850))', boxShadow: '0 0 8px rgba(52,211,153,.5)' }} />
                                {showLabels && <span className="absolute top-[13px] whitespace-nowrap pl-2 text-[11.5px] font-semibold text-slate-100" style={{ left: x(fe) + ppd + 8 }}>{a.activityName}</span>}
                              </>
                            ) : (
                              <>
                                <div className="absolute top-[7px] h-[14px] rounded-md" style={{ left: x(a.plannedStartDate), width: w(a.plannedStartDate, a.plannedEndDate), background: 'linear-gradient(90deg,#1d4ed8,#3b82f6 60%,#38bdf8)', border: '1px solid #7dd3fc66', boxShadow: '0 0 8px rgba(59,130,246,.45)' }} />
                                {showBaseline && a.baselineStartDate && a.baselineEndDate && (a.baselineStartDate !== a.plannedStartDate || a.baselineEndDate !== a.plannedEndDate) && (
                                  <div className="absolute top-[3px] h-[2px] bg-slate-400/70" style={{ left: x(a.baselineStartDate), width: w(a.baselineStartDate, a.baselineEndDate) }} />
                                )}
                                {aFrom && (
                                  <div className="absolute top-[26px] h-[13px] overflow-hidden rounded-md" style={{ left: x(aFrom), width: w(aFrom, aTo), background: 'var(--act-track)', border: '1px solid #34d39966', boxShadow: '0 0 8px rgba(52,211,153,.4)' }}>
                                    <div className="h-full" style={{ width: `${Math.min(100, pct)}%`, background: 'linear-gradient(90deg,#10b981,#34d399)' }} />
                                  </div>
                                )}
                                {delayed && (
                                  <>
                                    <div className="absolute top-[14px] border-t-2 border-dashed border-rose-500" style={{ left: pe, width: 38 }} />
                                    <span className="absolute top-[3px] z-[6] gantt-delay rounded-md border-2 border-rose-500 px-2 text-[11px] font-extrabold tracking-widest" style={{ left: bx, boxShadow: '0 0 10px rgba(244,63,94,.8)' }}>DELAY <span className="font-mono text-[10px] font-semibold opacity-80">+{mm.slip}d</span></span>
                                  </>
                                )}
                                {showLabels && (
                                  <>
                                    <span className="absolute top-[5px] whitespace-nowrap pl-2 text-[11.5px] font-semibold text-slate-100" style={{ left: delayed ? bx + 96 : pe + 2 }}>{a.activityName}</span>
                                    {aFrom && <span className="absolute top-[25px] whitespace-nowrap pl-2 text-[11px] font-semibold text-emerald-300" style={{ left: x(aTo) + ppd + 2 }}>Actual progress {pct}%</span>}
                                  </>
                                )}
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </Fragment>
              );
            })}
          </div>
        </div>
      </div>

      <SCurvePanel curve={m.curve} today={m.today} baseline={project!.plannedEndDate > m.kpis.plannedFinish ? project!.plannedEndDate : m.kpis.plannedFinish} forecast={m.kpis.forecastFinish} actualPct={m.kpis.overallProgress} height={280} />
      <GanttInsights />

      <Card title="Programme Overview" subtitle="Section envelopes: planned (outline) vs forecast (fill) with progress">
        <div className="space-y-1.5">
          {m.sections.map((s, i) => {
            const total = Math.max(1, totalDays);
            const left = (diffDays(start, s.start) / total) * 100;
            const width = ((diffDays(s.start, s.finish) + 1) / total) * 100;
            const fw = ((diffDays(s.start, s.forecastFinish) + 1) / total) * 100;
            const late = s.forecastFinish > s.finish;
            return (
              <div key={s.key} className="flex items-center gap-3 text-xs">
                <div className="w-56 shrink-0 truncate text-slate-300"><span className="mr-1.5 text-slate-500">{i + 1}.</span>{s.key}</div>
                <div className="relative h-5 flex-1 rounded bg-dark-900">
                  <div className="absolute top-0.5 h-4 rounded border" style={{ left: `${left}%`, width: `${width}%`, borderColor: colorOf(s.key) }} />
                  <div className="absolute top-1.5 h-2 rounded opacity-50" style={{ left: `${left}%`, width: `${fw}%`, background: late ? C.rose : C.emerald }} />
                  <div className="absolute top-1.5 h-2 rounded" style={{ left: `${left}%`, width: `${(fw * s.actual) / 100}%`, background: C.amber }} />
                  <div className="absolute top-0 h-5 w-px bg-solar-gold" style={{ left: `${(diffDays(start, m.today) / total) * 100}%` }} />
                </div>
                <div className="w-28 shrink-0 text-right font-mono text-slate-400">{s.actual}% · <span className={late ? 'text-brand-rose' : 'text-brand-emerald'}>{fmt(s.forecastFinish).slice(0, 5)}</span></div>
              </div>
            );
          })}
        </div>
      </Card>
      {addOpen && <AddActivityModal open onClose={() => setAddOpen(false)} />}
    </div>
  );
}
