'use client';
import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart } from 'recharts';
import { Users, Trophy, TrendingDown, AlertTriangle, MessageSquareWarning, Gauge, UserRound, ThumbsUp, ThumbsDown } from 'lucide-react';
import clsx from 'clsx';
import { useApp } from '../AppShell';
import { Card, C, STATUS_COLORS, tooltipStyle, Empty, Button } from '../ui';
import { Ring } from '../charts';
import { PageHeader } from '../Brand';
import StaffPercentPanel from '../StaffPercentPanel';
import { staffStats, BAND_COLORS, UNASSIGNED, type StaffStat } from '@/lib/performance';

const axis = { stroke: '#64748b', fontSize: 11, tickLine: false } as const;

export default function StaffView() {
  const { activities, model, project, cal, setView } = useApp();
  const m = model!;
  const all = useMemo(() => staffStats(activities, cal, m.an), [activities, cal, m]);
  const staff = all.filter((s) => s.name !== UNASSIGNED);
  const unassigned = all.find((s) => s.name === UNASSIGNED);
  const [pick, setPick] = useState('');
  const rated = staff.filter((s) => s.performance != null);
  const avg = rated.length ? Math.round((rated.reduce((x, s) => x + (s.performance ?? 0), 0) / rated.length) * 10) / 10 : null;
  const high = rated.filter((s) => s.band === 'High' || s.band === 'Good');
  const low = rated.filter((s) => s.band === 'Low' || s.band === 'Average').sort((a, b) => (a.performance ?? 0) - (b.performance ?? 0));
  const reasons = useMemo(() => {
    const mp = new Map<string, number>();
    for (const s of all) for (const r of s.reasons) mp.set(r.reason, (mp.get(r.reason) ?? 0) + r.count);
    const missing = all.reduce((x, s) => x + s.missingReasons, 0);
    const arr = [...mp.entries()].map(([name, value]) => ({ name: name.length > 38 ? `${name.slice(0, 36)}…` : name, value })).sort((a, b) => b.value - a.value).slice(0, 8);
    if (missing) arr.push({ name: 'Reason not entered', value: missing });
    return arr;
  }, [all]);

  if (!staff.length)
    return (
      <div className="space-y-5">
        <PageHeader title="Activity Incharge Performance" badge={`${activities.length} Activities`} subtitle={project!.name} />
        <Empty icon={<Users className="h-10 w-10" />} title="No activity incharges assigned yet"
          text="Open Master Schedule, click Column Edit, type a staff name in the Activity Incharge column for each activity, and click Save. Performance for each person appears here."
          action={<Button onClick={() => setView('schedule')}>Go to Master Schedule</Button>} />
      </div>
    );

  const top = rated[0];
  const bottom = rated[rated.length - 1];
  const rank = rated.map((s) => ({ name: s.name, perf: s.performance, band: s.band }));
  const stack = staff.map((s) => ({ name: s.name, Completed: s.completed, 'In Progress': s.inProgress, Delayed: s.delayed, 'On Hold': s.onHold, 'Not due': Math.max(0, s.total - s.completed - s.inProgress - s.delayed - s.onHold) }));
  const radar = staff.slice(0, 8).map((s) => ({
    name: s.name,
    Performance: s.performance ?? 0,
    'On-time %': s.completed ? Math.round((s.onTime / s.completed) * 100) : 0,
    'Completion %': Math.round((s.completed / s.total) * 100),
  }));
  const shown = pick ? staff.filter((s) => s.name === pick) : staff;

  const tile = (l: string, v: string | number, icon: React.ReactNode, c: string, sub?: string) => (
    <div className="flex items-center gap-3 rounded-xl border border-dark-700 bg-[#0b111c] p-4">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg" style={{ background: `${c}22`, color: c }}>{icon}</div>
      <div className="min-w-0"><div className="text-[11px] uppercase tracking-wide text-slate-400">{l}</div><div className="truncate text-xl font-bold text-white">{v}</div>{sub && <div className="truncate text-[11px]" style={{ color: c }}>{sub}</div>}</div>
    </div>
  );

  return (
    <div className="space-y-5">
      <PageHeader title="Activity Incharge Performance Dashboard" badge={`${staff.length} Staff • ${activities.length - (unassigned?.total ?? 0)} Assigned Activities`}
        subtitle={`${project!.name} • Performance = work delivered ÷ work due by ${new Date(m.today).toLocaleDateString('en-GB')}`} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {tile('Staff incharges', staff.length, <Users className="h-5 w-5" />, C.violet, unassigned ? `${unassigned.total} activities unassigned` : 'All activities assigned')}
        {tile('Average performance', avg == null ? '—' : `${avg}%`, <Gauge className="h-5 w-5" />, avg == null ? C.slate : BAND_COLORS[avg >= 90 ? 'High' : avg >= 75 ? 'Good' : avg >= 50 ? 'Average' : 'Low'])}
        {tile('Top performer', top?.name ?? '—', <Trophy className="h-5 w-5" />, C.emerald, top ? `${top.performance}%` : undefined)}
        {tile('Lowest performer', bottom && bottom !== top ? bottom.name : '—', <TrendingDown className="h-5 w-5" />, C.rose, bottom && bottom !== top ? `${bottom.performance}%` : undefined)}
        {tile('Delayed activities', staff.reduce((x, s) => x + s.delayed, 0), <AlertTriangle className="h-5 w-5" />, C.orange, `${staff.reduce((x, s) => x + s.delayDays, 0)} working days total`)}
        {tile('Delay reason missing', all.reduce((x, s) => x + s.missingReasons, 0), <MessageSquareWarning className="h-5 w-5" />, C.amber, 'ask staff to fill in')}
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Performance Ranking" subtitle="Duration-weighted performance % per incharge (75% target line)" className="xl:col-span-2">
          <ResponsiveContainer width="100%" height={Math.max(220, rank.length * 34 + 40)}>
            <BarChart data={rank} layout="vertical" margin={{ left: 10, right: 40, top: 4, bottom: 4 }}>
              <CartesianGrid stroke={C.grid} strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" domain={[0, 100]} {...axis} tickFormatter={(v) => `${v}%`} />
              <YAxis type="category" dataKey="name" width={130} {...axis} tick={{ fill: '#e2e8f0', fontSize: 12 }} />
              <Tooltip {...tooltipStyle} formatter={(v) => [`${v}%`, 'Performance']} cursor={{ fill: '#ffffff08' }} />
              <ReferenceLine x={75} stroke={C.amber} strokeDasharray="4 4" />
              <Bar dataKey="perf" radius={[0, 6, 6, 0]} barSize={18} isAnimationActive={false} label={{ position: 'right', fill: '#cbd5e1', fontSize: 11, formatter: (v: unknown) => `${v}%` }}>
                {rank.map((r) => <Cell key={r.name} fill={BAND_COLORS[r.band]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-slate-400">{(['High', 'Good', 'Average', 'Low'] as const).map((b) => <span key={b} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: BAND_COLORS[b] }} />{b} {b === 'High' ? '≥90%' : b === 'Good' ? '75–89%' : b === 'Average' ? '50–74%' : '<50%'}</span>)}</div>
        </Card>
        <Card title="Performance Profile" subtitle="Performance, on-time and completion by staff">
          <ResponsiveContainer width="100%" height={300}>
            <RadarChart data={radar} outerRadius="70%">
              <PolarGrid stroke={C.grid} />
              <PolarAngleAxis dataKey="name" tick={{ fill: '#cbd5e1', fontSize: 11 }} />
              <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
              <Radar name="Performance" dataKey="Performance" stroke={C.emerald} fill={C.emerald} fillOpacity={0.25} isAnimationActive={false} />
              <Radar name="On-time %" dataKey="On-time %" stroke={C.cyan} fill={C.cyan} fillOpacity={0.12} isAnimationActive={false} />
              <Radar name="Completion %" dataKey="Completion %" stroke={C.amber} fill={C.amber} fillOpacity={0.12} isAnimationActive={false} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Tooltip {...tooltipStyle} />
            </RadarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <StaffPercentPanel staff={staff} />

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Workload & Status by Incharge" subtitle="Number of activities per person">
          <ResponsiveContainer width="100%" height={Math.max(220, stack.length * 34 + 60)}>
            <BarChart data={stack} layout="vertical" margin={{ left: 10, right: 16, top: 4, bottom: 4 }}>
              <CartesianGrid stroke={C.grid} strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" {...axis} allowDecimals={false} />
              <YAxis type="category" dataKey="name" width={130} {...axis} tick={{ fill: '#e2e8f0', fontSize: 12 }} />
              <Tooltip {...tooltipStyle} cursor={{ fill: '#ffffff08' }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {(['Completed', 'In Progress', 'Delayed', 'On Hold'] as const).map((k) => <Bar key={k} dataKey={k} stackId="s" fill={STATUS_COLORS[k]} isAnimationActive={false} />)}
              <Bar dataKey="Not due" stackId="s" fill="#334155" radius={[0, 4, 4, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Why Activities Are Delayed" subtitle="Delay reasons entered by activity staff">
          {reasons.length ? (
            <ResponsiveContainer width="100%" height={Math.max(220, reasons.length * 32 + 30)}>
              <BarChart data={reasons} layout="vertical" margin={{ left: 10, right: 30, top: 4, bottom: 4 }}>
                <CartesianGrid stroke={C.grid} strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" {...axis} allowDecimals={false} />
                <YAxis type="category" dataKey="name" width={210} {...axis} tick={{ fill: '#e2e8f0', fontSize: 11 }} />
                <Tooltip {...tooltipStyle} cursor={{ fill: '#ffffff08' }} formatter={(v) => [v, 'Activities']} />
                <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={16} isAnimationActive={false}>{reasons.map((r) => <Cell key={r.name} fill={r.name === 'Reason not entered' ? '#64748b' : C.rose} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <p className="py-16 text-center text-sm text-slate-400">No delayed activities with reasons yet.</p>}
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <WhyList title="High performers — why" icon={<ThumbsUp className="h-4 w-4 text-brand-emerald" />} list={high} empty="No staff at 75% or above yet." />
        <WhyList title="Low performers — why" icon={<ThumbsDown className="h-4 w-4 text-brand-rose" />} list={low} empty="No staff below 75%. Well done." />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-2 text-sm font-semibold uppercase tracking-wide text-slate-300">Individual staff performance</h3>
        {['', ...staff.map((s) => s.name)].map((n) => (
          <button key={n || 'all'} onClick={() => setPick(n)} className={clsx('rounded-full border px-3 py-1 text-xs', pick === n ? 'border-solar-amber bg-solar-amber/15 text-solar-gold' : 'border-dark-600 text-slate-400 hover:text-white')}>{n || 'All staff'}</button>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {shown.map((s) => <StaffCard key={s.name} s={s} />)}
      </div>
    </div>
  );
}

function WhyList({ title, icon, list, empty }: { title: string; icon: React.ReactNode; list: StaffStat[]; empty: string }) {
  return (
    <Card title={<span className="flex items-center gap-2">{icon}{title}</span>}>
      {list.length ? (
        <div className="space-y-3">
          {list.map((s) => (
            <div key={s.name} className="rounded-lg border border-dark-700 bg-dark-950/50 p-3">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 font-semibold text-white"><UserRound className="h-4 w-4 text-violet-300" />{s.name}</span>
                <span className="rounded px-2 py-0.5 font-mono text-xs font-bold" style={{ color: BAND_COLORS[s.band], background: `${BAND_COLORS[s.band]}1f` }}>{s.performance}% · {s.band}</span>
              </div>
              <ul className="mt-1.5 list-inside list-disc space-y-0.5 text-xs text-slate-300">{s.why.map((w) => <li key={w}>{w}</li>)}</ul>
            </div>
          ))}
        </div>
      ) : <p className="py-6 text-center text-sm text-slate-400">{empty}</p>}
    </Card>
  );
}

function StaffCard({ s }: { s: StaffStat }) {
  const color = BAND_COLORS[s.band];
  const data = s.rows.filter((r) => r.perf != null).map((r) => ({ name: r.activityId, full: r.name, perf: r.perf, color: STATUS_COLORS[r.status] ?? C.slate }));
  return (
    <div className="rounded-2xl border border-dark-700 bg-[#0b111c] p-4">
      <div className="flex items-center gap-3">
        <div className="relative"><Ring value={s.performance ?? 0} color={color} size={64} /><span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-white">{s.performance == null ? '—' : `${Math.round(s.performance)}%`}</span></div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-lg font-bold text-white">{s.name}</div>
          <div className="text-xs" style={{ color }}>{s.band === 'No work due' ? 'No work due yet' : `${s.band} performance`}</div>
          <div className="truncate text-[11px] text-slate-500">{s.sections.join(' · ')}</div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2 text-center text-[11px]">
        {[['Activities', s.total, 'text-white'], ['Done', s.completed, 'text-emerald-300'], ['Delayed', s.delayed, 'text-rose-300'], ['Delay days', s.delayDays, 'text-emerald-300']].map(([l, v, c]) => (
          <div key={l as string} className="rounded bg-dark-900 py-1.5"><div className="text-slate-500">{l}</div><div className={clsx('font-mono font-bold', c as string)}>{v}</div></div>
        ))}
      </div>
      {data.length > 0 && (
        <div className="mt-3">
          <ResponsiveContainer width="100%" height={150}>
            <BarChart data={data} margin={{ top: 6, right: 4, left: -24, bottom: 0 }}>
              <CartesianGrid stroke={C.grid} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" {...axis} fontSize={9} interval={0} angle={-35} textAnchor="end" height={40} />
              <YAxis domain={[0, 100]} {...axis} fontSize={10} />
              <ReferenceLine y={75} stroke={C.amber} strokeDasharray="3 3" />
              <Tooltip {...tooltipStyle} formatter={(v) => [`${v}%`, 'Performance']} labelFormatter={(_l, p) => (p?.[0]?.payload as { full?: string })?.full ?? ''} cursor={{ fill: '#ffffff08' }} />
              <Bar dataKey="perf" radius={[3, 3, 0, 0]} isAnimationActive={false}>{data.map((d) => <Cell key={d.name} fill={d.color} />)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      <ul className="mt-2 space-y-1 text-xs text-slate-300">{s.why.map((w) => <li key={w} className="flex gap-1.5"><span style={{ color }}>•</span>{w}</li>)}</ul>
      {s.rows.some((r) => r.status === 'Delayed') && (
        <div className="mt-3 border-t border-dark-700 pt-2">
          <div className="mb-1 text-[11px] font-semibold uppercase text-slate-400">Delayed activities</div>
          {s.rows.filter((r) => r.status === 'Delayed').slice(0, 5).map((r) => (
            <div key={r.activityId} className="flex justify-between gap-2 py-0.5 text-[11px]">
              <span className="truncate text-slate-200">{r.name}</span>
              <span className="shrink-0 font-mono text-rose-300">+{r.delay}d</span>
              <span className={clsx('w-40 shrink-0 truncate text-right', r.reason ? 'text-slate-400' : 'italic text-rose-400')} title={r.reason}>{r.reason || 'no reason'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
