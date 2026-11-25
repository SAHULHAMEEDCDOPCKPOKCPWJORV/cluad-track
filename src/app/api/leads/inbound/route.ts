import { timingSafeEqual } from 'node:crypto';
import { handler, ok } from '@/server/auth';
import { getSecrets } from '@/server/config';
import { createLead, fromGoogleAds, mapFields } from '@/server/leads';
import { HttpError } from '@/server/store';

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Automatic lead capture. Point any of these at
 *   https://cluad-track.vercel.app/api/leads/inbound?key=YOUR_KEY&source=Website&campaign=Rooftop-Nov
 *  - website / landing-page enquiry forms (JSON or normal form post),
 *  - Zapier / Make / Pabbly, IndiaMART or JustDial lead forwarding,
 *  - Google Ads lead form extensions (webhook URL = the address above, key = the same value).
 */
export const POST = handler(async (req: Request) => {
  const url = new URL(req.url);
  const { LEAD_WEBHOOK_KEY } = await getSecrets();
  const type = req.headers.get('content-type') ?? '';
  let b: Record<string, unknown> = {};
  if (type.includes('application/json')) b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  else if (type.includes('form')) b = Object.fromEntries((await req.formData()).entries());
  else { try { b = JSON.parse(await req.text()); } catch { throw new HttpError(400, 'Send JSON or a form post'); } }

  const given = String(url.searchParams.get('key') ?? b.google_key ?? req.headers.get('x-lead-key') ?? '');
  if (!LEAD_WEBHOOK_KEY || !given || !same(given, LEAD_WEBHOOK_KEY)) throw new HttpError(401, 'Invalid lead key');

  const isGoogle = Array.isArray(b.user_column_data);
  const input = isGoogle ? fromGoogleAds(b) : mapFields(b);
  if (!isGoogle) {
    if (url.searchParams.get('source')) input.source = url.searchParams.get('source')!;
    if (url.searchParams.get('campaign') && !input.campaign) input.campaign = url.searchParams.get('campaign')!;
  }
  if (b.is_test === true) return ok({ ok: true, test: true }); // Google Ads "send test data"
  const { lead, duplicate } = await createLead(input, 'automation', String(input.source || 'Website form'));
  return ok({ ok: true, id: lead.id, duplicate }, 201);
});
