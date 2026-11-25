import { currentUser, handler, ok } from '@/server/auth';
import { getStore } from '@/server/store';

export const GET = handler(async () => {
  const user = await currentUser();
  return ok({ user, store: getStore().kind });
});
