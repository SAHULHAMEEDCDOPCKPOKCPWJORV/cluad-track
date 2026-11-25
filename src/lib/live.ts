'use client';
// Live updates in the app.
//  1. Instant: listens on the Supabase Realtime channel for "something changed" signals (about 1 s).
//  2. Safety net: asks the server "what changed since …?" every 10 s (60 s while the instant channel works),
//     and straight away when the app comes back to the screen or the network returns.
// Only change notes travel this way; the data itself is then reloaded through the signed-in API.
import { useEffect, useRef, useState } from 'react';
import { api, lastLocalWrite, type LiveChange } from './api';

export type LiveStatus = 'connecting' | 'live' | 'polling' | 'offline';
const TOPIC = 'swelect-live';

export function useLiveUpdates(enabled: boolean, me: string, onChanges: (changes: LiveChange[], fromOthers: LiveChange[], reloadAll: boolean) => void): LiveStatus {
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const cb = useRef(onChanges);
  cb.current = onChanges;

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let cursor: string | null = null;
    let startedAt: number | null = null;
    let realtimeUp = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;
    const seen = new Map<string, number>(); // change id -> when seen (forgotten after 2 min)

    const check = async () => {
      if (stopped || inFlight) return;
      if (typeof navigator !== 'undefined' && !navigator.onLine) { setStatus('offline'); return schedule(); }
      inFlight = true;
      try {
        const r = await api.live(cursor ?? undefined);
        startedAt ??= Date.parse(r.now) - 2000; // anything older was already in the data loaded at start
        const fresh = r.changes.filter((c) => !seen.has(c.id) && Date.parse(c.at) > startedAt!);
        const now = Date.now();
        for (const c of fresh) seen.set(c.id, now);
        for (const [id, t] of seen) if (now - t > 120_000) seen.delete(id);
        cursor = r.now;
        setStatus(realtimeUp ? 'live' : 'polling');
        if (r.truncated && fresh.length) cb.current(fresh, [], true); // very large change: just reload everything
        else if (fresh.length) {
          // Our own saves are already on screen; anything else (other people, or me on another device) is news.
          const ownEcho = (c: LiveChange) => c.email === me && now - lastLocalWrite < 15_000;
          const others = fresh.filter((c) => !ownEcho(c));
          if (others.length) cb.current(fresh, others.filter((c) => c.email !== me), false);
        }
      } catch {
        setStatus(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'polling');
      } finally {
        inFlight = false;
        schedule();
      }
    };
    const schedule = () => {
      clearTimeout(timer);
      if (stopped) return;
      const visible = typeof document === 'undefined' || document.visibilityState === 'visible';
      timer = setTimeout(check, !visible ? 60_000 : realtimeUp ? 60_000 : 10_000);
    };
    const soon = (ms = 300) => { clearTimeout(pending); pending = setTimeout(check, ms); };

    // instant channel (optional: works only when the public Supabase URL/key are set)
    let removeChannel: (() => void) | undefined;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (url && key) {
      import('@supabase/supabase-js').then(({ createClient }) => {
        if (stopped) return;
        const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
        const ch = sb.channel(TOPIC)
          .on('broadcast', { event: 'change' }, () => soon(400))
          .subscribe((state) => {
            realtimeUp = state === 'SUBSCRIBED';
            if (realtimeUp) { setStatus('live'); soon(0); } // catch anything missed while connecting
            else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT' || state === 'CLOSED') setStatus((s) => (s === 'offline' ? s : 'polling'));
            schedule();
          });
        removeChannel = () => { void sb.removeChannel(ch); };
      }).catch(() => undefined);
    }

    const onVisible = () => { if (document.visibilityState === 'visible') soon(0); else schedule(); };
    const onOnline = () => soon(0);
    const onOffline = () => setStatus('offline');
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onOnline);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    void check();

    return () => {
      stopped = true;
      clearTimeout(timer);
      clearTimeout(pending);
      removeChannel?.();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onOnline);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [enabled, me]);

  return status;
}
