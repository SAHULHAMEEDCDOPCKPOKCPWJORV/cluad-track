import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/** GET /api/version -> the id of the deployment now serving the app. Open (installed) apps poll this to update themselves. */
export function GET() {
  return NextResponse.json({ build: process.env.NEXT_PUBLIC_BUILD_ID ?? 'dev' }, { headers: { 'Cache-Control': 'no-store' } });
}
