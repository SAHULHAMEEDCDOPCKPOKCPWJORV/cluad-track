import { after } from 'next/server';
import { handler, ok, requireUser } from '@/server/auth';
import { buildDigest, isStale, listNews, listMentions, refreshNews } from '@/server/news';
import { buildReputation, listReviews } from '@/server/reputation';
import { socialOverview } from '@/server/social';
import { leadStats, listLeads } from '@/server/leads';
import { canView } from '@/lib/access';

/** Everything the home screen needs in one call. */
export const GET = handler(async () => {
  const u = await requireUser();
  if (await isStale(30)) after(() => refreshNews().catch(() => undefined));
  const [news, mentions, reviews, social] = await Promise.all([
    canView(u, 'news') ? listNews(2) : [], canView(u, 'reputation') ? listMentions(60) : [], canView(u, 'reputation') ? listReviews(100) : [],
    canView(u, 'social') ? socialOverview() : { accounts: [], posts: [], contentTypes: [], weekdays: [] },
  ]);
  const digest = buildDigest(news);
  const rep = buildReputation(mentions, reviews);
  const own = social.accounts.filter((a) => a.isOwn && a.followers != null);
  let leads = null;
  if (canView(u, 'leads')) {
    const st = leadStats(await listLeads());
    leads = { newToday: st.newToday, dueToday: st.dueToday, overdue: st.overdue, open: st.open, wonThisMonth: st.wonThisMonth, conversion: st.conversion };
  }
  return ok({
    news: { count24h: digest.total, top: [...digest.brand, ...digest.byCategory.flatMap((g) => g.items)].slice(0, 4) },
    reputation: { score: rep.score, mentions24h: rep.last24h.mentions, negative30d: rep.last30d.negative, googleRating: rep.googleRating },
    social: { connected: own.length, followers: own.reduce((s, a) => s + (a.followers ?? 0), 0), accounts: own.map((a) => ({ platform: a.platform, followers: a.followers, growth30d: a.growth30d })) },
    leads,
  });
});
