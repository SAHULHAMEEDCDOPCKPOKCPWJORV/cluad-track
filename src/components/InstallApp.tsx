'use client';
// Install popup for new visitors + registers the app helper (service worker).
//  - Android / Windows / Mac / Chromebook (Chrome, Edge): popup with a one-click "Install app" button.
//  - iPhone / iPad (Safari): popup showing the two taps needed (Share -> Add to Home Screen).
//  - Appears automatically the first time someone opens the site.
//  - A small "Install app" button stays visible on every page (including the sign-in page) until the app is installed.
//  - The auto popup is hidden when already running as the installed app, after install, or after the user closes it (for 14 days).
import { useEffect, useState } from 'react';
import { Download, Share, X, PlusSquare } from 'lucide-react';

type PromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };
const HIDE_KEY = 'swelect-install-hidden';
const HIDE_DAYS = 14;
const SHOW_DELAY_MS = 1500;

export default function InstallApp() {
  const [prompt, setPrompt] = useState<PromptEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [open, setOpen] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standalone) { setInstalled(true); return; }
    let dismissed = false;
    try { dismissed = Number(localStorage.getItem(HIDE_KEY) || 0) > Date.now(); } catch { /* private mode */ }

    const ua = navigator.userAgent;
    const isIos = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
    const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
    let timer: ReturnType<typeof setTimeout> | undefined;
    // the floating button is always available; the auto popup only appears if not dismissed recently
    const show = () => { if (dismissed) return; clearTimeout(timer); timer = setTimeout(() => setOpen(true), SHOW_DELAY_MS); };

    const onPrompt = (e: Event) => { e.preventDefault(); setPrompt(e as PromptEvent); show(); };
    const onInstalled = () => { setOpen(false); setPrompt(null); setInstalled(true); remember(); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);

    if (isIos && isSafari) { setIos(true); show(); }

    return () => {
      clearTimeout(timer);
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  function remember() {
    try { localStorage.setItem(HIDE_KEY, String(Date.now() + HIDE_DAYS * 24 * 3600 * 1000)); } catch { /* private mode */ }
  }
  function close() { setOpen(false); remember(); }
  async function install() {
    if (!prompt) return;
    try {
      await prompt.prompt();
      await prompt.userChoice;
    } catch { /* ignore */ }
    setPrompt(null);
    setOpen(false);
    remember();
  }

  if (installed || (!prompt && !ios)) return null;

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 left-4 z-40 flex items-center gap-2 rounded-full border border-white/15 bg-[#0f1523]/95 px-4 py-2 text-xs font-semibold text-amber-300 shadow-lg backdrop-blur hover:bg-[#161e31] print:hidden"
      >
        <Download size={14} /> Install app
      </button>
    );
  }

  return (
    <div
      role="dialog"
      aria-label="Install SWELECT Project Control"
      className="fixed inset-x-0 bottom-0 z-[100] flex justify-center p-3 sm:inset-x-auto sm:right-4 sm:bottom-4 sm:p-0"
    >
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#0f1523] p-4 text-white shadow-2xl">
        <div className="flex items-start gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon-192.png" alt="" width={48} height={48} className="h-12 w-12 rounded-xl" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">Install SWELECT PC</div>
            <p className="mt-0.5 text-xs text-white/70">
              Get the app on your device for faster opening and full-screen use. Free, no app store needed.
            </p>
          </div>
          <button onClick={close} aria-label="Close" className="rounded-md p-1 text-white/60 hover:bg-white/10 hover:text-white">
            <X size={16} />
          </button>
        </div>

        {prompt ? (
          <button
            onClick={install}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-amber-400 px-4 py-2.5 text-sm font-semibold text-black hover:bg-amber-300"
          >
            <Download size={16} /> Install app
          </button>
        ) : (
          <ol className="mt-3 space-y-2 text-xs text-white/80">
            <li className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10">1</span>
              Tap the <Share size={14} className="inline" /> Share button in Safari
            </li>
            <li className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10">2</span>
              Choose <PlusSquare size={14} className="inline" /> <b>Add to Home Screen</b>
            </li>
          </ol>
        )}

        <button onClick={close} className="mt-2 w-full text-center text-xs text-white/50 hover:text-white/80">
          Not now
        </button>
      </div>
    </div>
  );
}
