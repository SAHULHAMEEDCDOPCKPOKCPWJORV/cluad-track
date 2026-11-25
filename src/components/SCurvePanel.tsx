'use client';
import { useMemo, useState, type ReactNode } from 'react';
import { CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { TrendingUp } from 'lucide-react';
import clsx from 'clsx';
import type { SPoint } from '@/lib/schedule';
import { fmt, toDate } from '@/lib/calendar';
import { tooltipStyle } from './ui';
import { useReducedMotion } from './motion';

const BLUE = '#3b82f6', GREEN = '#10b981', ORANGE = '#10b981';

/** Overall S-curve with weekly / monthly checkpoints and summary tiles. */
export function SCurvePanel({ curve, today, baseline, forecast, actualPct, height = 320, title = 'Overall Project S-Curve Progression', accent, badge, mode: forcedMode, compact, plannedPct }: {
  curve: SPoint[]; today: string; baseline: string; forecast: string; actualPct: number; height?: number;
  /** Section / department panels reuse the overall design with their own title and colour. */
  title?: ReactNode; accent?: string; badge?: ReactNode; mode?: 'week' | 'month'; compact?: boolean;
  /** Planned % at the reporting date from the KPI engine, so the tile always equals the dashboard KPI. */
  plannedPct?: number;
}) {
  const anim = !useReducedMotion();
  const [ownMode, setMode] = useState<'week' | 'month'>('month');
  const mode = forcedMode ?? ownMode;
  const data = useMemo(() => {
    // Every S-curve starts from 0% at the start of the work (the day before the first planned activity).
    const withOrigin = <T extends SPoint>(pts: T[]): T[] => {
      if (!pts.length || pts[0].planned <= 0) return pts;
      return [{ ...pts[0], date: '', label: 'Start', planned: 0, actual: pts[0].actual != null ? 0 : null, forecast: null }, ...pts];
    };
    return withOrigin(build());
    function build() {
    if (mode === 'week')
      return curve.filter((p) => toDate(p.date).getUTCDay() === 0 || p.date === today).map((p) => ({ ...p, label: toDate(p.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit', timeZone: 'UTC' }) }));
    // One point per month: the month-end value (or the reporting date for the current month). Actual keeps its last real value.
    const m = new Map<string, SPoint>();
    const lastActual = new Map<string, number>();
    for (const p of curve) {
      m.set(p.date.slice(0, 7), p);
      if (p.actual != null) lastActual.set(p.date.slice(0, 7), p.actual);
    }
    return [...m.entries()].map(([k, p]) => ({ ...p, actual: lastActual.get(k) ?? null, label: toDate(`${k}-01`).toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' }) }));
    }
  }, [curve, mode, today]);
  const plannedNow = plannedPct ?? [...curve].reverse().find((p) => p.date <= today)?.planned ?? 0;
  const todayLabel = data.find((p) => p.date && p.date >= today)?.label;
  const late = forecast > baseline;

  return (
    <div className="sw-lift overflow-hidden rounded-2xl border border-dark-700 bg-[#0b111c]" style={accent ? { borderColor: `${accent}66`, boxShadow: `inset 0 3px 0 ${accent}` } : undefined}>
      <div className={clsx('flex flex-wrap items-start justify-between gap-3 border-b border-dark-700', compact ? 'px-4 py-3' : 'px-5 py-4')} style={accent ? { background: `linear-gradient(180deg, ${accent}22, transparent)` } : undefined}>
        <div className="min-w-0">
          <h3 className={clsx('flex items-center gap-2 font-bold text-white', compact && 'text-sm')}><TrendingUp className="h-5 w-5 shrink-0" style={{ color: accent ?? 'rgb(var(--ac-500))' }} /><span className="truncate">{title}</span>{badge}</h3>
          <p className="mt-1 font-mono text-xs text-slate-400">Baseline Target: <b className="text-solar-gold">{fmt(baseline)}</b> <span className="mx-1 text-slate-600">|</span> Forecast: <b className={late ? 'text-rose-300' : 'text-emerald-300'}>{fmt(forecast)}</b></p>
        </div>
        {!forcedMode && <div className="flex rounded-lg border border-dark-600 bg-dark-900 p-1">
          {(['week', 'month'] as const).map((k) => (
            <button key={k} onClick={() => setMode(k)} className={clsx('rounded-md px-3 py-1.5 text-sm font-semibold', mode === k ? 'bg-brand-blue text-white' : 'text-slate-400 hover:text-white')}>{k === 'week' ? 'Weekly S-Curve' : 'Monthly S-Curve'}</button>
          ))}
        </div>}
      </div>
      <div className={compact ? 'px-1 pt-3' : 'px-3 pt-4'}>
        <ResponsiveContainer width="100%" height={height}>
          <ComposedChart data={data} margin={{ top: 8, right: 20, left: -6, bottom: 0 }}>
            <CartesianGrid stroke="#1e283b" strokeDasharray="3 3" />
            <XAxis dataKey="label" stroke="#64748b" fontSize={11} tickLine={false} minTickGap={36} />
            <YAxis stroke="#64748b" fontSize={11} domain={[0, 100]} tickFormatter={(v) => `${v}%`} tickLine={false} width={46} />
            <Tooltip {...tooltipStyle} formatter={(v) => (v == null ? '—' : `${Number(v).toFixed(1)}%`)} />
            <Legend wrapperStyle={{ fontSize: compact ? 11 : 12 }} />
            <Line type="monotone" dataKey="planned" name="Planned Baseline %" stroke={BLUE} strokeWidth={2.5} dot={{ r: mode === 'month' ? 4 : 3, fill: BLUE }} isAnimationActive={anim} animationDuration={1200} animationEasing="ease-out" />
            <Line type="monotone" dataKey="actual" name="Actual Earned %" stroke={GREEN} strokeWidth={2.5} dot={{ r: mode === 'month' ? 4 : 3, fill: GREEN }} connectNulls={false} isAnimationActive={anim} animationDuration={1200} animationEasing="ease-out" />
            <Line type="monotone" dataKey="forecast" name="Forecast %" stroke={ORANGE} strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={anim} animationDuration={1200} animationEasing="ease-out" />
            {todayLabel && <ReferenceLine x={todayLabel} stroke="#34d399" strokeDasharray="2 3" label={{ value: 'Today', fill: '#34d399', fontSize: 11, position: 'insideTopRight' }} />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className={clsx('grid border-t border-dark-700', compact ? 'grid-cols-4 gap-2 p-3' : 'gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4')}>
        {(compact
          ? [
              { l: 'Planned', v: `${plannedNow.toFixed(2)}%`, c: 'text-blue-300' },
              { l: 'Actual', v: `${actualPct.toFixed(2)}%`, c: 'text-emerald-300' },
              { l: 'Variance', v: `${actualPct - plannedNow > 0 ? '+' : ''}${(actualPct - plannedNow).toFixed(2)}`, c: actualPct - plannedNow < -0.005 ? 'text-rose-300' : 'text-emerald-300' },
              { l: 'Forecast', v: fmt(forecast), c: late ? 'text-rose-300' : 'text-emerald-300' },
            ]
          : [
              { l: 'Interval Precision', v: mode === 'week' ? 'Weekly Tracking' : 'Monthly Tracking', c: 'text-white' },
              { l: 'Checkpoint Periods', v: `${data.filter((p) => p.date).length} ${mode === 'week' ? 'Weeks' : 'Months'}`, c: 'text-solar-gold' },
              { l: 'Approved Planned (today)', v: `${plannedNow.toFixed(2)}%`, c: 'text-blue-300' },
              { l: 'Verified Actual', v: `${actualPct.toFixed(2)}%`, c: 'text-emerald-300' },
            ]
        ).map((t) => (
          <div key={t.l} className={clsx('rounded-lg border border-dark-700 bg-dark-950/60', compact ? 'px-2 py-1.5 text-center' : 'px-3 py-2.5')}>
            <div className={clsx('text-slate-400', compact ? 'text-[10px] uppercase tracking-wide' : 'text-[11px]')}>{t.l}{compact ? '' : ':'}</div>
            <div className={clsx('font-mono font-bold', compact ? 'text-xs' : 'text-sm', t.c)}>{t.v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
