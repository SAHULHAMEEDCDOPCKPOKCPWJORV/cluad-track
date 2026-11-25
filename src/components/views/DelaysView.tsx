'use client';
import { Fragment, useMemo, useState } from 'react';
import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis, Cell, BarChart, Bar, LabelList } from 'recharts';
import { AlertTriangle, PauseCircle, Crosshair, CalendarX2, ChevronDown, ChevronRight, GitBranch, PlayCircle } from 'lucide-react';
import { useApp } from '../AppShell';
import { Card, C, STATUS_COLORS, Badge, StatusBadge, Button, Modal, Field, Input, Segmented, tooltipStyle, Empty } from '../ui';
import { VBars, Donut, Legendish } from '../charts';
import { buildRisks, type RiskItem } from '@/lib/report';
import { fmt } from '@/lib/calendar';
import { api } from '@/lib/api';

const SEV_COLORS: Record<string, string> = { Critical: C.rose, High: C.orange, Medium: C.amber, Low: C.cyan };

export default function DelaysView() {
  const { activities, model, project, applyUpdate, toast, user } = useApp();
  const m = model!;
  const risks = useMemo(() => buildRisks(activities, m.an), [activities, m]);
  const [section, setSection] = useState('ALL');
  const [filter, setFilter] = useState<'all' | 'root' | 'hold' | 'critical'>('all');
  const [open, setOpen] = useState<string | null>(null);
  const [holdFor, setHoldFor] = useState<RiskItem | { activityId: string; activityName: string } | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const byAct = new Map(activities.map((a) => [a.activityId, a]));
  const roots = risks.filter((r) => m.an.byId.get(r.activityId)!.rootCause);
  const holds = risks.filter((r) => r.status === 'On Hold');
  const sectionNames = m.sections.map((s) => s.key);
  const shown = risks.filter((r) => (section === 'ALL' || r.section === section) && (filter === 'all' || (filter === 'root' && m.an.byId.get(r.activityId)!.rootCause) || (filter === 'hold' && r.status === 'On Hold') || (filter === 'critical' && r.critical)));

  const perSection = m.sections.map((s) => {
    const rs = risks.filter((r) => r.section === s.key);
    return {
      name: s.key.split(' ')[0],
      full: s.key,
      'Root cause': rs.filter((r) => m.an.byId.get(r.activityId)!.rootCause).length,
      Inherited: rs.filter((r) => !m.an.byId.get(r.activityId)!.rootCause && r.status !== 'On Hold').length,
      'On hold': rs.filter((r) => r.status === 'On Hold').length,
    };
  });
  const impact = roots.filter((r) => r.finishImpact > 0).sort((a, b) => b.finishImpact - a.finishImpact).slice(0, 10).map((r) => ({ name: r.activityId, value: r.finishImpact, label: r.activityName }));
  const scatter = risks.filter((r) => r.delayDays > 0).map((r) => ({ x: Math.max(0, r.totalFloat), y: r.delayDays, z: Math.max(1, r.downstreamDelayed), id: r.activityId, name: r.activityName, sev: r.severity }));
  const sev = (['Critical', 'High', 'Medium', 'Low'] as const).map((s) => ({ name: s, value: risks.filter((r) => r.severity === s).length, color: SEV_COLORS[s] }));

  const doHold = async (activityId: string, on: boolean, remarks?: string) => {
    setBusy(true);
    try {
      applyUpdate(await api.updateActivities(project!.id, { activities: [{ activityId, status: on ? 'On Hold' : 'Active', ...(remarks != null ? { remarks } : {}) }] as never }));
      toast(on ? `${activityId} put on hold` : `${activityId} released`);
      setHoldFor(null);
      setReason('');
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  };

  const stat = (label: string, value: string | number, icon: React.ReactNode, color: string, sub?: string) => (
    <div className="flex items-center gap-3 rounded-xl border border-dark-700 bg-dark-850/80 p-4">
      <div className="flex h-11 w-11 items-center justify-center rounded-lg" style={{ background: `${color}22`, color }}>{icon}</div>
      <div><div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div><div className="text-2xl font-bold text-white">{value}</div>{sub && <div className="text-[11px]" style={{ color }}>{sub}</div>}</div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {stat('Delayed activities', m.kpis.delayed, <AlertTriangle className="h-5 w-5" />, C.rose, `max +${m.kpis.maxDelay} working days`)}
        {stat('Root causes', roots.length, <Crosshair className="h-5 w-5" />, C.orange, 'delay originates here')}
        {stat('On hold', holds.length, <PauseCircle className="h-5 w-5" />, C.amber)}
        {stat('Project finish impact', m.kpis.projectDelay > 0 ? `+${m.kpis.projectDelay}d` : '0d', <CalendarX2 className="h-5 w-5" />, m.kpis.projectDelay > 0 ? C.rose : C.emerald, `forecast ${fmt(m.kpis.forecastFinish)}`)}
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Delay Sources by Section" subtitle="Root-cause vs inherited (ripple) delays vs holds" className="xl:col-span-2">
          <VBars data={perSection} xKey="name" stacked height={250} bars={[{ key: 'Root cause', name: 'Root cause', color: C.rose }, { key: 'Inherited', name: 'Inherited from predecessors', color: C.orange }, { key: 'On hold', name: 'On hold', color: C.amber }]} />
        </Card>
        <Card title="Risk Severity" subtitle={`${risks.length} open delay / hold items`}>
          <Donut data={sev} height={180} center={String(risks.length)} sub="items" />
          <div className="mt-3"><Legendish items={sev} /></div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Project Finish Impact by Root Cause" subtitle="Working days each root-cause delay pushes the final completion">
          {impact.length ? (
            <ResponsiveContainer width="100%" height={Math.max(180, impact.length * 30 + 30)}>
              <BarChart data={impact} layout="vertical" margin={{ left: 0, right: 40, top: 4, bottom: 4 }}>
                <CartesianGrid stroke={C.grid} strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" stroke={C.axis} fontSize={11} tickFormatter={(v) => `${v}d`} />
                <YAxis type="category" dataKey="name" stroke={C.axis} fontSize={11} width={64} />
                <Tooltip {...tooltipStyle} formatter={(v, _n, p) => [`+${v} working days`, (p.payload as { label: string }).label]} cursor={{ fill: '#ffffff08' }} />
                <Bar dataKey="value" fill={C.rose} radius={[0, 4, 4, 0]} barSize={14} isAnimationActive={false}>
                  <LabelList dataKey="value" position="right" fill="#fda4af" fontSize={11} formatter={(v) => `+${v}d`} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <p className="py-10 text-center text-sm text-slate-400">No root-cause delay currently moves the project finish date.</p>}
        </Card>
        <Card title="Delay vs Float Exposure" subtitle="Bubble size = delayed downstream activities. Top-left = critical exposure">
          <ResponsiveContainer width="100%" height={260}>
            <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: -8 }}>
              <CartesianGrid stroke={C.grid} strokeDasharray="3 3" />
              <XAxis type="number" dataKey="x" name="Total float" stroke={C.axis} fontSize={11} tickFormatter={(v) => `${v}d`} label={{ value: 'Total float (wd)', position: 'insideBottom', offset: -4, fill: C.axis, fontSize: 11 }} />
              <YAxis type="number" dataKey="y" name="Delay" stroke={C.axis} fontSize={11} tickFormatter={(v) => `${v}d`} />
              <ZAxis type="number" dataKey="z" range={[40, 400]} />
              <Tooltip {...tooltipStyle} cursor={{ strokeDasharray: '3 3' }} content={({ payload }) => {
                const p = payload?.[0]?.payload as (typeof scatter)[number] | undefined;
                return p ? <div className="rounded-lg border border-dark-600 bg-dark-850 p-2 text-xs"><b className="text-solar-gold">{p.id}</b> {p.name}<br />Delay +{p.y}d · Float {p.x}d · {p.z} downstream</div> : null;
              }} />
              <Scatter data={scatter} isAnimationActive={false}>
                {scatter.map((s, i) => <Cell key={i} fill={SEV_COLORS[s.sev]} fillOpacity={0.75} />)}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <Card bodyClass="p-0" title="Section-wise Delays & Hold Register" subtitle="Expand a row to see its downstream successor ripple"
        right={<Segmented value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All' }, { value: 'root', label: 'Root causes' }, { value: 'critical', label: 'Critical' }, { value: 'hold', label: 'Holds' }]} />}>
        <div className="flex gap-1 overflow-x-auto border-b border-dark-700 px-3 py-2">
          {['ALL', ...sectionNames].map((s) => {
            const n = s === 'ALL' ? risks.length : risks.filter((r) => r.section === s).length;
            return (
              <button key={s} onClick={() => setSection(s)} className={`whitespace-nowrap rounded-md px-2.5 py-1 text-xs ${section === s ? 'bg-solar-amber text-dark-950' : 'text-slate-400 hover:bg-dark-750'}`}>
                {s === 'ALL' ? 'All sections' : s} <span className="opacity-70">({n})</span>
              </button>
            );
          })}
        </div>
        {shown.length === 0 ? (
          <div className="p-6"><Empty title="No delays here" text="Nothing matches this filter. Activities on schedule do not appear in this register." /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-xs">
              <thead className="bg-dark-800 text-left text-slate-300">
                <tr>{['', 'Activity', 'Section', 'Status', 'Severity', 'Delay', 'Own slip', 'Float', 'Finish impact', 'Downstream', 'Remarks / hold reason', ''].map((h, i) => <th key={i} className="px-2 py-2 font-semibold">{h}</th>)}</tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const mm = m.an.byId.get(r.activityId)!;
                  const isOpen = open === r.activityId;
                  return (
                    <Fragment key={r.activityId}>
                      <tr className="border-t border-dark-800 hover:bg-dark-800/50">
                        <td className="px-2"><button onClick={() => setOpen(isOpen ? null : r.activityId)} className="text-slate-400">{isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button></td>
                        <td className="max-w-[260px] px-2 py-2"><div className="flex items-center gap-1.5 font-mono text-slate-400">{r.activityId}{mm.rootCause && <Badge color={C.rose}>ROOT</Badge>}{r.critical && <Badge color={C.violet}>CP</Badge>}</div><div className="truncate text-slate-100">{r.activityName}</div></td>
                        <td className="max-w-[160px] truncate px-2 text-slate-400">{r.section}</td>
                        <td className="px-2"><StatusBadge status={r.status} /></td>
                        <td className="px-2"><Badge color={SEV_COLORS[r.severity]}>{r.severity}</Badge></td>
                        <td className="px-2 font-mono text-brand-rose">+{r.delayDays}d</td>
                        <td className="px-2 font-mono text-emerald-300">{r.ownSlip ? `+${r.ownSlip}d` : '—'}</td>
                        <td className="px-2 font-mono text-slate-300">{r.totalFloat}d</td>
                        <td className="px-2"><div className="flex items-center gap-1.5"><div className="h-1.5 w-16 overflow-hidden rounded bg-dark-700"><div className="h-full bg-brand-rose" style={{ width: `${Math.min(100, r.finishImpact * 3)}%` }} /></div><span className="font-mono">{r.finishImpact}d</span></div></td>
                        <td className="px-2 font-mono">{r.downstreamDelayed}</td>
                        <td className="max-w-[200px] truncate px-2 text-slate-400" title={r.remarks}>{r.remarks || '—'}</td>
                        <td className="px-2">
                          {user.canEdit && (r.status === 'On Hold'
                            ? <Button size="sm" variant="outline" onClick={() => doHold(r.activityId, false)} loading={busy}><PlayCircle className="h-3.5 w-3.5" />Release</Button>
                            : <Button size="sm" variant="ghost" onClick={() => { setHoldFor(r); setReason(r.remarks); }}><PauseCircle className="h-3.5 w-3.5" />Hold</Button>)}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-dark-900/70">
                          <td colSpan={12} className="px-6 py-3">
                            <div className="grid gap-4 md:grid-cols-3">
                              <div>
                                <h4 className="mb-1.5 text-[11px] font-semibold uppercase text-slate-400">Predecessors</h4>
                                {mm.predecessors.length ? mm.predecessors.map((p) => { const pm = m.an.byId.get(p)!; return <div key={p} className="flex justify-between py-0.5"><span className="truncate"><span className="font-mono text-slate-500">{p}</span> {byAct.get(p)?.activityName}</span><span className={pm.slip > 0 ? 'font-mono text-brand-rose' : 'font-mono text-brand-emerald'}>{pm.slip > 0 ? `+${pm.slip}d` : 'OK'}</span></div>; }) : <p className="text-slate-500">None (start of chain)</p>}
                              </div>
                              <div className="md:col-span-2">
                                <h4 className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold uppercase text-slate-400"><GitBranch className="h-3.5 w-3.5" />Downstream ripple ({mm.downstream.length} successors, {mm.downstreamDelayed} pushed late)</h4>
                                <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
                                  {mm.downstream.map((d) => byAct.get(d)!).sort((a, b) => a.sNo - b.sNo).map((a) => {
                                    const am = m.an.byId.get(a.activityId)!;
                                    return <span key={a.activityId} title={`${a.activityName}\nForecast finish ${fmt(am.forecastEnd)}`} className="rounded border px-1.5 py-0.5 font-mono text-[10px]" style={{ borderColor: `${am.slip > 0 ? C.rose : C.emerald}66`, color: am.slip > 0 ? '#fda4af' : '#6ee7b7' }}>{a.activityId}{am.slip > 0 ? ` +${am.slip}` : ''}</span>;
                                  })}
                                </div>
                                <h4 className="mb-1 mt-3 text-[11px] font-semibold uppercase text-slate-400">Mitigation protocol</h4>
                                <ul className="list-inside list-disc space-y-0.5 text-slate-300">{r.mitigation.map((t) => <li key={t}>{t}</li>)}</ul>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={!!holdFor} onClose={() => setHoldFor(null)} title={`Put ${holdFor?.activityId} on hold`}>
        <p className="mb-3 text-sm text-slate-300">{holdFor?.activityName}</p>
        <Field label="Hold reason (shown in reports and audit trail)"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Awaiting Discom approval letter" /></Field>
        <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={() => setHoldFor(null)}>Cancel</Button><Button loading={busy} onClick={() => doHold(holdFor!.activityId, true, reason)}><PauseCircle className="h-4 w-4" />Apply hold</Button></div>
      </Modal>
      <span className="hidden" style={{ color: STATUS_COLORS.Delayed }} />
    </div>
  );
}
