import { isValidIso } from '@/lib/calendar';
import { audit, body, handler, ok, requireUser } from '@/server/auth';
import { getStore, HttpError } from '@/server/store';

export const GET = handler(async () => {
  await requireUser();
  return ok({ holidays: await getStore().listHolidays() });
});

export const POST = handler(async (req: Request) => {
  const u = await requireUser({ admin: true });
  const b = await body<{ date?: string; name?: string; type?: string }>(req);
  if (!isValidIso(b.date)) throw new HttpError(400, 'Date must be YYYY-MM-DD');
  const name = String(b.name ?? '').trim().slice(0, 120);
  if (!name) throw new HttpError(400, 'Holiday name is required');
  const h = { date: b.date, name, type: String(b.type ?? 'Gazetted').slice(0, 40) };
  const store = getStore();
  await store.upsertHolidays([h]);
  await store.addAudit([audit(u, { action: 'HOLIDAY_ADDED', projectId: 'GLOBAL', newValue: `${h.date} ${h.name}` })]);
  return ok({ holiday: h }, 201);
});

export const DELETE = handler(async (req: Request) => {
  const u = await requireUser({ admin: true });
  const date = new URL(req.url).searchParams.get('date');
  if (!isValidIso(date)) throw new HttpError(400, 'date query parameter required');
  const store = getStore();
  await store.deleteHoliday(date);
  await store.addAudit([audit(u, { action: 'HOLIDAY_REMOVED', projectId: 'GLOBAL', oldValue: date })]);
  return ok({ ok: true });
});
