import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getSecrets } from '@/server/config';
import { createLead, fromMetaLead } from '@/server/leads';

/**
 * Facebook / Instagram Lead Ads webhook (subscribe the Page to the "leadgen" field in the Meta app).
 * Callback URL: https://cluad-track.vercel.app/api/leads/meta   Verify token: META_VERIFY_TOKEN
 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const { META_VERIFY_TOKEN } = await getSecrets();
  if (u.searchParams.get('hub.mode') === 'subscribe' && META_VERIFY_TOKEN && u.searchParams.get('hub.verify_token') === META_VERIFY_TOKEN)
    return new NextResponse(u.searchParams.get('hub.challenge') ?? '', { status: 200 });
  return NextResponse.json({ error: 'Verification failed' }, { status: 403 });
}

export async function POST(req: Request) {
  const raw = await req.text();
  const s = await getSecrets();
  if (s.META_APP_SECRET) {
    const sig = req.headers.get('x-hub-signature-256') ?? '';
    const want = `sha256=${createHmac('sha256', s.META_APP_SECRET).update(raw).digest('hex')}`;
    if (sig.length !== want.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return NextResponse.json({ error: 'Bad signature' }, { status: 401 });
  }
  if (!s.META_PAGE_TOKEN) return NextResponse.json({ error: 'Meta is not connected' }, { status: 503 });
  let body: { entry?: { changes?: { field?: string; value?: { leadgen_id?: string } }[] }[] } = {};
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }); }
  const ids = (body.entry ?? []).flatMap((e) => (e.changes ?? []).filter((c) => c.field === 'leadgen' && c.value?.leadgen_id).map((c) => c.value!.leadgen_id!));
  let created = 0;
  for (const id of ids.slice(0, 50)) {
    try {
      const r = await fetch(`https://graph.facebook.com/v21.0/${id}?fields=id,created_time,field_data,campaign_name,ad_name,form_id,platform&access_token=${s.META_PAGE_TOKEN}`, { signal: AbortSignal.timeout(10000) });
      const lead = await r.json();
      if (!r.ok) continue;
      await createLead(fromMetaLead(lead), 'automation', 'Meta Lead Ads');
      created++;
    } catch { /* Meta retries failed deliveries */ }
  }
  return NextResponse.json({ ok: true, received: ids.length, created });
}
