// Signed, httpOnly session cookie + request helpers for route handlers.
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import type { AuditLog, SessionUser } from '@/lib/types';
import { getStore, HttpError, isDemoMode, type UserRecord } from './store';
import { announceChange } from './live';
import { getSetting, setSetting } from './db';
import { TtlCache } from './resilience';
import { effectiveAccess, levelOf, MODULES, type Level, type ModuleKey } from '@/lib/access';
import { isOwner, OWNER_ONLY } from '@/lib/types';

export const COOKIE = 'swelect_session';
const MAX_AGE = 60 * 60 * 12; // 12 hours

function secret(): string {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) return createHash('sha256').update(`swelect-session:${process.env.SUPABASE_SERVICE_ROLE_KEY}`).digest('hex');
  if (isDemoMode()) return 'swelect-local-demo-secret';
  throw new HttpError(503, 'Server not configured: SESSION_SECRET or SUPABASE_SERVICE_ROLE_KEY missing.');
}

const b64 = (s: string) => Buffer.from(s).toString('base64url');
const sign = (payload: string) => createHmac('sha256', secret()).update(payload).digest('base64url');
/** Signs any string with the server secret (used by the project-password unlock cookie). */
export const signValue = sign;

export function createToken(userId: string) {
  const payload = b64(JSON.stringify({ uid: userId, exp: Date.now() + MAX_AGE * 1000 }));
  return `${payload}.${sign(payload)}`;
}

function verifyToken(token: string | undefined): string | null {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = Buffer.from(sign(payload));
  const got = Buffer.from(sig);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
  try {
    const { uid, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return typeof uid === 'string' && Date.now() < exp ? uid : null;
  } catch {
    return null;
  }
}

export function setSessionCookie(res: NextResponse, userId: string) {
  res.cookies.set(COOKIE, createToken(userId), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE,
  });
}

export function toSessionUser(u: UserRecord): SessionUser {
  return {
    id: u.id, email: u.email, name: u.name, department: u.department, role: u.role,
    canEdit: u.canEdit, canExport: u.canExport, canApprove: u.canApprove, mustChangePassword: !!u.mustChangePassword,
  };
}

// ───────── access control (admin-managed, per account) ─────────
type Overrides = Record<string, Partial<Record<ModuleKey, Level>>>;
const accessCache = new TtlCache<Overrides>(30_000, 1);
export async function accessOverrides(): Promise<Overrides> {
  const hit = accessCache.get('all');
  if (hit) return hit;
  const v = await getSetting<Overrides>('access.users', {});
  accessCache.set('all', v);
  return v;
}
export async function saveAccessOverride(userId: string, access: Partial<Record<ModuleKey, Level>> | null) {
  const all = { ...(await getSetting<Overrides>('access.users', {})) };
  if (access) all[userId] = Object.fromEntries(MODULES.filter((m) => ['none', 'view', 'edit'].includes(String(access[m.key]))).map((m) => [m.key, access[m.key]]));
  else delete all[userId];
  await setSetting('access.users', all);
  accessCache.clear();
  return all;
}

export async function currentUser(): Promise<SessionUser | null> {
  const uid = verifyToken((await cookies()).get(COOKIE)?.value);
  if (!uid) return null;
  const u = await getStore().getUser(uid);
  if (!u || !u.isActive) return null;
  if (OWNER_ONLY && !isOwner(u)) return null; // every other account is signed out
  const su = toSessionUser(u);
  su.access = effectiveAccess(su, (await accessOverrides())[u.id]);
  return su;
}

const moduleName = (m: ModuleKey) => MODULES.find((x) => x.key === m)?.label ?? m;

/** Signed-in user, optionally checking admin, edit rights and access to one part of the app. */
export async function requireUser(opts: { edit?: boolean; admin?: boolean; module?: ModuleKey } = {}): Promise<SessionUser> {
  const u = await currentUser();
  if (!u) throw new HttpError(401, 'Please sign in.');
  if (opts.admin && u.role !== 'Admin') throw new HttpError(403, 'Admin access required.');
  if (opts.module) {
    const lvl = levelOf(u, opts.module);
    if (lvl === 'none') throw new HttpError(403, `Your account does not have access to ${moduleName(opts.module)}. Ask an admin.`);
    if (opts.edit && lvl !== 'edit') throw new HttpError(403, `Your account can only view ${moduleName(opts.module)}.`);
  }
  if (opts.edit && !u.canEdit) throw new HttpError(403, 'Your account is read-only.');
  if (opts.edit && u.mustChangePassword) throw new HttpError(403, 'Please change your temporary password first.');
  return u;
}

export function audit(u: SessionUser | null, entry: Partial<AuditLog> & { action: string; projectId: string }): AuditLog {
  return {
    id: randomUUID(),
    projectName: null, activityId: null, activityName: null, fieldName: null, oldValue: null, newValue: null,
    ...entry,
    userId: u?.id ?? null,
    userEmail: u?.email ?? null,
    department: u?.department ?? null,
    timestamp: new Date().toISOString(),
  };
}

export function ok(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

/** Wraps a route handler: JSON errors, no caching. */
export function handler<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    const t0 = performance.now();
    const timing = (res: Response) => { res.headers.set('Server-Timing', `app;dur=${(performance.now() - t0).toFixed(1)}`); return res; };
    try {
      const res = await fn(...args);
      res.headers.set('Cache-Control', 'no-store');
      const req = args[0];
      if (req instanceof Request && req.method !== 'GET' && res.ok) announceChange(new URL(req.url).pathname); // tell open apps to refresh
      return timing(res);
    } catch (e) {
      if (e instanceof HttpError) return timing(NextResponse.json({ error: e.message }, { status: e.status, headers: e.status === 503 ? { 'Retry-After': '15' } : {} }));
      console.error(e);
      return timing(NextResponse.json({ error: 'Unexpected server error' }, { status: 500 }));
    }
  };
}

export async function body<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
}
