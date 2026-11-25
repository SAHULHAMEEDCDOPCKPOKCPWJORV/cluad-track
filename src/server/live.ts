// Live updates: after every successful save the server sends a tiny "something changed" signal on a
// Supabase Realtime broadcast channel. Open apps receive it within about a second and then reload the
// data through the normal signed-in API. The signal never carries project data, only which project
// changed, so the public channel exposes nothing sensitive (the tables stay locked by row security).
import { after } from 'next/server';

export const LIVE_TOPIC = 'swelect-live';

export type LiveSignal = { kind: 'project' | 'projects' | 'holidays' | 'users'; projectId?: string; at: number };

/** Which part of the app a write to this API path changed. */
export function signalFor(path: string): LiveSignal | null {
  const at = Date.now();
  if (/^\/api\/projects\/[^/]+\/unlock$/.test(path)) return null; // opening/closing a project changes nothing for other users
  const m = path.match(/^\/api\/projects\/([^/]+)/);
  if (m) return { kind: 'project', projectId: decodeURIComponent(m[1]), at };
  if (path === '/api/projects') return { kind: 'projects', at };
  if (path.startsWith('/api/holidays')) return { kind: 'holidays', at };
  if (path.startsWith('/api/users')) return { kind: 'users', at };
  return null; // sign-in, sign-out, password: nothing for other users to refresh
}

function config() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key && process.env.SWELECT_STORE !== 'memory' ? { url, key } : null;
}

const g = globalThis as unknown as { __swLive?: { ok: number; failed: number; last?: { at: string; status: number | string } } };
const stats = (g.__swLive ??= { ok: 0, failed: 0 });
export const liveStats = () => ({ ...stats, configured: !!config() });

/** Sends one broadcast. Never throws: a missed signal is covered by the apps' regular sync check. */
export async function broadcast(signal: LiveSignal, topic = LIVE_TOPIC): Promise<number | string> {
  const c = config();
  if (!c) return 'not configured';
  try {
    const r = await fetch(`${c.url}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: c.key, Authorization: `Bearer ${c.key}` },
      body: JSON.stringify({ messages: [{ topic, event: 'change', payload: signal, private: false }] }),
      signal: AbortSignal.timeout(3000),
    });
    stats[r.ok ? 'ok' : 'failed']++;
    stats.last = { at: new Date().toISOString(), status: r.status };
    return r.status;
  } catch (e) {
    stats.failed++;
    stats.last = { at: new Date().toISOString(), status: (e as Error).name };
    return (e as Error).name;
  }
}

/** Called after a successful write. Runs after the response is sent, so saving is not slowed down. */
export function announceChange(path: string) {
  const s = signalFor(path);
  if (!s || !config()) return;
  try {
    after(() => broadcast(s));
  } catch {
    void broadcast(s); // outside a request (tests): send directly
  }
}
