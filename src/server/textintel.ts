// Feed reading and simple text understanding (no external AI service needed):
// RSS/Atom parsing, topic category, company detection and positive/negative tone.
import { createHash } from 'node:crypto';
import type { Company } from './config';

export interface FeedItem { title: string; url: string; source: string; publishedAt: string | null; summary: string }

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—', hellip: '…', rupee: '₹' };
export function decode(s: string) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
}
export const stripHtml = (s: string) => decode(decode(s).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

function tag(block: string, name: string): string {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1] : '';
}

/** Bing News links go through a redirect; keep the real article address. */
export function cleanUrl(u: string) {
  try {
    const url = new URL(decode(u).trim());
    if (url.hostname.endsWith('bing.com') && url.searchParams.get('url')) return url.searchParams.get('url')!;
    for (const p of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid']) url.searchParams.delete(p);
    return url.toString();
  } catch {
    return u.trim();
  }
}

export function parseFeed(xml: string, fallbackSource: string): FeedItem[] {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
  const out: FeedItem[] = [];
  for (const b of blocks.slice(0, 60)) {
    const title = stripHtml(tag(b, 'title'));
    let link = stripHtml(tag(b, 'link'));
    if (!link) link = b.match(/<link[^>]*href="([^"]+)"/i)?.[1] ?? stripHtml(tag(b, 'guid'));
    if (!title || !/^https?:/i.test(link.trim())) continue;
    const date = stripHtml(tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date'));
    const t = date ? Date.parse(date) : NaN;
    const source = stripHtml(tag(b, 'source') || tag(b, 'News:Source')) || fallbackSource;
    const summary = stripHtml(tag(b, 'description') || tag(b, 'summary') || tag(b, 'content')).slice(0, 400);
    out.push({ title: title.slice(0, 300), url: cleanUrl(link), source: source.slice(0, 80), publishedAt: Number.isFinite(t) ? new Date(t).toISOString() : null, summary });
  }
  return out;
}

export const idFor = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 24);
export const titleKey = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim().slice(0, 90);

// ───────── topic categories ─────────
const CATEGORIES: [string, RegExp][] = [
  ['Tenders & Auctions', /\b(tender|auction|bid|rfs|rfp|seci|ntpc tender|sjvn tender|nhpc tender|lowest tariff|l1|allot|winners?)\b/i],
  ['Policy & Regulation', /\b(mnre|policy|regulat|cerc|serc|ministry|government|scheme|subsid|alm[m]?|gst|duty|guideline|notif|budget|pm[- ]?kusum|pm surya ghar|rooftop scheme|net[- ]metering|open access rule)/i],
  ['Wind', /\bwind\b|turbine|offshore/i],
  ['Storage & Hydrogen', /\b(battery|bess|storage|hydrogen|electroly[sz]er|pumped hydro|lithium)\b/i],
  ['Manufacturing & Modules', /\b(module|cell|wafer|ingot|polysilicon|manufactur|topcon|hjt|perovskite|factory|gigawatt capacity|inverter)/i],
  ['Finance & Deals', /\b(ipo|acqui|merger|stake|fund|invest|loan|financ|bond|revenue|profit|quarter|q[1-4]\b|share price|valuation|deal)/i],
  ['Rooftop & C&I', /\b(rooftop|c&i|commercial and industrial|captive|open access|ppa with|corporate ppa|behind[- ]the[- ]meter)/i],
  ['Projects & Commissioning', /\b(commission|project|plant|park|mw|gw|install|operational|epc|grid[- ]connect)/i],
];
export function categorize(text: string) {
  for (const [name, re] of CATEGORIES) if (re.test(text)) return name;
  return 'General';
}

const RELEVANT = /\b(solar|photovoltaic|pv\b|wind|renewable|green energy|clean energy|storage|bess|hydrogen|mnre|seci|power purchase|ppa|module|inverter|energy transition|discom)/i;
export const isRelevant = (text: string) => RELEVANT.test(text);

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const reCache = new Map<string, RegExp>();
/** Company names found in the text (whole words only, so "ReNew" does not match "renewable"). */
export function findCompanies(text: string, companies: Company[]): string[] {
  return companies.filter((c) => [c.name, ...c.aliases].some((a) => {
    const k = a.trim().toLowerCase();
    if (k.length < 3) return false;
    let re = reCache.get(k);
    if (!re) reCache.set(k, (re = new RegExp(`(^|[^a-z0-9])${esc(k)}([^a-z0-9]|$)`, 'i')));
    return re.test(text);
  })).map((c) => c.name);
}

// ───────── tone (positive / neutral / negative) ─────────
const POS = ['award', 'wins', 'won', 'record', 'growth', 'profit rises', 'profit up', 'surge', 'expands', 'expansion', 'commissions', 'commissioned', 'launch', 'partnership', 'order', 'secures', 'bags', 'approved', 'best', 'excellent', 'great', 'good', 'happy', 'satisfied', 'recommend', 'professional', 'helpful', 'quick', 'reliable', 'quality', 'thank', 'innovative', 'milestone', 'strong', 'upgrade', 'gains', 'rally', 'dividend'];
const NEG = ['fraud', 'scam', 'complaint', 'delay', 'delayed', 'poor', 'bad', 'worst', 'loss', 'losses', 'decline', 'falls', 'fell', 'drop', 'penalty', 'fine', 'lawsuit', 'dispute', 'cancel', 'default', 'downgrade', 'not working', 'no response', 'faulty', 'defect', 'fire', 'accident', 'unprofessional', 'rude', 'waste', 'pathetic', 'terrible', 'disappointed', 'refund', 'cheat', 'probe', 'raid', 'underperform', 'slump', 'plunge', 'weak'];
export function sentiment(text: string): -1 | 0 | 1 {
  const t = ` ${text.toLowerCase()} `;
  let s = 0;
  for (const w of POS) if (t.includes(` ${w}`)) s++;
  for (const w of NEG) if (t.includes(` ${w}`)) s -= 1.5;
  return s >= 1 ? 1 : s <= -1 ? -1 : 0;
}
