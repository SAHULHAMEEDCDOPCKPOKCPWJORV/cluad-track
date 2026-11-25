import { body, handler, ok, requireUser } from '@/server/auth';
import { runDaily } from '@/server/automation';

export const maxDuration = 300;

/** Admin: run the daily job now (optionally without sending emails). */
export const POST = handler(async (req: Request) => {
  await requireUser({ admin: true });
  const b = await body<{ sendEmails?: boolean }>(req);
  return ok(await runDaily({ sendEmails: !!b.sendEmails }));
});
