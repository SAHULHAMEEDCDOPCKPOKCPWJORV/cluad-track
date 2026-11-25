'use client';
import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

/** Dark / Light mode switch. The choice is remembered on this browser. */
export default function ThemeToggle() {
  const [mode, setMode] = useState<'dark' | 'light'>('dark');
  useEffect(() => {
    setMode(document.documentElement.classList.contains('light') ? 'light' : 'dark');
  }, []);
  const choose = (m: 'dark' | 'light') => {
    setMode(m);
    const el = document.documentElement;
    el.classList.toggle('light', m === 'light');
    el.classList.toggle('dark', m === 'dark');
    try { localStorage.setItem('swelect-theme', m); } catch { /* private mode */ }
  };
  return (
    <div className="fixed bottom-4 right-4 z-40 flex rounded-full border border-dark-600 bg-dark-850/95 p-1 shadow-lg backdrop-blur print:hidden" role="group" aria-label="Colour mode">
      <button type="button" onClick={() => choose('dark')} aria-pressed={mode === 'dark'} title="Dark mode" aria-label="Dark mode"
        className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${mode === 'dark' ? 'bg-slate-900 text-solar-gold ring-1 ring-slate-700' : 'text-slate-400 hover:text-slate-200'}`}>
        <Moon className="h-3.5 w-3.5" /><span className="hidden sm:inline">Dark</span>
      </button>
      <button type="button" onClick={() => choose('light')} aria-pressed={mode === 'light'} title="Light mode" aria-label="Light mode"
        className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${mode === 'light' ? 'bg-solar-amber text-white' : 'text-slate-400 hover:text-slate-200'}`}>
        <Sun className="h-3.5 w-3.5" /><span className="hidden sm:inline">Light</span>
      </button>
    </div>
  );
}
