import { after } from 'next/server';
import { handler, ok, requireUser } from '@/server/auth';
import { buildDigest, isStale, lastFetch, listNews, refreshNews } from '@/server/news';

export const maxDuration = 60;

/** News for the last N days (default 7). Refreshes in the background when the stored news is over 30 minutes old. */
export const GET = handler(async (req: Request) => {
  await requireUser({ module: 'news' });
  const days = Math.min(30, Math.max(1, Number(new URL(req.url).searchParams.get('days')) || 7));
  if (await isStale(30)) after(() => refreshNews().catch(() => undefined));
  const items = await listNews(days);
  return ok({ items, digest: buildDigest(items), lastFetch: await lastFetch() });
});

/** "Refresh now" (at most once every 2 minutes). */
export const POST = handler(async () => {
  await requireUser({ module: 'news' });
  const report = (await isStale(2)) ? await refreshNews() : null;
  const items = await listNews(7);
  return ok({ items, digest: buildDigest(items), lastFetch: await lastFetch(), report });
});
