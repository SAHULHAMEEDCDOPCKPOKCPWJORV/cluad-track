import { handler, ok, requireUser } from '@/server/auth';
import { canView } from '@/lib/access';
import { filterVisibleAudit } from '@/server/projectLock';
import { getStore } from '@/server/store';

export const dynamic = 'force-dynamic';

/**
 * GET /api/live?since=ISO  ->  what changed since that moment (no project data, just who changed what).
 * The app calls this when it gets a live signal, when it comes back to the screen, and every few seconds
 * as a safety net. Without `since` it only returns the server time to start from.
 * The query looks 15 s further back than asked so a save that was still being written is never missed;
 * the app ignores entries it has already seen (by id).
 */
export const GET = handler(async (req: Request) => {
  const u = await requireUser();
  const now = new Date();
  const sinceRaw = new URL(req.url).searchParams.get('since');
  const since = sinceRaw ? new Date(sinceRaw) : null;
  if (!since || Number.isNaN(since.getTime())) return ok({ now: now.toISOString(), changes: [] });
  const from = new Date(Math.max(since.getTime() - 15_000, now.getTime() - 24 * 3600_000)).toISOString();
  const LIMIT = 300;
  const logs = await filterVisibleAudit(u, await getStore().listChangesSince(from, LIMIT)); // nothing about still-locked projects
  const projectsOk = canView(u, 'projects');
  // accounts without Projects access only hear about holiday / access changes, never project names
  const changes = logs.filter((l) => projectsOk || l.projectId === 'GLOBAL').map((l) => ({ id: l.id, projectId: l.projectId, projectName: l.projectName, activityId: l.activityId, action: l.action, by: l.department, email: l.userEmail, at: new Date(l.timestamp).toISOString() }));
  // A big import writes hundreds of history rows; the newest are always included, and `truncated`
  // tells the app to simply reload everything.
  return ok({ now: now.toISOString(), changes, truncated: logs.length >= LIMIT });
});
