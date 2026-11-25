// Social Media Performance & Competitor Analysis.
// Own pages: Meta Graph API (Facebook Page + Instagram Business), LinkedIn Organization API, YouTube Data API.
// Competitors: Instagram Business Discovery (public business profiles, through SWELECT's own Instagram
// connection) and YouTube channel statistics. Any account can also be updated by hand (e.g. LinkedIn followers).
import { BRAND, getCompetitors, getSecrets } from './config';
import { select, upsert, type Row } from './db';

const GRAPH = 'https://graph.facebook.com/v21.0';
export type Fetch = typeof fetch;

export interface SyncResult { account: string; ok: boolean; message: string }

const today = () => new Date().toISOString().slice(0, 10);
const accId = (platform: string, handle: string) => `${platform}:${handle.replace(/^@/, '').toLowerCase()}`;

async function getJson(f: Fetch, url: string, init?: RequestInit) {
  const r = await f(url, { ...init, signal: AbortSignal.timeout(12000), cache: 'no-store' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j?.error?.message ?? j?.message ?? `HTTP ${r.status}`);
  return j;
}

interface PostIn { id: string; posted_at: string | null; text: string; media_type: string; permalink: string; likes: number; comments: number; shares?: number; saves?: number; reach?: number | null; impressions?: number | null }

async function save(account: { id: string; platform: string; handle: string; name: string; is_own: boolean; external_id?: string }, followers: number | null, totalPosts: number | null, posts: PostIn[], extra: Row = {}) {
  await upsert('swelect_social_accounts', [{ ...account, external_id: account.external_id ?? null }]);
  const recent = posts.slice(0, 12);
  const avgLikes = recent.length ? recent.reduce((s, p) => s + (p.likes ?? 0), 0) / recent.length : null;
  const avgComments = recent.length ? recent.reduce((s, p) => s + (p.comments ?? 0), 0) / recent.length : null;
  const er = followers && avgLikes != null ? ((avgLikes + (avgComments ?? 0) + recent.reduce((s, p) => s + (p.shares ?? 0), 0) / Math.max(1, recent.length)) / followers) * 100 : null;
  await upsert('swelect_social_snapshots', [{
    account_id: account.id, day: today(), followers, posts: totalPosts, avg_likes: avgLikes, avg_comments: avgComments,
    engagement_rate: er == null ? null : Math.round(er * 1000) / 1000, source: 'api', ...extra,
  }]);
  await upsert('swelect_social_posts', posts.map((p) => ({ ...p, account_id: account.id, text: (p.text ?? '').slice(0, 1000), updated_at: new Date().toISOString() })));
}

async function syncFacebook(f: Fetch, pageId: string, token: string): Promise<SyncResult> {
  const page = await getJson(f, `${GRAPH}/${pageId}?fields=name,username,followers_count,fan_count&access_token=${token}`);
  const feed = await getJson(f, `${GRAPH}/${pageId}/posts?fields=id,message,created_time,permalink_url,shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0),attachments{media_type}&limit=30&access_token=${token}`);
  const posts: PostIn[] = (feed.data ?? []).map((p: Row) => ({
    id: `fb:${p.id}`, posted_at: p.created_time, text: p.message ?? '', media_type: (p.attachments?.data?.[0]?.media_type ?? 'status').toUpperCase(),
    permalink: p.permalink_url ?? '', likes: p.reactions?.summary?.total_count ?? 0, comments: p.comments?.summary?.total_count ?? 0, shares: p.shares?.count ?? 0,
  }));
  const handle = page.username ?? page.name ?? pageId;
  await save({ id: accId('facebook', String(handle)), platform: 'Facebook', handle: String(handle), name: page.name ?? 'SWELECT', is_own: true, external_id: pageId }, page.followers_count ?? page.fan_count ?? null, null, posts);
  return { account: `Facebook · ${page.name}`, ok: true, message: `${page.followers_count ?? page.fan_count ?? '?'} followers, ${posts.length} recent posts` };
}

async function syncInstagram(f: Fetch, igId: string, token: string): Promise<SyncResult> {
  const me = await getJson(f, `${GRAPH}/${igId}?fields=username,name,followers_count,media_count&access_token=${token}`);
  const media = await getJson(f, `${GRAPH}/${igId}/media?fields=id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count&limit=30&access_token=${token}`);
  const posts: PostIn[] = [];
  for (const [i, m] of (media.data ?? []).entries()) {
    const p: PostIn = { id: `ig:${m.id}`, posted_at: m.timestamp, text: m.caption ?? '', media_type: m.media_product_type === 'REELS' ? 'REEL' : m.media_type, permalink: m.permalink ?? '', likes: m.like_count ?? 0, comments: m.comments_count ?? 0 };
    if (i < 12) {
      try {
        const ins = await getJson(f, `${GRAPH}/${m.id}/insights?metric=reach,saved,shares&access_token=${token}`);
        for (const d of ins.data ?? []) {
          const v = d.values?.[0]?.value ?? d.total_value?.value;
          if (d.name === 'reach') p.reach = v;
          if (d.name === 'saved') p.saves = v;
          if (d.name === 'shares') p.shares = v;
        }
      } catch { /* insights need extra permission; likes/comments still count */ }
    }
    posts.push(p);
  }
  await save({ id: accId('instagram', me.username), platform: 'Instagram', handle: me.username, name: me.name ?? me.username, is_own: true, external_id: igId }, me.followers_count ?? null, me.media_count ?? null, posts);
  return { account: `Instagram · @${me.username}`, ok: true, message: `${me.followers_count} followers, ${posts.length} recent posts` };
}

/** Public numbers of another Instagram business/creator account, through SWELECT's own Instagram connection. */
async function syncInstagramCompetitor(f: Fetch, igId: string, token: string, username: string, company: string): Promise<SyncResult> {
  const fields = `business_discovery.username(${username}){username,name,followers_count,media_count,media.limit(12){id,caption,media_type,media_product_type,timestamp,like_count,comments_count,permalink}}`;
  const j = await getJson(f, `${GRAPH}/${igId}?fields=${encodeURIComponent(fields)}&access_token=${token}`);
  const bd = j.business_discovery;
  const posts: PostIn[] = (bd.media?.data ?? []).map((m: Row) => ({ id: `ig:${m.id}`, posted_at: m.timestamp, text: m.caption ?? '', media_type: m.media_product_type === 'REELS' ? 'REEL' : m.media_type, permalink: m.permalink ?? '', likes: m.like_count ?? 0, comments: m.comments_count ?? 0 }));
  await save({ id: accId('instagram', bd.username), platform: 'Instagram', handle: bd.username, name: company, is_own: false }, bd.followers_count ?? null, bd.media_count ?? null, posts);
  return { account: `Instagram · ${company}`, ok: true, message: `${bd.followers_count} followers` };
}

async function syncYouTube(f: Fetch, key: string, channel: string, name: string, own: boolean): Promise<SyncResult> {
  const q = channel.startsWith('UC') ? `id=${channel}` : `forHandle=${encodeURIComponent(channel.startsWith('@') ? channel : `@${channel}`)}`;
  const j = await getJson(f, `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,contentDetails&${q}&key=${key}`);
  const ch = j.items?.[0];
  if (!ch) throw new Error('channel not found');
  const uploads = ch.contentDetails?.relatedPlaylists?.uploads;
  let posts: PostIn[] = [];
  if (uploads) {
    const pl = await getJson(f, `https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=12&playlistId=${uploads}&key=${key}`);
    const ids = (pl.items ?? []).map((i: Row) => i.contentDetails?.videoId).filter(Boolean).join(',');
    if (ids) {
      const v = await getJson(f, `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${ids}&key=${key}`);
      posts = (v.items ?? []).map((x: Row) => ({ id: `yt:${x.id}`, posted_at: x.snippet?.publishedAt, text: x.snippet?.title ?? '', media_type: 'VIDEO', permalink: `https://www.youtube.com/watch?v=${x.id}`, likes: Number(x.statistics?.likeCount ?? 0), comments: Number(x.statistics?.commentCount ?? 0), reach: Number(x.statistics?.viewCount ?? 0) }));
    }
  }
  const handle = ch.snippet?.customUrl ?? channel;
  await save({ id: accId('youtube', handle), platform: 'YouTube', handle, name: own ? BRAND.name : name, is_own: own, external_id: ch.id }, Number(ch.statistics?.subscriberCount ?? 0), Number(ch.statistics?.videoCount ?? 0), posts);
  return { account: `YouTube · ${own ? BRAND.name : name}`, ok: true, message: `${ch.statistics?.subscriberCount} subscribers` };
}

/** LinkedIn version header: a recent month (LinkedIn supports each version for about a year). */
const liVersion = () => process.env.LINKEDIN_VERSION || (() => { const d = new Date(); d.setUTCMonth(d.getUTCMonth() - 3); return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`; })();

async function syncLinkedIn(f: Fetch, orgId: string, token: string): Promise<SyncResult> {
  const headers = { Authorization: `Bearer ${token}`, 'LinkedIn-Version': liVersion(), 'X-Restli-Protocol-Version': '2.0.0' };
  const urn = encodeURIComponent(`urn:li:organization:${orgId}`);
  const size = await getJson(f, `https://api.linkedin.com/rest/networkSizes/${urn}?edgeType=COMPANY_FOLLOWED_BY_MEMBER`, { headers });
  let extra: Row = {};
  try {
    const st = await getJson(f, `https://api.linkedin.com/rest/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=${urn}`, { headers });
    const t = st.elements?.[0]?.totalShareStatistics;
    if (t) extra = { impressions: t.impressionCount ?? null, reach: t.uniqueImpressionsCount ?? null, engagement_rate: t.engagement != null ? Math.round(t.engagement * 100000) / 1000 : null };
  } catch { /* share statistics need the r_organization_social scope */ }
  await save({ id: accId('linkedin', orgId), platform: 'LinkedIn', handle: orgId, name: BRAND.name, is_own: true, external_id: orgId }, size.firstDegreeSize ?? null, null, [], extra);
  return { account: 'LinkedIn · SWELECT', ok: true, message: `${size.firstDegreeSize} followers` };
}

/** Pull fresh numbers for every connected account and competitor. Each one is independent: one failure never stops the rest. */
export async function syncSocial(f: Fetch = fetch): Promise<SyncResult[]> {
  const s = await getSecrets();
  const competitors = await getCompetitors();
  const jobs: { name: string; run: () => Promise<SyncResult> }[] = [];
  if (s.META_PAGE_ID && s.META_PAGE_TOKEN) jobs.push({ name: 'Facebook', run: () => syncFacebook(f, s.META_PAGE_ID!, s.META_PAGE_TOKEN!) });
  if (s.META_IG_USER_ID && s.META_PAGE_TOKEN) {
    jobs.push({ name: 'Instagram', run: () => syncInstagram(f, s.META_IG_USER_ID!, s.META_PAGE_TOKEN!) });
    for (const c of competitors.filter((c) => c.instagram)) jobs.push({ name: `Instagram · ${c.name}`, run: () => syncInstagramCompetitor(f, s.META_IG_USER_ID!, s.META_PAGE_TOKEN!, c.instagram!, c.name) });
  }
  if (s.LINKEDIN_ORG_ID && s.LINKEDIN_TOKEN) jobs.push({ name: 'LinkedIn', run: () => syncLinkedIn(f, s.LINKEDIN_ORG_ID!, s.LINKEDIN_TOKEN!) });
  if (s.YOUTUBE_API_KEY) {
    if (s.YOUTUBE_CHANNEL) jobs.push({ name: 'YouTube', run: () => syncYouTube(f, s.YOUTUBE_API_KEY!, s.YOUTUBE_CHANNEL!, BRAND.name, true) });
    for (const c of competitors.filter((c) => c.youtube)) jobs.push({ name: `YouTube · ${c.name}`, run: () => syncYouTube(f, s.YOUTUBE_API_KEY!, c.youtube!, c.name, false) });
  }
  const out: SyncResult[] = [];
  for (const j of jobs) {
    try { out.push(await j.run()); } catch (e) { out.push({ account: j.name, ok: false, message: (e as Error).message.slice(0, 200) }); }
  }
  return out;
}

/** Hand-entered numbers (e.g. a competitor's LinkedIn followers) for any account. */
export async function manualSnapshot(input: { platform: string; handle: string; name: string; isOwn: boolean; followers: number; posts?: number | null; engagementRate?: number | null; day?: string }) {
  const id = accId(input.platform.toLowerCase(), input.handle);
  await upsert('swelect_social_accounts', [{ id, platform: input.platform, handle: input.handle, name: input.name, is_own: input.isOwn }]);
  await upsert('swelect_social_snapshots', [{ account_id: id, day: input.day ?? today(), followers: input.followers, posts: input.posts ?? null, engagement_rate: input.engagementRate ?? null, source: 'manual' }]);
  return id;
}

// ───────── analysis for the screen and the daily report ─────────
export interface AccountView { id: string; platform: string; handle: string; name: string; isOwn: boolean; followers: number | null; followers30dAgo: number | null; growth30d: number | null; engagementRate: number | null; avgLikes: number | null; avgComments: number | null; posts30d: number; lastUpdated: string | null; source: string | null; trend: { day: string; followers: number | null }[] }
export interface PostView { id: string; accountId: string; account: string; platform: string; isOwn: boolean; postedAt: string; text: string; mediaType: string; permalink: string; likes: number; comments: number; shares: number; saves: number; reach: number | null; engagement: number }

export async function socialOverview() {
  const [accounts, snaps, posts] = await Promise.all([
    select('swelect_social_accounts', { limit: 500 }),
    select('swelect_social_snapshots', { gte: ['day', new Date(Date.now() - 120 * 86400_000).toISOString().slice(0, 10)], order: ['day', 'asc'], limit: 5000 }),
    select('swelect_social_posts', { gte: ['posted_at', new Date(Date.now() - 120 * 86400_000).toISOString()], order: ['posted_at', 'desc'], limit: 3000 }),
  ]);
  const t30 = Date.now() - 30 * 86400_000;
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const postViews: PostView[] = posts.filter((p) => byId.has(p.account_id)).map((p) => {
    const a = byId.get(p.account_id)!;
    const shares = Number(p.shares ?? 0);
    return { id: p.id, accountId: p.account_id, account: a.name, platform: a.platform, isOwn: !!a.is_own, postedAt: p.posted_at, text: p.text ?? '', mediaType: p.media_type ?? 'POST', permalink: p.permalink ?? '', likes: Number(p.likes ?? 0), comments: Number(p.comments ?? 0), shares, saves: Number(p.saves ?? 0), reach: p.reach == null ? null : Number(p.reach), engagement: Number(p.likes ?? 0) + Number(p.comments ?? 0) + shares + Number(p.saves ?? 0) };
  });
  const views: AccountView[] = accounts.map((a) => {
    const ss = snaps.filter((s) => s.account_id === a.id);
    const last = ss[ss.length - 1];
    const old = [...ss].reverse().find((s) => Date.parse(s.day) <= t30) ?? ss[0];
    const f = last?.followers ?? null;
    const f0 = old && old !== last ? old.followers ?? null : null;
    return {
      id: a.id, platform: a.platform, handle: a.handle, name: a.name ?? a.handle, isOwn: !!a.is_own, followers: f, followers30dAgo: f0,
      growth30d: f != null && f0 ? Math.round(((f - f0) / f0) * 1000) / 10 : null,
      engagementRate: last?.engagement_rate == null ? null : Number(last.engagement_rate), avgLikes: last?.avg_likes == null ? null : Math.round(Number(last.avg_likes)), avgComments: last?.avg_comments == null ? null : Math.round(Number(last.avg_comments)),
      posts30d: postViews.filter((p) => p.accountId === a.id && Date.parse(p.postedAt) >= t30).length,
      lastUpdated: last?.day ?? null, source: last?.source ?? null, trend: ss.map((s) => ({ day: s.day, followers: s.followers })),
    };
  });
  // what works best for SWELECT's own posts
  const own = postViews.filter((p) => p.isOwn);
  const types = [...new Set(own.map((p) => p.mediaType))].map((t) => {
    const xs = own.filter((p) => p.mediaType === t);
    return { type: t, posts: xs.length, avgEngagement: Math.round(xs.reduce((s, p) => s + p.engagement, 0) / Math.max(1, xs.length)) };
  }).sort((a, b) => b.avgEngagement - a.avgEngagement);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => {
    const xs = own.filter((p) => new Date(p.postedAt).getDay() === i);
    return { day: d, posts: xs.length, avgEngagement: Math.round(xs.reduce((s, p) => s + p.engagement, 0) / Math.max(1, xs.length)) };
  });
  return { accounts: views, posts: postViews, contentTypes: types, weekdays: days };
}
