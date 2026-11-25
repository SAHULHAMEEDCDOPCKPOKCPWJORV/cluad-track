// Sends email through Resend (https://resend.com). Needs RESEND_API_KEY and a sender address on a
// domain verified in Resend (EMAIL_FROM, e.g. "SWELECT Reports <reports@swelectes.com>").
import { getSecrets } from './config';

export async function sendEmail(m: { to: string[]; subject: string; html: string }): Promise<{ ok: boolean; error?: string }> {
  const s = await getSecrets();
  if (!s.RESEND_API_KEY || !s.EMAIL_FROM) return { ok: false, error: 'Email is not set up' };
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${s.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: s.EMAIL_FROM, to: m.to.slice(0, 50), subject: m.subject, html: m.html }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return { ok: false, error: ((await r.json().catch(() => ({}))) as { message?: string }).message ?? `HTTP ${r.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
