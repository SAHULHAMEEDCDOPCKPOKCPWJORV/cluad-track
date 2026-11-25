'use client';
import { Fragment, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Sparkles, FileDown, FileSpreadsheet, Lightbulb, ShieldAlert, Building2, Printer } from 'lucide-react';
import { fmtSpi } from '@/lib/schedule';
import { useApp } from '../AppShell';
import { Card, C, Badge, Button, DEPT_COLORS, tooltipStyle } from '../ui';
import { Gauge, SCurveChart } from '../charts';
import { generateReport } from '@/lib/report';
import { fmt } from '@/lib/calendar';

const RATING_COLORS: Record<string, string> = { Excellent: C.emerald, Good: C.cyan, 'Needs Attention': C.amber, Critical: C.rose };
const SEV_COLORS: Record<string, string> = { Critical: C.rose, High: C.orange, Medium: C.amber, Low: C.cyan };

export function useReportCtx() {
  const { project, activities, model, user } = useApp();
  const m = model!;
  const report = useMemo(() => generateReport(project!, activities, m.an, m.kpis, m.sections, m.depts), [project, activities, m]);
  return { ctx: { project: project!, activities, cal: m.cal, today: m.today, an: m.an, kpis: m.kpis, sections: m.sections, depts: m.depts, curve: m.curve, hist: m.hist, validation: m.validation, report, user: user.email }, report, m, user };
}

export default function ReportView() {
  const { ctx, report, m, user } = useReportCtx();
  const { toast } = useApp();
  const [busy, setBusy] = useState('');
  const k = m.kpis;
  const hc = report.health === 'On Track' ? C.emerald : report.health === 'At Risk' ? C.amber : C.rose;

  const run = async (kind: 'pdf' | 'xlsx') => {
    setBusy(kind);
    try {
      if (kind === 'pdf') await (await import('@/lib/exportPdf')).exportPdf(ctx);
      else await (await import('@/lib/exportExcel')).exportExcel(ctx);
      toast(kind === 'pdf' ? 'PDF report downloaded' : 'Excel suite downloaded');
    } catch (e) {
      console.error(e);
      toast(`Export failed: ${(e as Error).message}`, 'err');
    } finally {
      setBusy('');
    }
  };

  // Risk matrix: severity × finish-impact bucket
  const buckets = ['0d', '1–5d', '6–15d', '>15d'];
  const bucketOf = (d: number) => (d <= 0 ? 0 : d <= 5 ? 1 : d <= 15 ? 2 : 3);
  const matrix = (['Critical', 'High', 'Medium', 'Low'] as const).map((s) => {
    const row = [0, 0, 0, 0];
    report.risks.filter((r) => r.severity === s).forEach((r) => row[bucketOf(r.finishImpact)]++);
    return { s, row };
  });
  const maxCell = Math.max(1, ...matrix.flatMap((x) => x.row));

  return (
    <div className="space-y-4">
      <div className="relative overflow-hidden rounded-xl border border-dark-700 bg-gradient-to-br from-dark-800 to-dark-900 p-5">
        <div className="absolute -right-16 -top-16 h-56 w-56 rounded-full blur-3xl" style={{ background: `${hc}30` }} />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-solar-amber"><Sparkles className="h-4 w-4" />AI-assisted project report · data date {fmt(m.today)}</div>
            <h2 className="mt-2 text-xl font-semibold text-white">{report.headline}</h2>
            <ul className="mt-3 space-y-1.5 text-sm text-slate-300">{report.summary.map((s) => <li key={s} className="flex gap-2"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: hc }} />{s}</li>)}</ul>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Badge color={hc} className="!px-3 !py-1 !text-sm">{report.health}</Badge>
            {user.canExport && (
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => run('pdf')} loading={busy === 'pdf'}><FileDown className="h-4 w-4" />Export PDF</Button>
                <Button variant="outline" onClick={() => run('xlsx')} loading={busy === 'xlsx'}><FileSpreadsheet className="h-4 w-4" />Excel suite</Button>
                <Button variant="ghost" onClick={() => window.print()}><Printer className="h-4 w-4" /></Button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-4">
        <Card bodyClass="p-3"><Gauge value={k.overallProgress} label="Progress" color={C.amber} /></Card>
        <Card bodyClass="p-3"><Gauge value={Math.min(1.5, k.spi)} max={1.5} display={fmtSpi(k)} label="SPI" color={hc} /></Card>
        <Card bodyClass="p-3"><Gauge value={Math.min(60, Math.max(0, k.projectDelay))} max={60} display={`${k.projectDelay > 0 ? '+' : ''}${k.projectDelay}d`} label="Finish slip" color={k.projectDelay > 0 ? C.rose : C.emerald} /></Card>
        <Card bodyClass="p-3"><Gauge value={report.risks.length ? (report.risks.filter((r) => r.severity === 'Critical' || r.severity === 'High').length / report.risks.length) * 100 : 0} display={String(report.risks.length)} label="Open risks" color={C.orange} /></Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Trajectory" subtitle={`Forecast finish ${fmt(k.forecastFinish)} vs planned ${fmt(k.plannedFinish)}`} className="xl:col-span-2">
          <SCurveChart data={m.curve} today={m.today} height={280} id="rep" />
        </Card>
        <Card title={<span className="flex items-center gap-1.5"><ShieldAlert className="h-4 w-4 text-brand-rose" />Risk Heat Matrix</span>} subtitle="Severity × project-finish impact">
          <div className="grid grid-cols-[70px_repeat(4,1fr)] gap-1 text-[11px]">
            <div />
            {buckets.map((b) => <div key={b} className="text-center text-slate-400">{b}</div>)}
            {matrix.map(({ s, row }) => (
              <Fragment key={s}>
                <div className="flex items-center font-semibold" style={{ color: SEV_COLORS[s] }}>{s}</div>
                {row.map((n, i) => (
                  <div key={`${s}${i}`} className="flex h-12 items-center justify-center rounded-md text-base font-bold text-white" style={{ background: n ? `${SEV_COLORS[s]}${Math.round(30 + (n / maxCell) * 190).toString(16).padStart(2, '0')}` : 'rgb(var(--dk-800))' }}>{n || ''}</div>
                ))}
              </Fragment>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title={<span className="flex items-center gap-1.5"><Building2 className="h-4 w-4 text-brand-cyan" />Department Performance Audit</span>} subtitle="Score = SPI, completion, delays and holds (0–100)">
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={report.deptAudit} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid stroke={C.grid} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="dept" stroke={C.axis} fontSize={11} />
              <YAxis stroke={C.axis} fontSize={11} domain={[0, 100]} />
              <Tooltip {...tooltipStyle} cursor={{ fill: '#ffffff08' }} />
              <ReferenceLine y={70} stroke={C.amber} strokeDasharray="4 4" />
              <Bar dataKey="score" name="Score" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                {report.deptAudit.map((d) => <Cell key={d.dept} fill={DEPT_COLORS[d.dept] ?? C.amber} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="mt-3 space-y-1.5">
            {report.deptAudit.map((d) => (
              <div key={d.dept} className="flex items-start gap-2 text-xs">
                <span className="w-12 shrink-0 font-bold" style={{ color: DEPT_COLORS[d.dept] }}>{d.dept}</span>
                <Badge color={RATING_COLORS[d.rating]}>{d.rating}</Badge>
                <span className="text-slate-300">{d.finding}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Section Schedule Performance (SPI)" subtitle="1.00 = on plan">
          <ResponsiveContainer width="100%" height={Math.max(230, m.sections.length * 30)}>
            <BarChart data={m.sections.map((s) => ({ name: s.key, spi: s.spi }))} layout="vertical" margin={{ left: 0, right: 24, top: 4, bottom: 4 }}>
              <CartesianGrid stroke={C.grid} strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" stroke={C.axis} fontSize={11} domain={[0, 1.5]} />
              <YAxis type="category" dataKey="name" stroke={C.axis} width={170} tick={{ fontSize: 11, fill: '#cbd5e1' }} />
              <Tooltip {...tooltipStyle} cursor={{ fill: '#ffffff08' }} />
              <ReferenceLine x={1} stroke={C.gold} />
              <Bar dataKey="spi" name="SPI" barSize={12} radius={[0, 4, 4, 0]} isAnimationActive={false}>
                {m.sections.map((s) => <Cell key={s.key} fill={s.spi >= 0.95 ? C.emerald : s.spi >= 0.85 ? C.amber : C.rose} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card title={<span className="flex items-center gap-1.5"><Lightbulb className="h-4 w-4 text-solar-gold" />Recommendations</span>}>
          <ol className="space-y-2.5 text-sm text-slate-200">
            {report.recommendations.map((r, i) => (
              <li key={r} className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-solar-amber/20 text-xs font-bold text-solar-gold">{i + 1}</span>{r}</li>
            ))}
          </ol>
        </Card>
        <Card title="Delay Risk Mitigation" subtitle="Top risks with recovery protocol" className="xl:col-span-2" bodyClass="p-0">
          <div className="max-h-[420px] divide-y divide-dark-800 overflow-y-auto">
            {report.risks.slice(0, 15).map((r) => (
              <div key={r.activityId} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge color={SEV_COLORS[r.severity]}>{r.severity}</Badge>
                  <span className="font-mono text-xs text-slate-400">{r.activityId}</span>
                  <span className="text-slate-100">{r.activityName}</span>
                  <span className="ml-auto font-mono text-xs text-brand-rose">+{r.delayDays}d · impact {r.finishImpact}d{r.crashFactor > 1.05 ? ` · crash ×${r.crashFactor}` : ''}</span>
                </div>
                <ul className="mt-1.5 grid gap-x-4 gap-y-0.5 text-xs text-slate-400 md:grid-cols-2">{r.mitigation.slice(0, 4).map((t) => <li key={t}>→ {t}</li>)}</ul>
              </div>
            ))}
            {!report.risks.length && <p className="p-6 text-center text-sm text-slate-400">No delayed or held activities. Nothing to mitigate right now.</p>}
          </div>
        </Card>
      </div>
      <p className="text-center text-[11px] text-slate-500">Analysis is generated by SWELECT&apos;s rule-based engine from schedule logic, progress and float. It does not send project data to any external AI service.</p>
    </div>
  );
}
