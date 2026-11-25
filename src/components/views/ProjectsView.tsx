'use client';
import { useMemo, useState } from 'react';
import { Plus, MapPin, Zap, Pencil, Trash2, Copy, ExternalLink, Search, CalendarDays, Clock, Layers, TrendingUp, FolderOpen, X, Zap as Bolt, Lock, KeyRound } from 'lucide-react';
import clsx from 'clsx';
import { useApp, statusPill } from '../AppShell';
import { Card, Button, C, Modal, Input, Select, Empty, SERIES, Field } from '../ui';
import { Donut, Legendish, VBars } from '../charts';
import { Logo, PageHeader } from '../Brand';
import { api } from '@/lib/api';
import type { Project } from '@/lib/types';
import { PROJECT_STATUSES, PROJECT_TYPES } from '@/lib/types';
import { STATES, UNION_TERRITORIES, DISTRICTS } from '@/lib/locations';
import { fmt, diffDays, todayIso, isValidIso } from '@/lib/calendar';
import { generateFromMaster } from '@/lib/schedule';
import { MASTER_ACTIVITIES } from '@/lib/master';

const STATUS_COL: Record<string, string> = { Planning: C.violet, 'In Progress': C.blue, 'On Hold': C.amber, Completed: C.emerald };
const TYPE_LABEL: Record<string, string> = { 'Solar EPC': 'Solar EPC (Engineering, Procurement & Construction)', 'Solar IPP': 'Solar IPP (Independent Power Producer)' };

export default function ProjectsView() {
  const { projects, summaries, user, selectProject, setView, reloadProjects, toast, project: current, cal } = useApp();
  const [editing, setEditing] = useState<Project | null | 'new'>(null);
  const [q, setQ] = useState('');
  const [st, setSt] = useState('');
  const [ty, setTy] = useState('');
  const [busyId, setBusyId] = useState('');
  const [pwFor, setPwFor] = useState<Project | null>(null);

  const shown = projects.filter((p) => (!st || p.status === st) && (!ty || p.projectType === ty) && (!q || `${p.name} ${p.state} ${p.district} ${p.village}`.toLowerCase().includes(q.toLowerCase())));
  const byState = Object.entries(projects.reduce<Record<string, number>>((m, p) => ({ ...m, [p.state || '—']: (m[p.state || '—'] ?? 0) + p.capacityMw }), {})).map(([state, mw]) => ({ state, MW: mw }));
  const statusData = PROJECT_STATUSES.map((s) => ({ name: s, value: projects.filter((p) => p.status === s).length, color: STATUS_COL[s] }));
  const tlMin = projects.length ? projects.map((p) => p.plannedStartDate).reduce((a, b) => (a < b ? a : b)) : todayIso();
  const tlMax = projects.length ? projects.map((p) => p.plannedEndDate).reduce((a, b) => (a > b ? a : b)) : todayIso();
  const span = Math.max(1, diffDays(tlMin, tlMax));

  const remove = async (p: Project) => {
    if (!confirm(`Delete project "${p.name}" and all ${summaries[p.id]?.activities ?? ''} activities? This cannot be undone.`)) return;
    try {
      await api.deleteProject(p.id);
      toast('Project deleted');
      await reloadProjects();
    } catch (e) {
      toast((e as Error).message, 'err');
    }
  };
  const duplicate = async (p: Project) => {
    setBusyId(p.id);
    try {
      const src = await api.project(p.id);
      const { id: _id, createdAt: _c, updatedAt: _u, ...fields } = p;
      void _id; void _c; void _u;
      const r = await api.createProject({ ...fields, name: `${p.name} (Copy)` });
      await api.updateActivities(r.project.id, {
        action: 'import',
        activities: src.activities.map((a) => ({
          activityId: a.activityId, activityName: a.activityName, section: a.section, department: a.department, plannedDuration: a.plannedDuration,
          plannedStartDate: a.plannedStartDate, plannedEndDate: a.plannedEndDate, actualStartDate: a.actualStartDate, actualEndDate: a.actualEndDate,
          progressPercent: a.progressPercent, status: a.status === 'On Hold' ? 'On Hold' : 'Active', remarks: a.remarks,
        })),
      });
      toast(`Copied to "${p.name} (Copy)"`);
      await reloadProjects();
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="relative space-y-5">
      <div className="pointer-events-none fixed inset-0 bg-cover bg-center lg:left-72" aria-hidden
        style={{ backgroundImage: 'linear-gradient(rgba(3,5,8,0.80), rgba(3,5,8,0.93)), url(/solar-farm.svg)' }} />
      <div className="relative space-y-5">
      <PageHeader title="Project Storage & Workspace" badge={`${projects.length} Saved Projects`} subtitle="Multi-project solar portfolio • Isolated database storage per project"
        right={user.canEdit && <Button onClick={() => setEditing('new')} className="px-5 py-2.5 shadow-lg shadow-emerald-500/20"><Plus className="h-4 w-4" />Create New Project</Button>} />

      <div className="flex flex-wrap gap-3 rounded-xl border border-dark-700 bg-dark-900/80 p-4">
        <div className="relative min-w-[220px] flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search projects by name, state, district..." className="w-full pl-9" /></div>
        <Select value={st} onChange={(e) => setSt(e.target.value)} className="w-auto"><option value="">All Statuses</option>{PROJECT_STATUSES.map((s) => <option key={s}>{s}</option>)}</Select>
        <Select value={ty} onChange={(e) => setTy(e.target.value)} className="w-auto"><option value="">All Types</option>{PROJECT_TYPES.map((s) => <option key={s}>{s}</option>)}</Select>
      </div>

      {projects.length === 0 ? (
        <Empty icon={<FolderOpen className="h-10 w-10" />} title="No projects yet" text={`Create a project and SWELECT generates the full ${MASTER_ACTIVITIES.length}-activity schedule on the working calendar.`} action={user.canEdit && <Button onClick={() => setEditing('new')}><Plus className="h-4 w-4" />Create first project</Button>} />
      ) : (
        <>
          <div className="grid gap-5 md:grid-cols-2 2xl:grid-cols-3">
            {shown.map((p) => {
              const s = summaries[p.id];
              const sel = current?.id === p.id;
              const prog = Math.round((s?.progress ?? 0) * 10) / 10;
              return (
                <div key={p.id} className={clsx('rounded-2xl border bg-[#0b111c] p-5 transition', sel ? 'border-solar-amber shadow-[0_0_24px_-6px_rgba(16,185,129,0.45)]' : 'border-dark-700 hover:border-dark-500')}>
                  <div className="flex items-center justify-between">
                    <span className="rounded-md border border-dark-600 bg-dark-800 px-2.5 py-1 font-mono text-[11px] font-semibold text-slate-200">{p.projectType}</span>
                    <span className={clsx('rounded-full border px-2.5 py-1 text-xs font-semibold', statusPill(p.status))}>● {p.status}</span>
                  </div>
                  <h3 className="mt-3 flex items-center gap-2 truncate text-lg font-bold text-white">{p.locked && <Lock className="h-4 w-4 shrink-0 text-solar-gold" aria-label="Password protected" />}<span className="truncate">{p.name}</span></h3>
                  <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-400"><MapPin className="h-4 w-4 text-solar-amber" />{[p.village, p.district, p.state].filter(Boolean).join(', ') || '—'}</p>
                  {p.locked && !p.unlocked ? (
                    <div className="mt-4 rounded-xl border border-dark-700 bg-dark-950/60 p-6 text-center">
                      <Lock className="mx-auto h-6 w-6 text-solar-gold" />
                      <div className="mt-2 text-sm font-semibold text-white">Password protected</div>
                      <div className="mt-1 text-xs text-slate-400">Open the project and enter its password to see the schedule and progress.</div>
                    </div>
                  ) : (
                  <div className="mt-4 rounded-xl border border-dark-700 bg-dark-950/60 p-4">
                    <div className="grid grid-cols-2 gap-4 border-b border-dark-700 pb-3">
                      <div><div className="flex items-center gap-1.5 text-[11px] uppercase text-slate-400"><CalendarDays className="h-3.5 w-3.5 text-brand-cyan" />Planned Start</div><div className="mt-1 font-mono text-sm font-bold text-cyan-300">{fmt(p.plannedStartDate)}</div></div>
                      <div><div className="flex items-center gap-1.5 text-[11px] uppercase text-slate-400"><CalendarDays className="h-3.5 w-3.5 text-solar-amber" />Planned Finish</div><div className="mt-1 font-mono text-sm font-bold text-solar-gold">{fmt(p.plannedEndDate)}</div></div>
                    </div>
                    <div className="grid grid-cols-2 gap-4 border-b border-dark-700 py-3">
                      <div><div className="text-[11px] uppercase text-slate-400">Capacity</div><div className="mt-1 flex items-center gap-1.5 font-mono font-bold text-solar-gold"><Zap className="h-4 w-4" />{p.capacityMw} MWp</div></div>
                      <div><div className="text-[11px] uppercase text-slate-400">Duration</div><div className="mt-1 flex items-center gap-1.5 font-mono text-sm font-bold text-white"><Clock className="h-4 w-4 text-brand-emerald" />{cal.countWorking(p.plannedStartDate, p.plannedEndDate)} Working Days</div></div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 border-b border-dark-700 py-3 text-xs">
                      <span className="flex items-center gap-1.5 uppercase text-slate-400"><Layers className="h-3.5 w-3.5 text-violet-400" />Work Packages</span>
                      <span className="font-mono font-semibold text-white">{s?.activities ?? 0} Activities</span>
                      <span className="font-mono text-brand-emerald">({s?.completed ?? 0} Done)</span>
                      <span className="font-mono text-brand-rose">({s?.delayed ?? 0} Delay)</span>
                    </div>
                    <div className="pt-3">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1.5 text-sm text-slate-200"><TrendingUp className="h-4 w-4 text-brand-emerald" />Physical Progress</span>
                        <span className="rounded-md border border-brand-emerald/40 bg-brand-emerald/10 px-2 py-0.5 font-mono text-xs font-bold text-emerald-300">{prog}% Completed</span>
                      </div>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-dark-700"><div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-cyan-400" style={{ width: `${Math.min(100, prog)}%` }} /></div>
                    </div>
                  </div>
                  )}
                  <div className="mt-4 flex items-center gap-1 border-t border-dark-700 pt-4">
                    <span className="flex-1 font-mono text-[11px] text-slate-500">Modified: {fmt((p.updatedAt ?? p.createdAt ?? todayIso()).slice(0, 10))}</span>
                    {user.canEdit && <button title="Edit project setup" onClick={() => setEditing(p)} className="rounded p-1.5 text-slate-400 hover:bg-dark-800 hover:text-white"><Pencil className="h-4 w-4" /></button>}
                    {user.canEdit && <button title={p.locked ? 'Change or remove project password' : 'Set a project password'} aria-label="Project password" onClick={() => setPwFor(p)} className="rounded p-1.5 text-slate-400 hover:bg-dark-800 hover:text-white"><KeyRound className={clsx('h-4 w-4', p.locked && 'text-solar-gold')} /></button>}
                    {user.canEdit && <button title="Duplicate project" disabled={busyId === p.id} onClick={() => duplicate(p)} className="rounded p-1.5 text-slate-400 hover:bg-dark-800 hover:text-white"><Copy className={clsx('h-4 w-4', busyId === p.id && 'animate-pulse')} /></button>}
                    {user.role === 'Admin' && <button title="Delete project" onClick={() => remove(p)} className="rounded p-1.5 text-slate-400 hover:bg-dark-800 hover:text-brand-rose"><Trash2 className="h-4 w-4" /></button>}
                    <button onClick={() => { selectProject(p.id); setView('schedule'); }} className="ml-2 flex items-center gap-1.5 rounded-lg border border-solar-amber/60 bg-solar-amber/10 px-3 py-1.5 text-sm font-semibold text-solar-gold hover:bg-solar-amber/20">{p.locked && !p.unlocked ? 'Unlock' : 'Open'}{p.locked && !p.unlocked ? <Lock className="h-3.5 w-3.5" /> : <ExternalLink className="h-3.5 w-3.5" />}</button>
                  </div>
                </div>
              );
            })}
          </div>
          {!shown.length && <p className="py-6 text-center text-sm text-slate-500">No projects match these filters.</p>}

          <div className="grid gap-4 xl:grid-cols-3">
            <Card title="Capacity by State" subtitle="MW across the portfolio"><VBars data={byState} xKey="state" bars={[{ key: 'MW', name: 'MW', color: C.amber }]} height={200} /></Card>
            <Card title="Project Status"><Donut data={statusData} height={150} center={String(projects.length)} sub="projects" /><div className="mt-3"><Legendish items={statusData} /></div></Card>
            <Card title="Portfolio Timeline" subtitle={`${fmt(tlMin)} → ${fmt(tlMax)}`}>
              <div className="space-y-2">
                {projects.map((p, i) => {
                  const prog = summaries[p.id]?.progress ?? 0;
                  return (
                    <div key={p.id} className="text-xs">
                      <div className="mb-0.5 flex justify-between"><span className="truncate text-slate-300">{p.name}</span><span className="font-mono text-slate-500">{p.locked && !p.unlocked ? '🔒' : `${prog}%`}</span></div>
                      <div className="relative h-3 rounded bg-dark-900">
                        <div className="absolute h-3 rounded" style={{ left: `${(diffDays(tlMin, p.plannedStartDate) / span) * 100}%`, width: `${Math.max(2, (diffDays(p.plannedStartDate, p.plannedEndDate) / span) * 100)}%`, background: `${SERIES[i % SERIES.length]}44`, border: `1px solid ${SERIES[i % SERIES.length]}` }}>
                          <div className="h-full rounded" style={{ width: `${p.locked && !p.unlocked ? 0 : prog}%`, background: SERIES[i % SERIES.length] }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>
        </>
      )}
      </div>
      {editing && (
        <Modal open onClose={() => setEditing(null)} title={<SetupTitle edit={editing !== 'new'} />} wide>
          <SetupForm project={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />
        </Modal>
      )}
      {pwFor && <ProjectPasswordModal project={pwFor} onClose={() => setPwFor(null)} />}
    </div>
  );
}

/** Set, change or remove the password of one project. */
export function ProjectPasswordModal({ project, onClose }: { project: Project; onClose: () => void }) {
  const { user, toast, reloadProjects, reloadProject, project: current } = useApp();
  const [cur, setCur] = useState('');
  const [np, setNp] = useState('');
  const [np2, setNp2] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState<'' | 'save' | 'remove'>('');
  const has = !!project.locked;
  const needCurrent = has && user.role !== 'Admin'; // an Admin account can reset a forgotten password
  const refresh = async () => { await Promise.all([reloadProjects(), current?.id === project.id ? reloadProject() : Promise.resolve()]); };
  const save = async () => {
    setErr('');
    if (np.length < 6) return setErr('Project password must be at least 6 characters');
    if (np !== np2) return setErr('The two new passwords do not match');
    setBusy('save');
    try {
      await api.setProjectPassword(project.id, { newPassword: np, currentPassword: needCurrent ? cur : undefined });
      toast(has ? 'Project password changed' : 'Project password set');
      await refresh();
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy('');
    }
  };
  const remove = async () => {
    setErr('');
    if (!confirm(`Remove the password from "${project.name}"? Anyone who can use the app will be able to open it.`)) return;
    setBusy('remove');
    try {
      await api.setProjectPassword(project.id, { remove: true, currentPassword: needCurrent ? cur : undefined });
      toast('Project password removed');
      await refresh();
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy('');
    }
  };
  return (
    <Modal open onClose={onClose} title={has ? `Project password · ${project.name}` : `Set a project password · ${project.name}`}>
      <div className="space-y-3">
        <p className="rounded-lg bg-solar-amber/10 p-3 text-sm text-solar-gold">{has
          ? 'This project is password protected. Anyone opening it is asked for the password.'
          : 'Once a password is set, anyone opening this project is asked for it first. Its schedule, progress and history stay hidden until it is entered.'}</p>
        {needCurrent && <Field label="Current project password"><Input type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="off" /></Field>}
        <Field label={has ? 'New project password' : 'Project password'} hint="At least 6 characters"><Input type="password" value={np} onChange={(e) => setNp(e.target.value)} autoComplete="new-password" /></Field>
        <Field label="Confirm project password"><Input type="password" value={np2} onChange={(e) => setNp2(e.target.value)} autoComplete="new-password" /></Field>
        {err && <p className="text-sm text-brand-rose">{err}</p>}
        <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
          {has && <Button variant="danger" size="sm" onClick={remove} loading={busy === 'remove'} className="mr-auto">Remove password</Button>}
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} loading={busy === 'save'}>{has ? 'Change password' : 'Set password'}</Button>
        </div>
      </div>
    </Modal>
  );
}

function SetupTitle({ edit }: { edit: boolean }) {
  return (
    <div className="flex items-center gap-4">
      <Logo size="sm" />
      <div><div className="text-lg font-bold text-white">{edit ? 'Edit Project Setup' : 'New Project Setup'}</div><div className="text-xs font-normal text-slate-400">SWELECT Project Control • Master Parameters &amp; Working Calendar</div></div>
    </div>
  );
}

/** Project Setup page (sidebar). Edits the active project, or creates a new one. */
export function ProjectSetupPage() {
  const { project, user } = useApp();
  const [mode, setMode] = useState<'edit' | 'new'>(project ? 'edit' : 'new');
  const target = mode === 'edit' ? project : null;
  const [pwOpen, setPwOpen] = useState(false);
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader title={target ? 'Project Setup' : 'New Project Setup'} badge={target ? `${target.capacityMw} MW` : `${MASTER_ACTIVITIES.length} Work Packages`} subtitle="Master parameters, location hierarchy and working calendar"
        right={project && user.canEdit && (mode === 'edit'
          ? <div className="flex gap-2"><Button variant="outline" onClick={() => setPwOpen(true)}><KeyRound className="h-4 w-4" />{project.locked ? 'Project password' : 'Set project password'}</Button><Button variant="outline" onClick={() => setMode('new')}><Plus className="h-4 w-4" />New project</Button></div>
          : <Button variant="outline" onClick={() => setMode('edit')}><X className="h-4 w-4" />Back to {project.name}</Button>)} />
      <div className="rounded-2xl border border-dark-700 bg-[#0b111c] p-6">
        <SetupForm key={`${mode}-${target?.id ?? 'new'}`} project={target} onDone={() => setMode('edit')} />
      </div>
      {pwOpen && project && <ProjectPasswordModal project={project} onClose={() => setPwOpen(false)} />}
    </div>
  );
}

function Lbl({ n, children, accent }: { n?: number; children: React.ReactNode; accent?: string }) {
  return <span className={clsx('mb-1.5 block text-sm font-medium', accent ?? 'text-slate-300')}>{n != null && `${n}. `}{children}</span>;
}

function SetupForm({ project, onDone }: { project: Project | null; onDone: () => void }) {
  const { cal, holidays, projects, reloadProjects, selectProject, setView, toast, reloadProject, user } = useApp();
  const [f, setF] = useState({
    name: project?.name ?? '',
    capacityMw: project?.capacityMw ?? 50,
    projectType: project?.projectType ?? 'Solar EPC',
    status: project?.status ?? 'In Progress',
    state: project?.state ?? 'Tamil Nadu',
    district: project?.district ?? '',
    village: project?.village ?? '',
    plannedStartDate: project?.plannedStartDate ?? todayIso(),
    actualStartDate: project?.actualStartDate ?? '',
    actualEndDate: project?.actualEndDate ?? '',
    description: project?.description ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [projectPassword, setProjectPassword] = useState('');
  const districts = DISTRICTS[f.state];
  const villages = [...new Set(projects.filter((p) => p.district === f.district && p.village).map((p) => p.village))];
  const readOnly = !user.canEdit;

  // Planned duration: blank = standard 165-activity master duration; type a number (or pick an end date) to fit the schedule to it.
  const masterEnd = useMemo(() => {
    if (!isValidIso(f.plannedStartDate)) return '';
    return generateFromMaster('PREVIEW', f.plannedStartDate, cal).map((a) => a.plannedEndDate).reduce((a, b) => (a > b ? a : b));
  }, [f.plannedStartDate, cal]);
  const start = f.plannedStartDate;
  const currentWd = project ? cal.countWorking(project.plannedStartDate, project.plannedEndDate) : 0;
  const [dur, setDur] = useState<number | ''>(project ? currentWd : '');
  const masterWd = masterEnd ? cal.countWorking(start, masterEnd) : 0;
  const plannedWd = dur === '' ? masterWd : Math.max(0, Number(dur));
  const plannedEnd = isValidIso(start) && plannedWd > 0 ? cal.finishFrom(start, plannedWd) : '';
  const durTooShort = dur !== '' && plannedWd < 5;
  const actualWd = isValidIso(f.actualStartDate) && isValidIso(f.actualEndDate) && f.actualEndDate >= f.actualStartDate ? cal.countWorking(f.actualStartDate, f.actualEndDate) : '';
  const holsInRange = plannedEnd ? holidays.filter((h) => h.date >= start && h.date <= plannedEnd && !cal.isSunday(h.date)).length : 0;

  const save = async () => {
    setBusy(true);
    try {
      if (durTooShort) throw new Error('Planned duration must be at least 5 working days');
      const payload: Record<string, unknown> = { ...f, actualStartDate: f.actualStartDate || null, actualEndDate: f.actualEndDate || null };
      if (project) {
        const refit = start !== project.plannedStartDate || plannedWd !== currentWd;
        if (refit && !confirm(`Re-plan all planned dates to start ${fmt(start)} and finish in ${plannedWd} working days (${fmt(plannedEnd)})? Actual dates and progress are kept.`)) return;
        if (refit) Object.assign(payload, { refit: true, plannedDuration: plannedWd });
        await api.updateProject(project.id, payload as Partial<Project>);
        toast(refit ? `Schedule re-planned: finish ${fmt(plannedEnd)}` : 'Project setup updated');
        await reloadProject();
        await reloadProjects();
        onDone();
      } else {
        if (dur !== '') payload.plannedDuration = plannedWd;
        if (projectPassword) {
          if (projectPassword.length < 6) throw new Error('Project password must be at least 6 characters');
          payload.projectPassword = projectPassword;
        }
        const r = await api.createProject(payload as Partial<Project>);
        toast(`Project created with ${r.activities.length} scheduled activities`);
        await reloadProjects();
        selectProject(r.project.id);
        setView('schedule');
      }
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  };
  const set = (k: keyof typeof f, v: string | number) => setF((x) => ({ ...x, [k]: v }));

  return (
    <fieldset disabled={readOnly} className="space-y-5">
      <div className="grid gap-4 md:grid-cols-3">
        <label className="md:col-span-2"><Lbl n={1}>Project Name *</Lbl><Input className="w-full" value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Kamuthi 50 MW Solar Park" /></label>
        <label><Lbl n={2}>Capacity (MW/MWp) *</Lbl><Input className="w-full" type="number" min={0} step="0.1" value={f.capacityMw} onChange={(e) => set('capacityMw', Number(e.target.value))} /></label>
        <label className="md:col-span-2 lg:col-span-1"><Lbl n={3}>Project Type *</Lbl><Select value={f.projectType} onChange={(e) => set('projectType', e.target.value)}>{PROJECT_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t] ?? t}</option>)}</Select></label>
        <label className="lg:col-span-2"><Lbl n={12}>Project Status *</Lbl><Select value={f.status} onChange={(e) => set('status', e.target.value)}>{PROJECT_STATUSES.map((s) => <option key={s}>{s}</option>)}</Select></label>
      </div>

      <div className="rounded-xl border border-dark-700 bg-dark-950/50 p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-solar-gold"><MapPin className="h-4 w-4" />Indian Location Hierarchy (State → District → Village)</div>
        <div className="grid gap-3 md:grid-cols-3">
          <label><Lbl n={4}>State / UT *</Lbl>
            <Select value={f.state} onChange={(e) => setF((x) => ({ ...x, state: e.target.value, district: '', village: '' }))}>
              <optgroup label={`States (${STATES.length})`}>{STATES.map((s) => <option key={s}>{s}</option>)}</optgroup>
              <optgroup label={`Union Territories (${UNION_TERRITORIES.length})`}>{UNION_TERRITORIES.map((s) => <option key={s}>{s}</option>)}</optgroup>
            </Select>
          </label>
          <label><Lbl n={5}>District *</Lbl>
            {districts ? <Select value={f.district} onChange={(e) => setF((x) => ({ ...x, district: e.target.value, village: '' }))}><option value="">Select district</option>{districts.map((d) => <option key={d}>{d}</option>)}</Select>
              : <Input className="w-full" value={f.district} onChange={(e) => set('district', e.target.value)} placeholder="Type district" />}
          </label>
          <label><Lbl n={6}>Village / Site *</Lbl>
            <Input className="w-full" list="village-list" value={f.village} onChange={(e) => set('village', e.target.value)} placeholder="Village, town or survey no." />
            <datalist id="village-list">{villages.map((v) => <option key={v} value={v} />)}</datalist>
          </label>
        </div>
      </div>

      <div className="rounded-xl border border-dark-700 bg-dark-950/50 p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-solar-gold"><Bolt className="h-4 w-4" />Working Calendar Engine (Sundays &amp; Indian Holidays Excluded)</span>
          <span className="ml-auto rounded-md border border-brand-emerald/40 bg-brand-emerald/10 px-2 py-0.5 font-mono text-[11px] text-emerald-300">⚡ Auto-Calculated</span>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <label><Lbl n={7}>Planned Start Date *</Lbl><Input className="w-full font-mono" type="date" value={f.plannedStartDate} onChange={(e) => set('plannedStartDate', e.target.value)} /></label>
          <label><span className="mb-1.5 flex justify-between text-sm font-medium text-solar-gold"><span>Planned Duration *</span><span className="text-xs text-slate-500">Working Days</span></span>
            <div className="relative"><Input className={clsx('w-full font-mono text-solar-gold', durTooShort ? 'border-brand-rose' : 'border-solar-amber/50')} type="number" min={5} placeholder={String(masterWd || '')} value={dur === '' ? '' : dur}
              onChange={(e) => setDur(e.target.value === '' ? '' : Number(e.target.value))} /><span className="absolute right-3 top-2 text-xs text-slate-500">d</span></div>
            <span className="mt-1 block text-[11px] text-slate-500">{dur === '' ? `Standard master schedule: ${masterWd} d` : <button type="button" className="text-cyan-400 hover:underline" onClick={() => setDur('')}>Reset to standard ({masterWd} d)</button>}</span></label>
          <label><Lbl n={8}>Planned End Date *</Lbl><Input className="w-full font-mono" type="date" value={plannedEnd} min={start}
              onChange={(e) => { if (isValidIso(e.target.value) && e.target.value > start) setDur(cal.countWorking(start, e.target.value)); }} /></label>
        </div>
        <div className="mt-3 grid gap-3 border-t border-dark-700 pt-3 md:grid-cols-3">
          <label><Lbl n={9}>Actual Start Date</Lbl><Input className="w-full font-mono" type="date" value={f.actualStartDate} onChange={(e) => set('actualStartDate', e.target.value)} /></label>
          <label><span className="mb-1.5 flex justify-between text-sm font-medium text-brand-cyan"><span>Actual Duration</span><span className="text-xs text-slate-500">Working Days</span></span>
            <div className="relative"><Input className="w-full font-mono" type="number" min={1} placeholder="Auto or Days" value={actualWd}
              onChange={(e) => { const n = Number(e.target.value); if (n > 0 && isValidIso(f.actualStartDate)) set('actualEndDate', cal.finishFrom(f.actualStartDate, n)); }} /><span className="absolute right-3 top-2 text-xs text-slate-500">d</span></div></label>
          <label><Lbl n={10}>Actual End Date</Lbl><Input className="w-full font-mono" type="date" value={f.actualEndDate} onChange={(e) => set('actualEndDate', e.target.value)} /></label>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 rounded-lg border border-dark-700 bg-dark-900 px-3 py-2 font-mono text-xs">
          <span className="text-solar-gold">Working Days: <b className="text-white">{plannedWd} d</b></span>
          <span className="text-slate-400">Sundays: <b className="text-brand-rose">0% Working</b> • Saturdays: <b className="text-brand-emerald">Working</b></span>
          <span className="ml-auto text-slate-400">Indian Holidays: <b className="text-solar-gold">{holsInRange} Active</b></span>
        </div>
        <p className="mt-2 text-[11px] text-slate-500">{project
          ? 'Changing the start date, duration or end date re-plans all planned activity dates to fit (actual dates and progress are kept).'
          : `${MASTER_ACTIVITIES.length} master activities will be scheduled from the start date with predecessor logic${dur !== '' ? `, fitted to ${plannedWd} working days` : ''}.`}</p>
      </div>

      <label className="block"><Lbl n={11}>Project Description</Lbl>
        <textarea className="w-full rounded-lg border border-dark-600 bg-dark-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-solar-amber focus:outline-none" rows={3} value={f.description} onChange={(e) => set('description', e.target.value)} placeholder="e.g. Ground Mounted Solar PV project with central inverter station, 110kV bay evacuation..." />
      </label>
      {!project && (
        <label className="block"><Lbl>Project Password (optional)</Lbl>
          <Input className="w-full" type="password" autoComplete="new-password" value={projectPassword} onChange={(e) => setProjectPassword(e.target.value)} placeholder="Leave empty for no password" />
          <span className="mt-1 block text-[11px] text-slate-500">If you set one, anyone opening this project must enter it first. You can change or remove it later from the project card.</span>
        </label>
      )}
      <div className="flex justify-end gap-3 border-t border-dark-700 pt-4">
        <Button variant="ghost" onClick={onDone} type="button">Cancel</Button>
        {!readOnly && <Button onClick={save} loading={busy} className="px-6">{project ? 'Update Project Setup' : 'Create Project & Generate Schedule'}</Button>}
      </div>
    </fieldset>
  );
}
