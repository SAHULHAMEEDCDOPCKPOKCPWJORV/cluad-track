import { randomBytes } from 'node:crypto';
import { body, handler, ok, requireUser } from '@/server/auth';
import { getCompetitors, getRecipients, getSalesTeam, getSources, saveSecrets, secretStatus, SECRET_FIELDS, type Company, type NewsSource, type Recipients, type SalesPerson, type SecretName } from '@/server/config';
import { getSetting, setSetting } from '@/server/db';
import { lastFetch } from '@/server/news';
import { HttpError } from '@/server/store';

const emails = (v: unknown) => (Array.isArray(v) ? v : String(v ?? '').split(/[\s,;]+/)).map((x) => String(x).trim().toLowerCase()).filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)).slice(0, 50);

async function all() {
  return {
    secrets: await secretStatus(), sources: await getSources(), competitors: await getCompetitors(), salesTeam: await getSalesTeam(),
    recipients: await getRecipients(), lastRun: await getSetting('automation.lastRun', null), lastFetch: await lastFetch(),
  };
}

export const GET = handler(async () => {
  await requireUser({ admin: true });
  return ok(await all());
});

export const PUT = handler(async (req: Request) => {
  await requireUser({ admin: true });
  const b = await body<{ secrets?: Partial<Record<SecretName, string>>; sources?: NewsSource[]; competitors?: Company[]; salesTeam?: SalesPerson[]; recipients?: Recipients; newLeadKey?: boolean }>(req);
  if (b.secrets) {
    const clean: Partial<Record<SecretName, string>> = {};
    for (const k of SECRET_FIELDS) if (k in b.secrets) clean[k] = String(b.secrets[k] ?? '');
    await saveSecrets(clean);
  }
  if (b.newLeadKey) await saveSecrets({ LEAD_WEBHOOK_KEY: randomBytes(18).toString('base64url') });
  if (b.sources) {
    const list = b.sources.filter((s) => /^https:\/\//.test(String(s.url))).slice(0, 40).map((s) => ({ name: String(s.name || s.url).slice(0, 80), url: String(s.url).slice(0, 500), kind: s.kind === 'mention' ? 'mention' : 'news', enabled: s.enabled !== false }));
    await setSetting('news.sources', list);
  }
  if (b.competitors) {
    const list = b.competitors.filter((c) => String(c.name ?? '').trim()).slice(0, 60).map((c) => ({
      name: String(c.name).trim().slice(0, 80), aliases: (Array.isArray(c.aliases) ? c.aliases : String(c.aliases ?? '').split(',')).map((a) => String(a).trim().toLowerCase()).filter(Boolean).slice(0, 10),
      instagram: String(c.instagram ?? '').replace(/^@/, '').trim().slice(0, 60) || undefined, youtube: String(c.youtube ?? '').trim().slice(0, 80) || undefined,
      linkedin: String(c.linkedin ?? '').trim().slice(0, 200) || undefined, sector: String(c.sector ?? '').slice(0, 60) || undefined,
    }));
    await setSetting('competitors', list);
  }
  if (b.salesTeam) {
    const list = b.salesTeam.filter((p) => String(p.name ?? '').trim()).slice(0, 100).map((p) => ({ name: String(p.name).trim().slice(0, 80), email: emails([p.email])[0] ?? '', states: (Array.isArray(p.states) ? p.states : String(p.states ?? '').split(',')).map((x) => String(x).trim()).filter(Boolean).slice(0, 40), active: p.active !== false }));
    await setSetting('sales.team', list);
  }
  if (b.recipients) await setSetting('recipients', { news: emails(b.recipients.news), reputation: emails(b.recipients.reputation), social: emails(b.recipients.social), leads: emails(b.recipients.leads) });
  if (!Object.keys(b).length) throw new HttpError(400, 'Nothing to save');
  return ok(await all());
});
