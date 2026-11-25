'use client';
import { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Route } from 'lucide-react';
import { useApp } from './AppShell';
import { Card, C, STATUS_COLORS, SERIES, tooltipStyle } from './ui';
import { toDate, fmt } from '@/lib/calendar';
import { SECTION_NAMES, CUSTOM_SECTION } from '@/lib/master';

const axis = { stroke: '#64748b', fontSize: 11, tickLine: false } as const;
const ORDER = [...SECTION_NAMES, CUSTOM_SECTION];
const short = (s: string) => (s.length > 22 ? `${s.slice(0, 21)}…` : s);
const mkey = (iso: string) => iso.slice(0, 7);
const mlabel = (k: string) => toDate(`${k}-01`).toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' });

/** Extra Gantt analytics: section durations, monthly starts/finishes, float, status mix and critical chain. */
export function GanttInsights() {
  const { activities, model, cal } = useApp();
  const m = model!;

  const secDur = m.sections.map((s) => ({
    name: short(s.key), full: s.key,
    Planned: cal.countWorking(s.start, s.finish),
    Forecast: cal.countWorking(s.start, s.forecastFinish),
    slip: Math.max(0, cal.workingDiff(s.finish, s.forecastFinish)),
  }));

  const monthly = useMemo(() => {
    const mp = new Map<string, { starts: number; finishes: number; actual: number; cum: number }>();
    const get = (k: string) => mp.get(k) ?? mp.set(k, { starts: 0, finishes: 0, actual: 0, cum: 0 }).get(k)!;
    for (const a of activities) {
      get(mkey(a.plannedStartDate)).starts++;
      get(mkey(a.plannedEndDate)).finishes++;
      if (a.progressPercent >= 100 && a.actualEndDate) get(mkey(a.actualEndDate)).actual++;
    }
    let cum = 0;
    return [...mp.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => {
      cum += v.finishes;
      return { name: mlabel(k), 'Planned starts': v.starts, 'Planned finishes': v.finishes, 'Actual finishes': v.actual, 'Cumulative planned finishes': cum };
    });
  }, [activities]);

  const floatBuckets = useMemo(() => {
    const b = [{ name: 'Critical (0d)', n: 0, c: C.rose }, { name: '1–5d', n: 0, c: C.orange }, { name: '6–15d', n: 0, c: C.amber }, { name: '16–30d', n: 0, c: C.cyan }, { name: '>30d', n: 0, c: C.emerald }];
    for (const a of activities) {
      const f = m.an.byId.get(a.activityId)!.totalFloat;
      b[f <= 0 ? 0 : f <= 5 ? 1 : f <= 15 ? 2 : f <= 30 ? 3 : 4].n++;
    }
    return b;
  }, [activities, m]);

  const statusBySec = useMemo(() => {
    const groups = [...new Set(activities.map((a) => a.section))].sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99));
    return groups.map((g) => {
      const row: Record<string, string | number> = { name: short(g) };
      for (const st of ['Completed', 'In Progress', 'Delayed', 'On Hold', 'Not Started']) row[st] = 0;
      for (const a of activities) if (a.section === g) row[m.an.byId.get(a.activityId)!.status] = Number(row[m.an.byId.get(a.activityId)!.status] ?? 0) + 1;
      return row;
    });
  }, [activities, m]);

  const chain = m.an.criticalPath.map((id) => activities.find((a) => a.activityId === id)!).filter(Boolean);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Section Duration: Planned vs Forecast" subtitle="Working days from section start to finish">
          <ResponsiveContainer width="100%" height={Math.max(240, secDur.length * 34 + 50)}>
            <BarChart data={secDur} layout="vertical" margin={{ left: 10, right: 30, top: 4, bottom: 4 }}>
              <CartesianGrid stroke={C.grid} strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" {...axis} />
              <YAxis type="category" dataKey="name" width={160} {...axis} tick={{ fill: '#e2e8f0', fontSize: 11 }} />
              <Tooltip {...tooltipStyle} cursor={{ fill: '#ffffff08' }} formatter={(v, n) => [`${v} working days`, n]} labelFormatter={(_l, p) => (p?.[0]?.payload as { full?: string })?.full ?? ''} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="Planned" fill={C.cyan} barSize={9} radius={[0, 3, 3, 0]} isAnimationActive={false} />
              <Bar dataKey="Forecast" barSize={9} radius={[0, 3, 3, 0]} isAnimationActive={false}>{secDur.map((d) => <Cell key={d.full} fill={d.slip > 0 ? C.rose : C.emerald} />)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Monthly Activity Starts & Finishes" subtitle="Planned starts / finishes per month, actual finishes, cumulative line">
          <ResponsiveContainer width="100%" height={Math.max(240, secDur.length * 34 + 50)}>
            <ComposedChart data={monthly} margin={{ left: -14, right: 8, top: 8, bottom: 0 }}>
              <CartesianGrid stroke={C.grid} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" {...axis} minTickGap={8} />
              <YAxis yAxisId="l" {...axis} allowDecimals={false} />
              <YAxis yAxisId="r" orientation="right" {...axis} allowDecimals={false} />
              <Tooltip {...tooltipStyle} cursor={{ fill: '#ffffff08' }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar yAxisId="l" dataKey="Planned starts" fill={C.blue} radius={[3, 3, 0, 0]} isAnimationActive={false} />
              <Bar yAxisId="l" dataKey="Planned finishes" fill={C.amber} radius={[3, 3, 0, 0]} isAnimationActive={false} />
              <Bar yAxisId="l" dataKey="Actual finishes" fill={C.emerald} radius={[3, 3, 0, 0]} isAnimationActive={false} />
              <Line yAxisId="r" type="monotone" dataKey="Cumulative planned finishes" stroke={C.violet} strokeWidth={2} dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Total Float Distribution" subtitle="How much slack each activity has">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={floatBuckets} margin={{ left: -18, right: 8, top: 8, bottom: 0 }}>
              <CartesianGrid stroke={C.grid} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" {...axis} />
              <YAxis {...axis} allowDecimals={false} />
              <Tooltip {...tooltipStyle} cursor={{ fill: '#ffffff08' }} formatter={(v) => [v, 'Activities']} />
              <Bar dataKey="n" radius={[4, 4, 0, 0]} isAnimationActive={false} label={{ position: 'top', fill: '#cbd5e1', fontSize: 11 }}>{floatBuckets.map((b) => <Cell key={b.name} fill={b.c} />)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Activity Status by Section" subtitle="Stacked count of activities" className="xl:col-span-2">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={statusBySec} margin={{ left: -18, right: 8, top: 8, bottom: 0 }}>
              <CartesianGrid stroke={C.grid} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" {...axis} interval={0} angle={-20} textAnchor="end" height={60} fontSize={10} />
              <YAxis {...axis} allowDecimals={false} />
              <Tooltip {...tooltipStyle} cursor={{ fill: '#ffffff08' }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {['Completed', 'In Progress', 'Delayed', 'On Hold', 'Not Started'].map((k) => <Bar key={k} dataKey={k} stackId="s" fill={STATUS_COLORS[k]} isAnimationActive={false} />)}
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <Card title={<span className="flex items-center gap-2"><Route className="h-4 w-4 text-brand-rose" />Critical Path Chain</span>} subtitle={`${chain.length} activities with zero float drive the finish date (${fmt(m.kpis.forecastFinish)} forecast)`}>
        <div className="flex flex-wrap items-center gap-1.5">
          {chain.map((a, i) => {
            const mm = m.an.byId.get(a.activityId)!;
            const col = SERIES[Math.max(0, ORDER.indexOf(a.section)) % SERIES.length];
            return (
              <span key={a.activityId} className="flex items-center gap-1.5">
                <span title={`${a.activityName}\n${fmt(a.plannedStartDate)} → ${fmt(a.plannedEndDate)} · ${mm.status}${mm.delayDays ? ` · +${mm.delayDays}d` : ''}`}
                  className="rounded-md border px-2 py-1 text-[11px]" style={{ borderColor: `${col}88`, background: `${col}14`, color: mm.delayDays > 0 ? '#fda4af' : '#e2e8f0' }}>
                  <b className="font-mono">{a.activityId}</b> {a.activityName.length > 28 ? `${a.activityName.slice(0, 27)}…` : a.activityName}{mm.delayDays > 0 && <b className="ml-1">+{mm.delayDays}d</b>}
                </span>
                {i < chain.length - 1 && <span className="text-slate-600">→</span>}
              </span>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
