/** @type {import('next').NextConfig} */
const security = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
];

// Every deployment gets its own id. Open apps compare theirs with the server's to know a newer version is live.
const BUILD_ID = process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_GIT_COMMIT_SHA || `local-${Date.now()}`;

const nextConfig = {
  env: { NEXT_PUBLIC_BUILD_ID: BUILD_ID },
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  // Docker / self-hosting builds a small standalone server (set BUILD_STANDALONE=1). Vercel ignores this.
  output: process.env.BUILD_STANDALONE ? 'standalone' : undefined,
  async headers() {
    return [
      { source: '/:path*', headers: security },
      // Logos and the login photo rarely change: let browsers and the CDN keep them for a week.
      { source: '/:file(swelect-logo.png|swelect-mark.png|solar-farm.jpg)', headers: [{ key: 'Cache-Control', value: 'public, max-age=604800, stale-while-revalidate=86400' }] },
      { source: '/solar-farm.svg', headers: [{ key: 'Cache-Control', value: 'public, max-age=604800, stale-while-revalidate=86400' }] },
    ];
  },
};
export default nextConfig;
