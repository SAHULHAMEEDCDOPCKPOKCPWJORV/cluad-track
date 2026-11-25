import { NextResponse } from 'next/server';
import { audit, body, handler, requireUser } from '@/server/auth';
import { relockProject, unlockProject } from '@/server/projectLock';
import { getStore, HttpError } from '@/server/store';
import { clientIp, enforce, LIMITS } from '@/server/rateLimit';

type Ctx = { params: Promise<{ id: string }> };

// After 5 wrong passwords for one project from one account, wait 5 minutes (on top of the per-IP limit in proxy.ts).
const wrong = new Map<string, { n: number; until: number }>();

/** POST { password } -> opens a password-protected project for this account; any other open project is locked again. */
export const POST = handler(async (req: Request, ctx: Ctx) => {
  const u = await requireUser({ module: 'projects' });
  await enforce([LIMITS.unlockIp, clientIp(req)]);
  const { id } = await ctx.params;
  const store = getStore();
  const project = await store.getProject(id);
  if (!project) throw new HttpError(404, 'Project not found');
  const { password } = await body<{ password?: unknown }>(req);
  const key = `${u.id}:${id}`;
  const w = wrong.get(key);
  if (w && w.until > Date.now()) throw new HttpError(429, 'Too many wrong passwords. Try again in a few minutes.');
  const res = NextResponse.json({ ok: true });
  try {
    await unlockProject(u, id, password, res);
  } catch (e) {
    if (e instanceof HttpError && e.status === 403) {
      const n = (w?.n ?? 0) + 1;
      wrong.set(key, { n, until: n >= 5 ? Date.now() + 5 * 60_000 : 0 });
      await store.addAudit([audit(u, { action: 'PROJECT_UNLOCK_FAILED', projectId: id, projectName: project.name })]);
    }
    throw e;
  }
  wrong.delete(key);
  await store.addAudit([audit(u, { action: 'PROJECT_UNLOCKED', projectId: id, projectName: project.name })]);
  return res;
});

/** DELETE -> locks the project again on this device ('_all' locks every project). */
export const DELETE = handler(async (_req: Request, ctx: Ctx) => {
  const u = await requireUser({ module: 'projects' });
  const { id } = await ctx.params;
  const res = NextResponse.json({ ok: true });
  await relockProject(u, id, res);
  return res;
});
