import { body, handler, ok, requireUser } from '@/server/auth';
import { updateActivities, type ActivityPatch } from '@/server/projectService';
import { assertProjectAccess, lockState } from '@/server/projectLock';
import { HttpError } from '@/server/store';

type Ctx = { params: Promise<{ id: string }> };

export const PUT = handler(async (req: Request, ctx: Ctx) => {
  const u = await requireUser({ edit: true, module: 'projects' });
  const { id } = await ctx.params;
  await assertProjectAccess(u, id);
  const b = await body<{ activities?: ActivityPatch[]; action?: 'edit' | 'import' | 'reschedule' | 'rebaseline'; deleteIds?: string[] }>(req);
  if (b.activities && !Array.isArray(b.activities)) throw new HttpError(400, 'activities must be an array');
  if ((b.activities?.length ?? 0) > 2000) throw new HttpError(400, 'Too many rows');
  const r = await updateActivities(u, id, b.activities ?? [], { action: b.action, deleteIds: b.deleteIds });
  return ok({ ...r, project: (await lockState(u)).decorate(r.project) });
});
