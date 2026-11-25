import { NextResponse } from 'next/server';
import { audit, body, handler, requireUser } from '@/server/auth';
import { savePassword } from '@/server/projectLock';
import { getStore, HttpError } from '@/server/store';

type Ctx = { params: Promise<{ id: string }> };

/**
 * PUT { newPassword, currentPassword? }  -> set or change the project password
 * PUT { remove: true, currentPassword? } -> remove it
 * An existing password can only be changed or removed with the current password (an Admin account may reset it).
 */
export const PUT = handler(async (req: Request, ctx: Ctx) => {
  const u = await requireUser({ edit: true, module: 'projects' });
  const { id } = await ctx.params;
  const store = getStore();
  const project = await store.getProject(id);
  if (!project) throw new HttpError(404, 'Project not found');
  const input = await body<{ newPassword?: unknown; currentPassword?: unknown; remove?: unknown }>(req);
  const res = NextResponse.json({ ok: true, locked: !input.remove });
  const what = await savePassword(u, id, input, input.remove ? undefined : res);
  await store.addAudit([audit(u, { action: `PROJECT_PASSWORD_${what.toUpperCase()}`, projectId: id, projectName: project.name, newValue: `Project password ${what}` })]);
  return res;
});
