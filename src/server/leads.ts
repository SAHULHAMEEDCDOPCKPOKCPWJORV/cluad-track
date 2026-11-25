// Lead Tracking & Sales Follow-up Automation.
// Leads arrive automatically (website/landing-page forms, Meta Lead Ads, Google Ads lead forms, Excel import),
// are de-duplicated, assigned to a salesperson and given a follow-up date. Every change is recorded.
import { randomUUID } from 'node:crypto';
import { getSalesTeam } from './config';
import { select, update, upsert, type Row } from './db';
import { HttpError } from './store';

export const STAGES = ['New', 'Contacted', 'Qualified', 'Site Visit', 'Proposal Sent', 'Negotiation', 'Won', 'Lost'] as const;
export type Stage = (typeof STAGES)[number];
/** Days until the next follow-up after moving to a stage. */
const NEXT_DAYS: Record<string, number | null> = { New: 0, Contacted: 2, Qualified: 3, 'Site Visit': 3, 'Proposal Sent': 4, Negotiation: 3, Won: null, Lost: null };
export const OPEN_STAGES = STAGES.filter((s) => s !== 'Won' && s !== 'Lost');

export interface Lead {
  id: string; createdAt: string; updatedAt: string; name: string; phone: string; email: string; company: string; city: string; state: string;
  requirement: string; segment: string; source: string; campaign: string; owner: string; stage: string; value: number | null;
  nextFollowup: string | null; lastContacted: string | null; lostReason: string; notes: string;
}
export const toLead = (r: Row): Lead => ({
  id: r.id, createdAt: r.created_at, updatedAt: r.updated_at, name: r.name, phone: r.phone ?? '', email: r.email ?? '', company: r.company ?? '', city: r.city ?? '', state: r.state ?? '',
  requirement: r.requirement ?? '', segment: r.segment ?? '', source: r.source ?? '', campaign: r.campaign ?? '', owner: r.owner ?? '', stage: r.stage ?? 'New',
  value: r.value == null ? null : Number(r.value), nextFollowup: r.next_followup ?? null, lastContacted: r.last_contacted ?? null, lostReason: r.lost_reason ?? '', notes: r.notes ?? '',
});

const s = (v: unknown, max = 200) => (v == null ? '' : String(v).trim().slice(0, max));
export const cleanPhone = (p: unknown) => {
  const d = s(p, 40).replace(/[^\d+]/g, '');
  const digits = d.replace(/\D/g, '');
  return digits.length >= 10 ? (digits.length === 10 ? `+91${digits}` : `+${digits}`) : d;
};
const isoDay = (offsetDays: number, from = new Date()) => new Date(from.getTime() + offsetDays * 86400_000).toISOString().slice(0, 10);

export interface LeadInput { name?: unknown; phone?: unknown; email?: unknown; company?: unknown; city?: unknown; state?: unknown; requirement?: unknown; segment?: unknown; source?: unknown; campaign?: unknown; owner?: unknown; value?: unknown; notes?: unknown; externalId?: unknown; stage?: unknown; nextFollowup?: unknown }

async function event(leadId: string, by: string, kind: string, text: string) {
  await upsert('swelect_lead_events', [{ id: randomUUID(), lead_id: leadId, at: new Date().toISOString(), by_user: by, kind, text: text.slice(0, 1000) }]);
}

/** Pick a salesperson: someone covering the lead's state first, then round-robin across the active team. */
async function assignOwner(state: string): Promise<string> {
  const team = (await getSalesTeam()).filter((p) => p.active);
  if (!team.length) return '';
  const st = state.toLowerCase();
  const pool = team.filter((p) => p.states?.some((x) => x.toLowerCase() === st));
  const candidates = pool.length ? pool : team;
  const open = await select('swelect_leads', { inList: ['stage', OPEN_STAGES as unknown as string[]], columns: 'owner', limit: 5000 });
  const load = (n: string) => open.filter((r) => r.owner === n).length;
  return candidates.slice().sort((a, b) => load(a.name) - load(b.name))[0].name; // fewest open leads
}

/** Create a lead, or log a repeat enquiry on the existing one (same phone or email). */
export async function createLead(input: LeadInput, by: string, how: string): Promise<{ lead: Lead; duplicate: boolean }> {
  const name = s(input.name, 120) || s(input.company, 120) || s(input.email, 120) || s(input.phone, 40);
  if (!name) throw new HttpError(400, 'A lead needs at least a name, phone or email');
  const phone = cleanPhone(input.phone);
  const email = s(input.email, 160).toLowerCase();
  const externalId = s(input.externalId, 120) || null;

  const matches: Row[] = [];
  if (externalId) matches.push(...(await select('swelect_leads', { eq: { external_id: externalId }, limit: 1 })));
  if (!matches.length && phone) matches.push(...(await select('swelect_leads', { eq: { phone }, limit: 1 })));
  if (!matches.length && email) matches.push(...(await select('swelect_leads', { eq: { email }, limit: 1 })));
  if (matches.length) {
    const old = matches[0];
    const note = `Repeat enquiry via ${how}${s(input.campaign) ? ` (${s(input.campaign)})` : ''}${s(input.requirement) ? `: ${s(input.requirement)}` : ''}`;
    const patch: Row = { updated_at: new Date().toISOString() };
    if (old.stage === 'Lost') { patch.stage = 'New'; patch.next_followup = isoDay(0); }
    if (!old.next_followup || old.next_followup > isoDay(1)) patch.next_followup = isoDay(0);
    await update('swelect_leads', { id: old.id }, patch);
    await event(old.id, by, 'Repeat enquiry', note);
    return { lead: toLead({ ...old, ...patch }), duplicate: true };
  }

  const state = s(input.state, 60);
  const now = new Date().toISOString();
  const stage = STAGES.includes(s(input.stage) as Stage) ? s(input.stage) : 'New';
  const nd = NEXT_DAYS[stage];
  const row: Row = {
    id: randomUUID(), created_at: now, updated_at: now, name, phone: phone || null, email: email || null, company: s(input.company, 160) || null, city: s(input.city, 80) || null, state: state || null,
    requirement: s(input.requirement, 300) || null, segment: s(input.segment, 60) || null, source: s(input.source, 80) || how, campaign: s(input.campaign, 160) || null,
    owner: s(input.owner, 80) || (await assignOwner(state)) || null, stage, value: Number.isFinite(Number(input.value)) && s(input.value) !== '' ? Number(input.value) : null,
    next_followup: /^\d{4}-\d{2}-\d{2}$/.test(s(input.nextFollowup)) ? s(input.nextFollowup) : nd == null ? null : isoDay(nd), notes: s(input.notes, 2000) || null, external_id: externalId,
  };
  await upsert('swelect_leads', [row]);
  await event(row.id, by, 'Created', `New lead via ${how}${row.campaign ? ` · ${row.campaign}` : ''}${row.owner ? ` · assigned to ${row.owner}` : ''}`);
  return { lead: toLead(row), duplicate: false };
}

export interface LeadPatch { stage?: string; owner?: string; nextFollowup?: string | null; value?: number | null; notes?: string; lostReason?: string; logCall?: string; name?: string; phone?: string; email?: string; company?: string; city?: string; state?: string; requirement?: string; segment?: string; campaign?: string; source?: string }

export async function updateLead(id: string, p: LeadPatch, by: string): Promise<Lead> {
  const [old] = await select('swelect_leads', { eq: { id }, limit: 1 });
  if (!old) throw new HttpError(404, 'Lead not found');
  const patch: Row = { updated_at: new Date().toISOString() };
  const notes: string[] = [];
  if (p.stage && p.stage !== old.stage) {
    if (!STAGES.includes(p.stage as Stage)) throw new HttpError(400, 'Unknown stage');
    if (p.stage === 'Lost' && !s(p.lostReason || old.lost_reason)) throw new HttpError(400, 'Please give a reason when marking a lead as Lost');
    patch.stage = p.stage;
    const nd = NEXT_DAYS[p.stage];
    if (p.nextFollowup === undefined) patch.next_followup = nd == null ? null : isoDay(nd);
    if (p.stage !== 'New') patch.last_contacted = new Date().toISOString();
    notes.push(`Stage: ${old.stage} → ${p.stage}`);
  }
  if (p.owner !== undefined && p.owner !== (old.owner ?? '')) { patch.owner = s(p.owner, 80) || null; notes.push(`Owner: ${old.owner || '—'} → ${p.owner || '—'}`); }
  if (p.nextFollowup !== undefined) {
    if (p.nextFollowup && !/^\d{4}-\d{2}-\d{2}$/.test(p.nextFollowup)) throw new HttpError(400, 'Follow-up date must be YYYY-MM-DD');
    patch.next_followup = p.nextFollowup || null;
    if ((old.next_followup ?? null) !== (p.nextFollowup || null)) notes.push(`Next follow-up: ${p.nextFollowup || 'none'}`);
  }
  if (p.value !== undefined) { patch.value = p.value; notes.push(`Value: ${p.value ?? '—'}`); }
  if (p.lostReason !== undefined) patch.lost_reason = s(p.lostReason, 300) || null;
  if (p.notes !== undefined) patch.notes = s(p.notes, 4000) || null;
  for (const k of ['name', 'company', 'city', 'state', 'requirement', 'segment', 'campaign', 'source'] as const) if (p[k] !== undefined) patch[k] = s(p[k], 300) || null;
  if (p.phone !== undefined) patch.phone = cleanPhone(p.phone) || null;
  if (p.email !== undefined) patch.email = s(p.email, 160).toLowerCase() || null;
  if (p.logCall) {
    patch.last_contacted = new Date().toISOString();
    if (old.stage === 'New' && !patch.stage) { patch.stage = 'Contacted'; notes.push('Stage: New → Contacted'); }
    if (p.nextFollowup === undefined && !p.stage) patch.next_followup = isoDay(NEXT_DAYS[(patch.stage ?? old.stage) as string] ?? 2);
  }
  await update('swelect_leads', { id }, patch);
  if (p.logCall) await event(id, by, 'Follow-up', s(p.logCall, 1000));
  if (notes.length) await event(id, by, 'Updated', notes.join(' · '));
  return toLead({ ...old, ...patch });
}

export async function listLeads(): Promise<Lead[]> {
  return (await select('swelect_leads', { order: ['created_at', 'desc'], limit: 5000 })).map(toLead);
}
export async function leadHistory(id: string) {
  return (await select('swelect_lead_events', { eq: { lead_id: id }, order: ['at', 'desc'], limit: 200 })).map((e) => ({ at: e.at, by: e.by_user ?? '', kind: e.kind, text: e.text ?? '' }));
}

// ───────── numbers for the screen and the daily sales email ─────────
export function leadStats(leads: Lead[], now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const monthStart = today.slice(0, 8) + '01';
  const open = leads.filter((l) => OPEN_STAGES.includes(l.stage as never));
  const group = (key: 'campaign' | 'source' | 'owner') => {
    const m = new Map<string, Lead[]>();
    for (const l of leads) { const k = (l[key] || '—').trim() || '—'; m.set(k, [...(m.get(k) ?? []), l]); }
    return [...m.entries()].map(([name, xs]) => {
      const won = xs.filter((l) => l.stage === 'Won');
      const closed = xs.filter((l) => l.stage === 'Won' || l.stage === 'Lost').length;
      const days = won.map((l) => (Date.parse(l.updatedAt) - Date.parse(l.createdAt)) / 86400_000);
      return {
        name, leads: xs.length, open: xs.filter((l) => OPEN_STAGES.includes(l.stage as never)).length, won: won.length, lost: xs.filter((l) => l.stage === 'Lost').length,
        conversion: xs.length ? Math.round((won.length / xs.length) * 1000) / 10 : 0, winRate: closed ? Math.round((won.length / closed) * 1000) / 10 : null,
        wonValue: won.reduce((s, l) => s + (l.value ?? 0), 0), avgDaysToWin: days.length ? Math.round(days.reduce((a, b) => a + b, 0) / days.length) : null,
        overdue: xs.filter((l) => OPEN_STAGES.includes(l.stage as never) && l.nextFollowup && l.nextFollowup < today).length,
      };
    }).sort((a, b) => b.leads - a.leads);
  };
  const reached = (i: number) => leads.filter((l) => l.stage !== 'Lost' ? STAGES.indexOf(l.stage as Stage) >= i : false).length;
  return {
    total: leads.length,
    newToday: leads.filter((l) => l.createdAt.slice(0, 10) === today).length,
    dueToday: open.filter((l) => l.nextFollowup === today).length,
    overdue: open.filter((l) => l.nextFollowup && l.nextFollowup < today).length,
    noFollowup: open.filter((l) => !l.nextFollowup).length,
    open: open.length,
    wonThisMonth: leads.filter((l) => l.stage === 'Won' && l.updatedAt.slice(0, 10) >= monthStart).length,
    conversion: leads.length ? Math.round((leads.filter((l) => l.stage === 'Won').length / leads.length) * 1000) / 10 : 0,
    pipelineValue: open.reduce((s, l) => s + (l.value ?? 0), 0),
    funnel: STAGES.filter((st) => st !== 'Lost').map((st, i) => ({ stage: st, count: reached(i) })),
    byStage: STAGES.map((st) => ({ stage: st, count: leads.filter((l) => l.stage === st).length })),
    byCampaign: group('campaign'), bySource: group('source'), byOwner: group('owner'),
  };
}

// ───────── turning form/ads payloads into leads ─────────
const FIELD_ALIASES: Record<keyof LeadInput, string[]> = {
  name: ['name', 'full_name', 'fullname', 'customer_name', 'contact_name', 'your_name', 'first_name'],
  phone: ['phone', 'phone_number', 'mobile', 'mobile_number', 'contact_number', 'whatsapp', 'tel'],
  email: ['email', 'email_address', 'e-mail', 'mail'],
  company: ['company', 'company_name', 'organisation', 'organization', 'business_name', 'firm'],
  city: ['city', 'location', 'town'],
  state: ['state', 'region', 'province'],
  requirement: ['requirement', 'capacity', 'capacity_kw', 'system_size', 'message', 'comments', 'enquiry', 'inquiry', 'monthly_bill', 'electricity_bill', 'what_is_your_requirement'],
  segment: ['segment', 'customer_type', 'type', 'category', 'property_type'],
  source: ['source', 'utm_source', 'platform', 'channel'],
  campaign: ['campaign', 'campaign_name', 'utm_campaign', 'ad_name', 'form_name'],
  owner: ['owner', 'assigned_to', 'salesperson'],
  value: ['value', 'deal_value', 'amount', 'budget'],
  notes: ['notes', 'remarks', 'note'],
  externalId: ['lead_id', 'leadgen_id', 'external_id'],
  stage: ['stage', 'status'],
  nextFollowup: ['next_followup', 'follow_up_date', 'followup_date'],
};
const norm = (k: string) => k.toLowerCase().trim().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '');

/** Map any flat object (website form, Zapier, Excel row) to lead fields by common column names. */
export function mapFields(obj: Record<string, unknown>): LeadInput {
  const flat = new Map(Object.entries(obj).map(([k, v]) => [norm(k), v]));
  const out: LeadInput = {};
  for (const [field, names] of Object.entries(FIELD_ALIASES) as [keyof LeadInput, string[]][]) {
    for (const n of names) { const v = flat.get(norm(n)); if (v != null && String(v).trim() !== '') { out[field] = v; break; } }
  }
  if (!out.name) { const fn = flat.get('first_name'); const ln = flat.get('last_name'); if (fn || ln) out.name = `${fn ?? ''} ${ln ?? ''}`.trim(); }
  return out;
}

/** Google Ads lead form webhook: { lead_id, campaign_id, google_key, user_column_data: [{ column_id, string_value }] } */
export function fromGoogleAds(b: Record<string, unknown>): LeadInput {
  const cols = (b.user_column_data as { column_id?: string; column_name?: string; string_value?: string }[] | undefined) ?? [];
  const get = (...ids: string[]) => cols.find((c) => ids.includes(String(c.column_id ?? '').toUpperCase()))?.string_value;
  const fields: Record<string, unknown> = {};
  for (const c of cols) if (c.column_name) fields[c.column_name] = c.string_value;
  const extra = mapFields(fields);
  return {
    ...extra,
    name: get('FULL_NAME') ?? ([get('FIRST_NAME'), get('LAST_NAME')].filter(Boolean).join(' ') || extra.name),
    phone: get('PHONE_NUMBER') ?? extra.phone, email: get('EMAIL') ?? extra.email, company: get('COMPANY_NAME') ?? extra.company,
    city: get('CITY') ?? extra.city, state: get('REGION') ?? extra.state, source: 'Google Ads',
    campaign: String(b.campaign_name ?? (b.campaign_id ? `Google Ads ${b.campaign_id}` : extra.campaign ?? '')), externalId: b.lead_id ? `gads:${b.lead_id}` : undefined,
  };
}

/** Meta Lead Ads lead (fetched from the Graph API): { id, field_data: [{ name, values: [] }], campaign_name, ad_name, form_id } */
export function fromMetaLead(l: Record<string, unknown>): LeadInput {
  const fields: Record<string, unknown> = {};
  for (const f of (l.field_data as { name: string; values: string[] }[] | undefined) ?? []) fields[f.name] = f.values?.join(', ');
  const m = mapFields(fields);
  return { ...m, source: String(l.platform ?? '').toLowerCase() === 'ig' ? 'Instagram Lead Ads' : 'Facebook Lead Ads', campaign: String(l.campaign_name ?? l.ad_name ?? m.campaign ?? ''), externalId: `meta:${l.id}` };
}
