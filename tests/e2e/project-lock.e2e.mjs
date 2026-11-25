// End-to-end test of per-project passwords against a local demo-mode server.
const BASE = process.env.TEST_BASE_URL || 'http://localhost:3111';
// End-to-end tests for project passwords. Run with: npm run test:e2e (starts a demo server with throwaway data).
let ipN = 0; const RUN = Math.floor(Math.random() * 250);
const results = [];
const check = (name, cond, extra = '') => { results.push([cond ? 'PASS' : 'FAIL', name, cond ? '' : extra]); };

class Client {
  constructor() { this.jar = new Map(); this.ip = `10.${RUN}.0.${++ipN}`; }
  async call(method, path, json) {
    const headers = { 'Content-Type': 'application/json', 'x-real-ip': this.ip, Cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ') };
    const r = await fetch(BASE + path, { method, headers, body: json === undefined ? undefined : JSON.stringify(json) });
    for (const c of r.headers.getSetCookie?.() ?? []) { const [kv] = c.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i), v = kv.slice(i + 1); if (v === '' || /max-age=0/i.test(c)) this.jar.delete(k); else this.jar.set(k, v); }
    const data = await r.json().catch(() => ({}));
    return { status: r.status, data };
  }
  login(email) { return this.call('POST', '/api/auth/login', { email, password: 'Demo-pass1' }); }
}

const admin = new Client();
check('admin login', (await admin.login('plan@swelect.com')).status === 200);

// 1. create a project WITH a password and one WITHOUT
const a = await admin.call('POST', '/api/projects', { name: 'Viruksha', capacityMw: 5, plannedStartDate: '2026-12-01', projectPassword: 'viruksha@12' });
check('create project with password -> 201', a.status === 201, JSON.stringify(a.data));
const A = a.data.project?.id;
check('created project reports locked + unlocked for its creator', a.data.project?.locked === true && a.data.project?.unlocked === true);
check('creator can open their new project', (await admin.call('GET', `/api/projects/${A}`)).status === 200);
const noPw = await admin.call('POST', '/api/projects', { name: 'NoPw', capacityMw: 2, plannedStartDate: '2026-12-01' });
check('create project WITHOUT password -> 400 and not created', noPw.status === 400 && !(await admin.call('GET', '/api/projects')).data.projects.some((p) => p.name === 'NoPw'));
const b = await admin.call('POST', '/api/projects', { name: 'Second Project', capacityMw: 2, plannedStartDate: '2026-12-01', projectPassword: 'second-pw' });
const B = b.data.project?.id;
check('create second project -> locked', b.status === 201 && b.data.project?.locked === true);
const tooShort = await admin.call('POST', '/api/projects', { name: 'Bad', capacityMw: 1, plannedStartDate: '2026-12-01', projectPassword: 'abc' });
check('too-short password rejected (400) and project NOT created', tooShort.status === 400 && !(await admin.call('GET', '/api/projects')).data.projects.some((p) => p.name === 'Bad'));


// 3. a fresh session (no unlock cookie) is locked out of everything for project A
const u = new Client(); await u.login('plan@swelect.com');
const list = await u.call('GET', '/api/projects');
const pa = list.data.projects.find((p) => p.id === A);
check('list shows project A as locked + not unlocked', pa?.locked === true && pa?.unlocked === false);
check('list hides description of locked project', pa?.description === '');
check('list hides progress summary of locked project', !list.data.summaries.some((s) => s.projectId === A));
check('GET project A -> 423', (await u.call('GET', `/api/projects/${A}`)).status === 423);
check('PATCH project A -> 423', (await u.call('PATCH', `/api/projects/${A}`, { name: 'hacked' })).status === 423);
check('PUT activities A -> 423', (await u.call('PUT', `/api/projects/${A}/activities`, { activities: [] })).status === 423);
check('DELETE without declaration -> 400', (await u.call('DELETE', `/api/projects/${A}`, { password: 'viruksha@12' })).status === 400);
check('DELETE with wrong password -> 403', (await u.call('DELETE', `/api/projects/${A}`, { password: 'nope', declaration: true })).status === 403);
check('project still exists after refused deletes', (await admin.call('GET', '/api/projects')).data.projects.some((p) => p.id === A));
check('audit for project A -> 423', (await u.call('GET', `/api/audit?projectId=${A}`)).status === 423);
const g = await u.call('GET', '/api/audit?limit=5000');
check('global audit hides project A rows', g.status === 200 && !g.data.logs.some((l) => l.projectId === A));
const live = await u.call('GET', `/api/live?since=${new Date(Date.now() - 3600_000).toISOString()}`);
check('live feed hides project A changes', live.status === 200 && !live.data.changes.some((c) => c.projectId === A));

// 4. unlock
check('wrong password -> 403', (await u.call('POST', `/api/projects/${A}/unlock`, { password: 'nope' })).status === 403);
check('empty password -> 403', (await u.call('POST', `/api/projects/${A}/unlock`, { password: '' })).status === 403);
check('correct password -> 200', (await u.call('POST', `/api/projects/${A}/unlock`, { password: 'viruksha@12' })).status === 200);
const opened = await u.call('GET', `/api/projects/${A}`);
check('after unlock: project + activities load', opened.status === 200 && opened.data.activities?.length > 50 && opened.data.project?.unlocked === true);
check('after unlock: audit readable', (await u.call('GET', `/api/audit?projectId=${A}`)).status === 200);
// forged cookie must not work
const f = new Client(); await f.login('plan@swelect.com'); f.jar.set('swelect_unlock', u.jar.get('swelect_unlock').replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')));
check('tampered unlock cookie is rejected', (await f.call('GET', `/api/projects/${A}`)).status === 423);
// another account cannot reuse the cookie
const other = new Client(); await other.login('land@swelect.com'); other.jar.set('swelect_unlock', u.jar.get('swelect_unlock'));
check('unlock cookie of another account is rejected', (await other.call('GET', `/api/projects/${A}`)).status === 423);
// relock
check('lock again -> 200', (await u.call('DELETE', `/api/projects/${A}/unlock`)).status === 200);
check('after relock project is locked again', (await u.call('GET', `/api/projects/${A}`)).status === 423);

// 6. change / remove password. Non-admin department lead needs the current password.
const lead = new Client(); await lead.login('land@swelect.com');
check('lead: change without current password -> 403', (await lead.call('PUT', `/api/projects/${A}/password`, { newPassword: 'another1' })).status === 403);
check('lead: change with WRONG current password -> 403', (await lead.call('PUT', `/api/projects/${A}/password`, { newPassword: 'another1', currentPassword: 'x' })).status === 403);
check('lead: change with current password -> 200', (await lead.call('PUT', `/api/projects/${A}/password`, { newPassword: 'another1', currentPassword: 'viruksha@12' })).status === 200);
check('password change locks out sessions unlocked before (old unlock cookie)', (await admin.call('GET', `/api/projects/${A}`)).status === 423);
check('old password no longer works', (await u.call('POST', `/api/projects/${A}/unlock`, { password: 'viruksha@12' })).status === 403);
check('new password works', (await u.call('POST', `/api/projects/${A}/unlock`, { password: 'another1' })).status === 200);
check('too-short new password rejected', (await lead.call('PUT', `/api/projects/${A}/password`, { newPassword: 'abc', currentPassword: 'another1' })).status === 400);
// admin can reset a forgotten password
check('admin can reset without current password', (await admin.call('PUT', `/api/projects/${A}/password`, { newPassword: 'reset-by-admin' })).status === 200);

// set a password on an open project, then remove
check('B is locked for others', (await u.call('GET', `/api/projects/${B}`)).status === 423);
check('password cannot be removed, even by admin (400)', (await admin.call('PUT', `/api/projects/${B}/password`, { remove: true })).status === 400);
check('B still locked after refused removal', (await u.call('GET', `/api/projects/${B}`)).status === 423);

// 7. audit trail never contains the password itself
await admin.call('POST', `/api/projects/${A}/unlock`, { password: 'reset-by-admin' });
const au = await admin.call('GET', `/api/audit?projectId=${A}`);
const text = JSON.stringify(au.data);
check('audit has password events', /PROJECT_PASSWORD_(SET|CHANGED)/.test(text) && /PROJECT_UNLOCK/.test(text));
check('audit does not contain any password text', !/viruksha@12|another1|reset-by-admin|second-pw/.test(text));

// 8. delete cleans up
check('admin delete WITHOUT project password -> 403', (await admin.call('DELETE', `/api/projects/${A}`, { declaration: true })).status === 403);
check('admin deletes project A with password + declaration', (await admin.call('DELETE', `/api/projects/${A}`, { password: 'reset-by-admin', declaration: true })).status === 200);
const del = await admin.call('GET', `/api/audit?limit=5000`);
check('deletion is recorded with declaration', del.data.logs.some((l) => l.action === 'PROJECT_DELETED' && /declaration/.test(l.newValue ?? '')));
check('unknown project unlock -> 404', (await u.call('POST', `/api/projects/${A}/unlock`, { password: 'x' })).status === 404);


// 9. brute force limit: 5 wrong passwords in a row on one project from one account -> 5 minute wait (own project + account)
const c = await admin.call('POST', '/api/projects', { name: 'Brute Target', capacityMw: 1, plannedStartDate: '2026-12-01', projectPassword: 'correct-horse' });
const C = c.data.project?.id;
const bf = new Client(); await bf.login('eng@swelect.com');
let last = 0; for (let i = 0; i < 6; i++) last = (await bf.call('POST', `/api/projects/${C}/unlock`, { password: 'wrong' + i })).status;
check('repeated wrong passwords get locked out (429)', last === 429, String(last));
check('even the right password is refused during lockout', (await bf.call('POST', `/api/projects/${C}/unlock`, { password: 'correct-horse' })).status === 429);
const bf2 = new Client(); await bf2.login('trn@swelect.com');
check('a different account is not affected by that lockout', (await bf2.call('POST', `/api/projects/${C}/unlock`, { password: 'correct-horse' })).status === 200);

// 10. one project open at a time; '_all' locks everything
const one = new Client(); await one.login('comm@swelect.com');
const P1 = (await admin.call('POST', '/api/projects', { name: 'P1', capacityMw: 1, plannedStartDate: '2026-12-01', projectPassword: 'pass-one' })).data.project.id;
const P2 = (await admin.call('POST', '/api/projects', { name: 'P2', capacityMw: 1, plannedStartDate: '2026-12-01', projectPassword: 'pass-two' })).data.project.id;
check('creating P2 locks P1 for its creator (only the new project is open)', (await admin.call('GET', `/api/projects/${P1}`)).status === 423 && (await admin.call('GET', `/api/projects/${P2}`)).status === 200);
await one.call('POST', `/api/projects/${P1}/unlock`, { password: 'pass-one' });
check('P1 open after its password', (await one.call('GET', `/api/projects/${P1}`)).status === 200);
await one.call('POST', `/api/projects/${P2}/unlock`, { password: 'pass-two' });
check('opening P2 locks P1 again', (await one.call('GET', `/api/projects/${P1}`)).status === 423 && (await one.call('GET', `/api/projects/${P2}`)).status === 200);
check("lock '_all' -> 200", (await one.call('DELETE', '/api/projects/_all/unlock')).status === 200);
check("after '_all' nothing is open", (await one.call('GET', `/api/projects/${P2}`)).status === 423);
await one.call('POST', `/api/projects/${P2}/unlock`, { password: 'pass-two' });
check('changing the password of the open project keeps it open', (await one.call('PUT', `/api/projects/${P2}/password`, { newPassword: 'pass-two-b', currentPassword: 'pass-two' })).status === 200 && (await one.call('GET', `/api/projects/${P2}`)).status === 200);
check('changing another project password does not unlock it', (await admin.call('PUT', `/api/projects/${P1}/password`, { newPassword: 'pass-one-b' })).status === 200 && (await admin.call('GET', `/api/projects/${P1}`)).status === 423);

// 11. global limit per email works across different IP addresses (shared counter, not per server copy)
let lastStatus = 0;
for (let i = 0; i < 11; i++) { const c = new Client(); lastStatus = (await c.call('POST', '/api/auth/login', { email: 'nobody-' + RUN + '@swelect.com', password: 'wrong' })).status; }
check('11th sign-in for one email from 11 different IPs -> 429', lastStatus === 429, String(lastStatus));
const ok2 = new Client();
check('another email is not affected', (await ok2.login('site@swelect.com')).status === 200);
// 12. gateway basics
const big = await fetch(BASE + '/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-real-ip': '10.200.0.1', 'Content-Length': String(9 * 1024 * 1024) }, body: 'x'.repeat(9 * 1024 * 1024) }).catch(() => ({ status: 0 }));
check('request over 8 MB is refused (413)', big.status === 413, String(big.status));
const h = await fetch(BASE + '/api/auth/me', { headers: { 'x-real-ip': '10.200.0.2' } });
check('API responses carry request id + rate-limit headers + no-store', !!h.headers.get('x-request-id') && !!h.headers.get('ratelimit-limit') && /no-store/.test(h.headers.get('cache-control') ?? ''));
const ready = await fetch(BASE + '/api/health?ready=1');
check('readiness check (database reachable) -> 200', ready.status === 200);

for (const r of results) console.log(r.join('  '));
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
