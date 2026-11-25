'use client';
import { isCredit } from '@/lib/types';
import { useEffect, useRef, useState } from 'react';
import { Lock, Mail, ShieldCheck, Eye, EyeOff, Sun, CalendarRange, BarChart3, Activity, ArrowRight } from 'lucide-react';
import { api } from '@/lib/api';
import type { SessionUser } from '@/lib/types';
import { DEPARTMENTS, DEPARTMENT_NAMES } from '@/lib/types';
import { Button, Input, DEPT_COLORS } from '../ui';

type GoogleId = {
  accounts: { id: { initialize: (o: Record<string, unknown>) => void; renderButton: (el: HTMLElement, o: Record<string, unknown>) => void } };
};
declare global { interface Window { google?: GoogleId } }

function loadGoogleScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve();
    const existing = document.getElementById('gsi-client') as HTMLScriptElement | null;
    const s = existing ?? Object.assign(document.createElement('script'), { id: 'gsi-client', src: 'https://accounts.google.com/gsi/client', async: true, defer: true });
    s.addEventListener('load', () => resolve());
    s.addEventListener('error', () => reject(new Error('Could not load Google sign-in')));
    if (!existing) document.head.appendChild(s);
  });
}

export default function LoginView({ onLogin, error }: { onLogin: (u: SessionUser) => void; error?: string }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [err, setErr] = useState(error ?? '');
  const [busy, setBusy] = useState(false);
  const [gState, setGState] = useState<'loading' | 'ready' | 'off' | 'error'>('loading');
  const gBtn = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { googleClientId } = await api.authConfig();
        if (!googleClientId) return alive && setGState('off');
        await loadGoogleScript();
        if (!alive || !gBtn.current || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: googleClientId,
          ux_mode: 'popup',
          callback: async (resp: { credential?: string }) => {
            if (!resp.credential) return;
            setErr('');
            setBusy(true);
            try { onLogin((await api.googleLogin(resp.credential)).user); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
          },
        });
        const light = document.documentElement.classList.contains('light');
        window.google.accounts.id.renderButton(gBtn.current, { theme: light ? 'outline' : 'filled_black', size: 'large', shape: 'pill', text: 'continue_with', width: gBtn.current.offsetWidth || 360, logo_alignment: 'left' });
        setGState('ready');
      } catch {
        if (alive) setGState('error');
      }
    })();
    return () => { alive = false; };
  }, [onLogin]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      onLogin((await api.login(email, password)).user);
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen bg-dark-950 lg:grid-cols-[1.15fr_1fr]">
      {/* Brand panel */}
      <div className="login-hero relative hidden overflow-hidden lg:block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/solar-farm.jpg" alt="" className="absolute inset-0 h-full w-full scale-105 object-cover" />
        <div className="absolute inset-0 bg-gradient-to-br from-[#0b1220]/95 via-[#0b1220]/80 to-[#7c2d12]/60" />
        <div className="absolute inset-0 opacity-[0.07]" style={{ backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)', backgroundSize: '44px 44px' }} />
        <div className="relative flex h-full flex-col justify-between p-12 text-white">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-white px-3 py-2 shadow-xl">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/swelect-logo.png" alt="SWELECT" className="h-8" />
            </div>
            <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] !text-emerald-200 backdrop-blur">Project Control</span>
          </div>

          <div className="max-w-xl">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.25em] !text-emerald-300"><Sun className="h-4 w-4" />Solar EPC &amp; IPP</p>
            <h1 className="mt-4 text-4xl font-extrabold leading-[1.1] !text-white xl:text-5xl">
              Plan, track and deliver<br />
              <span className="bg-gradient-to-r from-emerald-300 via-emerald-400 to-emerald-500 bg-clip-text !text-transparent">every megawatt on time.</span>
            </h1>
            <p className="mt-5 max-w-lg text-[15px] leading-relaxed !text-white/80">
              One schedule engine for the master schedule, Gantt chart, S-curves and dashboard, with verified progress history and audit trail.
            </p>
            <div className="mt-8 grid grid-cols-3 gap-3">
              {[
                { i: <CalendarRange className="h-5 w-5" />, k: 'Excel', t: 'Import any master schedule' },
                { i: <BarChart3 className="h-5 w-5" />, k: 'Auto', t: 'Sections & S-curves from your data' },
                { i: <Activity className="h-5 w-5" />, k: 'CPM', t: 'Critical path & delay ripple' },
              ].map((f) => (
                <div key={f.t} className="rounded-2xl border border-white/15 bg-white/[0.07] p-4 backdrop-blur-md">
                  <div className="!text-emerald-300">{f.i}</div>
                  <div className="mt-3 text-xl font-bold !text-white">{f.k}</div>
                  <div className="text-xs !text-white/70">{f.t}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {DEPARTMENTS.map((d) => (
              <span key={d} title={DEPARTMENT_NAMES[d]} className="rounded-md px-2 py-1 text-[11px] font-semibold backdrop-blur" style={{ color: DEPT_COLORS[d], background: 'rgba(15,23,42,0.55)', border: `1px solid ${DEPT_COLORS[d]}55` }}>{d}</span>
            ))}
          </div>
        </div>
      </div>

      {/* Sign-in panel */}
      <div className="relative flex items-center justify-center px-6 py-12">
        <div className="pointer-events-none absolute right-0 top-0 h-72 w-72 rounded-full bg-solar-amber/10 blur-3xl" aria-hidden />
        <div className="relative w-full max-w-[420px]">
          <div className="mb-8 flex justify-center lg:hidden">
            <div className="rounded-xl bg-white px-4 py-2.5 shadow">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/swelect-logo.png" alt="SWELECT" className="h-8" />
            </div>
          </div>
          <h2 className="text-[28px] font-bold tracking-tight text-white">Welcome back</h2>
          <p className="mt-1.5 text-sm text-slate-400">Sign in to SWELECT Project Control.</p>

          <div className="mt-8">
            <div ref={gBtn} className={gState === 'ready' ? 'flex min-h-[44px] justify-center' : 'hidden'} />
            {gState !== 'ready' && (
              <button type="button" disabled
                title={gState === 'off' ? 'Google sign-in is not set up yet (administrator: add GOOGLE_CLIENT_ID)' : gState === 'error' ? 'Google sign-in could not load' : 'Loading Google sign-in…'}
                className="flex w-full items-center justify-center gap-3 rounded-full border border-dark-600 bg-dark-900 px-4 py-2.5 text-sm font-semibold text-slate-300 opacity-70">
                <GoogleMark />
                {gState === 'loading' ? 'Loading Google sign-in…' : gState === 'off' ? 'Continue with Google (not set up yet)' : 'Google sign-in unavailable'}
              </button>
            )}
            <p className="mt-2 text-center text-[11px] text-slate-500">Works for Google emails that already have an account here.</p>
          </div>

          <div className="my-6 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
            <span className="h-px flex-1 bg-dark-700" />or with email<span className="h-px flex-1 bg-dark-700" />
          </div>

          <form onSubmit={submit} className="space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-slate-300">Email</span>
              <div className="relative">
                <Mail className="absolute left-3.5 top-3 h-4 w-4 text-slate-500" />
                <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-11 rounded-xl pl-10" placeholder="you@swelect.com" autoComplete="username" />
              </div>
            </label>
            <label className="block">
              <span className="mb-1.5 flex justify-between text-xs font-semibold text-slate-300">Password<span className="font-normal text-slate-500">Forgot? Ask the Planning admin</span></span>
              <div className="relative">
                <Lock className="absolute left-3.5 top-3 h-4 w-4 text-slate-500" />
                <Input type={show ? 'text' : 'password'} required value={password} onChange={(e) => setPassword(e.target.value)} className="h-11 rounded-xl pl-10 pr-10" autoComplete="current-password" />
                <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'} className="absolute right-3 top-3 text-slate-500 hover:text-slate-200">{show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
              </div>
            </label>
            {err && <p role="alert" className={`rounded-xl border border-brand-rose/30 bg-brand-rose/10 px-3 py-2.5 text-rose-300 ${isCredit(err) ? 'text-base font-extrabold' : 'text-sm'}`}>{err}</p>}
            <Button type="submit" loading={busy} className="h-11 w-full rounded-xl text-[15px]">Sign in <ArrowRight className="h-4 w-4" /></Button>
          </form>

          <div className="mt-8 flex items-center gap-2 rounded-xl border border-dark-700 bg-dark-900/60 px-3.5 py-3 text-[11px] text-slate-400">
            <ShieldCheck className="h-4 w-4 shrink-0 text-brand-emerald" />
            Encrypted session · passwords stored hashed · every change is written to the activity history.
          </div>
          <p className="mt-6 text-center text-[11px] text-slate-500">© SWELECT Energy Systems Limited · Confidential</p>
        </div>
      </div>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 38.6 44 33 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
