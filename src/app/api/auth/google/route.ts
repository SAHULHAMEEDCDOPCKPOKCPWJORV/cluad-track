import { NextResponse } from 'next/server';
import { audit, body, handler, setSessionCookie, toSessionUser } from '@/server/auth';
import { getStore, HttpError, ownerOnly } from '@/server/store';
import { CREDIT, isOwner } from '@/lib/types';
import { resilientFetch } from '@/server/resilience';

interface GoogleTokenInfo { aud?: string; iss?: string; email?: string; email_verified?: string | boolean; exp?: string; hd?: string }

/**
 * Sign in with Google. The browser gets a signed ID token from Google; we ask Google to verify it,
 * check it was issued for this app, and then sign in ONLY an existing, active account with the same email.
 * No account is ever created from a Google login.
 */
export const POST = handler(async (req: Request) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new HttpError(503, 'Google sign-in is not set up yet. Ask the administrator to add GOOGLE_CLIENT_ID.');
  const { credential } = await body<{ credential?: string }>(req);
  if (!credential || typeof credential !== 'string' || credential.length > 4096) throw new HttpError(400, 'Missing Google credential');

  let r: Response;
  try {
    r = await resilientFetch('Google sign-in', { timeoutMs: 6_000 })(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`, { cache: 'no-store' });
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(502, 'Could not reach Google to verify the sign-in. Please try again.');
  }
  if (!r.ok) throw new HttpError(401, 'Google could not verify this sign-in. Please try again.');
  const info = (await r.json()) as GoogleTokenInfo;
  const verified = info.email_verified === true || info.email_verified === 'true';
  if (info.aud !== clientId || !['accounts.google.com', 'https://accounts.google.com'].includes(String(info.iss)) || !verified || !info.email || Number(info.exp) * 1000 < Date.now())
    throw new HttpError(401, 'Google sign-in token is not valid for this application.');
  const allowed = (process.env.GOOGLE_ALLOWED_DOMAINS || '').split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
  const email = info.email.toLowerCase();
  if (allowed.length && !allowed.includes(email.split('@')[1])) throw new HttpError(403, `Google accounts from ${email.split('@')[1]} are not allowed here.`);

  const store = getStore();
  if (ownerOnly() && !isOwner({ email })) throw new HttpError(403, CREDIT);
  const user = await store.getUserByEmail(email);
  if (!user || !user.isActive) throw new HttpError(403, `${email} has no SWELECT Project Control account. Ask the Planning admin to add this email in User Management.`);
  const su = toSessionUser(user);
  await store.addAudit([audit(su, { action: 'LOGIN', projectId: 'GLOBAL', newValue: 'Google sign-in' })]);
  const res = NextResponse.json({ user: su });
  setSessionCookie(res, user.id);
  return res;
});
