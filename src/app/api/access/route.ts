import { accessOverrides, body, handler, ok, requireUser, saveAccessOverride, audit } from '@/server/auth';
import { getStore, HttpError } from '@/server/store';
import { defaultAccess, MODULES, type Level, type ModuleKey } from '@/lib/access';

/** Admin: every account with its current access, the defaults, and any admin settings. */
export const GET = handler(async () => {
  await requireUser({ admin: true });
  const [users, overrides] = await Promise.all([getStore().listUsers(), accessOverrides()]);
  return ok({ modules: MODULES, users: users.map((u) => ({ ...u, defaults: defaultAccess(u), override: overrides[u.id] ?? null })) });
});

/** Admin: set (or reset to default with access = null) what one account can use. */
export const PUT = handler(async (req: Request) => {
  const me = await requireUser({ admin: true });
  const b = await body<{ userId?: string; access?: Partial<Record<ModuleKey, Level>> | null }>(req);
  const target = b.userId ? await getStore().getUser(b.userId) : null;
  if (!target) throw new HttpError(404, 'User not found');
  if (target.role === 'Admin') throw new HttpError(400, 'Admins always have full access. Change the role in User Management first.');
  await saveAccessOverride(target.id, b.access ?? null);
  await getStore().addAudit([audit(me, { action: 'ACCESS_CHANGED', projectId: 'GLOBAL', newValue: `${target.email}: ${b.access ? MODULES.map((m) => `${m.label}=${b.access?.[m.key] ?? 'default'}`).join(', ') : 'reset to default'}` })]);
  const overrides = await accessOverrides();
  const users = await getStore().listUsers();
  return ok({ modules: MODULES, users: users.map((u) => ({ ...u, defaults: defaultAccess(u), override: overrides[u.id] ?? null })) });
});
