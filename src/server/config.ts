// Settings for the marketing & sales modules: news sources, competitors, sales team, email lists and
// connection keys. Keys are stored server-side only (never sent to the browser in full).
import { getSetting, setSetting } from './db';

export interface NewsSource { name: string; url: string; kind: 'news' | 'mention'; enabled: boolean }
export interface Company { name: string; aliases: string[]; instagram?: string; youtube?: string; linkedin?: string; facebook?: string; sector?: string }
export interface SalesPerson { name: string; email: string; states?: string[]; active: boolean }
export interface Recipients { news: string[]; reputation: string[]; social: string[]; leads: string[] }

export const bing = (q: string) => `https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss&setlang=en-IN&cc=IN`;

export const BRAND: Company = { name: 'SWELECT', aliases: ['swelect', 'swelect energy', 'swelect energy systems', 'swelectes'], sector: 'Solar' };

export const DEFAULT_SOURCES: NewsSource[] = [
  { name: 'Mercom India', url: 'https://www.mercomindia.com/feed', kind: 'news', enabled: true },
  { name: 'PV Magazine India', url: 'https://www.pv-magazine-india.com/feed/', kind: 'news', enabled: true },
  { name: 'Renewable Watch', url: 'https://renewablewatch.in/feed/', kind: 'news', enabled: true },
  { name: 'PV Tech', url: 'https://www.pv-tech.org/feed/', kind: 'news', enabled: true },
  { name: 'Solar news (India)', url: bing('solar energy India'), kind: 'news', enabled: true },
  { name: 'Wind news (India)', url: bing('wind energy India'), kind: 'news', enabled: true },
  { name: 'Renewable tenders & policy', url: bing('renewable energy tender MNRE SECI'), kind: 'news', enabled: true },
  { name: 'Storage & green hydrogen', url: bing('battery energy storage India green hydrogen'), kind: 'news', enabled: true },
  { name: 'SWELECT mentions', url: bing('"SWELECT"'), kind: 'mention', enabled: true },
  { name: 'SWELECT Energy Systems mentions', url: bing('"Swelect Energy Systems"'), kind: 'mention', enabled: true },
];

/** Main solar, wind and renewable players in India. Editable in the app (Connections & Settings). */
export const DEFAULT_COMPETITORS: Company[] = [
  { name: 'Adani Green Energy', aliases: ['adani green', 'adani solar'], instagram: 'adanigreenenergy', sector: 'Solar & Wind' },
  { name: 'Tata Power Renewables', aliases: ['tata power renewable', 'tata power solar', 'tata power'], instagram: 'tatapower', sector: 'Solar & Wind' },
  { name: 'ReNew', aliases: ['renew power', 'renew energy global', 'renew'], instagram: 'renew_power', sector: 'Solar & Wind' },
  { name: 'NTPC Green Energy', aliases: ['ntpc green', 'ngel'], sector: 'Solar & Wind' },
  { name: 'Waaree Energies', aliases: ['waaree'], instagram: 'waareeenergies', sector: 'Solar' },
  { name: 'Vikram Solar', aliases: ['vikram solar'], instagram: 'vikramsolar', sector: 'Solar' },
  { name: 'Premier Energies', aliases: ['premier energies'], sector: 'Solar' },
  { name: 'Suzlon', aliases: ['suzlon'], instagram: 'suzlon_group', sector: 'Wind' },
  { name: 'Inox Wind', aliases: ['inox wind', 'inox green', 'inoxgfl'], sector: 'Wind' },
  { name: 'Sterling and Wilson', aliases: ['sterling and wilson', 'sterling & wilson'], sector: 'Solar EPC' },
  { name: 'JSW Energy', aliases: ['jsw energy', 'jsw neo', 'jsw renew'], sector: 'Solar & Wind' },
  { name: 'Avaada', aliases: ['avaada'], sector: 'Solar' },
  { name: 'Greenko', aliases: ['greenko'], sector: 'Solar, Wind & Storage' },
  { name: 'Azure Power', aliases: ['azure power'], sector: 'Solar' },
  { name: 'Juniper Green Energy', aliases: ['juniper green'], sector: 'Solar & Wind' },
  { name: 'Hero Future Energies', aliases: ['hero future'], sector: 'Solar & Wind' },
  { name: 'CleanMax', aliases: ['cleanmax', 'clean max'], sector: 'C&I Solar & Wind' },
  { name: 'Fourth Partner Energy', aliases: ['fourth partner'], sector: 'C&I Solar' },
  { name: 'Amp Energy India', aliases: ['amp energy', 'ampin'], sector: 'C&I Solar' },
  { name: 'Torrent Power', aliases: ['torrent power'], sector: 'Solar & Wind' },
];

export const DEFAULT_RECIPIENTS: Recipients = { news: [], reputation: [], social: [], leads: [] };

// Keys that can be saved from the Connections page (or set as Vercel environment variables of the same name).
export const SECRET_FIELDS = [
  'META_PAGE_ID', 'META_IG_USER_ID', 'META_PAGE_TOKEN', 'META_APP_SECRET', 'META_VERIFY_TOKEN',
  'LINKEDIN_ORG_ID', 'LINKEDIN_TOKEN',
  'YOUTUBE_API_KEY', 'YOUTUBE_CHANNEL',
  'GOOGLE_PLACES_KEY', 'GOOGLE_PLACE_IDS',
  'RESEND_API_KEY', 'EMAIL_FROM',
  'LEAD_WEBHOOK_KEY',
] as const;
export type SecretName = (typeof SECRET_FIELDS)[number];
// Not secret: IDs and addresses can be shown in full.
export const PLAIN_FIELDS: SecretName[] = ['META_PAGE_ID', 'META_IG_USER_ID', 'LINKEDIN_ORG_ID', 'YOUTUBE_CHANNEL', 'GOOGLE_PLACE_IDS', 'EMAIL_FROM', 'LEAD_WEBHOOK_KEY', 'META_VERIFY_TOKEN'];

export async function getSecrets(): Promise<Partial<Record<SecretName, string>>> {
  const saved = await getSetting<Partial<Record<SecretName, string>>>('secrets', {});
  const out: Partial<Record<SecretName, string>> = {};
  for (const k of SECRET_FIELDS) {
    const v = process.env[k] || saved[k];
    if (v) out[k] = String(v);
  }
  return out;
}
export async function saveSecrets(patch: Partial<Record<SecretName, string>>) {
  const saved = await getSetting<Partial<Record<SecretName, string>>>('secrets', {});
  for (const k of SECRET_FIELDS) {
    if (!(k in patch)) continue;
    const v = String(patch[k] ?? '').trim();
    if (v) saved[k] = v.slice(0, 2000);
    else delete saved[k];
  }
  await setSetting('secrets', saved);
}
/** What the browser may see: plain IDs in full, secret keys only as "saved, ends with …1234". */
export async function secretStatus() {
  const s = await getSecrets();
  const out: Record<string, { set: boolean; value?: string; hint?: string; fromEnv?: boolean }> = {};
  for (const k of SECRET_FIELDS) {
    const v = s[k];
    out[k] = !v ? { set: false } : PLAIN_FIELDS.includes(k) ? { set: true, value: v, fromEnv: !!process.env[k] } : { set: true, hint: `…${v.slice(-4)}`, fromEnv: !!process.env[k] };
  }
  return out;
}

export const getSources = () => getSetting<NewsSource[]>('news.sources', DEFAULT_SOURCES);
export const getCompetitors = () => getSetting<Company[]>('competitors', DEFAULT_COMPETITORS);
export const getSalesTeam = () => getSetting<SalesPerson[]>('sales.team', []);
export const getRecipients = () => getSetting<Recipients>('recipients', DEFAULT_RECIPIENTS);
