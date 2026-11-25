// The daily job (runs every morning from Vercel Cron, or on demand by an admin):
// fetch news + mentions, Google reviews and social numbers; build the four daily reports;
// save them; email them to the configured people; send each salesperson their follow-ups.
import { BRAND, getRecipients, getSalesTeam, getSecrets } from './config';
import { select, setSetting, upsert } from './db';
import { buildDigest, listNews, refreshNews, type Digest } from './news';
import { buildReputation, refreshGoogleReviews, listReviews, type ReputationReport } from './reputation';
import { listMentions } from './news';
import { socialOverview, syncSocial } from './social';
import { leadStats, listLeads, OPEN_STAGES, type Lead } from './leads';
import { sendEmail } from './email';

const APP = 'https://cluad-track.vercel.app';
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });

function shell(title: string, body: string) {
  return `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:720px;margin:auto;color:#0f172a">
  <div style="background:#0b1220;color:#fff;padding:18px 22px;border-radius:12px 12px 0 0"><div style="font-size:12px;letter-spacing:2px;color:#34d399">SWELECT · DAILY</div><div style="font-size:20px;font-weight:700;margin-top:4px">${esc(title)}</div></div>
  <div style="border:1px solid #e2e8f0;border-top:0;padding:18px 22px;border-radius:0 0 12px 12px">${body}
  <p style="margin-top:24px;font-size:12px;color:#64748b">Open the app: <a href="${APP}">${APP}</a></p></div></div>`;
}
const item = (t: { title: string; url: string; source: string; publishedAt?: string }) =>
  `<li style="margin:6px 0"><a href="${esc(t.url)}" style="color:#1d4ed8;text-decoration:none;font-weight:600">${esc(t.title)}</a><br><span style="font-size:12px;color:#64748b">${esc(t.source)}${t.publishedAt ? ` · ${fmtDate(t.publishedAt)}` : ''}</span></li>`;

export function newsEmail(d: Digest) {
  const parts = [`<p style="color:#475569">${d.total} renewable-energy stories in the last 24 hours.</p>`];
  if (d.brand.length) parts.push(`<h3 style="color:#047857">SWELECT in the news</h3><ul>${d.brand.map(item).join('')}</ul>`);
  if (d.competitors.length) parts.push(`<h3>Competitors</h3><ul>${d.competitors.map((i) => item({ ...i, source: `${i.companies.join(', ')} · ${i.source}` })).join('')}</ul>`);
  for (const g of d.byCategory) parts.push(`<h3 style="margin-top:18px">${esc(g.category)}</h3><ul>${g.items.map(item).join('')}</ul>`);
  return shell(`Solar & Renewable News – ${fmtDate(d.day)}`, parts.join(''));
}
export function reputationEmail(r: ReputationReport) {
  const box = (label: string, v: string | number, color = '#0f172a') => `<td style="padding:10px;border:1px solid #e2e8f0;border-radius:8px;text-align:center"><div style="font-size:22px;font-weight:700;color:${color}">${v}</div><div style="font-size:11px;color:#64748b">${label}</div></td>`;
  const body = `<table style="width:100%;border-collapse:separate;border-spacing:6px"><tr>${box('Reputation score (30 days)', `${r.score}/100`, r.score >= 80 ? '#047857' : r.score >= 60 ? '#047857' : '#be123c')}${box('New mentions (24h)', r.last24h.mentions)}${box('Negative (24h)', r.last24h.negative, '#be123c')}${box('Google rating', r.googleRating ?? '—')}</tr></table>
  ${r.newItems.length ? `<h3>New mentions</h3><ul>${r.newItems.map(item).join('')}</ul>` : '<p>No new mentions of SWELECT in the last 24 hours.</p>'}
  ${r.newReviews.length ? `<h3>New reviews</h3><ul>${r.newReviews.map((v) => `<li>${'★'.repeat(Math.round(v.rating))} <b>${esc(v.author)}</b> (${esc(v.place)}): ${esc(v.text.slice(0, 300))}</li>`).join('')}</ul>` : ''}
  ${r.watch.length ? `<h3 style="color:#be123c">Needs attention (negative, last 30 days)</h3><ul>${r.watch.map((w) => item({ title: `[${w.type}] ${w.title}`, url: w.url, source: w.source })).join('')}</ul>` : ''}`;
  return shell(`${BRAND.name} Reputation Report – ${fmtDate(r.day)}`, body);
}
type Social = Awaited<ReturnType<typeof socialOverview>>;
export function socialEmail(s: Social, day: string) {
  const rows = s.accounts.filter((a) => a.followers != null).sort((a, b) => (b.followers ?? 0) - (a.followers ?? 0));
  const tr = rows.map((a) => `<tr style="${a.isOwn ? 'background:#ecfdf5;font-weight:600' : ''}"><td style="padding:6px;border-bottom:1px solid #e2e8f0">${esc(a.name)}</td><td style="padding:6px;border-bottom:1px solid #e2e8f0">${esc(a.platform)}</td><td style="padding:6px;border-bottom:1px solid #e2e8f0;text-align:right">${(a.followers ?? 0).toLocaleString('en-IN')}</td><td style="padding:6px;border-bottom:1px solid #e2e8f0;text-align:right">${a.growth30d == null ? '—' : `${a.growth30d > 0 ? '+' : ''}${a.growth30d}%`}</td><td style="padding:6px;border-bottom:1px solid #e2e8f0;text-align:right">${a.engagementRate == null ? '—' : `${a.engagementRate}%`}</td></tr>`).join('');
  const top = s.posts.filter((p) => p.isOwn && Date.parse(p.postedAt) > Date.now() - 30 * 86400_000).sort((a, b) => b.engagement - a.engagement).slice(0, 5);
  const body = rows.length
    ? `<table style="width:100%;border-collapse:collapse;font-size:13px"><tr style="text-align:left;color:#64748b"><th style="padding:6px">Account</th><th style="padding:6px">Platform</th><th style="padding:6px;text-align:right">Followers</th><th style="padding:6px;text-align:right">30-day growth</th><th style="padding:6px;text-align:right">Engagement</th></tr>${tr}</table>
      ${top.length ? `<h3>SWELECT's best posts (30 days)</h3><ul>${top.map((p) => `<li><a href="${esc(p.permalink)}">${esc(p.text.slice(0, 90) || p.mediaType)}</a> — ${p.likes} likes, ${p.comments} comments (${esc(p.platform)})</li>`).join('')}</ul>` : ''}`
    : '<p>No social accounts are connected yet. An admin can connect them in the app under Connections & Settings.</p>';
  return shell(`Social Media Performance – ${fmtDate(day)}`, body);
}
function leadsRows(xs: Lead[]) {
  return `<table style="width:100%;border-collapse:collapse;font-size:13px"><tr style="text-align:left;color:#64748b"><th style="padding:6px">Lead</th><th style="padding:6px">Phone</th><th style="padding:6px">Stage</th><th style="padding:6px">Follow-up</th><th style="padding:6px">Campaign</th></tr>${xs.map((l) => `<tr><td style="padding:6px;border-bottom:1px solid #e2e8f0"><b>${esc(l.name)}</b>${l.company ? `<br><span style="color:#64748b">${esc(l.company)}</span>` : ''}</td><td style="padding:6px;border-bottom:1px solid #e2e8f0">${esc(l.phone)}</td><td style="padding:6px;border-bottom:1px solid #e2e8f0">${esc(l.stage)}</td><td style="padding:6px;border-bottom:1px solid #e2e8f0">${l.nextFollowup ? fmtDate(l.nextFollowup) : '—'}</td><td style="padding:6px;border-bottom:1px solid #e2e8f0">${esc(l.campaign || l.source)}</td></tr>`).join('')}</table>`;
}
export function leadsSummaryEmail(leads: Lead[], day: string) {
  const st = leadStats(leads);
  const camp = st.byCampaign.slice(0, 10).map((c) => `<tr><td style="padding:6px;border-bottom:1px solid #e2e8f0">${esc(c.name)}</td><td style="padding:6px;border-bottom:1px solid #e2e8f0;text-align:right">${c.leads}</td><td style="padding:6px;border-bottom:1px solid #e2e8f0;text-align:right">${c.won}</td><td style="padding:6px;border-bottom:1px solid #e2e8f0;text-align:right">${c.conversion}%</td><td style="padding:6px;border-bottom:1px solid #e2e8f0;text-align:right">${c.overdue}</td></tr>`).join('');
  const owners = st.byOwner.map((o) => `<tr><td style="padding:6px;border-bottom:1px solid #e2e8f0">${esc(o.name)}</td><td style="padding:6px;border-bottom:1px solid #e2e8f0;text-align:right">${o.open}</td><td style="padding:6px;border-bottom:1px solid #e2e8f0;text-align:right;color:${o.overdue ? '#be123c' : 'inherit'}">${o.overdue}</td><td style="padding:6px;border-bottom:1px solid #e2e8f0;text-align:right">${o.won}</td></tr>`).join('');
  return shell(`Leads & Follow-ups – ${fmtDate(day)}`, `<p><b>${st.newToday}</b> new today · <b>${st.dueToday}</b> due today · <b style="color:#be123c">${st.overdue}</b> overdue · <b>${st.wonThisMonth}</b> won this month · conversion <b>${st.conversion}%</b></p>
  <h3>By campaign</h3><table style="width:100%;border-collapse:collapse;font-size:13px"><tr style="text-align:left;color:#64748b"><th style="padding:6px">Campaign</th><th style="padding:6px;text-align:right">Leads</th><th style="padding:6px;text-align:right">Won</th><th style="padding:6px;text-align:right">Conversion</th><th style="padding:6px;text-align:right">Overdue</th></tr>${camp}</table>
  <h3>By salesperson</h3><table style="width:100%;border-collapse:collapse;font-size:13px"><tr style="text-align:left;color:#64748b"><th style="padding:6px">Owner</th><th style="padding:6px;text-align:right">Open</th><th style="padding:6px;text-align:right">Overdue</th><th style="padding:6px;text-align:right">Won</th></tr>${owners}</table>`);
}
export function ownerEmail(name: string, mine: Lead[], day: string) {
  const due = mine.filter((l) => l.nextFollowup && l.nextFollowup <= day).sort((a, b) => String(a.nextFollowup).localeCompare(String(b.nextFollowup)));
  return shell(`Your follow-ups today, ${name}`, `<p>You have <b>${due.length}</b> lead${due.length === 1 ? '' : 's'} to follow up today (including overdue).</p>${leadsRows(due)}<p style="font-size:12px;color:#64748b">After each call, open the lead in the app and press "Log call" so the next follow-up date is set automatically.</p>`);
}

export interface RunOptions { sendEmails: boolean; fetchImpl?: typeof fetch }

export async function runDaily(opts: RunOptions) {
  const started = new Date();
  const log: Record<string, unknown> = {};
  const day = started.toISOString().slice(0, 10);

  // 1. collect
  try { log.news = await refreshNews(opts.fetchImpl ? { fetchImpl: (u) => opts.fetchImpl!(u).then((r) => r.text()) } : {}); } catch (e) { log.news = { error: (e as Error).message }; }
  try { log.reviews = await refreshGoogleReviews(opts.fetchImpl); } catch (e) { log.reviews = { error: (e as Error).message }; }
  try { log.social = await syncSocial(opts.fetchImpl); } catch (e) { log.social = { error: (e as Error).message }; }

  // 2. reports
  const [news, mentions, reviews, social, leads] = await Promise.all([listNews(3), listMentions(365), listReviews(), socialOverview(), listLeads()]);
  const digest = buildDigest(news, started);
  const reputation = buildReputation(mentions, reviews, started);
  const stats = leadStats(leads, started);
  await upsert('swelect_reports', [
    { id: `news:${day}`, kind: 'news', day, data: digest },
    { id: `reputation:${day}`, kind: 'reputation', day, data: reputation },
    { id: `social:${day}`, kind: 'social', day, data: { accounts: social.accounts.map(({ trend: _t, ...a }) => a), contentTypes: social.contentTypes } },
    { id: `leads:${day}`, kind: 'leads', day, data: { ...stats, byCampaign: stats.byCampaign.slice(0, 30) } },
  ]);

  // 3. email
  const mail: { to: string; subject: string; ok: boolean; error?: string }[] = [];
  if (opts.sendEmails) {
    const secrets = await getSecrets();
    if (!secrets.RESEND_API_KEY || !secrets.EMAIL_FROM) log.email = 'not set up (add the email key and sender address in Connections & Settings)';
    else {
      const r = await getRecipients();
      const send = async (to: string[], subject: string, html: string) => {
        if (!to.length) return;
        const res = await sendEmail({ to, subject, html });
        mail.push({ to: to.join(', '), subject, ...res });
      };
      await send(r.news, `Solar & Renewable News – ${fmtDate(day)}`, newsEmail(digest));
      await send(r.reputation, `${BRAND.name} Reputation Report – ${fmtDate(day)}`, reputationEmail(reputation));
      await send(r.social, `Social Media Performance – ${fmtDate(day)}`, socialEmail(social, day));
      await send(r.leads, `Leads & Follow-ups – ${fmtDate(day)}`, leadsSummaryEmail(leads, day));
      for (const p of (await getSalesTeam()).filter((p) => p.active && p.email)) {
        const mine = leads.filter((l) => l.owner === p.name && OPEN_STAGES.includes(l.stage as never));
        if (mine.some((l) => l.nextFollowup && l.nextFollowup <= day)) await send([p.email], `Your follow-ups today – ${fmtDate(day)}`, ownerEmail(p.name, mine, day));
      }
      await Promise.all(['news', 'reputation', 'social', 'leads'].map(async (k) => {
        const [row] = await select('swelect_reports', { eq: { id: `${k}:${day}` }, limit: 1 });
        if (row) await upsert('swelect_reports', [{ ...row, emailed_at: new Date().toISOString() }]);
      }));
    }
  }
  log.emails = mail;
  const summary = { at: started.toISOString(), seconds: Math.round((Date.now() - started.getTime()) / 100) / 10, ...log };
  await setSetting('automation.lastRun', summary);
  return summary;
}
