'use client';
// Percentage-based staff graphics: gauge per incharge, actual vs due progress %, band split and a % heat strip.
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, C, tooltipStyle } from './ui';
import { Donut, Legendish } from './charts';
import { BAND_COLORS, bandOf, type StaffStat } from '@/lib/performance';

const axis = { stroke: '#64748b', fontSize: 11, tickLine: false } as const;
const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : 0);

function Gauge({ value, color, size = 120 }: { value: number | null; color: string; size?: number }) {
  // Half-circle gauge 0–100%
  const r = size / 2 - 10;
  const len = Math.PI * r;
  const v = value == null ? 0 : Math.max(0, Math.min(100, value));
  const cx = size / 2, cy = size / 2;
  const arc = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
  return (
    <svg width={size} height={size / 2 + 14} viewBox={`0 0 ${size} ${size / 2 + 14}`}>
      <path d={arc} fill="none" stroke="#1e293b" strokeWidth={12} strokeLinecap="round" />
      <path d={arc} fill="none" stroke={color} strokeWidth={12} strokeLinecap="round" strokeDasharray={`${(v / 100) * len} ${len}`} />
      <text x={cx} y={cy + 2} textAnchor="middle" fill="#fff" fontSize={20} fontWeight={700}>{value == null ? '—' : `${Math.round(v)}%`}</text>
    </svg>
  );
}

export default function StaffPercentPanel({ staff }: { staff: StaffStat[] }) {
  const rows = staff.map((s) => {
    const progress = avg(s.rows.map((r) => r.progress));
    const due = avg(s.rows.map((r) => r.due));
    return {
      name: s.name, perf: s.performance, band: s.band,
      'Actual progress %': progress, 'Planned (due) %': due,
      'Completion %': s.total ? Math.round((s.completed / s.total) * 100) : 0,
      'On-time %': s.completed ? Math.round((s.onTime / s.completed) * 100) : 0,
      'Delayed %': s.total ? Math.round((s.delayed / s.total) * 100) : 0,
    };
  });
  const bands = (['High', 'Good', 'Average', 'Low', 'No work due'] as const).map((b) => ({ name: b, value: staff.filter((s) => s.band === b).length, color: BAND_COLORS[b] }));
  const metrics = ['Actual progress %', 'Planned (due) %', 'Completion %', 'On-time %', 'Delayed %'] as const;
  const cellColor = (k: string, v: number) => {
    const good = k === 'Delayed %' ? 100 - v : v;
    return BAND_COLORS[bandOf(good) === 'No work due' ? 'Low' : bandOf(good)];
  };

  return (
    <div className="space-y-4">
      <Card title="Staff Performance % Gauges" subtitle="Each incharge's performance percentage (work delivered ÷ work due)">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
          {staff.map((s) => (
            <div key={s.name} className="flex flex-col items-center rounded-xl border border-dark-700 bg-dark-950/50 px-2 pb-3 pt-2">
              <Gauge value={s.performance} color={BAND_COLORS[s.band]} />
              <div className="mt-1 max-w-full truncate text-sm font-semibold text-white" title={s.name}>{s.name}</div>
              <div className="text-[11px] font-semibold" style={{ color: BAND_COLORS[s.band] }}>{s.band}</div>
              <div className="mt-1 text-[10px] text-slate-500">{s.completed}/{s.total} done · {s.delayed} delayed</div>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Actual vs Planned Progress %" subtitle="Average progress each incharge has achieved against what was due by today" className="xl:col-span-2">
          <ResponsiveContainer width="100%" height={Math.max(240, rows.length * 44 + 60)}>
            <BarChart data={rows} layout="vertical" margin={{ left: 10, right: 30, top: 4, bottom: 4 }}>
              <CartesianGrid stroke={C.grid} strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" domain={[0, 100]} {...axis} tickFormatter={(v) => `${v}%`} />
              <YAxis type="category" dataKey="name" width={130} {...axis} tick={{ fill: '#e2e8f0', fontSize: 12 }} />
              <Tooltip {...tooltipStyle} formatter={(v) => `${v}%`} cursor={{ fill: '#ffffff08' }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="Planned (due) %" fill="#475569" radius={[0, 4, 4, 0]} barSize={12} isAnimationActive={false} />
              <Bar dataKey="Actual progress %" fill={C.emerald} radius={[0, 4, 4, 0]} barSize={12} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Performance Bands" subtitle="How many staff fall in each % band">
          <Donut data={bands} height={190} center={String(staff.length)} sub="staff" />
          <div className="mt-3"><Legendish items={bands.map((b) => ({ ...b, value: `${b.value} (${b.name === 'High' ? '≥90%' : b.name === 'Good' ? '75–89%' : b.name === 'Average' ? '50–74%' : b.name === 'Low' ? '<50%' : '—'})` }))} /></div>
        </Card>
      </div>

      <Card title="Staff % Scorecard" subtitle="Green = strong, red = needs attention (Delayed % is better when low)">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr className="text-left text-xs uppercase text-slate-400"><th className="px-2 py-2">Incharge</th><th className="px-2 text-center">Performance %</th>{metrics.map((k) => <th key={k} className="px-2 text-center">{k}</th>)}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name} className="border-t border-dark-800">
                  <td className="px-2 py-2 font-medium text-slate-100">{r.name}</td>
                  <td className="px-2 text-center"><span className="inline-block min-w-[56px] rounded px-2 py-1 font-mono text-xs font-bold" style={{ color: BAND_COLORS[r.band], background: `${BAND_COLORS[r.band]}22` }}>{r.perf == null ? '—' : `${r.perf}%`}</span></td>
                  {metrics.map((k) => (
                    <td key={k} className="px-2 text-center">
                      <div className="relative mx-auto h-6 w-24 overflow-hidden rounded bg-dark-800">
                        <div className="h-full" style={{ width: `${r[k]}%`, background: `${cellColor(k, r[k])}99` }} />
                        <span className="absolute inset-0 flex items-center justify-center font-mono text-[11px] font-semibold text-white">{r[k]}%</span>
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
