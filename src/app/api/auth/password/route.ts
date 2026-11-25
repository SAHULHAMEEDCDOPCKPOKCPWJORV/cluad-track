import bcrypt from 'bcryptjs';
import { audit, body, handler, ok, requireUser } from '@/server/auth';
import { getStore, HttpError } from '@/server/store';
import { CREDIT, isOwner } from '@/lib/types';

export const POST = handler(async (req: Request) => {
  const u = await requireUser();
  if (isOwner(u)) throw new HttpError(403, CREDIT); // the owner's password is fixed
  const { currentPassword, newPassword } = await body<{ currentPassword?: string; newPassword?: string }>(req);
  const np = String(newPassword ?? '');
  if (np.length < 8 || !/[A-Za-z]/.test(np) || !/\d/.test(np)) throw new HttpError(400, 'New password needs at least 8 characters with letters and numbers');
  const store = getStore();
  const rec = await store.getUser(u.id);
  if (!rec?.passwordHash || !(await bcrypt.compare(String(currentPassword ?? ''), rec.passwordHash))) throw new HttpError(400, 'Current password is incorrect');
  await store.updateUser(u.id, { passwordHash: await bcrypt.hash(np, 10), mustChangePassword: false });
  await store.addAudit([audit(u, { action: 'PASSWORD_CHANGED', projectId: 'GLOBAL' })]);
  return ok({ ok: true });
});
