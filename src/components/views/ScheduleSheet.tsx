'use client';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { Upload, Download, Save, Wand2, Lock, Plus, Search, PauseCircle, Trash2, ChevronDown, ChevronRight, Pencil, Columns3, CheckCircle2, Undo2, FileDown, LayoutGrid } from 'lucide-react';
import { useApp } from '../AppShell';
import { Card, Button, C, DEPT_COLORS, SERIES, Select, Input, Modal, Field, StatusBadge } from '../ui';
import { VBars } from '../charts';
import { PageHeader } from '../Brand';
import { api } from '@/lib/api';
import type { Activity } from '@/lib/types';
import { DEPARTMENTS } from '@/lib/types';
import { SECTION_NAMES, CUSTOM_SECTION } from '@/lib/master';
import { downloadTemplate } from '@/lib/excelImport';
import { fmt, addDays, toDate, isValidIso, type WorkCalendar } from '@/lib/calendar';
import { weightsFor } from '@/lib/schedule';
import { generateReport } from '@/lib/report';
import ImportModal from './ImportModal';
import { activityPerformance, BAND_COLORS, bandOf } from '@/lib/performance';
import { sectionColorMap } from '@/lib/sectionColors';
import { AlertTriangle, UserRound } from 'lucide-react';

type Patch = Partial<Activity> & { actualDuration?: number | null };
const ORDER = [...SECTION_NAMES, CUSTOM_SECTION];

/** Keeps dates and durations consistent on the working calendar when one field changes. */
function derive(cal: WorkCalendar, cur: Activity, k: string, v: unknown): Patch {
  const dur = cur.isMilestone ? 0 : Number(cur.plannedDuration) || 0;
  switch (k) {
    case 'plannedDuration': {
      const n = Math.max(0, Math.ceil((Number(v) || 0) - 1e-9)); // part days count as a full day
      return { plannedDuration: n, plannedEndDate: n <= 0 ? cur.plannedStartDate : cal.finishFrom(cur.plannedStartDate, n) };
    }
    case 'plannedStartDate':
      if (!isValidIso(v)) return { plannedStartDate: v as string };
      return { plannedStartDate: v as string, plannedEndDate: dur <= 0 ? (v as string) : cal.finishFrom(v as string, dur) };
    case 'plannedEndDate':
      if (!isValidIso(v) || (v as string) < cur.plannedStartDate) return { plannedEndDate: v as string };
      return { plannedEndDate: v as string, plannedDuration: cur.isMilestone ? 0 : cal.countWorking(cur.plannedStartDate, v as string) };
    case 'actualDuration': {
      const n = Math.round(Number(v) || 0);
      return n > 0 && cur.actualStartDate ? { actualEndDate: cal.finishFrom(cur.actualStartDate, n) } : {};
    }
    case 'actualStartDate':
    case 'actualEndDate':
      return { [k]: v ? (v as string) : null };
    case 'progressPercent':
      return { progressPercent: Math.min(100, Math.max(0, Number(v) || 0)) };
    default:
      return { [k]: v } as Patch;
  }
}
const actualDur = (cal: WorkCalendar, a: Activity) => (a.actualStartDate && a.actualEndDate && a.actualEndDate >= a.actualStartDate ? cal.countWorking(a.actualStartDate, a.actualEndDate) : null);

export default function ScheduleSheet() {
  const { activities, project, model, user, applyUpdate, toast, cal, registerSave, setView } = useApp();
  const m = model!;
  const [draft, setDraft] = useState<Record<string, Patch>>({});
  const [q, setQ] = useState('');
  const [section, setSection] = useState('');
  const [colEdit, setColEdit] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editRow, setEditRow] = useState<Activity | null>(null);
  const [addSec, setAddSec] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const canEdit = user.canEdit && !user.mustChangePassword;
  const dirty = Object.keys(draft).length;
  const byId = useMemo(() => new Map(activities.map((a) => [a.activityId, a])), [activities]);
  const merged = (a: Activity): Activity => ({ ...a, ...(draft[a.activityId] ?? {}) }) as Activity;

  const change = (a: Activity, k: string, v: unknown) =>
    setDraft((d) => {
      const cur = { ...a, ...(d[a.activityId] ?? {}) } as Activity;
      const next = { ...(d[a.activityId] ?? {}), ...derive(cal, cur, k, v) } as Record<string, unknown>;
      for (const key of Object.keys(next)) if (String((a as unknown as Record<string, unknown>)[key] ?? '') === String(next[key] ?? '')) delete next[key];
      const n = { ...d };
      if (Object.keys(next).length) n[a.activityId] = next as Patch;
      else delete n[a.activityId];
      return n;
    });

  const run = async (label: string, fn: () => Promise<{ project: NonNullable<typeof project>; activities: Activity[]; changed?: number }>, okMsg: string) => {
    setBusy(label);
    try {
      const r = await fn();
      applyUpdate(r);
      toast(`${okMsg}${r.changed != null ? ` (${r.changed} rows)` : ''}`);
      return true;
    } catch (e) {
      toast((e as Error).message, 'err');
      return false;
    } finally {
      setBusy('');
    }
  };
  const save = async () => {
    const ok = await run('save', () => api.updateActivities(project!.id, { activities: Object.entries(draft).map(([activityId, p]) => ({ activityId, ...p })) }), 'Schedule saved');
    if (ok) setDraft({});
  };
  // Double-click a cell to edit it; Enter / leaving the cell saves that row, Esc cancels.
  const [cell, setCell] = useState<{ id: string; k: string } | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const cancelRef = useRef(false);
  const dropRow = (aid: string) => setDraft((d) => { const n = { ...d }; delete n[aid]; return n; });
  const commit = async (aid: string) => {
    setCell(null);
    if (cancelRef.current) { cancelRef.current = false; dropRow(aid); return; }
    const p = draftRef.current[aid];
    if (!p) return;
    const ok = await run('save', () => api.updateActivities(project!.id, { activities: [{ activityId: aid, ...p }] }), `${aid} saved`);
    if (ok) dropRow(aid);
  };
  // Actual duration: the stored value (e.g. copied from Excel) unless the actual dates are being edited.
  const adOf = (r: Activity) => { const d = draft[r.activityId]; return d && ('actualStartDate' in d || 'actualEndDate' in d) ? actualDur(cal, r) : (r.actualDuration ?? actualDur(cal, r)); };
  const vc = (a: Activity, k: string, type: 'date' | 'number' | 'text', display: React.ReactNode, cls: string, extra?: Record<string, unknown>) => {
    const r = merged(a);
    if (cell && cell.id === a.activityId && cell.k === k) {
      const v = k === 'actualDuration' ? adOf(r) ?? '' : (r as unknown as Record<string, unknown>)[k];
      return (
        <td className="border-b border-solar-amber bg-solar-amber/10 p-0 ring-2 ring-inset ring-solar-amber">
          <input autoFocus className={clsx('sheet-input font-mono', type !== 'text' && 'text-center')} type={type} value={String(v ?? '')} list={k === 'incharge' ? 'incharge-list' : undefined}
            onChange={(e) => change(a, k, type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)}
            onBlur={() => commit(a.activityId)}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { cancelRef.current = true; (e.target as HTMLInputElement).blur(); } }} {...extra} />
        </td>
      );
    }
    const editable = canEdit && !(a.isMilestone && k === 'plannedDuration');
    return (
      <td className={clsx(cls, editable && 'cursor-cell hover:bg-solar-amber/10 hover:ring-1 hover:ring-inset hover:ring-solar-amber/40')} title={editable ? 'Double-click to edit' : undefined}
        onDoubleClick={() => editable && setCell({ id: a.activityId, k })}>{display}</td>
    );
  };
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    registerSave(dirty ? () => saveRef.current() : null);
    return () => registerSave(null);
  }, [dirty, registerSave]);

  const exportSuite = async () => {
    setBusy('xlsx');
    try {
      const report = generateReport(project!, activities, m.an, m.kpis, m.sections, m.depts);
      await (await import('@/lib/exportExcel')).exportExcel({ project: project!, activities, cal: m.cal, today: m.today, an: m.an, kpis: m.kpis, sections: m.sections, depts: m.depts, curve: m.curve, hist: m.hist, validation: m.validation, report, user: user.email });
      toast('Excel workbook downloaded');
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setBusy('');
    }
  };

  const rows = activities.filter((a) => (!section || a.section === section) && (!q || `${a.activityId} ${a.activityName}`.toLowerCase().includes(q.toLowerCase())));
  const groups = [...new Set(rows.map((a) => a.section))].sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99));
  const allSections = [...new Set(activities.map((a) => a.section))];
  const secColors = sectionColorMap(allSections);
  const inchargeNames = [...new Set(activities.map((a) => a.incharge).filter(Boolean))].sort();
  const wd = cal.countWorking(project!.plannedStartDate, project!.plannedEndDate);
  const toggle = (s: string) => setCollapsed((c) => { const n = new Set(c); if (n.has(s)) n.delete(s); else n.add(s); return n; });

  const hist = useMemo(() => {
    const b = [{ name: '0%', n: 0 }, { name: '1–25', n: 0 }, { name: '26–50', n: 0 }, { name: '51–75', n: 0 }, { name: '76–99', n: 0 }, { name: '100%', n: 0 }];
    for (const a of activities) {
      const p = a.progressPercent;
      b[p <= 0 ? 0 : p <= 25 ? 1 : p <= 50 ? 2 : p <= 75 ? 3 : p < 100 ? 4 : 5].n++;
    }
    return b;
  }, [activities]);
  const load = useMemo(() => {
    const months = new Map<string, Record<string, number>>();
    for (const a of activities) {
      if (a.isMilestone) continue;
      for (let d = a.plannedStartDate; d <= a.plannedEndDate; d = addDays(d, 7)) {
        const key = toDate(d).toLocaleString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' });
        const row = months.get(key) ?? {};
        row[String(a.department)] = (row[String(a.department)] ?? 0) + 1;
        months.set(key, row);
      }
    }
    return [...months.entries()].map(([month, r]) => ({ month, ...r }));
  }, [activities]);

  const th = 'whitespace-nowrap border-b border-dark-600 px-3 py-3 text-left text-[13px] font-semibold';
  const cellIn = (a: Activity, k: string, type: 'date' | 'number', extra?: Record<string, unknown>) => {
    const r = merged(a);
    const v = k === 'actualDuration' ? adOf(r) ?? '' : (r as unknown as Record<string, unknown>)[k];
    const changed = draft[a.activityId] && (k in draft[a.activityId] || (k === 'actualDuration' && 'actualEndDate' in draft[a.activityId]));
    return (
      <td className={clsx('border-b border-dark-800 p-0', changed && 'bg-solar-amber/15')}>
        <input className="sheet-input text-center font-mono" type={type} value={String(v ?? '')} disabled={a.isMilestone && k === 'plannedDuration'}
          onChange={(e) => change(a, k, type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)} {...extra} />
      </td>
    );
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Master Schedule" right={<Button onClick={() => setView('dashboard')}><LayoutGrid className="h-4 w-4" />Go to Dashboard</Button>} badge={`${project!.capacityMw} MW • ${wd} Days (${activities.length} Work Packages)`}
        subtitle={<span className="font-mono uppercase">Project: <b className="text-slate-200">{project!.name}</b> • Timeline: <b className="text-slate-200">{fmt(project!.plannedStartDate)}</b> to <b className="text-slate-200">{fmt(project!.plannedEndDate)}</b> ({wd} days • {activities.length} work packages)</span>} />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-60"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter activities..." className="w-full pl-9" /></div>
        <Select value={section} onChange={(e) => setSection(e.target.value)} className="w-auto min-w-[230px]"><option value="">All Sections ({allSections.length})</option>{[...ORDER.filter((s) => allSections.includes(s)), ...allSections.filter((s) => !ORDER.includes(s))].map((s) => <option key={s}>{s}</option>)}</Select>
        {canEdit && <Button variant="outline" onClick={() => setImportOpen(true)}><Upload className="h-4 w-4" />Import Excel File</Button>}
        <Button variant="outline" className="!border-brand-emerald/50 !text-emerald-300" onClick={() => downloadTemplate(project!.name, activities)}><Download className="h-4 w-4" />Template</Button>
        <Button variant="outline" loading={busy === 'xlsx'} onClick={exportSuite}><FileDown className="h-4 w-4" />Export Excel</Button>
        {canEdit && <Button onClick={() => setAddSec(CUSTOM_SECTION)}><Plus className="h-4 w-4" />Add Activity</Button>}
        {canEdit && <Button variant="outline" className={clsx(colEdit ? '!border-brand-cyan !bg-brand-cyan/20 !text-cyan-200' : '!border-brand-cyan/50 !text-cyan-300')} onClick={() => setColEdit(!colEdit)}><Columns3 className="h-4 w-4" />{colEdit ? 'Exit Column Edit' : 'Column Edit'}</Button>}
        {dirty > 0 ? (
          <>
            <Button loading={busy === 'save'} onClick={save}><Save className="h-4 w-4" />Save ({dirty})</Button>
            <Button variant="ghost" onClick={() => setDraft({})}><Undo2 className="h-4 w-4" />Discard</Button>
          </>
        ) : <span className="flex items-center gap-1.5 rounded-lg border border-dark-600 px-3 py-2 text-sm text-slate-400"><Save className="h-4 w-4" />Saved</span>}
        {canEdit && (
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" size="sm" loading={busy === 'resched'} onClick={() => confirm('Re-plan all planned dates from the activity logic and current durations? Baseline is kept.') && run('resched', () => api.updateActivities(project!.id, { action: 'reschedule' }), 'Schedule re-planned')}><Wand2 className="h-3.5 w-3.5" />Re-plan from logic</Button>
            {(user.role === 'Admin' || user.canApprove) && <Button variant="ghost" size="sm" loading={busy === 'base'} onClick={() => confirm('Set the baseline equal to the current plan?') && run('base', () => api.updateActivities(project!.id, { action: 'rebaseline' }), 'Baseline updated')}><Lock className="h-3.5 w-3.5" />Re-baseline</Button>}
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-dark-700 bg-[#0b111c]">
        <div className="max-h-[70vh] overflow-auto">
          <table className="grid-table w-full min-w-[1800px] border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-dark-850">
              <tr>
                <th className={clsx(th, 'w-14 text-slate-300')}>S.No.</th>
                <th className={clsx(th, 'text-slate-300')}>Activity Name</th>
                {[['Planned Duration', 'text-solar-gold'], ['Planned Start Date', 'text-solar-gold'], ['Planned End Date', 'text-solar-gold'], ['Actual Duration', 'text-cyan-300'], ['Actual Start Date', 'text-cyan-300'], ['Actual End Date', 'text-cyan-300'], ['Progress %', 'text-emerald-300'], ['Status', 'text-slate-300']].map(([h, c]) => (
                  <th key={h} className={clsx(th, 'text-center', c)}>{h}{colEdit && h !== 'Status' && <Pencil className="ml-1.5 inline h-3 w-3 opacity-60" />}</th>
                ))}
                <th className={clsx(th, 'text-violet-300')}>Activity Incharge{colEdit && <Pencil className="ml-1.5 inline h-3 w-3 opacity-60" />}</th>
                <th className={clsx(th, 'text-rose-300')}>Delay Reason{colEdit && <Pencil className="ml-1.5 inline h-3 w-3 opacity-60" />}</th>
                <th className={clsx(th, 'text-center text-emerald-300')} title="Completed = 100%, not completed = 0%. Double-click a cell to enter your own value.">Incharge Perf %{colEdit && <Pencil className="ml-1.5 inline h-3 w-3 opacity-60" />}</th>
                <th className={clsx(th, 'text-center text-slate-300')}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g, gIdx) => {
                // Every section heading gets its own colour band.
                const color = secColors.get(g) ?? SERIES[gIdx % SERIES.length];
                const list = rows.filter((a) => a.section === g);
                const isCol = collapsed.has(g);
                // Weighted progress (same engine as the Dashboard), never a simple average. Unsaved edits are included.
                const secAll = activities.filter((a) => a.section === g).map((a) => merged(a));
                const secW = weightsFor(secAll);
                const secProg = secAll.length ? secAll.reduce((x, a, i) => x + (secW[i] * Math.min(100, Math.max(0, Number(a.progressPercent)))) / 100, 0).toFixed(2) : '0.00';
                const secStart = list.map((a) => a.plannedStartDate).sort()[0];
                const secEnd = list.map((a) => a.plannedEndDate).sort().pop();
                return (
                  <Fragment key={g}>
                    <tr style={{ background: `linear-gradient(90deg, ${color}33, ${color}0d 60%, transparent)` }}>
                      <td colSpan={14} className="border-b px-3 py-2.5" style={{ borderLeft: `4px solid ${color}`, borderBottomColor: `${color}55` }}>
                        <div className="flex flex-wrap items-center gap-2.5">
                          <button onClick={() => toggle(g)} className="text-slate-300">{isCol ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</button>
                          <span className="h-3 w-3 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
                          <span className="font-bold" style={{ color }}>{g}</span>
                          <span className="font-mono text-xs text-slate-300">({list.length} activities)</span>
                          {secStart && <span className="font-mono text-[11px] text-slate-400">{fmt(secStart)} → {fmt(secEnd)}</span>}
                          <span className="rounded px-1.5 py-0.5 font-mono text-[11px] font-bold" style={{ color, background: `${color}22` }}>{secProg}%</span>
                          {canEdit && <button onClick={() => setAddSec(g)} className="flex items-center gap-1 rounded-md border border-solar-amber/50 px-2 py-0.5 text-xs font-semibold text-solar-gold hover:bg-solar-amber/10"><Plus className="h-3 w-3" />Add Activity</button>}
                        </div>
                      </td>
                    </tr>
                    {!isCol && list.map((a) => {
                      const mm = m.an.byId.get(a.activityId)!;
                      const r = merged(a);
                      const ad = adOf(r);
                      return (
                        <tr key={a.id} className="hover:bg-dark-800/40">
                          <td className="border-b border-dark-800 px-3 py-2.5 text-center font-mono text-xs text-slate-500">{a.sNo}</td>
                          {cell && cell.id === a.activityId && cell.k === 'activityName' ? vc(a, 'activityName', 'text', null, '') : <td className={clsx('max-w-[420px] border-b border-dark-800 px-3', canEdit && 'cursor-cell hover:bg-solar-amber/10')} title={canEdit ? 'Double-click to edit name' : undefined} onDoubleClick={() => canEdit && setCell({ id: a.activityId, k: 'activityName' })}>
                            <div className="flex items-center gap-2">
                              <span className={clsx('truncate font-medium', mm.critical ? 'text-rose-200' : 'text-slate-100')} title={`${a.activityId} · ${r.activityName}`}>{r.activityName}</span>
                              {a.isMilestone && <span className="shrink-0 rounded border border-solar-amber/50 bg-solar-amber/15 px-1.5 text-[9px] font-bold uppercase text-solar-gold">Milestone</span>}
                              {r.status === 'On Hold' && <PauseCircle className="h-3.5 w-3.5 shrink-0 text-solar-amber" />}
                            </div>
                          </td>}
                          {colEdit && canEdit ? (
                            <>
                              {cellIn(a, 'plannedDuration', 'number', { min: 0 })}
                              {cellIn(a, 'plannedStartDate', 'date')}
                              {cellIn(a, 'plannedEndDate', 'date')}
                              {cellIn(a, 'actualDuration', 'number', { min: 1, placeholder: 'auto' })}
                              {cellIn(a, 'actualStartDate', 'date')}
                              {cellIn(a, 'actualEndDate', 'date')}
                              {cellIn(a, 'progressPercent', 'number', { min: 0, max: 100 })}
                            </>
                          ) : (
                            <>
                              {vc(a, 'plannedDuration', 'number', a.isMilestone ? '◆' : `${r.plannedDuration} d`, 'border-b border-dark-800 text-center font-mono text-solar-gold', { min: 0 })}
                              {vc(a, 'plannedStartDate', 'date', fmt(r.plannedStartDate), 'border-b border-dark-800 text-center font-mono text-slate-200')}
                              {vc(a, 'plannedEndDate', 'date', fmt(r.plannedEndDate), 'border-b border-dark-800 text-center font-mono text-slate-200')}
                              {vc(a, 'actualDuration', 'number', ad != null ? `${ad} d` : '—', 'border-b border-dark-800 text-center font-mono text-cyan-300', { min: 1 })}
                              {vc(a, 'actualStartDate', 'date', fmt(r.actualStartDate) || '—', 'border-b border-dark-800 text-center font-mono text-slate-200')}
                              {vc(a, 'actualEndDate', 'date', fmt(r.actualEndDate) || '—', 'border-b border-dark-800 text-center font-mono text-slate-200')}
                              {vc(a, 'progressPercent', 'number', `${r.progressPercent}%`, clsx('border-b border-dark-800 text-center font-mono font-semibold', r.progressPercent >= 100 ? 'text-emerald-300' : r.progressPercent > 0 ? 'text-solar-gold' : 'text-slate-400'), { min: 0, max: 100 })}
                            </>
                          )}
                          <td className="border-b border-dark-800 px-2 text-center">
                            <div className="flex items-center justify-center gap-1.5"><StatusBadge status={mm.status} />{mm.delayDays > 0 && <span className="font-mono text-[11px] text-brand-rose">+{mm.delayDays}d</span>}</div>
                          </td>
                          {colEdit && canEdit ? (
                            <>
                              <td className={clsx('border-b border-dark-800 p-0', draft[a.activityId] && 'incharge' in draft[a.activityId] && 'bg-solar-amber/15')}>
                                <input className="sheet-input min-w-[150px]" list="incharge-list" placeholder="Name" value={r.incharge ?? ''} onChange={(e) => change(a, 'incharge', e.target.value)} />
                              </td>
                              <td className={clsx('border-b border-dark-800 p-0', draft[a.activityId] && 'delayReason' in draft[a.activityId] && 'bg-solar-amber/15')}>
                                <input className={clsx('sheet-input min-w-[200px]', mm.delayDays > 0 && !r.delayReason && 'placeholder:text-rose-400')} placeholder={mm.delayDays > 0 ? 'Why is it delayed?' : ''} value={r.delayReason ?? ''} onChange={(e) => change(a, 'delayReason', e.target.value)} />
                              </td>
                            </>
                          ) : (
                            <>
                              {vc(a, 'incharge', 'text', r.incharge ? <span className="flex items-center gap-1.5 truncate text-violet-200"><UserRound className="h-3.5 w-3.5 shrink-0" />{r.incharge}</span> : <span className="text-slate-600">—</span>, 'max-w-[180px] border-b border-dark-800 px-3', { placeholder: 'Staff name' })}
                              {vc(a, 'delayReason', 'text', r.delayReason ? <span className="block truncate text-rose-200" title={r.delayReason}>{r.delayReason}</span>
                                  : mm.delayDays > 0 ? <span className="flex items-center gap-1 text-xs text-rose-400"><AlertTriangle className="h-3.5 w-3.5" />Reason needed</span> : <span className="text-slate-600">—</span>, 'max-w-[240px] border-b border-dark-800 px-3', { placeholder: 'Why is it delayed?' })}
                            </>
                          )}
                          {colEdit && canEdit ? cellIn(a, 'inchargePerf', 'number', { min: 0, max: 100, placeholder: 'auto' }) : (() => {
                            // Completed = 100%, not completed = 0%, unless a value was typed in (double-click to edit, clear it to go back to auto).
                            const p = activityPerformance(r, cal, m.today) ?? 0;
                            const manual = r.inchargePerf != null;
                            return vc(a, 'inchargePerf', 'number', <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 font-mono text-xs font-bold" style={{ color: BAND_COLORS[bandOf(p)], background: `${BAND_COLORS[bandOf(p)]}1f` }} title={manual ? 'Entered manually (clear the cell to use automatic 100% / 0%)' : 'Automatic: completed = 100%, not completed = 0%'}>{p}%{manual && <Pencil className="h-2.5 w-2.5 opacity-70" />}</span>,
                              'border-b border-dark-800 px-2 text-center', { min: 0, max: 100, placeholder: 'auto' });
                          })()}
                          <td className="border-b border-dark-800 px-2 text-center">
                            <button disabled={!canEdit} onClick={() => setEditRow(byId.get(a.activityId) ?? a)} className="inline-flex items-center gap-1 rounded-md border border-brand-blue/50 bg-brand-blue/10 px-2.5 py-1 text-xs font-semibold text-blue-300 hover:bg-brand-blue/20 disabled:opacity-40"><Pencil className="h-3 w-3" />Edit</button>
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-4 border-t border-dark-700 bg-dark-900 px-4 py-2.5 font-mono text-xs text-slate-400">
          <span>Total Rows: <b className="text-white">{activities.length} Activities</b></span>
          <span>Completed: <b className="text-emerald-300">{m.kpis.completed}</b></span>
          <span>In Progress: <b className="text-solar-gold">{m.kpis.inProgress}</b></span>
          <span>Delayed: <b className="text-brand-rose">{m.kpis.delayed}</b></span>
          {canEdit && <span className="text-slate-500">Tip: double-click any cell to edit · Enter saves · Esc cancels</span>}
          <span className="ml-auto flex items-center gap-1.5">{dirty ? <span className="text-solar-gold">{dirty} unsaved row{dirty > 1 ? 's' : ''}. Click Save.</span> : <><CheckCircle2 className="h-4 w-4 text-brand-emerald" /><span className="text-emerald-300">All changes saved permanently</span></>}</span>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Progress Distribution" subtitle="Activities by % complete"><VBars data={hist} xKey="name" bars={[{ key: 'n', name: 'Activities', color: C.amber }]} height={200} /></Card>
        <Card title="Monthly Workload by Department" subtitle="Activity-weeks planned per month" className="xl:col-span-2"><VBars data={load} xKey="month" stacked height={200} bars={DEPARTMENTS.map((d) => ({ key: d, name: d, color: DEPT_COLORS[d] }))} /></Card>
      </div>

      <datalist id="incharge-list">{inchargeNames.map((n) => <option key={n} value={n} />)}</datalist>
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} />
      {addSec && <AddActivityModal open onClose={() => setAddSec(null)} initialSection={addSec} />}
      {editRow && <EditActivityModal act={editRow} onClose={() => setEditRow(null)} />}
    </div>
  );
}

function EditActivityModal({ act, onClose }: { act: Activity; onClose: () => void }) {
  const { project, applyUpdate, toast, cal, user } = useApp();
  const [r, setR] = useState<Activity>(act);
  const [busy, setBusy] = useState('');
  const set = (k: string, v: unknown) => setR((cur) => ({ ...cur, ...derive(cal, cur, k, v) }) as Activity);
  const custom = act.activityId.startsWith('CUS-');
  const ad = actualDur(cal, r);
  const save = async () => {
    const p: Record<string, unknown> = {};
    for (const k of ['activityName', 'section', 'department', 'plannedDuration', 'plannedStartDate', 'plannedEndDate', 'actualStartDate', 'actualEndDate', 'progressPercent', 'status', 'remarks', 'incharge', 'delayReason', 'inchargePerf'] as const)
      if (String(r[k] ?? '') !== String(act[k] ?? '')) p[k] = r[k];
    if (!Object.keys(p).length) return onClose();
    setBusy('save');
    try {
      applyUpdate(await api.updateActivities(project!.id, { activities: [{ activityId: act.activityId, ...p }] as never }));
      toast(`${act.activityId} saved`);
      onClose();
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setBusy('');
    }
  };
  const del = async () => {
    if (!confirm(`Delete custom activity ${act.activityId}?`)) return;
    setBusy('del');
    try {
      applyUpdate(await api.updateActivities(project!.id, { deleteIds: [act.activityId] }));
      toast(`${act.activityId} deleted`);
      onClose();
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setBusy('');
    }
  };
  return (
    <Modal open onClose={onClose} title={<span>Edit activity <span className="font-mono text-solar-gold">{act.activityId}</span></span>} wide>
      <div className="grid gap-3 md:grid-cols-3">
        <div className="md:col-span-3"><Field label="Activity name"><Input className="w-full" value={r.activityName} onChange={(e) => set('activityName', e.target.value)} /></Field></div>
        <Field label="Section"><Select value={r.section} onChange={(e) => set('section', e.target.value)}>{[...new Set([r.section, ...ORDER])].map((s) => <option key={s}>{s}</option>)}</Select></Field>
        <Field label="Department"><Select value={String(r.department)} onChange={(e) => set('department', e.target.value)}>{DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}</Select></Field>
        <Field label="Progress %"><Input className="w-full" type="number" min={0} max={100} value={r.progressPercent} onChange={(e) => set('progressPercent', e.target.value)} /></Field>
      </div>
      <div className="mt-4 grid gap-3 rounded-xl border border-dark-700 bg-dark-950/50 p-3 md:grid-cols-3">
        <Field label="Planned duration (working days)"><Input className="w-full" type="number" min={0} disabled={r.isMilestone} value={r.plannedDuration} onChange={(e) => set('plannedDuration', e.target.value)} /></Field>
        <Field label="Planned start"><Input className="w-full" type="date" value={r.plannedStartDate} onChange={(e) => set('plannedStartDate', e.target.value)} /></Field>
        <Field label="Planned end"><Input className="w-full" type="date" value={r.plannedEndDate} onChange={(e) => set('plannedEndDate', e.target.value)} /></Field>
        <Field label="Actual duration (working days)"><Input className="w-full" type="number" min={1} placeholder="auto" value={ad ?? ''} onChange={(e) => set('actualDuration', e.target.value)} /></Field>
        <Field label="Actual start"><Input className="w-full" type="date" value={r.actualStartDate ?? ''} onChange={(e) => set('actualStartDate', e.target.value)} /></Field>
        <Field label="Actual end"><Input className="w-full" type="date" value={r.actualEndDate ?? ''} onChange={(e) => set('actualEndDate', e.target.value)} /></Field>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <Field label="Hold">
          <button type="button" onClick={() => set('status', r.status === 'On Hold' ? 'Active' : 'On Hold')} className={clsx('flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold', r.status === 'On Hold' ? 'border-solar-amber bg-solar-amber/15 text-solar-gold' : 'border-dark-600 text-slate-300')}>
            <PauseCircle className="h-4 w-4" />{r.status === 'On Hold' ? 'On Hold (click to release)' : 'Not on hold'}
          </button>
        </Field>
        <Field label="Activity incharge"><Input className="w-full" list="incharge-list" value={r.incharge ?? ''} onChange={(e) => set('incharge', e.target.value)} placeholder="Staff name" /></Field>
        <Field label="Incharge performance % (blank = auto)"><Input className="w-full" type="number" min={0} max={100} placeholder={r.progressPercent >= 100 ? 'auto: 100' : 'auto: 0'} value={r.inchargePerf ?? ''} onChange={(e) => setR((cur) => ({ ...cur, inchargePerf: e.target.value === '' ? null : Number(e.target.value) }))} /></Field>
        <Field label="Delay reason (if delayed)"><Input className="w-full" value={r.delayReason ?? ''} onChange={(e) => set('delayReason', e.target.value)} placeholder="e.g. Land owner dispute, material not delivered" /></Field>
        <div className="md:col-span-3"><Field label="Remarks / hold reason"><Input className="w-full" value={r.remarks ?? ''} onChange={(e) => set('remarks', e.target.value)} /></Field></div>
      </div>
      <div className="mt-5 flex items-center gap-2">
        {custom && user.canEdit && <Button variant="danger" loading={busy === 'del'} onClick={del}><Trash2 className="h-4 w-4" />Delete</Button>}
        <span className="flex-1 text-xs text-slate-500">Dates follow the working calendar: Sundays and gazetted holidays are skipped.</span>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button loading={busy === 'save'} onClick={save}><Save className="h-4 w-4" />Save activity</Button>
      </div>
    </Modal>
  );
}

export function AddActivityModal({ open, onClose, initialSection = CUSTOM_SECTION }: { open: boolean; onClose: () => void; initialSection?: string }) {
  const { project, activities, applyUpdate, toast, user, cal } = useApp();
  const [f, setF] = useState({ activityName: '', section: initialSection, department: user.department, plannedStartDate: project?.plannedStartDate ?? '', plannedDuration: 5 });
  const [busy, setBusy] = useState(false);
  const nextId = () => {
    const ids = new Set(activities.map((a) => a.activityId));
    let n = activities.filter((a) => a.activityId.startsWith('CUS-')).length;
    let id: string;
    do id = `CUS-${String(++n).padStart(3, '0')}`; while (ids.has(id));
    return id;
  };
  const end = isValidIso(f.plannedStartDate) && f.plannedDuration > 0 ? cal.finishFrom(f.plannedStartDate, f.plannedDuration) : f.plannedStartDate;
  const submit = async () => {
    if (!f.activityName.trim()) return toast('Activity name required', 'err');
    setBusy(true);
    try {
      applyUpdate(await api.updateActivities(project!.id, { activities: [{ activityId: nextId(), ...f, plannedEndDate: end }] as never }));
      toast('Activity added');
      onClose();
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Add project-specific activity">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><Field label="Activity name"><Input className="w-full" value={f.activityName} onChange={(e) => setF({ ...f, activityName: e.target.value })} /></Field></div>
        <Field label="Section"><Select value={f.section} onChange={(e) => setF({ ...f, section: e.target.value })}>{ORDER.map((s) => <option key={s}>{s}</option>)}</Select></Field>
        <Field label="Department"><Select value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })}>{DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}</Select></Field>
        <Field label="Planned start"><Input className="w-full" type="date" value={f.plannedStartDate} onChange={(e) => setF({ ...f, plannedStartDate: e.target.value })} /></Field>
        <Field label="Duration (working days)"><Input className="w-full" type="number" min={0} value={f.plannedDuration} onChange={(e) => setF({ ...f, plannedDuration: Number(e.target.value) })} /></Field>
      </div>
      <p className="mt-3 text-xs text-slate-400">Planned end: <b className="font-mono text-solar-gold">{fmt(end)}</b> (working calendar)</p>
      <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={busy}><Plus className="h-4 w-4" />Add activity</Button></div>
    </Modal>
  );
}

