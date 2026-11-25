// Global rate limits for the sensitive actions: signing in, opening a project with its password,
// changing a project password and deleting a project.
//
// The limits in src/proxy.ts are counted inside each server copy. When Vercel (or Kubernetes) runs several
// copies at once, each copy has its own count. These limits are kept in the database instead
// (function swelect_rate_hit), so every copy shares one count per person and the limit really holds.
//
// If the counter cannot be reached the request is allowed (fail open): a database hiccup must never stop
// people from signing in. The per-copy limits in proxy.ts and the per-account lockouts still apply.
import { getDb, HttpError } from './store';

export interface Limit { name: string; max: number; windowSec: number }

export const LIMITS = {
  loginIp: { name: 'login-ip', max: 20, windowSec: 60 }, // an office can share one IP address
  loginEmail: { name: 'login-email', max: 10, windowSec: 15 * 60 },
  unlockIp: { name: 'unlock-ip', max: 30, windowSec: 60 }, // the password is asked on every open, so allow normal use
  passwordIp: { name: 'password-ip', max: 10, windowSec: 60 },
  deleteIp: { name: 'delete-ip', max: 10, windowSec: 60 },
} satisfies Record<string, Limit>;

/** The visitor's IP address as reported by Vercel, nginx or the Kubernetes ingress. */
export function clientIp(req: Request): string {
  return (req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for')?.split(',')[0] || 'local').trim().slice(0, 64);
}

// Local demo / tests (no database): same rules, counted in memory.
const g = globalThis as unknown as { __swGlobalRate?: Map<string, { start: number; hits: number }> };
const mem = (g.__swGlobalRate ??= new Map());

async function hit(key: string, windowSec: number): Promise<{ hits: number; resetMs: number } | null> {
  const db = getDb();
  if (!db) {
    const now = Date.now();
    const cur = mem.get(key);
    const e = !cur || now - cur.start >= windowSec * 1000 ? { start: now, hits: 1 } : { start: cur.start, hits: cur.hits + 1 };
    mem.set(key, e);
    return { hits: e.hits, resetMs: e.start + windowSec * 1000 - now };
  }
  try {
    const { data, error } = await db.rpc('swelect_rate_hit', { p_key: key, p_window_seconds: windowSec });
    if (error) throw new Error(error.message);
    const row = (Array.isArray(data) ? data[0] : data) as { hits: number; reset_at: string } | undefined;
    if (!row) return null;
    return { hits: Number(row.hits), resetMs: new Date(row.reset_at).getTime() - Date.now() };
  } catch (e) {
    console.warn(`[rate-limit] counter unavailable, allowing request: ${(e as Error).message}`);
    return null;
  }
}

/** Counts one attempt against each limit and throws 429 once any of them is used up. */
export async function enforce(...checks: [Limit, string][]) {
  const results = await Promise.all(checks.map(([l, who]) => hit(`${l.name}:${who.toLowerCase()}`, l.windowSec).then((r) => ({ l, r }))));
  for (const { l, r } of results) {
    if (r && r.hits > l.max) {
      const wait = Math.max(1, Math.ceil(r.resetMs / 1000));
      throw new HttpError(429, `Too many attempts. Please wait ${wait >= 120 ? `${Math.ceil(wait / 60)} minutes` : `${wait} seconds`} and try again.`);
    }
  }
}
