import { body, handler, ok, requireUser } from '@/server/auth';
import { manualSnapshot, socialOverview, syncSocial } from '@/server/social';
import { HttpError } from '@/server/store';
import { remove } from '@/server/db';

export const maxDuration = 60;

export const GET = handler(async () => {
  await requireUser({ module: 'social' });
  return ok(await socialOverview());
});

export const POST = handler(async (req: Request) => {
  await requireUser({ edit: true, module: 'social' });
  const b = await body<Record<string, unknown>>(req);
  if (b.action === 'sync') {
    const results = await syncSocial();
    return ok({ results, ...(await socialOverview()) });
  }
  if (b.action === 'manual') {
    const followers = Number(b.followers);
    if (!b.platform || !b.handle || !Number.isFinite(followers) || followers < 0) throw new HttpError(400, 'Platform, account and followers are required');
    await manualSnapshot({
      platform: String(b.platform).slice(0, 30), handle: String(b.handle).slice(0, 80), name: String(b.name || b.handle).slice(0, 80), isOwn: !!b.isOwn, followers,
      posts: b.posts === '' || b.posts == null ? null : Number(b.posts), engagementRate: b.engagementRate === '' || b.engagementRate == null ? null : Number(b.engagementRate),
      day: /^\d{4}-\d{2}-\d{2}$/.test(String(b.day)) ? String(b.day) : undefined,
    });
    return ok(await socialOverview());
  }
  if (b.action === 'delete' && typeof b.accountId === 'string') {
    await remove('swelect_social_accounts', { id: b.accountId });
    return ok(await socialOverview());
  }
  throw new HttpError(400, 'Unknown action');
});
