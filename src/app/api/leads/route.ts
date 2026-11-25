import { body, handler, ok, requireUser } from '@/server/auth';
import { createLead, leadHistory, leadStats, listLeads, mapFields, STAGES, updateLead, type LeadInput, type LeadPatch } from '@/server/leads';
import { getSalesTeam } from '@/server/config';
import { HttpError } from '@/server/store';

export const GET = handler(async (req: Request) => {
  await requireUser({ module: 'leads' });
  const history = new URL(req.url).searchParams.get('history');
  if (history) return ok({ history: await leadHistory(history) });
  const leads = await listLeads();
  const team = (await getSalesTeam()).filter((p) => p.active).map((p) => p.name);
  return ok({ leads, stats: leadStats(leads), stages: STAGES, team });
});

/** Add one lead, or import many (from Excel). Duplicates (same phone/email) are merged automatically. */
export const POST = handler(async (req: Request) => {
  const u = await requireUser({ edit: true, module: 'leads' });
  const b = await body<{ lead?: LeadInput; rows?: Record<string, unknown>[] }>(req);
  if (Array.isArray(b.rows)) {
    if (b.rows.length > 3000) throw new HttpError(400, 'Import up to 3000 rows at a time');
    let added = 0, merged = 0;
    const errors: string[] = [];
    for (const [i, r] of b.rows.entries()) {
      try {
        const res = await createLead(mapFields(r), u.email, 'Excel import');
        if (res.duplicate) merged++; else added++;
      } catch (e) { if (errors.length < 20) errors.push(`Row ${i + 2}: ${(e as Error).message}`); }
    }
    return ok({ added, merged, errors });
  }
  if (!b.lead) throw new HttpError(400, 'lead or rows required');
  return ok(await createLead(b.lead, u.email, 'Added in app'), 201);
});

export const PATCH = handler(async (req: Request) => {
  const u = await requireUser({ edit: true, module: 'leads' });
  const b = await body<LeadPatch & { id?: string }>(req);
  if (!b.id) throw new HttpError(400, 'id required');
  const { id, ...patch } = b;
  return ok({ lead: await updateLead(id, patch, u.email) });
});
