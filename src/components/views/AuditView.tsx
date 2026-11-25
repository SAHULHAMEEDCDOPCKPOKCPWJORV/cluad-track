'use client';
import { useEffect, useMemo, useState } from 'react';
import { Download, RefreshCw, Search, History } from 'lucide-react';
import { useApp } from '../AppShell';
import { Card, Button, C, DEPT_COLORS, Select, Input, Badge, Spinner, Segmented, SERIES } from '../ui';
import { VBars, Donut, Legendish, HBars } from '../charts';
import { api } from '@/lib/api';
import type { AuditLog } from '@/lib/types';
import { addDays, todayIso, fmt } from '@/lib/calendar';
import { downloadBlob } from '@/lib/excelImport';

const ACTION_COLORS: Record<string, string> = {
  ACTIVITY_UPDATED: C.cyan, SCHEDULE_IMPORTED: C.violet, ACTIVITY_ADDED: C.emerald, ACTIVITY_DELETED: C.rose, HOLD_APPLIED: C.amber, HOLD_RELEASED: C.emerald,
  PROJECT_CREATED: C.gold, PROJECT_UPDATED: C.blue, PROJECT_DELETED: C.rose, RESCHEDULED: C.orange, REBASELINED: C.orange, LOGIN: C.slate,
};

export default function AuditView() {
  const { project, toast } = useApp();
  const [scope, setScope] = useState<'project' | 'all'>(project ? 'project' : 'all');
  const [logs, setLogs] = useState<AuditLog[] | null>(null);
  const [q, setQ] = useState('');
  const [action, setAction] = useState('');
  const [dept, setDept] = useState('');

  const load = () => {
    setLogs(null);
    api.audit(scope === 'project' ? project?.id : undefined).then((r) => setLogs(r.logs)).catch((e) => { toast(e.message, 'err'); setLogs([]); });
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [scope, project?.id]);

  const view = useMemo(() => (logs ?? []).filter((l) => (!action || l.action === action) && (!dept || l.department === dept) && (!q || `${l.activityId} ${l.activityName} ${l.userEmail} ${l.fieldName} ${l.oldValue} ${l.newValue} ${l.projectName}`.toLowerCase().includes(q.toLowerCase()))), [logs, action, dept, q]);

  const charts = useMemo(() => {
    const L = logs ?? [];
    const today = todayIso();
    const days: { day: string; date: string; [k: string]: string | number }[] = [];
    for (let i = 29; i >= 0; i--) { const d = addDays(today, -i); days.push({ day: fmt(d).slice(0, 5), date: d, Edits: 0, Imports: 0, Other: 0 }); }
    const idx = new Map(days.map((d, i) => [d.date, i]));
    const byDept: Record<string, number> = {};
    const byAction: Record<string, number> = {};
    const byField: Record<string, number> = {};
    for (const l of L) {
      const d = l.timestamp.slice(0, 10);
      const i = idx.get(d);
      if (i != null) {
        const key = l.action === 'ACTIVITY_UPDATED' ? 'Edits' : l.action === 'SCHEDULE_IMPORTED' ? 'Imports' : 'Other';
        (days[i][key] as number)++;
      }
      if (l.department) byDept[l.department] = (byDept[l.department] ?? 0) + 1;
      byAction[l.action] = (byAction[l.action] ?? 0) + 1;
      if (l.fieldName) byField[l.fieldName] = (byField[l.fieldName] ?? 0) + 1;
    }
    return {
      days,
      dept: Object.entries(byDept).map(([name, value]) => ({ name, value, color: DEPT_COLORS[name] ?? C.slate })),
      actions: Object.entries(byAction).sort((a, b) => b[1] - a[1]).map(([name, value], i) => ({ name, value, color: ACTION_COLORS[name] ?? SERIES[i % SERIES.length] })),
      fields: Object.entries(byField).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, n]) => ({ name, Changes: n })),
    };
  }, [logs]);

  const exportCsv = () => {
    const head = ['Timestamp', 'Project', 'User', 'Department', 'Action', 'Activity ID', 'Activity', 'Field', 'Old value', 'New value'];
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = view.map((l) => [new Date(l.timestamp).toLocaleString('en-IN'), l.projectName, l.userEmail, l.department, l.action, l.activityId, l.activityName, l.fieldName, l.oldValue, l.newValue].map(esc).join(','));
    downloadBlob([head.join(','), ...rows].join('\n'), `swelect_audit_${todayIso()}.csv`, 'text/csv');
  };

  if (!logs) return <Spinner label="Loading audit trail…" />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented value={scope} onChange={setScope} options={[...(project ? [{ value: 'project' as const, label: `This project` }] : []), { value: 'all' as const, label: 'All activity' }]} />
        <span className="text-sm text-slate-400">{logs.length} audit entries</span>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={load}><RefreshCw className="h-3.5 w-3.5" />Refresh</Button>
          <Button variant="outline" size="sm" onClick={exportCsv}><Download className="h-3.5 w-3.5" />CSV</Button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Change Activity – last 30 days" className="xl:col-span-2">
          <VBars data={charts.days} xKey="day" stacked height={220} bars={[{ key: 'Edits', name: 'Field edits', color: C.cyan }, { key: 'Imports', name: 'Imports', color: C.violet }, { key: 'Other', name: 'Other', color: C.slate }]} />
        </Card>
        <Card title="Changes by Department">
          <Donut data={charts.dept} height={160} center={String(charts.dept.reduce((s, d) => s + d.value, 0))} sub="entries" />
          <div className="mt-3"><Legendish items={charts.dept} /></div>
        </Card>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Actions"><HBars data={charts.actions.map((a) => ({ name: a.name.replace(/_/g, ' ').toLowerCase(), Count: a.value }))} keys={[{ key: 'Count', name: 'Count', color: C.amber }]} unit="" /></Card>
        <Card title="Most-changed Fields"><HBars data={charts.fields} keys={[{ key: 'Changes', name: 'Changes', color: C.cyan }]} unit="" /></Card>
      </div>

      <Card bodyClass="p-0" title={<span className="flex items-center gap-1.5"><History className="h-4 w-4 text-solar-amber" />Permanent Audit Trail</span>} subtitle="Every field change with user, department, time, old and new value">
        <div className="flex flex-wrap gap-2 border-b border-dark-700 px-4 py-3">
          <div className="relative w-64"><Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-500" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="py-1.5 pl-8 text-xs" /></div>
          <Select value={action} onChange={(e) => setAction(e.target.value)} className="w-auto py-1.5 text-xs"><option value="">All actions</option>{charts.actions.map((a) => <option key={a.name}>{a.name}</option>)}</Select>
          <Select value={dept} onChange={(e) => setDept(e.target.value)} className="w-auto py-1.5 text-xs"><option value="">All departments</option>{charts.dept.map((d) => <option key={d.name}>{d.name}</option>)}</Select>
          <span className="self-center text-xs text-slate-500">{view.length} shown</span>
        </div>
        <div className="max-h-[60vh] overflow-auto">
          <table className="w-full min-w-[1000px] text-xs">
            <thead className="sticky top-0 bg-dark-800 text-left text-slate-300">
              <tr>{['Timestamp', 'User', 'Dept', 'Action', 'Project', 'Activity', 'Field', 'Old value', 'New value'].map((h) => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}</tr>
            </thead>
            <tbody>
              {view.slice(0, 1000).map((l) => (
                <tr key={l.id} className="border-t border-dark-800 hover:bg-dark-800/50">
                  <td className="whitespace-nowrap px-3 py-1.5 font-mono text-slate-400">{new Date(l.timestamp).toLocaleString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                  <td className="px-3 text-slate-300">{l.userEmail ?? 'system'}</td>
                  <td className="px-3 font-semibold" style={{ color: DEPT_COLORS[l.department ?? ''] }}>{l.department}</td>
                  <td className="px-3"><Badge color={ACTION_COLORS[l.action] ?? C.slate}>{l.action.replace(/_/g, ' ')}</Badge></td>
                  <td className="max-w-[160px] truncate px-3 text-slate-400">{l.projectName ?? (l.projectId === 'GLOBAL' ? '—' : l.projectId)}</td>
                  <td className="max-w-[220px] truncate px-3 text-slate-200" title={l.activityName ?? ''}>{l.activityId && <span className="mr-1 font-mono text-slate-500">{l.activityId}</span>}{l.activityName}</td>
                  <td className="px-3 font-mono text-slate-400">{l.fieldName}</td>
                  <td className="max-w-[180px] truncate px-3 text-rose-300/80" title={l.oldValue ?? ''}>{l.oldValue}</td>
                  <td className="max-w-[220px] truncate px-3 text-emerald-300" title={l.newValue ?? ''}>{l.newValue}</td>
                </tr>
              ))}
              {!view.length && <tr><td colSpan={9} className="px-3 py-8 text-center text-slate-500">No audit entries yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
