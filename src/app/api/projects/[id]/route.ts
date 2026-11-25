import { audit, body, handler, ok, requireUser } from '@/server/auth';
import { refitProject, sanitizeProjectInput } from '@/server/projectService';
import { assertProjectAccess, checkPassword, forgetPassword, lockState } from '@/server/projectLock';
import { getStore, HttpError } from '@/server/store';
import { clientIp, enforce, LIMITS } from '@/server/rateLimit';

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (_req: Request, ctx: Ctx) => {
  const u = await requireUser({ module: 'projects' });
  const { id } = await ctx.params;
  await assertProjectAccess(u, id); // 423 until the project password is entered
  const store = getStore();
  const project = await store.getProject(id);
  if (!project) throw new HttpError(404, 'Project not found');
  return ok({ project: (await lockState(u)).decorate(project), activities: await store.listActivities(id) });
});

export const PATCH = handler(async (req: Request, ctx: Ctx) => {
  const u = await requireUser({ edit: true, module: 'projects' });
  const { id } = await ctx.params;
  await assertProjectAccess(u, id);
  const store = getStore();
  const prev = await store.getProject(id);
  if (!prev) throw new HttpError(404, 'Project not found');
  const input = await body<Record<string, unknown>>(req);
  const next = sanitizeProjectInput(input, prev);
  const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => k !== 'updatedAt' && String(next[k] ?? '') !== String(prev[k] ?? ''));
  if (changed.length) {
    await store.saveProject(next);
    await store.addAudit(changed.map((k) => audit(u, { action: 'PROJECT_UPDATED', projectId: id, projectName: next.name, fieldName: k, oldValue: String(prev[k] ?? ''), newValue: String(next[k] ?? '') })));
  }
  if (input.refit) {
    const r = await refitProject(u, id, input);
    return ok({ ...r, project: (await lockState(u)).decorate(r.project) });
  }
  return ok({ project: (await lockState(u)).decorate(next) });
});

/**
 * DELETE { password, declaration: true } -> deletes the project.
 * Always needs the project's password and the signed declaration, even for an Admin account.
 */
export const DELETE = handler(async (req: Request, ctx: Ctx) => {
  const u = await requireUser({ admin: true });
  await enforce([LIMITS.deleteIp, clientIp(req)]);
  const { id } = await ctx.params;
  const store = getStore();
  const prev = await store.getProject(id);
  if (!prev) throw new HttpError(404, 'Project not found');
  const { password, declaration } = await body<{ password?: unknown; declaration?: unknown }>(req);
  if (declaration !== true) throw new HttpError(400, 'Tick the declaration to confirm the deletion');
  if (!(await checkPassword(id, password))) {
    await store.addAudit([audit(u, { action: 'PROJECT_DELETE_REFUSED', projectId: id, projectName: prev.name, newValue: 'Wrong project password' })]);
    throw new HttpError(403, 'Incorrect project password. The project was not deleted.');
  }
  await store.deleteProject(id);
  await forgetPassword(id);
  await store.addAudit([audit(u, { action: 'PROJECT_DELETED', projectId: id, projectName: prev.name, newValue: `Deleted with project password and signed declaration by ${u.email}` })]);
  return ok({ ok: true });
});
