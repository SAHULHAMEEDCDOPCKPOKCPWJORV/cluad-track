import bcrypt from 'bcryptjs';
import { randomBytes, randomUUID } from 'node:crypto';
import { CREDIT, isOwner, USER_DEPARTMENTS } from '@/lib/types';
import { audit, body, handler, ok, requireUser } from '@/server/auth';
import { getStore, HttpError } from '@/server/store';

const tempPassword = () => `Sw-${randomBytes(6).toString('base64url')}9`;

export const GET = handler(async () => {
  await requireUser({ module: 'users' });
  return ok({ users: await getStore().listUsers() });
});

export const POST = handler(async (req: Request) => {
  const u = await requireUser({ admin: true });
  const b = await body<Record<string, unknown>>(req);
  const email = String(b.email ?? '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'Valid email required');
  const department = String(b.department ?? '');
  if (!(USER_DEPARTMENTS as readonly string[]).includes(department)) throw new HttpError(400, 'Unknown department');
  const store = getStore();
  if (await store.getUserByEmail(email)) throw new HttpError(409, 'A user with this email already exists');
  const pw = tempPassword();
  const user = {
    id: randomUUID(), email, department, name: String(b.name ?? email).slice(0, 120),
    role: ['Admin', 'Department Lead', 'Viewer'].includes(String(b.role)) ? String(b.role) : 'Department Lead',
    isActive: true, canEdit: b.role !== 'Viewer', canExport: true, canApprove: b.role === 'Admin', mustChangePassword: true,
  };
  await store.createUser(user, await bcrypt.hash(pw, 10));
  await store.addAudit([audit(u, { action: 'USER_CREATED', projectId: 'GLOBAL', newValue: `${email} (${department}, ${user.role})` })]);
  return ok({ user, temporaryPassword: pw }, 201);
});

export const PATCH = handler(async (req: Request) => {
  const u = await requireUser({ admin: true });
  const b = await body<Record<string, unknown>>(req);
  const id = String(b.id ?? '');
  const store = getStore();
  const target = await store.getUser(id);
  if (!target) throw new HttpError(404, 'User not found');
  if (isOwner(target)) throw new HttpError(403, CREDIT); // the owner account cannot be changed
  const patch: Record<string, unknown> = {};
  for (const k of ['isActive', 'canEdit', 'canExport', 'canApprove'] as const) if (typeof b[k] === 'boolean') patch[k] = b[k];
  if (typeof b.role === 'string' && ['Admin', 'Department Lead', 'Viewer'].includes(b.role)) patch.role = b.role;
  if (typeof b.name === 'string') patch.name = b.name.slice(0, 120);
  if ((id === u.id || isOwner(target)) && (patch.isActive === false || patch.canEdit === false || (patch.role && patch.role !== 'Admin'))) throw new HttpError(400, 'You cannot deactivate or demote yourself');
  let temporaryPassword: string | undefined;
  if (b.resetPassword === true) {
    temporaryPassword = tempPassword();
    patch.passwordHash = await bcrypt.hash(temporaryPassword, 10);
    patch.mustChangePassword = true;
  }
  await store.updateUser(id, patch);
  await store.addAudit([audit(u, { action: b.resetPassword ? 'PASSWORD_RESET' : 'USER_UPDATED', projectId: 'GLOBAL', newValue: `${target.email}: ${Object.keys(patch).filter((k) => k !== 'passwordHash').join(', ')}` })]);
  return ok({ ok: true, temporaryPassword });
});
