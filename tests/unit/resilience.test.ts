// Unit tests for the circuit breaker, retry, timeout and cache. Run with: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CircuitBreaker, resilientFetch, TtlCache } from '../../src/server/resilience';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('circuit breaker opens after 5 failures, fails fast, half-opens, closes on success', async () => {
  const b = new CircuitBreaker('DB', 5, 200);
  for (let i = 0; i < 5; i++) b.failure();
  assert.throws(() => b.before(), (e: { status?: number }) => e.status === 503);
  await wait(250);
  assert.equal(b.status.state, 'half-open');
  b.success();
  assert.equal(b.status.state, 'closed');
});

test('a read is retried once after 503', async () => {
  let calls = 0;
  const f = resilientFetch('T1', { fetchImpl: (async () => new Response('', { status: ++calls === 1 ? 503 : 200 })) as typeof fetch });
  assert.equal((await f('http://x')).status, 200);
  assert.equal(calls, 2);
});

test('a write is never retried (no double saves)', async () => {
  let calls = 0;
  const f = resilientFetch('T2', { fetchImpl: (async () => { calls++; return new Response('', { status: 503 }); }) as typeof fetch });
  await f('http://x', { method: 'POST' });
  assert.equal(calls, 1);
});

test('a hung request times out with 504', async () => {
  const hang = ((_: unknown, init?: RequestInit) => new Promise<Response>((_r, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('abort'))))) as typeof fetch;
  const f = resilientFetch('T3', { timeoutMs: 100, fetchImpl: hang });
  await assert.rejects(f('http://x', { method: 'POST' }), (e: { status?: number }) => e.status === 504);
});

test('cache keeps values for its time limit only', async () => {
  const c = new TtlCache<number>(100, 2);
  c.set('a', 1);
  assert.equal(c.get('a'), 1);
  await wait(120);
  assert.equal(c.get('a'), undefined);
});
