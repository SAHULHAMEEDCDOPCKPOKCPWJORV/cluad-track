// SWELECT Digital Reputation Monitor: news/web mentions (from the news fetch), Google reviews,
// and comments on SWELECT's own social posts (when connected). Produces the daily report.
import { getSecrets } from './config';
import { select, upsert, type Row } from './db';
import { listMentions, type NewsItem } from './news';
import { idFor, sentiment } from './textintel';

export interface Review { id: string; platform: string; place: string; author: string; rating: number; text: string; url: string; publishedAt: string; sentiment: number }
const toReview = (r: Row): Review => ({ id: r.id, platform: r.platform, place: r.place ?? '', author: r.author ?? '', rating: Number(r.rating ?? 0), text: r.text ?? '', url: r.url ?? '', publishedAt: r.published_at, sentiment: Number(r.sentiment ?? 0) });

/** Google reviews through the official Places API (needs GOOGLE_PLACES_KEY + one or more place IDs). */
export async function refreshGoogleReviews(fetchImpl: typeof fetch = fetch): Promise<{ added: number; places: { place: string; rating?: number; total?: number; error?: string }[] }> {
  const s = await getSecrets();
  if (!s.GOOGLE_PLACES_KEY || !s.GOOGLE_PLACE_IDS) return { added: 0, places: [] };
  const ids = s.GOOGLE_PLACE_IDS.split(/[\s,]+/).filter(Boolean).slice(0, 20);
  const rows: Row[] = [];
  const places: { place: string; rating?: number; total?: number; error?: string }[] = [];
  for (const id of ids) {
    try {
      const r = await fetchImpl(`https://places.googleapis.com/v1/places/${encodeURIComponent(id)}`, {
        headers: { 'X-Goog-Api-Key': s.GOOGLE_PLACES_KEY, 'X-Goog-FieldMask': 'displayName,rating,userRatingCount,reviews,googleMapsUri' },
        signal: AbortSignal.timeout(9000),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error?.message ?? `HTTP ${r.status}`);
      const place = j.displayName?.text ?? id;
      places.push({ place, rating: j.rating, total: j.userRatingCount });
      for (const rv of j.reviews ?? []) {
        const text = rv.text?.text ?? rv.originalText?.text ?? '';
        const rating = Number(rv.rating ?? 0);
        rows.push({
          id: idFor(`g:${id}:${rv.name ?? rv.authorAttribution?.displayName}:${rv.publishTime}`), platform: 'Google', place,
          author: rv.authorAttribution?.displayName ?? 'Google user', rating, text, url: rv.authorAttribution?.uri ?? j.googleMapsUri ?? '',
          published_at: rv.publishTime ?? new Date().toISOString(), sentiment: rating >= 4 ? 1 : rating <= 2 ? -1 : sentiment(text),
        });
      }
    } catch (e) {
      places.push({ place: id, error: (e as Error).message.slice(0, 160) });
    }
  }
  const added = await upsert('swelect_reviews', rows, { ignoreDuplicates: true });
  return { added: added.length, places };
}

export async function listReviews(limit = 300) {
  return (await select('swelect_reviews', { order: ['published_at', 'desc'], limit })).map(toReview);
}

export interface ReputationReport {
  day: string;
  last24h: { mentions: number; positive: number; neutral: number; negative: number; reviews: number };
  last30d: { mentions: number; positive: number; neutral: number; negative: number };
  score: number; // 0–100: share of non-negative mentions and reviews in 30 days
  googleRating: number | null;
  newItems: (NewsItem & { type: 'mention' })[];
  newReviews: Review[];
  watch: { title: string; url: string; source: string; type: string }[]; // negative items to look at
  daily: { day: string; positive: number; neutral: number; negative: number }[];
}

export function buildReputation(mentions: NewsItem[], reviews: Review[], now = new Date()): ReputationReport {
  const t24 = now.getTime() - 86400_000;
  const t30 = now.getTime() - 30 * 86400_000;
  const tone = (xs: { sentiment: number }[]) => ({ positive: xs.filter((x) => x.sentiment > 0).length, neutral: xs.filter((x) => x.sentiment === 0).length, negative: xs.filter((x) => x.sentiment < 0).length });
  const m24 = mentions.filter((m) => Date.parse(m.publishedAt) >= t24);
  const r24 = reviews.filter((r) => Date.parse(r.publishedAt) >= t24);
  const m30 = mentions.filter((m) => Date.parse(m.publishedAt) >= t30);
  const r30 = reviews.filter((r) => Date.parse(r.publishedAt) >= t30);
  const all30 = [...m30, ...r30];
  const neg30 = all30.filter((x) => x.sentiment < 0).length;
  const rated = reviews.filter((r) => r.rating > 0);
  const daily: ReputationReport['daily'] = [];
  for (let d = 29; d >= 0; d--) {
    const day = new Date(now.getTime() - d * 86400_000).toISOString().slice(0, 10);
    const xs = [...mentions, ...reviews].filter((x) => x.publishedAt?.slice(0, 10) === day);
    daily.push({ day, ...tone(xs) });
  }
  return {
    day: now.toISOString().slice(0, 10),
    last24h: { mentions: m24.length, ...tone([...m24, ...r24]), reviews: r24.length },
    last30d: { mentions: m30.length, ...tone(all30) },
    score: all30.length ? Math.round(((all30.length - neg30) / all30.length) * 100) : 100,
    googleRating: rated.length ? Math.round((rated.reduce((s, r) => s + r.rating, 0) / rated.length) * 10) / 10 : null,
    newItems: m24.map((m) => ({ ...m, type: 'mention' as const })),
    newReviews: r24,
    watch: [
      ...m30.filter((m) => m.sentiment < 0).map((m) => ({ title: m.title, url: m.url, source: m.source, type: 'Mention' })),
      ...r30.filter((r) => r.sentiment < 0).map((r) => ({ title: `${r.rating}★ ${r.author}: ${r.text.slice(0, 140)}`, url: r.url, source: r.platform, type: 'Review' })),
    ].slice(0, 15),
    daily,
  };
}

export async function reputationNow() {
  const [mentions, reviews] = await Promise.all([listMentions(365), listReviews()]);
  return { report: buildReputation(mentions, reviews), mentions, reviews };
}
