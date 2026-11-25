'use client';
import { useEffect, useMemo, useState } from 'react';
import { UserPlus, KeyRound, ShieldCheck, ShieldOff, Copy } from 'lucide-react';
import { useApp } from '../AppShell';
import { Card, Button, C, DEPT_COLORS, Badge, Modal, Field, Input, Select, Spinner } from '../ui';
import { VBars } from '../charts';
import { api } from '@/lib/api';
import type { AppUser, AuditLog } from '@/lib/types';
import { isOwner, USER_DEPARTMENTS, USER_DEPARTMENT_NAMES } from '@/lib/types';

export default function UsersView() {
  const { user, toast } = useApp();
  const [users, setUsers] = useState<AppUser[] | null>(null);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [newOpen, setNewOpen] = useState(false);
  const [secret, setSecret] = useState<{ email: string; pw: string } | null>(null);
  const isAdmin = user.role === 'Admin';

  const load = () => {
    api.users().then((r) => setUsers(r.users)).catch((e) => toast(e.message, 'err'));
    api.audit().then((r) => setLogs(r.logs)).catch(() => undefined);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, []);

  const activity = useMemo(() => {
    const m: Record<string, { edits: number; lastLogin: string | null; lastAction: string | null }> = {};
    for (const l of logs) {
      const k = l.userEmail ?? '';
      m[k] ??= { edits: 0, lastLogin: null, lastAction: null };
      if (l.action === 'LOGIN') m[k].lastLogin ??= l.timestamp;
      else {
        m[k].edits++;
        m[k].lastAction ??= l.timestamp;
      }
    }
    return m;
  }, [logs]);

  const patch = async (u: AppUser, p: Partial<AppUser> & { resetPassword?: boolean }) => {
    try {
      const r = await api.updateUser({ id: u.id, ...p });
      if (r.temporaryPassword) setSecret({ email: u.email, pw: r.temporaryPassword });
      else toast('User updated');
      load();
    } catch (e) {
      toast((e as Error).message, 'err');
    }
  };

  if (!users) return <Spinner />;
  const chart = users.map((u) => ({ name: u.department, Changes: activity[u.email]?.edits ?? 0 }));

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Changes Recorded per Account" subtitle="From the audit trail" className="xl:col-span-2">
          <VBars data={chart} xKey="name" bars={[{ key: 'Changes', name: 'Changes', color: C.amber }]} height={200} />
        </Card>
        <Card title="Access Summary">
          <div className="grid grid-cols-2 gap-3 text-center">
            {[
              { l: 'Accounts', v: users.length, c: C.violet },
              { l: 'Active', v: users.filter((u) => u.isActive).length, c: C.emerald },
              { l: 'Admins', v: users.filter((u) => u.role === 'Admin').length, c: C.amber },
              { l: 'Pending password change', v: users.filter((u) => u.mustChangePassword).length, c: C.rose },
            ].map((t) => (
              <div key={t.l} className="rounded-lg bg-dark-900 p-3"><div className="text-2xl font-bold" style={{ color: t.c }}>{t.v}</div><div className="text-[11px] text-slate-400">{t.l}</div></div>
            ))}
          </div>
        </Card>
      </div>

      <div className="flex justify-end">{isAdmin && <Button onClick={() => setNewOpen(true)}><UserPlus className="h-4 w-4" />Add user</Button>}</div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {users.map((u) => {
          const a = activity[u.email];
          const col = DEPT_COLORS[u.department] ?? C.slate;
          return (
            <div key={u.id} className={`rounded-xl border bg-dark-850/80 p-4 ${u.isActive ? 'border-dark-700' : 'border-dark-700 opacity-60'}`}>
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-full text-xs font-bold" style={{ background: `${col}22`, color: col, border: `1px solid ${col}66` }}>{u.department}</div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-white">{USER_DEPARTMENT_NAMES[u.department] ?? u.name}</div>
                  <div className="truncate text-xs text-slate-400">{u.email}</div>
                </div>
                <Badge color={u.role === 'Admin' ? C.amber : u.role === 'Viewer' ? C.slate : C.cyan}>{u.role}</Badge>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {isOwner(u) && <Badge color={C.amber}>Main admin · protected</Badge>}
                {!u.isActive && <Badge color={C.rose}>Inactive</Badge>}
                {u.canEdit ? <Badge color={C.emerald}>Can edit</Badge> : <Badge color={C.slate}>Read-only</Badge>}
                {u.canExport && <Badge color={C.cyan}>Export</Badge>}
                {u.canApprove && <Badge color={C.violet}>Approver</Badge>}
                {u.mustChangePassword && <Badge color={C.orange}>Temp password</Badge>}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                <div className="rounded bg-dark-900 p-2"><div className="text-slate-500">Last sign-in</div><div className="text-slate-200">{a?.lastLogin ? new Date(a.lastLogin).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}</div></div>
                <div className="rounded bg-dark-900 p-2"><div className="text-slate-500">Changes made</div><div className="text-slate-200">{a?.edits ?? 0}</div></div>
              </div>
              {isAdmin && u.id !== user.id && !isOwner(u) && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => confirm(`Reset password for ${u.email}?`) && patch(u, { resetPassword: true })}><KeyRound className="h-3.5 w-3.5" />Reset password</Button>
                  <Button size="sm" variant="outline" onClick={() => patch(u, { canEdit: !u.canEdit })}>{u.canEdit ? 'Make read-only' : 'Allow edit'}</Button>
                  <Button size="sm" variant="outline" onClick={() => patch(u, { isActive: !u.isActive })}>{u.isActive ? <><ShieldOff className="h-3.5 w-3.5" />Deactivate</> : <><ShieldCheck className="h-3.5 w-3.5" />Activate</>}</Button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {newOpen && <NewUserModal onClose={() => setNewOpen(false)} onCreated={(email, pw) => { setNewOpen(false); setSecret({ email, pw }); load(); }} />}
      <Modal open={!!secret} onClose={() => setSecret(null)} title="Temporary password">
        <p className="text-sm text-slate-300">Give this one-time password to <b>{secret?.email}</b> privately. They must change it at first sign-in. It will not be shown again.</p>
        <div className="mt-4 flex items-center gap-2 rounded-lg bg-dark-900 p-3 font-mono text-lg text-solar-gold">
          {secret?.pw}
          <button className="ml-auto text-slate-400 hover:text-white" onClick={() => navigator.clipboard.writeText(secret?.pw ?? '')}><Copy className="h-4 w-4" /></button>
        </div>
      </Modal>
    </div>
  );
}

function NewUserModal({ onClose, onCreated }: { onClose: () => void; onCreated: (email: string, pw: string) => void }) {
  const { toast } = useApp();
  const [f, setF] = useState({ email: '', name: '', department: 'SITE', role: 'Department Lead' });
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const r = await api.createUser(f);
      onCreated(r.user.email, r.temporaryPassword);
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title="Add user">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><Field label="Email"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field></div>
        <div className="sm:col-span-2"><Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field></div>
        <Field label="Department"><Select value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })}>{USER_DEPARTMENTS.map((d) => <option key={d} value={d}>{d} – {USER_DEPARTMENT_NAMES[d]}</option>)}</Select></Field>
        <Field label="Role"><Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option>Department Lead</option><option>Viewer</option><option>Admin</option></Select></Field>
      </div>
      <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={busy}><UserPlus className="h-4 w-4" />Create</Button></div>
    </Modal>
  );
}
