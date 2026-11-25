'use client';
import type { ReactNode } from 'react';

// SWELECT company logo (public/swelect-logo.png).
export function Logo({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const h = size === 'sm' ? 'h-7' : size === 'lg' ? 'h-16' : 'h-10';
  return (
    <div className="inline-flex items-center justify-center rounded-lg bg-white px-2.5 py-1.5 shadow">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/swelect-logo.png" alt="swelect - Powering the world responsibly" className={`${h} w-auto`} />
    </div>
  );
}

export function PageHeader({ title, badge, subtitle, right }: { title: string; badge?: ReactNode; subtitle?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-4">
      <Logo />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-bold text-white md:text-2xl">{title}</h2>
          {badge && <span className="rounded-md border border-solar-amber/40 bg-solar-amber/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-solar-gold">{badge}</span>}
        </div>
        {subtitle && <p className="mt-0.5 truncate text-xs text-slate-400 md:text-sm">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}
