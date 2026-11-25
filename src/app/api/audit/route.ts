import { handler, ok, requireUser } from '@/server/auth';
import { assertProjectAccess, filterVisibleAudit } from '@/server/projectLock';
import { getStore } from '@/server/store';

export const GET = handler(async (req: Request) => {
  const sp = new URL(req.url).searchParams;
  const projectId = sp.get('projectId');
  const u = await requireUser({ module: projectId ? 'projects' : 'audit' });
  if (projectId) await assertProjectAccess(u, projectId);
  const logs = await getStore().listAudit({ projectId: projectId || undefined, limit: Number(sp.get('limit') ?? 1000) || 1000, field: sp.get('field') || undefined });
  // The all-projects history leaves out projects that are still locked.
  return ok({ logs: projectId ? logs : await filterVisibleAudit(u, logs) });
});
