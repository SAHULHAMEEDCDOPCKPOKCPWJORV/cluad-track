import { NextResponse } from 'next/server';
import { audit, body, handler, requireUser } from '@/server/auth';
import { savePassword } from '@/server/projectLock';
import { getStore, HttpError } from '@/server/store';
import { clientIp, enforce, LIMITS } from '@/server/rateLimit';

type Ctx = { params: Promise<{ id: string }> };

/**
 * PUT { newPassword, currentPassword? } -> set or change the project password.
 * Every project must have one, so it cannot be removed. Changing it needs the current password
 * (an Admin account may reset a forgotten one).
 */
export const PUT = handler(async (req: Request, ctx: Ctx) => {
  const u = await requireUser({ edit: true, module: 'projects' });
  await enforce([LIMITS.passwordIp, clientIp(req)]);
  const { id } = await ctx.params;
  const store = getStore();
  const project = await store.getProject(id);
  if (!project) throw new HttpError(404, 'Project not found');
  const input = await body<{ newPassword?: unknown; currentPassword?: unknown; remove?: unknown }>(req);
  const res = NextResponse.json({ ok: true, locked: true });
  const what = await savePassword(u, id, input, res);
  await store.addAudit([audit(u, { action: `PROJECT_PASSWORD_${what.toUpperCase()}`, projectId: id, projectName: project.name, newValue: `Project password ${what}` })]);
  return res;
});
