// Solar News Aggregator + SWELECT mentions: fetch feeds, clean, de-duplicate, tag and store.
import { BRAND, getCompetitors, getSources, type Company, type NewsSource } from './config';
import { getSetting, select, setSetting, upsert, type Row } from './db';
import { categorize, findCompanies, idFor, isRelevant, parseFeed, sentiment, titleKey, type FeedItem } from './textintel';

const UA = 'Mozilla/5.0 (compatible; SWELECT-ProjectControl/1.0; +https://cluad-track.vercel.app)';

export type FetchImpl = (url: string) => Promise<string>;
const httpGet: FetchImpl = async (url) => {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml, */*' }, signal: AbortSignal.timeout(9000), cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
};

export interface FetchReport { source: string; kind: string; found: number; added: number; error?: string }

/** Fetch every enabled source and store new stories. Returns a per-source report. */
export async function refreshNews(opts: { fetchImpl?: FetchImpl; now?: Date } = {}): Promise<{ added: number; sources: FetchReport[] }> {
  const get = opts.fetchImpl ?? httpGet;
  const now = opts.now ?? new Date();
  const [sources, competitors] = await Promise.all([getSources(), getCompetitors()]);
  const companies = [BRAND, ...competitors];
  const enabled = sources.filter((s) => s.enabled);
  const results = await Promise.allSettled(enabled.map((s) => get(s.url).then((xml) => ({ s, items: parseFeed(xml, s.name) }))));

  // recent titles already stored, so the same story from two sites is kept once
  const since = new Date(now.getTime() - 10 * 86400_000).toISOString();
  const recent = await select('swelect_news', { gte: ['fetched_at', since], columns: 'id,title', limit: 5000 });
  const seenTitles = new Set(recent.map((r) => titleKey(r.title)));
  const seenIds = new Set(recent.map((r) => r.id));

  const report: FetchReport[] = [];
  const rows: Row[] = [];
  results.forEach((res, i) => {
    const s: NewsSource = enabled[i];
    if (res.status === 'rejected') {
      report.push({ source: s.name, kind: s.kind, found: 0, added: 0, error: String((res.reason as Error)?.message ?? res.reason).slice(0, 120) });
      return;
    }
    let added = 0;
    for (const it of res.value.items) {
      const row = toRow(it, s, companies, now);
      if (!row || seenIds.has(row.id) || seenTitles.has(titleKey(row.title))) continue;
      seenIds.add(row.id);
      seenTitles.add(titleKey(row.title));
      rows.push(row);
      added++;
    }
    report.push({ source: s.name, kind: s.kind, found: res.value.items.length, added });
  });
  const inserted = await upsert('swelect_news', rows, { ignoreDuplicates: true });
  await setSetting('news.lastFetch', { at: now.toISOString(), added: inserted.length, sources: report });
  return { added: inserted.length, sources: report };
}

function toRow(it: FeedItem, s: NewsSource, companies: Company[], now: Date): Row | null {
  const text = `${it.title}. ${it.summary}`;
  const found = findCompanies(text, companies);
  const mentionsBrand = found.includes(BRAND.name);
  if (s.kind === 'mention' && !mentionsBrand) return null; // search noise
  if (s.kind === 'news' && !mentionsBrand && !isRelevant(text)) return null;
  const published = it.publishedAt && Date.parse(it.publishedAt) <= now.getTime() + 3600_000 ? it.publishedAt : now.toISOString();
  // news older than 14 days is not "news"; mentions keep their history
  if (s.kind === 'news' && Date.parse(published) < now.getTime() - 14 * 86400_000) return null;
  return {
    id: idFor(it.url), url: it.url, title: it.title, source: it.source || s.name, published_at: published, summary: it.summary,
    category: categorize(text), companies: found, kind: mentionsBrand ? 'mention' : 'news', sentiment: sentiment(text), fetched_at: now.toISOString(),
  };
}

export interface NewsItem { id: string; url: string; title: string; source: string; publishedAt: string; summary: string; category: string; companies: string[]; kind: string; sentiment: number }
export const toItem = (r: Row): NewsItem => ({ id: r.id, url: r.url, title: r.title, source: r.source, publishedAt: r.published_at, summary: r.summary ?? '', category: r.category ?? 'General', companies: r.companies ?? [], kind: r.kind, sentiment: Number(r.sentiment ?? 0) });

export async function listNews(days = 7, limit = 600) {
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  return (await select('swelect_news', { gte: ['published_at', since], order: ['published_at', 'desc'], limit })).map(toItem);
}
export async function listMentions(days = 365, limit = 800) {
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  return (await select('swelect_news', { eq: { kind: 'mention' }, gte: ['published_at', since], order: ['published_at', 'desc'], limit })).map(toItem);
}
export const lastFetch = () => getSetting<{ at: string; added: number; sources: FetchReport[] } | null>('news.lastFetch', null);

/** True if the stored news is older than `minutes` (used to refresh automatically when someone opens the page). */
export async function isStale(minutes: number) {
  const lf = await lastFetch();
  return !lf || Date.now() - Date.parse(lf.at) > minutes * 60_000;
}

// ───────── daily digest (what Kavya sends every day, automated) ─────────
export interface Digest { day: string; total: number; brand: NewsItem[]; competitors: NewsItem[]; byCategory: { category: string; items: NewsItem[] }[] }
export function buildDigest(items: NewsItem[], now = new Date(), hours = 24): Digest {
  const from = now.getTime() - hours * 3600_000;
  const fresh = items.filter((i) => Date.parse(i.publishedAt) >= from).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const brand = fresh.filter((i) => i.companies.includes(BRAND.name));
  const competitors = fresh.filter((i) => !i.companies.includes(BRAND.name) && i.companies.length > 0).slice(0, 10);
  const shown = new Set([...brand, ...competitors].map((i) => i.id));
  const order = ['Policy & Regulation', 'Tenders & Auctions', 'Projects & Commissioning', 'Rooftop & C&I', 'Manufacturing & Modules', 'Wind', 'Storage & Hydrogen', 'Finance & Deals', 'General'];
  const byCategory = order
    .map((category) => ({ category, items: fresh.filter((i) => i.category === category && !shown.has(i.id)).slice(0, 8) }))
    .filter((g) => g.items.length);
  return { day: now.toISOString().slice(0, 10), total: fresh.length, brand, competitors, byCategory };
}
