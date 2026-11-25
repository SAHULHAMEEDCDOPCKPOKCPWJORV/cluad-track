import { handler, ok } from '@/server/auth';

/** Public sign-in settings. The Google client ID is public by design (it is shown to every browser). */
export const GET = handler(async () => ok({ googleClientId: process.env.GOOGLE_CLIENT_ID || null }));
