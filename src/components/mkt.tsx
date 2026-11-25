'use client';
// Small shared pieces for the marketing & sales screens: page title, number tiles, chips, time-ago.
import clsx from 'clsx';
import type { ReactNode } from 'react';

export function PageTitle({ icon, title, subtitle, right }: { icon: ReactNode; title: string; subtitle?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-solar-amber/15 text-solar-gold">{icon}</div>
      <div className="min-w-0 flex-1">
        <h2 className="text-xl font-bold text-white md:text-2xl">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-slate-400">{subtitle}</p>}
      </div>
      {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
    </div>
  );
}

export function Stat({ label, value, hint, tone = 'neutral', onClick }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'neutral' | 'good' | 'bad' | 'warn' | 'accent'; onClick?: () => void }) {
  const color = { neutral: 'text-white', good: 'text-emerald-300', bad: 'text-rose-300', warn: 'text-emerald-300', accent: 'text-solar-gold' }[tone];
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag onClick={onClick} className={clsx('rounded-2xl border border-dark-700 bg-dark-850 px-4 py-3.5 text-left', onClick && 'transition hover:border-solar-amber/50')}>
      <div className="text-xs font-medium text-slate-400">{label}</div>
      <div className={clsx('mt-1 text-2xl font-bold tabular-nums', color)}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
    </Tag>
  );
}

export function Chip({ active, children, onClick, count }: { active?: boolean; children: ReactNode; onClick?: () => void; count?: number }) {
  return (
    <button type="button" onClick={onClick}
      className={clsx('rounded-full border px-3 py-1 text-xs font-semibold transition', active ? 'border-solar-amber bg-solar-amber/15 text-solar-gold' : 'border-dark-600 text-slate-300 hover:border-dark-500 hover:text-white')}>
      {children}{count != null && <span className="ml-1.5 text-slate-500">{count}</span>}
    </button>
  );
}

export function Tone({ value }: { value: number }) {
  const [label, cls] = value > 0 ? ['Positive', 'border-emerald-400/40 bg-emerald-500/10 text-emerald-300'] : value < 0 ? ['Negative', 'border-rose-400/50 bg-rose-500/10 text-rose-300'] : ['Neutral', 'border-slate-500/40 bg-slate-500/10 text-slate-300'];
  return <span className={clsx('rounded-full border px-2 py-0.5 text-[11px] font-semibold', cls)}>{label}</span>;
}

export function timeAgo(iso: string | null | undefined) {
  if (!iso) return '—';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.round(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
export const fmtNum = (n: number | null | undefined) => (n == null ? '—' : n >= 1e7 ? `${(n / 1e7).toFixed(1)} Cr` : n >= 1e5 ? `${(n / 1e5).toFixed(1)} L` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));
export const fmtINR = (n: number | null | undefined) => (n == null ? '—' : `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`);

export function SetupNote({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-solar-amber/40 bg-solar-amber/5 p-5">
      <div className="font-semibold text-solar-gold">{title}</div>
      <div className="mt-1 text-sm text-slate-300">{children}</div>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/** Copy text to the clipboard (falls back to a hidden textarea). */
export async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const t = document.createElement('textarea');
    t.value = text; document.body.appendChild(t); t.select();
    const ok = document.execCommand('copy'); t.remove(); return ok;
  }
}
