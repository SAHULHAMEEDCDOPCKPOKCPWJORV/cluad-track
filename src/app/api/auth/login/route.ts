import bcrypt from 'bcryptjs';
import { NextResponse } from 'next/server';
import { audit, body, handler, setSessionCookie, toSessionUser } from '@/server/auth';
import { getStore, HttpError, ownerOnly } from '@/server/store';
import { CREDIT, isOwner } from '@/lib/types';
import { clientIp, enforce, LIMITS } from '@/server/rateLimit';

const attempts = new Map<string, { n: number; until: number }>();

export const POST = handler(async (req: Request) => {
  const { email, password } = await body<{ email?: string; password?: string }>(req);
  const key = String(email ?? '').toLowerCase().trim();
  if (!key || !password) throw new HttpError(400, 'Email and password are required');
  await enforce([LIMITS.loginIp, clientIp(req)], [LIMITS.loginEmail, key]); // shared by every server copy
  const a = attempts.get(key);
  if (a && a.until > Date.now()) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
  if (ownerOnly() && !isOwner({ email: key })) throw new HttpError(403, CREDIT); // only the owner account can open the app
  const store = getStore();
  const user = await store.getUserByEmail(key);
  const valid = !!user && user.isActive && !!user.passwordHash && (await bcrypt.compare(String(password), user.passwordHash));
  if (!valid) {
    const n = (a?.n ?? 0) + 1;
    attempts.set(key, { n, until: n >= 5 ? Date.now() + 5 * 60_000 : 0 });
    throw new HttpError(401, ownerOnly() ? CREDIT : 'Invalid email or password');
  }
  attempts.delete(key);
  const su = toSessionUser(user!);
  await store.addAudit([audit(su, { action: 'LOGIN', projectId: 'GLOBAL' })]);
  const res = NextResponse.json({ user: su });
  setSessionCookie(res, user!.id);
  return res;
});
