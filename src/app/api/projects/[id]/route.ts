import { audit, body, handler, ok, requireUser } from '@/server/auth';
import { refitProject, sanitizeProjectInput } from '@/server/projectService';
import { assertProjectAccess, forgetPassword, lockState } from '@/server/projectLock';
import { getStore, HttpError } from '@/server/store';

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

export const DELETE = handler(async (_req: Request, ctx: Ctx) => {
  const u = await requireUser({ admin: true });
  const { id } = await ctx.params;
  await assertProjectAccess(u, id);
  const store = getStore();
  const prev = await store.getProject(id);
  if (!prev) throw new HttpError(404, 'Project not found');
  await store.deleteProject(id);
  await forgetPassword(id);
  await store.addAudit([audit(u, { action: 'PROJECT_DELETED', projectId: id, projectName: prev.name })]);
  return ok({ ok: true });
});
