// Per-project passwords.
//  - A project with a password keeps all of its data (schedule, progress, history) behind it: the API refuses
//    every request for that project until the right password has been entered on this account.
//  - Only a bcrypt hash is stored (in the existing settings table, key "project.passwords"), never the password.
//  - Entering the password sets a signed, httpOnly cookie that remembers which projects this account unlocked.
//    The cookie records the version of the password it was issued for, so changing or removing the password
//    locks everyone out again at once.
import { timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';
import type { NextResponse } from 'next/server';
import type { AuditLog, Project, SessionUser } from '@/lib/types';
import { getSetting, setSetting } from './db';
import { signValue } from './auth';
import { HttpError } from './store';
import { TtlCache } from './resilience';

export const UNLOCK_COOKIE = 'swelect_unlock';
const UNLOCK_MAX_AGE = 60 * 60 * 8; // an unlocked project stays open for 8 hours
export const MIN_PASSWORD = 6;
export const MAX_PASSWORD = 100;

export interface LockRecord { hash: string; at: string; by: string }
type Locks = Record<string, LockRecord>;
type Unlocks = Record<string, { exp: number; v: string }>;

const SETTING_KEY = 'project.passwords';
const cache = new TtlCache<Locks>(5_000, 1);

export async function getLocks(): Promise<Locks> {
  const hit = cache.get('all');
  if (hit) return hit;
  const v = await getSetting<Locks>(SETTING_KEY, {});
  cache.set('all', v);
  return v;
}

async function saveLocks(next: Locks) {
  await setSetting(SETTING_KEY, next);
  cache.clear();
}

// ───────── unlock cookie ─────────
const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

function readUnlocks(token: string | undefined, uid: string): Unlocks {
  if (!token) return {};
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return {};
  const expected = Buffer.from(signValue(payload));
  const got = Buffer.from(sig);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return {};
  try {
    const d = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { uid?: string; p?: Unlocks };
    if (d.uid !== uid || !d.p || typeof d.p !== 'object') return {};
    const now = Date.now();
    return Object.fromEntries(Object.entries(d.p).filter(([, e]) => e && typeof e.exp === 'number' && e.exp > now));
  } catch {
    return {};
  }
}

async function currentUnlocks(uid: string): Promise<Unlocks> {
  return readUnlocks((await cookies()).get(UNLOCK_COOKIE)?.value, uid);
}

function writeUnlocks(res: NextResponse, uid: string, p: Unlocks) {
  const payload = enc({ uid, p });
  res.cookies.set(UNLOCK_COOKIE, `${payload}.${signValue(payload)}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: UNLOCK_MAX_AGE,
  });
}

// ───────── checks ─────────
/** True when the project has no password, or this account has already entered the current one. */
export async function isUnlocked(u: SessionUser, projectId: string, locks?: Locks, unlocks?: Unlocks): Promise<boolean> {
  const l = (locks ?? (await getLocks()))[projectId];
  if (!l) return true;
  const e = (unlocks ?? (await currentUnlocks(u.id)))[projectId];
  return !!e && e.v === l.at;
}

/** Throws 423 (Locked) unless the project is open for this account. Call before returning or changing project data. */
export async function assertProjectAccess(u: SessionUser, projectId: string) {
  if (!(await isUnlocked(u, projectId))) throw new HttpError(423, 'This project is password protected. Enter the project password to open it.');
}

/** Marks a project as protected/unlocked on its way to the browser and hides what a locked project must not show. */
export function decorate(p: Project, locks: Locks, unlocks: Unlocks): Project {
  const l = locks[p.id];
  if (!l) return { ...p, locked: false, unlocked: true };
  const open = !!unlocks[p.id] && unlocks[p.id].v === l.at;
  return open ? { ...p, locked: true, unlocked: true } : { ...p, description: '', locked: true, unlocked: false };
}

export async function lockState(u: SessionUser) {
  const [locks, unlocks] = await Promise.all([getLocks(), currentUnlocks(u.id)]);
  const open = (id: string) => !locks[id] || (!!unlocks[id] && unlocks[id].v === locks[id].at);
  return { locks, unlocks, open, decorate: (p: Project) => decorate(p, locks, unlocks) };
}

// ───────── actions ─────────
export function checkNew(pw: unknown): string {
  const s = typeof pw === 'string' ? pw : '';
  if (s.length < MIN_PASSWORD) throw new HttpError(400, `Project password must be at least ${MIN_PASSWORD} characters`);
  if (s.length > MAX_PASSWORD) throw new HttpError(400, `Project password must be at most ${MAX_PASSWORD} characters`);
  return s;
}

/** Checks the password and marks the project as unlocked on the response cookie. */
export async function unlockProject(u: SessionUser, projectId: string, password: unknown, res: NextResponse) {
  const l = (await getLocks())[projectId];
  if (!l) return { ok: true, protected: false };
  const valid = typeof password === 'string' && password.length > 0 && password.length <= MAX_PASSWORD && (await bcrypt.compare(password, l.hash));
  if (!valid) throw new HttpError(403, 'Incorrect project password');
  const cur = await currentUnlocks(u.id);
  writeUnlocks(res, u.id, { ...cur, [projectId]: { exp: Date.now() + UNLOCK_MAX_AGE * 1000, v: l.at } });
  return { ok: true, protected: true };
}

export async function relockProject(u: SessionUser, projectId: string, res: NextResponse) {
  const cur = await currentUnlocks(u.id);
  delete cur[projectId];
  writeUnlocks(res, u.id, cur);
}

/**
 * Set, change or remove a project password. Returns what happened for the audit trail.
 * Changing or removing an existing password needs the current password, or an Admin account.
 */
export async function savePassword(
  u: SessionUser,
  projectId: string,
  input: { newPassword?: unknown; currentPassword?: unknown; remove?: unknown },
  res?: NextResponse,
): Promise<'set' | 'changed'> {
  const locks = { ...(await getLocks()) };
  const existing = locks[projectId];
  if (existing && u.role !== 'Admin') {
    const cur = typeof input.currentPassword === 'string' ? input.currentPassword : '';
    if (!cur || !(await bcrypt.compare(cur, existing.hash))) throw new HttpError(403, 'Enter the current project password to change or remove it');
  }
  // Every project must have a password: it can be changed, never removed.
  if (input.remove) throw new HttpError(400, 'Every project must have a password. Set a new one instead of removing it.');
  const pw = checkNew(input.newPassword);
  const rec: LockRecord = { hash: await bcrypt.hash(pw, 10), at: new Date().toISOString(), by: u.email };
  locks[projectId] = rec;
  await saveLocks(locks);
  // The person who just set it does not get locked out of their own project.
  if (res) {
    const cur = await currentUnlocks(u.id);
    writeUnlocks(res, u.id, { ...cur, [projectId]: { exp: Date.now() + UNLOCK_MAX_AGE * 1000, v: rec.at } });
  }
  return existing ? 'changed' : 'set';
}

/** True when `password` is this project's password (a project without one has nothing to check). */
export async function checkPassword(projectId: string, password: unknown): Promise<boolean> {
  const l = (await getLocks())[projectId];
  if (!l) return true;
  return typeof password === 'string' && password.length > 0 && password.length <= MAX_PASSWORD && bcrypt.compare(password, l.hash);
}

/** Used when a project is deleted: drop its password record. */
export async function forgetPassword(projectId: string) {
  const locks = { ...(await getLocks()) };
  if (!locks[projectId]) return;
  delete locks[projectId];
  await saveLocks(locks);
}

/** Audit rows for locked projects must not reach an account that has not unlocked them. */
export async function filterVisibleAudit(u: SessionUser, logs: AuditLog[]): Promise<AuditLog[]> {
  const s = await lockState(u);
  return logs.filter((l) => s.open(l.projectId));
}
