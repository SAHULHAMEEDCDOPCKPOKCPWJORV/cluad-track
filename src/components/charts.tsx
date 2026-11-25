'use client';
import {
  Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart, PolarAngleAxis, PolarGrid, PolarRadiusAxis,
  Radar, RadarChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { SPoint } from '@/lib/schedule';
import { C, tooltipStyle } from './ui';
import { useAnimatedNumber, useReducedMotion } from './motion';

const axis = { stroke: C.axis, fontSize: 11, tickLine: false, axisLine: { stroke: C.grid } } as const;

export function SCurveChart({ data, height = 300, today, compact, id = 's', color = C.amber, plannedColor = C.cyan }: { data: SPoint[]; height?: number; today?: string; compact?: boolean; id?: string; color?: string; plannedColor?: string }) {
  const todayLabel = today ? data.find((p) => p.date >= today)?.label : undefined;
  const anim = !useReducedMotion();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: compact ? 4 : 16, left: compact ? -28 : -8, bottom: 0 }}>
        <defs>
          <linearGradient id={`${id}-pl`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={plannedColor} stopOpacity={0.35} />
            <stop offset="100%" stopColor={plannedColor} stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id={`${id}-ac`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.45} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        {!compact && <CartesianGrid stroke={C.grid} strokeDasharray="3 3" vertical={false} />}
        <XAxis dataKey="label" {...axis} hide={compact} minTickGap={28} />
        <YAxis {...axis} domain={[0, 100]} tickFormatter={(v) => `${v}%`} width={compact ? 30 : 44} hide={compact} />
        <Tooltip {...tooltipStyle} formatter={(v) => (v == null ? '—' : `${Number(v).toFixed(1)}%`)} />
        {!compact && <Legend wrapperStyle={{ fontSize: 12, color: C.axis }} />}
        <Area type="monotone" dataKey="planned" name="Planned" stroke={plannedColor} strokeWidth={2} fill={`url(#${id}-pl)`} dot={false} isAnimationActive={anim} animationDuration={1100} animationEasing="ease-out" />
        <Area type="monotone" dataKey="actual" name="Actual" stroke={color} strokeWidth={2.5} fill={`url(#${id}-ac)`} dot={false} connectNulls={false} isAnimationActive={anim} animationDuration={1100} animationEasing="ease-out" />
        <Line type="monotone" dataKey="forecast" name="Forecast" stroke={C.rose} strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={anim} animationDuration={1100} animationEasing="ease-out" />
        {todayLabel && <ReferenceLine x={todayLabel} stroke={C.gold} strokeDasharray="2 3" label={compact ? undefined : { value: 'Today', fill: C.gold, fontSize: 11, position: 'insideTopRight' }} />}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function Donut({ data, height = 220, center, sub }: { data: { name: string; value: number; color: string }[]; height?: number; center?: string; sub?: string }) {
  const anim2 = !useReducedMotion();
  const shown = data.filter((d) => d.value > 0);
  return (
    <div className="relative" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={shown.length ? shown : [{ name: 'None', value: 1, color: C.grid }]} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="88%" paddingAngle={shown.length > 1 ? 2 : 0} stroke="none" isAnimationActive={anim2} animationDuration={900}>
            {(shown.length ? shown : [{ color: C.grid }]).map((d, i) => (
              <Cell key={i} fill={d.color} />
            ))}
          </Pie>
          <Tooltip {...tooltipStyle} />
        </PieChart>
      </ResponsiveContainer>
      {center && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold text-white">{center}</span>
          {sub && <span className="text-[11px] uppercase tracking-wide text-slate-400">{sub}</span>}
        </div>
      )}
    </div>
  );
}

export function Legendish({ items }: { items: { name: string; value: number | string; color: string }[] }) {
  return (
    <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
      {items.map((i) => (
        <li key={i.name} className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-slate-300">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: i.color }} />
            {i.name}
          </span>
          <span className="font-mono font-semibold text-slate-100">{i.value}</span>
        </li>
      ))}
    </ul>
  );
}

/** Semicircle gauge (SVG). */
export function Gauge({ value, max = 100, label, color = C.amber, size = 180, display }: { value: number; max?: number; label?: string; color?: string; size?: number; display?: string }) {
  const animated = useAnimatedNumber(value);
  const v = Math.max(0, Math.min(max, animated));
  const r = size / 2 - 14;
  const cx = size / 2;
  const cy = size / 2 + 4;
  const arc = (frac: number) => {
    const a = Math.PI * (1 - frac);
    return `${cx + r * Math.cos(a)} ${cy - r * Math.sin(a)}`;
  };
  return (
    <svg width="100%" viewBox={`0 0 ${size} ${size / 2 + 26}`} className="block">
      <path d={`M ${arc(0)} A ${r} ${r} 0 0 1 ${arc(1)}`} stroke={C.grid} strokeWidth={14} fill="none" strokeLinecap="round" />
      <path d={`M ${arc(0)} A ${r} ${r} 0 0 1 ${arc(v / max)}`} stroke={color} strokeWidth={14} fill="none" strokeLinecap="round" />
      <text x={cx} y={cy - 6} textAnchor="middle" className="fill-white" style={{ fontSize: size / 6, fontWeight: 700 }}>
        {display ?? (Math.round(v * 10) / 10).toFixed(1)}
      </text>
      {label && (
        <text x={cx} y={cy + 16} textAnchor="middle" style={{ fontSize: 11, fill: C.axis, letterSpacing: 1 }}>
          {label.toUpperCase()}
        </text>
      )}
    </svg>
  );
}

/** Small progress ring for KPI tiles. */
export function Ring({ value, color = C.amber, size = 44 }: { value: number; color?: string; size?: number }) {
  const r = size / 2 - 4;
  const c = 2 * Math.PI * r;
  const animatedValue = useAnimatedNumber(value);
  const v = Math.max(0, Math.min(100, animatedValue));
  return (
    <svg width={size} height={size} className="shrink-0 -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} stroke={C.grid} strokeWidth={5} fill="none" />
      <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={5} fill="none" strokeDasharray={`${(v / 100) * c} ${c}`} strokeLinecap="round" />
    </svg>
  );
}

export function Sparkline({ values, color = C.amber, height = 28 }: { values: number[]; color?: string; height?: number }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const w = 100;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${height - ((v - min) / (max - min || 1)) * (height - 2) - 1}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="h-7 w-full">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.8} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function HBars({ data, height, keys, max, unit = '%' }: { data: Record<string, string | number>[]; height?: number; keys: { key: string; name: string; color: string }[]; max?: number; unit?: string }) {
  const anim2 = !useReducedMotion();
  return (
    <ResponsiveContainer width="100%" height={height ?? Math.max(160, data.length * 34 + 40)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }} barGap={2}>
        <CartesianGrid stroke={C.grid} strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" {...axis} domain={[0, max ?? 'auto']} tickFormatter={(v) => `${v}${unit}`} />
        <YAxis type="category" dataKey="name" {...axis} width={150} tick={{ fontSize: 11, fill: '#cbd5e1' }} />
        <Tooltip {...tooltipStyle} cursor={{ fill: '#ffffff08' }} formatter={(v) => `${Number(v).toFixed(1)}${unit}`} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {keys.map((k) => (
          <Bar key={k.key} dataKey={k.key} name={k.name} fill={k.color} radius={[0, 4, 4, 0]} barSize={10} isAnimationActive={anim2} animationDuration={900} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function VBars({ data, xKey, bars, height = 240, stacked, unit = '' }: { data: Record<string, string | number>[]; xKey: string; bars: { key: string; name: string; color: string }[]; height?: number; stacked?: boolean; unit?: string }) {
  const anim2 = !useReducedMotion();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid stroke={C.grid} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey={xKey} {...axis} interval={0} tick={{ fontSize: 10, fill: C.axis }} />
        <YAxis {...axis} allowDecimals={false} tickFormatter={(v) => `${v}${unit}`} />
        <Tooltip {...tooltipStyle} cursor={{ fill: '#ffffff08' }} />
        {bars.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {bars.map((b) => (
          <Bar key={b.key} dataKey={b.key} name={b.name} fill={b.color} stackId={stacked ? 's' : undefined} radius={stacked ? undefined : [4, 4, 0, 0]} isAnimationActive={anim2} animationDuration={900} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function DeptRadar({ data, height = 280 }: { data: { dept: string; planned: number; actual: number }[]; height?: number }) {
  const anim2 = !useReducedMotion();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RadarChart data={data} outerRadius="72%">
        <PolarGrid stroke={C.grid} />
        <PolarAngleAxis dataKey="dept" tick={{ fill: '#cbd5e1', fontSize: 11 }} />
        <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
        <Radar name="Planned %" dataKey="planned" stroke={C.cyan} fill={C.cyan} fillOpacity={0.15} isAnimationActive={anim2} animationDuration={900} />
        <Radar name="Actual %" dataKey="actual" stroke={C.amber} fill={C.amber} fillOpacity={0.35} isAnimationActive={anim2} animationDuration={900} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Tooltip {...tooltipStyle} formatter={(v) => `${Number(v).toFixed(1)}%`} />
      </RadarChart>
    </ResponsiveContainer>
  );
}

export function TrendBars({ data, height = 220 }: { data: { label: string; planned: number; actual: number | null }[]; height?: number }) {
  const anim2 = !useReducedMotion();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
        <CartesianGrid stroke={C.grid} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" {...axis} minTickGap={20} />
        <YAxis {...axis} tickFormatter={(v) => `${v}%`} />
        <Tooltip {...tooltipStyle} formatter={(v) => (v == null ? '—' : `${Number(v).toFixed(2)}%`)} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="planned" name="Planned / week" fill={C.cyan} fillOpacity={0.6} radius={[3, 3, 0, 0]} isAnimationActive={anim2} animationDuration={900} />
        <Bar dataKey="actual" name="Achieved / week" fill={C.amber} radius={[3, 3, 0, 0]} isAnimationActive={anim2} animationDuration={900} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
