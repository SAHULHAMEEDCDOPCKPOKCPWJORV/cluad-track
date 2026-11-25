import { handler, ok, requireUser } from '@/server/auth';
import { reputationNow } from '@/server/reputation';
import { refreshGoogleReviews } from '@/server/reputation';
import { isStale, refreshNews } from '@/server/news';

export const maxDuration = 60;

export const GET = handler(async () => {
  await requireUser({ module: 'reputation' });
  const { report, mentions, reviews } = await reputationNow();
  return ok({ report, mentions: mentions.slice(0, 300), reviews: reviews.slice(0, 200) });
});

/** Re-check mentions and Google reviews now. */
export const POST = handler(async () => {
  await requireUser({ edit: true, module: 'reputation' });
  if (await isStale(2)) await refreshNews();
  const reviews = await refreshGoogleReviews();
  const { report, mentions, reviews: all } = await reputationNow();
  return ok({ report, mentions: mentions.slice(0, 300), reviews: all.slice(0, 200), reviewSync: reviews });
});
