import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { runDaily } from '@/server/automation';
import { getSetting } from '@/server/db';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

/**
 * Called by Vercel Cron every morning (see vercel.json).
 * - If the CRON_SECRET environment variable is set, Vercel sends "Authorization: Bearer <CRON_SECRET>" and only that is accepted.
 * - Without it, the job still runs from Vercel Cron, but at most once every 20 hours, so an outside call can never
 *   cause extra runs or duplicate emails.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const got = req.headers.get('authorization') ?? '';
    const want = `Bearer ${secret}`;
    if (got.length !== want.length || !timingSafeEqual(Buffer.from(got), Buffer.from(want))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  } else {
    if (!(req.headers.get('user-agent') ?? '').toLowerCase().startsWith('vercel-cron')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const last = await getSetting<{ at?: string } | null>('automation.lastRun', null);
    if (last?.at && Date.now() - Date.parse(last.at) < 20 * 3600_000) return NextResponse.json({ ok: true, skipped: 'already ran in the last 20 hours' });
  }
  const summary = await runDaily({ sendEmails: true });
  return NextResponse.json({ ok: true, at: summary.at, seconds: summary.seconds }, { headers: { 'Cache-Control': 'no-store' } });
}
