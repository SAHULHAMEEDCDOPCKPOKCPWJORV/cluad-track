// API gateway: every /api request passes through here first (Next.js 16 "proxy", formerly middleware).
//  - request ID on every request/response (for tracing in logs),
//  - rate limiting per client IP, with stricter limits for sign-in and for writes,
//  - request size limit, method allow-list,
//  - standard RateLimit headers and 429 + Retry-After when a limit is hit.
// Limits are counted per server instance. On Vercel, add the firewall rule in deploy/README-performance.md for a global limit.
import { NextResponse, type NextRequest } from 'next/server';

type Rule = { name: string; limit: number; windowMs: number };
const RULES = {
  auth: { name: 'auth', limit: 10, windowMs: 60_000 }, // sign-in / password: 10 per minute
  write: { name: 'write', limit: 90, windowMs: 60_000 }, // saves, imports, deletes: 90 per minute
  read: { name: 'read', limit: 600, windowMs: 60_000 }, // page data: 600 per minute
} satisfies Record<string, Rule>;
const MAX_BODY = 8 * 1024 * 1024; // 8 MB (an Excel import of thousands of rows fits easily)
const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

const g = globalThis as unknown as { __swRate?: Map<string, number[]> };
const hits: Map<string, number[]> = (g.__swRate ??= new Map<string, number[]>());

/** Sliding-window counter. Returns how many requests are left, or -1 and the wait time when over the limit. */
function take(key: string, rule: Rule, now = Date.now()) {
  const from = now - rule.windowMs;
  const list = (hits.get(key) ?? []).filter((t) => t > from);
  if (list.length >= rule.limit) {
    hits.set(key, list);
    return { left: -1, resetMs: list[0] + rule.windowMs - now };
  }
  list.push(now);
  hits.set(key, list);
  if (hits.size > 20_000) for (const [k, v] of hits) if (!v.length || v[v.length - 1] < from) hits.delete(k); // keep memory bounded
  return { left: rule.limit - list.length, resetMs: list[0] + rule.windowMs - now };
}

function clientIp(req: NextRequest) {
  return (req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for')?.split(',')[0] || 'local').trim();
}

function ruleFor(req: NextRequest): Rule {
  const p = req.nextUrl.pathname;
  if (p === '/api/auth/login' || p === '/api/auth/google' || p === '/api/auth/password') return req.method === 'GET' ? RULES.read : RULES.auth;
  // project passwords: opening or changing one gets the same strict limit as signing in
  if (/^\/api\/projects\/[^/]+\/(unlock|password)$/.test(p)) return RULES.auth;
  return req.method === 'GET' || req.method === 'HEAD' ? RULES.read : RULES.write;
}

export function proxy(req: NextRequest) {
  const id = req.headers.get('x-request-id') || crypto.randomUUID();
  const json = (status: number, error: string, extra: Record<string, string> = {}) =>
    NextResponse.json({ error }, { status, headers: { 'x-request-id': id, 'Cache-Control': 'no-store', ...extra } });

  if (!METHODS.has(req.method)) return json(405, 'Method not allowed');
  const len = Number(req.headers.get('content-length') || 0);
  if (len > MAX_BODY) return json(413, 'Request is too large (limit 8 MB).');

  if (req.nextUrl.pathname !== '/api/health') {
    const rule = ruleFor(req);
    const r = take(`${rule.name}:${clientIp(req)}`, rule);
    const rate = { 'RateLimit-Limit': String(rule.limit), 'RateLimit-Remaining': String(Math.max(0, r.left)), 'RateLimit-Reset': String(Math.ceil(r.resetMs / 1000)) };
    if (r.left < 0) return json(429, 'Too many requests. Please wait a moment and try again.', { ...rate, 'Retry-After': String(Math.max(1, Math.ceil(r.resetMs / 1000))) });
    const headers = new Headers(req.headers);
    headers.set('x-request-id', id);
    const res = NextResponse.next({ request: { headers } });
    res.headers.set('x-request-id', id);
    for (const [k, v] of Object.entries(rate)) res.headers.set(k, v);
    return res;
  }
  const res = NextResponse.next();
  res.headers.set('x-request-id', id);
  return res;
}

export const config = { matcher: ['/api/:path*'] };
