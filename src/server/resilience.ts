// Resilience helpers for calls to Supabase and other services:
//  - timeout on every request,
//  - one retry for safe (read) requests that hit a network error or a 502/503/504,
//  - a circuit breaker: after repeated failures the app fails fast for a short time instead of
//    piling up slow requests, then lets one trial request through to see if the service is back.
// Plus a tiny time-limited cache for data that rarely changes.

import { HttpError } from './store';

type BreakerState = 'closed' | 'open' | 'half-open';

export class CircuitBreaker {
  private state: BreakerState = 'closed';
  private failures = 0;
  private openedAt = 0;
  constructor(
    readonly name: string,
    private readonly threshold = 5, // consecutive failures before opening
    private readonly coolDownMs = 15_000, // how long to fail fast before a trial request
  ) {}
  get status() {
    return { name: this.name, state: this.currentState(), failures: this.failures };
  }
  private currentState(): BreakerState {
    if (this.state === 'open' && Date.now() - this.openedAt >= this.coolDownMs) this.state = 'half-open';
    return this.state;
  }
  /** Throws immediately while the circuit is open. */
  before() {
    if (this.currentState() === 'open') throw new HttpError(503, `${this.name} is temporarily unavailable. Please try again in a few seconds.`);
  }
  success() {
    this.failures = 0;
    this.state = 'closed';
  }
  failure() {
    this.failures++;
    if (this.state === 'half-open' || this.failures >= this.threshold) {
      this.state = 'open';
      this.openedAt = Date.now();
    }
  }
}

const g = globalThis as unknown as { __swBreakers?: Map<string, CircuitBreaker> };
export function breaker(name: string) {
  g.__swBreakers ??= new Map();
  let b = g.__swBreakers.get(name);
  if (!b) g.__swBreakers.set(name, (b = new CircuitBreaker(name)));
  return b;
}
export const breakerStatus = () => [...(g.__swBreakers?.values() ?? [])].map((b) => b.status);

const RETRYABLE = new Set([502, 503, 504]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** fetch() with timeout, one retry for reads, and a circuit breaker. Drop-in for the Supabase client. */
export function resilientFetch(name: string, opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}): typeof fetch {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const base = opts.fetchImpl ?? fetch;
  return async (input, init) => {
    const b = breaker(name);
    b.before();
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const safe = method === 'GET' || method === 'HEAD';
    for (let attempt = 0; ; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const outer = init?.signal;
      if (outer) outer.addEventListener('abort', () => ctrl.abort(), { once: true });
      try {
        const res = await base(input, { ...init, signal: ctrl.signal });
        if (RETRYABLE.has(res.status)) {
          if (safe && attempt === 0) { await sleep(250); continue; }
          b.failure();
        } else b.success();
        return res;
      } catch (e) {
        if (outer?.aborted) throw e; // caller cancelled: not a service failure
        if (safe && attempt === 0) { await sleep(250); continue; }
        b.failure();
        const timedOut = ctrl.signal.aborted;
        throw new HttpError(timedOut ? 504 : 502, `${name} ${timedOut ? 'did not answer in time' : 'could not be reached'}. Please try again.`);
      } finally {
        clearTimeout(timer);
      }
    }
  };
}

/** Small per-server-instance cache with a time limit. */
export class TtlCache<V> {
  private m = new Map<string, { v: V; exp: number }>();
  constructor(private readonly ttlMs: number, private readonly max = 500) {}
  get(k: string): V | undefined {
    const e = this.m.get(k);
    if (!e) return undefined;
    if (e.exp < Date.now()) { this.m.delete(k); return undefined; }
    return e.v;
  }
  set(k: string, v: V) {
    if (this.m.size >= this.max) this.m.delete(this.m.keys().next().value as string);
    this.m.set(k, { v, exp: Date.now() + this.ttlMs });
  }
  delete(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}
