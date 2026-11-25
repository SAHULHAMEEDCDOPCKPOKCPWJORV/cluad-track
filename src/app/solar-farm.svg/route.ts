// The background now uses the uploaded solar park photo; keep this old address working.
export function GET() {
  return new Response(null, { status: 308, headers: { location: '/solar-farm.jpg' } });
}
