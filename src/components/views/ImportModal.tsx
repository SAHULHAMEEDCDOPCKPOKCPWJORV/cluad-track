'use client';
import { useMemo, useRef, useState } from 'react';
import { Upload, FileSpreadsheet } from 'lucide-react';
import { useApp } from '../AppShell';
import { Button, C, Select, Modal, Field, Badge } from '../ui';
import { Donut, Legendish } from '../charts';
import { api } from '@/lib/api';
import { DEPARTMENTS } from '@/lib/types';
import { MASTER_ACTIVITIES, CUSTOM_SECTION } from '@/lib/master';
import { parseExcel, guessDept, type ParsedImport, type ImportRow } from '@/lib/excelImport';
import { fmt, isValidIso, todayIso } from '@/lib/calendar';

/** Excel import: the sheet's activities, dates, durations and progress are copied into the schedule. */
export default function ImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { project, activities, applyUpdate, toast, user, cal } = useApp();
  const [parsed, setParsed] = useState<ParsedImport | null>(null);
  const [replace, setReplace] = useState(true);
  const [shift, setShift] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [customDept, setCustomDept] = useState(user.department);
  const fileRef = useRef<HTMLInputElement>(null);
  const present = new Set(activities.map((a) => a.activityId));

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setErr('');
    setParsed(null);
    try {
      setParsed(await parseExcel(f));
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const setDecision = (i: number, v: string) => setParsed((p) => (p ? { ...p, rows: p.rows.map((r, j) => (j === i ? { ...r, decision: v } : r)) } : p));

  const stats = parsed
    ? {
        id: parsed.rows.filter((r) => r.decision !== 'CUSTOM' && r.decision !== 'SKIP' && r.match?.method === 'id' && r.decision === r.match.activityId).length,
        name: parsed.rows.filter((r) => r.decision !== 'CUSTOM' && r.decision !== 'SKIP' && (r.match?.method !== 'id' || r.decision !== r.match?.activityId)).length,
        custom: parsed.rows.filter((r) => r.decision === 'CUSTOM').length,
        skip: parsed.rows.filter((r) => r.decision === 'SKIP').length,
      }
    : null;

  // Exact copy by default; optionally move Sunday/holiday dates to the next working day.
  const snap = (d: unknown) => (isValidIso(d) ? (shift ? cal.nextWorking(d) : (d as string)) : null);
  const plan = useMemo(() => {
    if (!parsed) return { rows: [] as { r: ImportRow; ps: string | null; pe: string | null; as: string | null; ae: string | null; pr: number | null; calc: boolean; moved: string[] }[], moved: 0 };
    let moved = 0;
    const rows = parsed.rows.map((r) => {
      const v = r.values;
      const m: string[] = [];
      const fix = (k: 'plannedStartDate' | 'plannedEndDate' | 'actualStartDate' | 'actualEndDate', label: string) => {
        const o = v[k];
        const n = snap(o);
        if (n && n !== o) m.push(`${label} ${fmt(o as string)} → ${fmt(n)} (${cal.holidayName(o as string) ?? 'Sunday'})`);
        return n;
      };
      const ps = fix('plannedStartDate', 'Start');
      let pe = fix('plannedEndDate', 'End');
      if (ps && pe && pe < ps) pe = ps;
      const as = fix('actualStartDate', 'Act. start');
      let ae = fix('actualEndDate', 'Act. end');
      if (as && ae && ae < as) ae = as;
      // Progress: copied from the sheet; only an empty cell is worked out from the actual dates.
      const today = todayIso();
      const given = v.progressPercent == null ? null : Math.min(100, Math.max(0, Number(v.progressPercent)));
      let pr: number | null = given;
      let calc = false;
      if (given == null && as) {
        calc = true;
        if (as > today) pr = 0;
        else if (ae && ae <= today) pr = 100;
        else {
          const total = ae ? cal.countWorking(as, ae) : Math.max(1, Number(v.plannedDuration) || (ps && pe ? cal.countWorking(ps, pe) : 1));
          pr = Math.min(99, Math.max(1, Math.round((cal.countWorking(as, today) / Math.max(1, total)) * 100)));
        }
      }
      if (m.length) moved++;
      return { r, ps, pe, as, ae, pr, calc, moved: m };
    });
    return { rows, moved };
  }, [parsed, cal, shift]);

  const apply = async () => {
    if (!parsed) return;
    const patches: Record<string, unknown>[] = [];
    let customN = activities.filter((a) => a.activityId.startsWith('CUS-')).length;
    const seen = new Set<string>();
    let order = 0;
    for (const { r: row0, ps, pe, as, ae, pr } of plan.rows) {
      let r = row0;
      if (r.decision === 'SKIP') continue;
      const v = r.values;
      // sNo follows the Excel row order, so the page lists activities exactly as in the sheet.
      const p: Record<string, unknown> = { sNo: ++order };
      if (ps) p.plannedStartDate = ps;
      if (pe) p.plannedEndDate = pe;
      // Durations are copied from the sheet (recalculated only when dates were moved off Sundays/holidays).
      if (v.plannedDuration != null && (!shift || !pe)) p.plannedDuration = v.plannedDuration;
      if (v.actualDuration != null && !shift) p.actualDuration = v.actualDuration;
      if (as) p.actualStartDate = as;
      if (ae) p.actualEndDate = ae;
      // Actual dates are kept exactly as in the sheet; progress comes from the sheet or from those dates.
      if (pr != null) {
        p.progressPercent = pr;
        if (!as && pr > 0 && ps) { const today = todayIso(); p.actualStartDate = ps <= today ? ps : today; }
        if (pr >= 100 && !ae) { const today = todayIso(); p.actualEndDate = pe && pe <= today ? pe : today; }
      }
      if (!as && !ae && (pr == null || pr === 0)) { p.actualStartDate = null; p.actualEndDate = null; }
      const rem = [v.remarks, v.extra].filter(Boolean).join(' | ');
      if (rem) p.remarks = rem;
      if (v.incharge) p.incharge = v.incharge;
      if (v.delayReason) p.delayReason = v.delayReason;
      if (v.activityName) p.activityName = v.activityName;
      if (v.section) p.section = v.section;
      if (v.department && DEPARTMENTS.includes(String(v.department).toUpperCase() as never)) p.department = String(v.department).toUpperCase();
      else if (guessDept(v.section as string)) p.department = guessDept(v.section as string);
      // Two Excel rows that match the same master activity: keep both (the second becomes its own activity).
      if (r.decision !== 'CUSTOM' && seen.has(r.decision)) r = { ...r, decision: 'CUSTOM' };
      if (r.decision === 'CUSTOM') {
        let id = String(v.activityId ?? '').trim().toUpperCase();
        if (!id || present.has(id) || seen.has(id)) do id = `CUS-${String(++customN).padStart(3, '0')}`; while (present.has(id) || seen.has(id));
        seen.add(id);
        patches.push({ activityId: id, section: CUSTOM_SECTION, department: customDept, ...p, activityName: v.activityName ?? v.activityId });
      } else {
        seen.add(r.decision);
        patches.push({ activityId: r.decision, ...p });
      }
    }
    // Safety: never wipe a schedule because the file had no usable rows.
    if (!patches.length) { setErr('No activities were found in this Excel file, so nothing was changed. Check that it has an "Activity Name" column.'); return; }
    // Replace mode: activities that are not in the Excel file are removed, so the schedule matches the sheet.
    const deleteIds = replace ? activities.filter((a) => !seen.has(a.activityId)).map((a) => a.activityId) : [];
    if (replace && deleteIds.length) {
      const many = patches.length < activities.length / 2;
      const msg = many
        ? `WARNING: this file has only ${patches.length} activities, but the project has ${activities.length}. ${deleteIds.length} activities would be REMOVED.\n\nClick OK to replace the schedule, or Cancel and untick "Replace schedule" to only update matching rows.`
        : `The schedule will be replaced by this Excel: ${patches.length} activities from the file. ${deleteIds.length} old activities not in the file will be removed. Continue?`;
      if (!confirm(msg)) return;
    }
    setBusy(true);
    try {
      const res = await api.updateActivities(project!.id, { activities: patches as never, action: 'import', deleteIds });
      applyUpdate(res);
      toast(`Import applied: ${patches.length} rows${plan.moved ? `, ${plan.moved} moved off Sundays/holidays` : ''}${deleteIds.length ? `, ${deleteIds.length} removed` : ''}. All pages updated.`);
      setParsed(null);
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const legend = stats ? [
    { name: 'Matched by ID', value: stats.id, color: C.emerald },
    { name: 'Matched by name', value: stats.name, color: C.cyan },
    { name: 'Custom (new)', value: stats.custom, color: C.violet },
    { name: 'Skipped', value: stats.skip, color: C.slate },
  ] : [];

  return (
    <Modal open={open} onClose={onClose} title="Project-specific Excel import" wide>
      {!parsed ? (
        <div>
          <div onClick={() => fileRef.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files[0]); }}
            className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-dark-600 px-6 py-14 text-center hover:border-solar-amber/60">
            <FileSpreadsheet className="h-10 w-10 text-solar-amber" />
            <p className="mt-3 font-medium text-white">Drop an .xlsx or .csv schedule here, or click to browse</p>
            <p className="mt-1 text-sm text-slate-400">Rows are matched against the {MASTER_ACTIVITIES.length}-activity master list by Activity ID, then by name.</p>
            <input ref={fileRef} type="file" accept=".xlsx,.csv" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          </div>
          {err && <p className="mt-3 text-sm text-brand-rose">{err}</p>}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="md:col-span-1"><Donut height={170} center={String(parsed.rows.length)} sub="rows" data={legend} /></div>
            <div className="space-y-3 md:col-span-2">
              <Legendish items={legend} />
              <p className="text-xs text-slate-400">Sheet <b className="text-slate-200">{parsed.sheetName}</b>, header row {parsed.headerRow}. Detected columns: {Object.keys(parsed.columns).map((k) => <Badge key={k} color={C.cyan} className="mr-1 mt-1">{k}</Badge>)}</p>
              <label className="flex items-start gap-2 rounded-lg border border-solar-amber/40 bg-solar-amber/10 p-2.5 text-xs text-slate-200">
                <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} className="mt-0.5" />
                <span><b className="text-solar-gold">Replace schedule with this Excel (full paste).</b> The page will match your sheet: same activities, order, names, dates, progress, incharge, delay reason and other columns (kept in Remarks). Activities not in the file are removed.</span>
              </label>
              <label className="flex items-start gap-2 rounded-lg border border-dark-600 bg-dark-900 p-2.5 text-xs text-slate-300">
                <input type="checkbox" checked={shift} onChange={(e) => setShift(e.target.checked)} className="mt-0.5" />
                <span><b className="text-slate-100">Move Sunday/holiday dates to the next working day.</b> Leave unticked to copy every date, duration and progress % exactly as in the Excel.</span>
              </label>
              {plan.moved > 0 && <p className="rounded-lg border border-brand-cyan/40 bg-brand-cyan/10 p-2.5 text-xs text-cyan-200">{plan.moved} rows have dates on a Sunday or holiday. They will move to the next working day (shown in the table).</p>}
              <Field label="Department for custom activities">
                <Select value={customDept} onChange={(e) => setCustomDept(e.target.value)} className="w-40">{DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}</Select>
              </Field>
            </div>
          </div>
          <div className="max-h-[48vh] overflow-auto rounded-lg border border-dark-700">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-dark-800 text-left text-slate-300">
                <tr><th className="px-2 py-2">Row</th><th className="px-2">Imported activity</th><th className="px-2">Dates / %</th><th className="px-2">Match</th><th className="px-2">Master activity</th></tr>
              </thead>
              <tbody>
                {parsed.rows.map((r, i) => (
                  <tr key={i} className="border-t border-dark-800">
                    <td className="px-2 py-1.5 font-mono text-slate-500">{r.rowNo}</td>
                    <td className="max-w-[240px] px-2"><div className="font-mono text-slate-400">{r.values.activityId ?? '—'}</div><div className="truncate text-slate-100">{r.values.activityName ?? ''}</div></td>
                    <td className="whitespace-nowrap px-2 font-mono text-slate-400">{fmt(plan.rows[i]?.ps)} → {fmt(plan.rows[i]?.pe)}{plan.rows[i]?.pr != null && <span className="ml-1 text-solar-gold" title={plan.rows[i]?.calc ? 'Worked out from the actual dates' : 'From the sheet'}>{plan.rows[i]?.pr}%{plan.rows[i]?.calc ? ' (calc)' : ''}</span>}
                      {plan.rows[i]?.as && <div className="text-[10px] text-cyan-300/80">Actual {fmt(plan.rows[i]?.as)} → {fmt(plan.rows[i]?.ae) || '…'}</div>}
                      {plan.rows[i]?.moved.map((t) => <div key={t} className="text-[10px] text-cyan-300">↻ {t}</div>)}</td>
                    <td className="px-2">{r.match ? <Badge color={r.match.method === 'id' ? C.emerald : C.cyan}>{r.match.method === 'id' ? 'ID' : `${Math.round(r.match.score * 100)}%`}</Badge> : <Badge color={C.violet}>none</Badge>}</td>
                    <td className="px-2 py-1">
                      <Select value={r.decision} onChange={(e) => setDecision(i, e.target.value)} className="py-1 text-xs">
                        <option value="CUSTOM">➕ Add as custom activity</option>
                        <option value="SKIP">⏭ Skip row</option>
                        {MASTER_ACTIVITIES.map((mm) => <option key={mm.activityId} value={mm.activityId}>{mm.activityId} · {mm.name}</option>)}
                      </Select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {err && <p className="text-sm text-brand-rose">{err}</p>}
          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setParsed(null)}>Choose another file</Button>
            <Button onClick={apply} loading={busy}><Upload className="h-4 w-4" />Apply import</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
