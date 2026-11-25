'use client';
// Keeps every open copy of the app (browser tabs and installed apps on laptops and phones) on the newest version.
// It asks the server which version is live every minute, and whenever the app comes back to the screen or back online.
// When a newer version has been published the app reloads itself; if someone has unsaved edits it shows an
// "Update now" bar instead, so nothing typed is lost.
import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

const CHECK_MS = 60_000;

export default function AppUpdater() {
  const [pending, setPending] = useState(false);
  useEffect(() => {
    const mine = process.env.NEXT_PUBLIC_BUILD_ID;
    if (process.env.NODE_ENV !== 'production' || !mine) return;
    let busy = false;
    const check = async () => {
      if (busy || !navigator.onLine) return;
      busy = true;
      try {
        const r = await fetch('/api/version', { cache: 'no-store' });
        const { build } = (await r.json()) as { build?: string };
        if (build && build !== mine) {
          await navigator.serviceWorker?.getRegistration().then((reg) => reg?.update()).catch(() => undefined);
          if ((window as unknown as { __swelectUnsaved?: boolean }).__swelectUnsaved) setPending(true);
          else location.reload();
        }
      } catch {
        /* offline or server busy: try again at the next check */
      } finally {
        busy = false;
      }
    };
    const onVisible = () => { if (document.visibilityState === 'visible') void check(); };
    const timer = setInterval(check, CHECK_MS);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', check);
    window.addEventListener('online', check);
    void check();
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', check);
      window.removeEventListener('online', check);
    };
  }, []);
  if (!pending) return null;
  return (
    <div className="fixed inset-x-0 top-0 z-[100] flex items-center justify-center gap-3 bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-lg print:hidden">
      <RefreshCw className="h-4 w-4" />A new version of the app is available. Save your changes, then
      <button onClick={() => location.reload()} className="rounded-md bg-white px-3 py-1 text-emerald-700 hover:bg-emerald-50">Update now</button>
    </div>
  );
}
