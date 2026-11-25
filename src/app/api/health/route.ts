import { NextResponse } from 'next/server';
import { getStore } from '@/server/store';
import { breakerStatus } from '@/server/resilience';
import { broadcast, liveStats } from '@/server/live';

let rtCheck: { at: number; result: Record<string, unknown> } | null = null;

/** End-to-end check of the live channel: listen as a browser would (public key), send a signal, wait for it. */
async function realtimeCheck(): Promise<Record<string, unknown>> {
  if (rtCheck && Date.now() - rtCheck.at < 60_000) return { ...rtCheck.result, cached: true };
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anon) return { status: 'not configured' };
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(url, anon, { auth: { persistSession: false } });
  const topic = `swelect-health-${Math.random().toString(36).slice(2)}`;
  const t0 = Date.now();
  const result = await new Promise<Record<string, unknown>>((resolve) => {
    const done = (r: Record<string, unknown>) => { resolve(r); sb.removeAllChannels(); };
    const timer = setTimeout(() => done({ status: 'error', message: 'no signal received within 6 s' }), 6000);
    sb.channel(topic)
      .on('broadcast', { event: 'change' }, () => { clearTimeout(timer); done({ status: 'ok', roundTripMs: Date.now() - t0 }); })
      .subscribe(async (state) => {
        if (state === 'SUBSCRIBED') {
          const s = await broadcast({ kind: 'projects', at: Date.now() }, topic);
          if (s !== 202 && s !== 200) { clearTimeout(timer); done({ status: 'error', message: `broadcast returned ${s}` }); }
        } else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT') { clearTimeout(timer); done({ status: 'error', message: state }); }
      });
  });
  rtCheck = { at: Date.now(), result };
  return result;
}

/**
 * Health check for load balancers, Kubernetes probes and uptime monitors.
 *  GET /api/health        -> process is up (liveness)
 *  GET /api/health?ready=1 -> also checks the database (readiness); 503 if it cannot be reached
 * No secrets or data are returned.
 */
export async function GET(req: Request) {
  const ready = new URL(req.url).searchParams.has('ready');
  const body: Record<string, unknown> = { status: 'ok', uptimeSec: Math.round(process.uptime()), time: new Date().toISOString() };
  let status = 200;
  if (ready) {
    const t = Date.now();
    try {
      const s = getStore();
      await s.listHolidays();
      body.database = { status: 'ok', store: s.kind, ms: Date.now() - t };
    } catch (e) {
      status = 503;
      body.status = 'degraded';
      body.database = { status: 'error', message: (e as Error).message };
    }
    body.circuits = breakerStatus();
    body.live = liveStats();
    if (new URL(req.url).searchParams.has('realtime')) body.realtime = await realtimeCheck();
  }
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}
