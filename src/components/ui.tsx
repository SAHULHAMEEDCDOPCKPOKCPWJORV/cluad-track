'use client';
import clsx from 'clsx';
import { X, Loader2 } from 'lucide-react';
import { useEffect, type ReactNode, type ButtonHTMLAttributes, type InputHTMLAttributes, type SelectHTMLAttributes } from 'react';

export const C = {
  amber: '#10b981',
  gold: '#34d399',
  blue: '#3b82f6',
  cyan: '#06b6d4',
  emerald: '#10b981',
  rose: '#f43f5e',
  violet: '#8b5cf6',
  orange: '#34d399',
  slate: '#64748b',
  grid: '#1e283b',
  axis: '#7c8aa5',
};
export const STATUS_COLORS: Record<string, string> = {
  Completed: C.emerald,
  'In Progress': C.blue,
  'Not Started': C.slate,
  Delayed: C.rose,
  'On Hold': C.amber,
};
export const SERIES = [C.amber, C.cyan, C.emerald, C.violet, C.rose, C.blue, C.orange, '#14b8a6', '#e879f9', '#a3e635'];
export const DEPT_COLORS: Record<string, string> = {
  PLAN: C.amber, LAND: '#a3e635', ENG: C.cyan, PRO: C.violet, SITE: C.orange, TRN: C.blue, COMM: C.emerald, MKT: '#e879f9', SALES: '#14b8a6',
};

export function Card({ title, subtitle, right, children, className, bodyClass }: { title?: ReactNode; subtitle?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section className={clsx('rounded-2xl border border-dark-700 bg-dark-850', className)}>
      {(title || right) && (
        <header className="flex items-start justify-between gap-3 border-b border-dark-700/70 px-5 py-3.5">
          <div>
            {title && <h3 className="text-sm font-semibold tracking-tight text-slate-100">{title}</h3>}
            {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
          </div>
          {right}
        </header>
      )}
      <div className={clsx('p-5', bodyClass)}>{children}</div>
    </section>
  );
}

export function Button({ variant = 'primary', size = 'md', loading, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' | 'outline'; size?: 'sm' | 'md'; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3.5 py-2 text-sm',
        variant === 'primary' && 'bg-solar-amber text-dark-950 shadow-sm shadow-solar-amber/25 hover:bg-solar-gold',
        variant === 'ghost' && 'text-slate-300 hover:bg-dark-750 hover:text-white',
        variant === 'outline' && 'border border-dark-600 bg-dark-850 text-slate-200 hover:border-solar-amber/60 hover:bg-dark-750',
        variant === 'danger' && 'bg-brand-rose/90 text-white hover:bg-brand-rose',
        className,
      )}
    >
      {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {children}
    </button>
  );
}

export const inputCls = 'rounded-lg border border-dark-600 bg-dark-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 hover:border-dark-500 focus:border-solar-amber focus:outline-none focus:ring-2 focus:ring-solar-amber/25';

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={clsx(inputCls, !/\bw-/.test(props.className ?? '') && 'w-full', props.className)} />;
}
export function Select({ children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={clsx(inputCls, !/\bw-/.test(props.className ?? '') && 'w-full', 'pr-8', props.className)}>
      {children}
    </select>
  );
}
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-slate-500">{hint}</span>}
    </label>
  );
}

export function Badge({ children, color = C.slate, className }: { children: ReactNode; color?: string; className?: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold', className)} style={{ color, background: `${color}22`, border: `1px solid ${color}55` }}>
      {children}
    </span>
  );
}
export const StatusBadge = ({ status }: { status: string }) => <Badge color={STATUS_COLORS[status] ?? C.slate}>{status}</Badge>;

export function Progress({ value, color = C.amber, planned, height = 8 }: { value: number; color?: string; planned?: number; height?: number }) {
  return (
    <div className="relative w-full overflow-hidden rounded-full bg-dark-700" style={{ height }}>
      <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, Math.max(0, value))}%`, background: color }} />
      {planned != null && <div className="absolute top-0 h-full w-0.5 bg-white/80" style={{ left: `${Math.min(100, Math.max(0, planned))}%` }} title={`Planned ${planned}%`} />}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/60 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div className={clsx('mt-10 w-full rounded-2xl border border-dark-600 bg-dark-850 shadow-pop', wide ? 'max-w-5xl' : 'max-w-xl')} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-dark-700 px-5 py-3.5">
          <h2 className="text-base font-semibold text-white">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-dark-700 hover:text-white" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Empty({ icon, title, text, action }: { icon?: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-dark-600 px-6 py-16 text-center">
      {icon && <div className="mb-3 text-solar-amber">{icon}</div>}
      <h3 className="text-base font-semibold text-slate-100">{title}</h3>
      {text && <p className="mt-1 max-w-md text-sm text-slate-400">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400">
      <Loader2 className="h-5 w-5 animate-spin text-solar-amber" /> {label ?? 'Loading…'}
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-dark-600 bg-dark-800 p-0.5">
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)} className={clsx('rounded-md px-2.5 py-1 text-xs font-medium transition', value === o.value ? 'bg-solar-amber text-dark-950 shadow-sm' : 'text-slate-400 hover:text-white')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const tooltipStyle = {
  contentStyle: { background: 'rgb(var(--dk-900))', border: '1px solid rgb(var(--dk-600))', borderRadius: 10, fontSize: 12, color: 'rgb(var(--sl-200))', boxShadow: '0 10px 30px rgb(var(--shadow) / 0.25)' },
  labelStyle: { color: 'rgb(var(--ac-400))', fontWeight: 600 },
  itemStyle: { padding: 0 },
};

export const pct = (n: number) => `${Math.round(n * 10) / 10}%`;
