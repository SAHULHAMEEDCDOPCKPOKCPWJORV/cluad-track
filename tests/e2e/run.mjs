// Starts the built app on throwaway demo data and runs the end-to-end tests against it.
// Usage: npm run build && npm run test:e2e
import { spawn } from 'node:child_process';

const PORT = process.env.TEST_PORT || '3456';
const BASE = `http://localhost:${PORT}`;
const env = { ...process.env, SWELECT_STORE: 'memory', SWELECT_TEST_ALL_USERS: '1', SESSION_SECRET: 'test-only-secret', DEMO_PASSWORD: 'Demo-pass1', PORT };
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', PORT], { env, stdio: ['ignore', 'pipe', 'inherit'] });
const stop = (code) => { server.kill('SIGTERM'); process.exit(code); };

for (let i = 0; ; i++) {
  try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* not up yet */ }
  if (i > 60) { console.error('Server did not start'); stop(1); }
  await new Promise((r) => setTimeout(r, 500));
}
const t = spawn(process.execPath, ['tests/e2e/project-lock.e2e.mjs'], { env: { ...process.env, TEST_BASE_URL: BASE }, stdio: 'inherit' });
t.on('exit', (code) => stop(code ?? 1));
