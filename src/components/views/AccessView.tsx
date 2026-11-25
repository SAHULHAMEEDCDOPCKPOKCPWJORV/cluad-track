'use client';
import { useEffect, useMemo, useState } from 'react';
import { UserCog, RotateCcw, Save, Search, Info } from 'lucide-react';
import { useApp } from '../AppShell';
import { Badge, Button, C, DEPT_COLORS, Input, Select, Spinner } from '../ui';
import { PageTitle } from '../mkt';
import { api, type AccessData, type AccessUser } from '@/lib/api';
import type { AccessMap, Level, ModuleKey } from '@/lib/access';

const LEVELS: { v: Level; label: string; short: string; cls: string }[] = [
  { v: 'none', label: 'No access', short: 'Off', cls: 'bg-dark-700 text-slate-300 border-dark-500' },
  { v: 'view', label: 'View only', short: 'View', cls: 'bg-sky-500/15 text-sky-300 border-sky-400/50' },
  { v: 'edit', label: 'Can edit', short: 'Edit', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/50' },
];

const PRESETS: { name: string; access: AccessMap }[] = [
  { name: 'Project team', access: { projects: 'edit', news: 'view', reputation: 'view', social: 'view', leads: 'none', users: 'view', audit: 'view' } },
  { name: 'Marketing', access: { projects: 'none', news: 'edit', reputation: 'edit', social: 'edit', leads: 'edit', users: 'view', audit: 'none' } },
  { name: 'Sales', access: { projects: 'none', news: 'view', reputation: 'view', social: 'view', leads: 'edit', users: 'view', audit: 'none' } },
  { name: 'Management (view everything)', access: { projects: 'view', news: 'view', reputation: 'view', social: 'view', leads: 'view', users: 'view', audit: 'view' } },
  { name: 'No access', access: { projects: 'none', news: 'none', reputation: 'none', social: 'none', leads: 'none', users: 'none', audit: 'none' } },
];

const current = (u: AccessUser): AccessMap => ({ ...u.defaults, ...(u.override ?? {}) }) as AccessMap;
const same = (a: AccessMap, b: AccessMap) => Object.keys(a).every((k) => a[k as ModuleKey] === b[k as ModuleKey]);

export default function AccessView() {
  const { user: me, toast } = useApp();
  const [data, setData] = useState<AccessData | null>(null);
  const [drafts, setDrafts] = useState<Record<string, AccessMap>>({});
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState('');

  useEffect(() => { api.access().then(setData).catch((e) => toast(e.message, 'err')); }, [toast]);

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (data?.users ?? [])
      .filter((u) => !t || `${u.name} ${u.email} ${u.department}`.toLowerCase().includes(t))
      .sort((a, b) => Number(b.role !== 'Admin') - Number(a.role !== 'Admin') || Number(b.isActive) - Number(a.isActive) || a.department.localeCompare(b.department));
  }, [data, q]);

  if (me.role !== 'Admin') return <p className="text-slate-400">Only an admin can manage access.</p>;
  if (!data) return <Spinner />;

  const valueOf = (u: AccessUser) => drafts[u.id] ?? current(u);
  const setDraft = (u: AccessUser, next: AccessMap) =>
    setDrafts((d) => { const c = { ...d }; if (same(next, current(u))) delete c[u.id]; else c[u.id] = next; return c; });
  const dirtyIds = Object.keys(drafts);

  const save = async (ids: string[]) => {
    setBusy(ids.length > 1 ? 'all' : ids[0]);
    try {
      let last: AccessData | null = null;
      for (const id of ids) {
        const u = data.users.find((x) => x.id === id)!;
        const next = drafts[id];
        // matching the defaults exactly = no special setting needed
        last = await api.saveAccess(id, same(next, u.defaults) ? null : next);
      }
      if (last) setData(last);
      setDrafts((d) => { const c = { ...d }; ids.forEach((i) => delete c[i]); return c; });
      toast(ids.length > 1 ? `Access saved for ${ids.length} accounts` : 'Access saved. It applies straight away.');
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setBusy('');
    }
  };
  const reset = async (u: AccessUser) => {
    setBusy(u.id);
    try {
      setData(await api.saveAccess(u.id, null));
      setDrafts((d) => { const c = { ...d }; delete c[u.id]; return c; });
      toast(`${u.name || u.email} is back to the standard access for ${u.department}`);
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="space-y-4">
      <PageTitle
        icon={<UserCog className="h-5 w-5" />}
        title="Access Control"
        subtitle="Choose what each account can open in the app. Changes apply immediately, even if the person is already signed in."
        right={dirtyIds.length > 0 && (
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setDrafts({})}>Discard</Button>
            <Button onClick={() => save(dirtyIds)} loading={busy === 'all'}><Save className="h-4 w-4" />Save {dirtyIds.length} change{dirtyIds.length > 1 ? 's' : ''}</Button>
          </div>
        )}
      />

      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-dark-700 bg-dark-850 px-4 py-3 text-sm text-slate-300">
        {LEVELS.map((l) => <span key={l.v} className="flex items-center gap-2"><span className={`rounded-md border px-2 py-0.5 text-xs font-semibold ${l.cls}`}>{l.short}</span>{l.label}</span>)}
        <span className="flex items-center gap-1.5 text-slate-400"><Info className="h-4 w-4" />Admins always have full access. Accounts set to read-only in User Management can only view.</span>
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a person or department" className="w-full pl-9" />
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-dark-700 bg-dark-850">
        <table className="w-full min-w-[1040px] text-sm">
          <thead>
            <tr className="border-b border-dark-700 text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="w-[280px] px-4 py-3">Account</th>
              {data.modules.map((m) => <th key={m.key} className="px-2 py-3 text-center" title={m.hint}>{m.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => {
              const admin = u.role === 'Admin';
              const v = valueOf(u);
              const dirty = !!drafts[u.id];
              return (
                <tr key={u.id} className={`border-b border-dark-800 last:border-0 ${!u.isActive ? 'opacity-50' : ''} ${dirty ? 'bg-emerald-500/5' : ''}`}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-white">{u.name || u.email.split('@')[0]}</span>
                      <Badge color={DEPT_COLORS[u.department] ?? C.slate}>{u.department}</Badge>
                      {admin && <Badge color={C.amber}>Admin</Badge>}
                      {!u.isActive && <Badge color={C.slate}>Disabled</Badge>}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {u.email}
                      {!admin && (u.override ? <span className="ml-2 text-solar-gold">· custom access</span> : <span className="ml-2">· standard for {u.department}</span>)}
                      {!admin && !u.canEdit && <span className="ml-2 text-sky-300">· read-only account</span>}
                    </div>
                    {!admin && (
                      <div className="mt-2 flex items-center gap-2">
                        <Select value="" onChange={(e) => { const p = PRESETS.find((x) => x.name === e.target.value); if (p) setDraft(u, { ...p.access }); }} className="!py-1 text-xs">
                          <option value="">Quick set…</option>
                          {PRESETS.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
                        </Select>
                        {dirty
                          ? <Button size="sm" onClick={() => save([u.id])} loading={busy === u.id}><Save className="h-3.5 w-3.5" />Save</Button>
                          : u.override && <Button size="sm" variant="ghost" title="Back to the standard access for this department" onClick={() => reset(u)} loading={busy === u.id}><RotateCcw className="h-3.5 w-3.5" />Reset</Button>}
                      </div>
                    )}
                  </td>
                  {data.modules.map((m) => (
                    <td key={m.key} className="px-2 py-3 text-center">
                      {admin ? <span className="text-xs font-semibold text-emerald-300">Full</span> : (
                        <div className="inline-flex overflow-hidden rounded-lg border border-dark-600" role="radiogroup" aria-label={`${m.label} access for ${u.email}`}>
                          {LEVELS.map((l) => {
                            const on = v[m.key] === l.v;
                            return (
                              <button
                                key={l.v}
                                role="radio"
                                aria-checked={on}
                                title={`${l.label}: ${m.hint}`}
                                onClick={() => setDraft(u, { ...v, [m.key]: l.v })}
                                className={`px-2 py-1 text-[11px] font-semibold transition ${on ? `border ${l.cls}` : 'text-slate-500 hover:bg-dark-800 hover:text-slate-200'}`}
                              >{l.short}</button>
                            );
                          })}
                        </div>
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={data.modules.length + 1} className="px-4 py-8 text-center text-slate-500">No accounts match “{q}”.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {data.modules.map((m) => (
          <div key={m.key} className="rounded-xl border border-dark-700 bg-dark-850 px-4 py-3">
            <div className="font-medium text-white">{m.label}</div>
            <div className="mt-0.5 text-xs text-slate-400">{m.hint}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
