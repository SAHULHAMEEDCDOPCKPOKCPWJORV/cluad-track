'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import {
  LayoutGrid, GanttChartSquare, FileSpreadsheet, AlertCircle, BrainCircuit, FolderOpen, CalendarDays, History, Users, LogOut, KeyRound, Menu,
  CheckCircle2, XCircle, Lock, SlidersHorizontal, Zap, Cloud, Save, FileText, Loader2, Award, Home, Newspaper, ShieldCheck, BarChart3, Users2, Plug, UserCog,
} from 'lucide-react';
import { api, ApiError, type LiveChange, type ProjectSummary } from '@/lib/api';
import { useLiveUpdates } from '@/lib/live';
import type { Activity, Holiday, Project, SessionUser } from '@/lib/types';
import { DEPARTMENT_NAMES, isCredit, type Department } from '@/lib/types';
import { WorkCalendar, todayIso } from '@/lib/calendar';
import { analyzeProject, buildSCurve, computeKpis, historyFromAudit, summarizeBy, validateModel, type GroupSummary, type Kpis, type ProgressHistory, type ProjectAnalysis, type SPoint, type ValidationReport } from '@/lib/schedule';
import { generateReport } from '@/lib/report';
import { canEditModule, canSeeActivity, canView, hasFullAccess, type ModuleKey } from '@/lib/access';
import { Button, Field, Input, Modal, Spinner } from './ui';
import { Logo } from './Brand';
import LoginView from './views/LoginView';
import Dashboard from './views/Dashboard';
import GanttView from './views/GanttView';
import ScheduleSheet from './views/ScheduleSheet';
import DelaysView from './views/DelaysView';
import ReportView from './views/ReportView';
import ProjectsView, { ProjectSetupPage } from './views/ProjectsView';
import CalendarView from './views/CalendarView';
import AuditView from './views/AuditView';
import UsersView from './views/UsersView';
import StaffView from './views/StaffView';
import HomeView from './views/HomeView';
import NewsView from './views/NewsView';
import ReputationView from './views/ReputationView';
import SocialView from './views/SocialView';
import LeadsView from './views/LeadsView';
import SettingsView from './views/SettingsView';
import AccessView from './views/AccessView';

export type View = 'home' | 'projects' | 'setup' | 'schedule' | 'gantt' | 'dashboard' | 'delays' | 'staff' | 'report' | 'calendar' | 'news' | 'reputation' | 'social' | 'leads' | 'users' | 'audit' | 'access' | 'settings';

export interface Model {
  cal: WorkCalendar;
  today: string;
  an: ProjectAnalysis;
  kpis: Kpis;
  sections: GroupSummary[];
  depts: GroupSummary[];
  curve: SPoint[];
  hist: ProgressHistory;
  validation: ValidationReport;
}

interface Ctx {
  user: SessionUser;
  storeKind: string;
  projects: Project[];
  summaries: Record<string, ProjectSummary>;
  project: Project | null;
  activities: Activity[];
  holidays: Holiday[];
  model: Model | null;
  cal: WorkCalendar;
  view: View;
  setView: (v: View) => void;
  selectProject: (id: string) => void;
  /** Opens a project (from Project Storage only) and goes to its dashboard. */
  openProject: (id: string) => void;
  /** Closes the open project and returns to Project Storage. */
  closeProject: () => void;
  reloadProjects: () => Promise<void>;
  reloadProject: () => Promise<void>;
  reloadHolidays: () => Promise<void>;
  applyUpdate: (r: { project: Project; activities: Activity[] }) => void;
  toast: (msg: string, kind?: 'ok' | 'err') => void;
  /** A page with unsaved edits registers its save function so the top-bar Save button can run it. */
  registerSave: (fn: (() => Promise<unknown>) | null) => void;
  markSaved: () => void;
}

const AppCtx = createContext<Ctx | null>(null);
export const useApp = () => {
  const c = useContext(AppCtx);
  if (!c) throw new Error('useApp outside provider');
  return c;
};

type NavItem = { view: View; label: string; icon: ReactNode; needsProject?: boolean; group: string };
const NAV: NavItem[] = [
  { view: 'home', label: 'Home', icon: <Home className="h-[18px] w-[18px]" />, group: '' },
  { view: 'projects', label: 'Project Storage', icon: <FolderOpen className="h-[18px] w-[18px]" />, group: 'Projects' },
  { view: 'setup', label: 'Project Setup', icon: <SlidersHorizontal className="h-[18px] w-[18px]" />, group: 'Projects' },
  { view: 'schedule', label: 'Excel Import', icon: <FileSpreadsheet className="h-[18px] w-[18px]" />, needsProject: true, group: 'Projects' },
  { view: 'gantt', label: 'Gantt Chart', icon: <GanttChartSquare className="h-[18px] w-[18px]" />, needsProject: true, group: 'Projects' },
  { view: 'dashboard', label: 'Project Dashboard', icon: <LayoutGrid className="h-[18px] w-[18px]" />, needsProject: true, group: 'Projects' },
  { view: 'delays', label: 'Delays & Hold Impact', icon: <AlertCircle className="h-[18px] w-[18px]" />, needsProject: true, group: 'Projects' },
  { view: 'staff', label: 'Staff Performance', icon: <Award className="h-[18px] w-[18px]" />, needsProject: true, group: 'Projects' },
  { view: 'report', label: 'AI Project Report', icon: <BrainCircuit className="h-[18px] w-[18px]" />, needsProject: true, group: 'Projects' },
  { view: 'calendar', label: 'Holiday Calendar', icon: <CalendarDays className="h-[18px] w-[18px]" />, group: 'Projects' },
  { view: 'news', label: 'Solar News', icon: <Newspaper className="h-[18px] w-[18px]" />, group: 'Marketing & Sales' },
  { view: 'reputation', label: 'Reputation Monitor', icon: <ShieldCheck className="h-[18px] w-[18px]" />, group: 'Marketing & Sales' },
  { view: 'social', label: 'Social Media', icon: <BarChart3 className="h-[18px] w-[18px]" />, group: 'Marketing & Sales' },
  { view: 'leads', label: 'Leads & Follow-ups', icon: <Users2 className="h-[18px] w-[18px]" />, group: 'Marketing & Sales' },
  { view: 'users', label: 'User Management', icon: <Users className="h-[18px] w-[18px]" />, group: 'Admin' },
  { view: 'audit', label: 'Activity History', icon: <History className="h-[18px] w-[18px]" />, group: 'Admin' },
  { view: 'access', label: 'Access Control', icon: <UserCog className="h-[18px] w-[18px]" />, group: 'Admin' },
  { view: 'settings', label: 'Connections & Settings', icon: <Plug className="h-[18px] w-[18px]" />, group: 'Admin' },
];
const PROJECT_VIEWS: View[] = ['projects', 'setup', 'schedule', 'gantt', 'dashboard', 'delays', 'staff', 'report', 'calendar'];
/** Which access-control area each page belongs to (null = Home / admin-only pages). */
const moduleOf = (v: View): ModuleKey | null =>
  PROJECT_VIEWS.includes(v) ? 'projects' : v === 'news' || v === 'reputation' || v === 'social' || v === 'leads' || v === 'users' || v === 'audit' ? v : null;
const allowed = (u: SessionUser, v: View) => (v === 'settings' || v === 'access' ? u.role === 'Admin' : v === 'home' || canView(u, moduleOf(v)!));

const STATUS_PILL: Record<string, string> = { Planning: 'text-violet-300 border-violet-400/40 bg-violet-500/10', 'In Progress': 'text-blue-300 border-blue-400/40 bg-blue-500/10', 'On Hold': 'text-emerald-300 border-emerald-400/40 bg-emerald-500/10', Completed: 'text-emerald-300 border-emerald-400/40 bg-emerald-500/10' };
export const statusPill = (s: string) => STATUS_PILL[s] ?? 'text-slate-300 border-slate-500/40 bg-slate-500/10';

export default function AppShell() {
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);
  const [storeKind, setStoreKind] = useState('');
  const [bootError, setBootError] = useState('');
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    let isOffline = false;
    const boot = () => api.me()
      .then((r) => { isOffline = false; setOffline(false); setUser(r.user); setStoreKind(r.store); })
      .catch((e) => {
        // No internet (the installed app can still open): show a clear offline screen instead of the sign-in page.
        // A request that never reached the server throws a TypeError; a server answer is an ApiError.
        if (!(e instanceof ApiError)) { isOffline = true; setOffline(true); return; }
        setBootError(e.message); setUser(null);
      });
    boot();
    const retry = () => { if (isOffline) boot(); };
    const timer = setInterval(retry, 10_000); // also covers "Wi-Fi connected but no internet"
    window.addEventListener('online', retry);
    return () => { clearInterval(timer); window.removeEventListener('online', retry); };
  }, []);
  if (offline) return <OfflineScreen />;
  if (user === undefined) return <div className="min-h-screen bg-dark-950"><Spinner label="Starting SWELECT Project Control…" /></div>;
  if (!user) return <LoginView error={bootError} onLogin={(u) => { setBootError(''); setUser(u); }} />;
  return <Workspace user={user} storeKind={storeKind} onLogout={() => setUser(null)} onUser={setUser} />;
}

function Workspace({ user, storeKind, onLogout, onUser }: { user: SessionUser; storeKind: string; onLogout: () => void; onUser: (u: SessionUser) => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [summaries, setSummaries] = useState<Record<string, ProjectSummary>>({});
  const [project, setProject] = useState<Project | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [view, setViewState] = useState<View>(() => {
    const v = typeof window !== 'undefined' ? (localStorage.getItem('swelect.view') as View | null) : null;
    if (!v || v === 'settings') return 'home';
    // A project is only opened from Project Storage, so a fresh start never lands inside a project page.
    return PROJECT_VIEWS.includes(v) && v !== 'calendar' && v !== 'setup' ? 'projects' : v;
  });
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState<{ id: number; msg: string; kind: 'ok' | 'err' }[]>([]);
  const [navOpen, setNavOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(user.mustChangePassword);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [syncErr, setSyncErr] = useState(false);
  const [busy, setBusy] = useState('');
  const saveFn = useRef<(() => Promise<unknown>) | null>(null);
  const pidRef = useRef<string | null>(null);
  const canProjects = canView(user, 'projects');
  const canProjectsRef = useRef(canProjects);
  canProjectsRef.current = canProjects;
  const onUserRef = useRef(onUser);
  onUserRef.current = onUser;
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [hist, setHist] = useState<ProgressHistory>(new Map());
  pidRef.current = projectId;

  const toast = useCallback((msg: string, kind: 'ok' | 'err' = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
    if (kind === 'err') setSyncErr(true);
  }, []);
  const markSaved = useCallback(() => { setSavedAt(new Date()); setSyncErr(false); }, []);

  const reloadProjects = useCallback(async () => {
    const r = await api.projects();
    setProjects(r.projects);
    setSummaries(Object.fromEntries(r.summaries.map((s) => [s.projectId, s])));
    // Keep the open project only while it still exists and is still open for this account. Nothing is opened automatically.
    setProjectId((cur) => (cur && r.projects.some((p) => p.id === cur && (!p.locked || p.unlocked)) ? cur : null));
  }, []);
  const reloadHolidays = useCallback(async () => setHolidays((await api.holidays()).holidays), []);
  const reloadProject = useCallback(async () => {
    if (!projectId) {
      setProject(null);
      setActivities([]);
      return;
    }
    let r: { project: Project; activities: Activity[] };
    try {
      r = await api.project(projectId);
    } catch (e) {
      // Password-protected project: show the password screen instead of an error.
      if (e instanceof ApiError && e.status === 423) {
        if (pidRef.current === projectId) {
          setProjectId(null); setProject(null); setActivities([]); setLoadedFor(null); setHist(new Map());
          setViewState('projects');
          toast('This project is password protected. Open it from Project Storage and enter its password.', 'err');
        }
        return;
      }
      throw e;
    }
    if (pidRef.current !== projectId) return; // a newer project was selected meanwhile
    setProject(r.project);
    setActivities(r.activities);
    setLoadedFor(projectId);
    // Recorded progress changes: the only source for the past part of the actual S-curve.
    api.progressHistory(projectId).then((h) => { if (pidRef.current === projectId) setHist(historyFromAudit(h.logs)); }).catch(() => setHist(new Map()));
  }, [projectId, toast]);

  useEffect(() => {
    Promise.all(canProjects ? [reloadProjects(), reloadHolidays()] : [])
      .catch((e) => toast(e.message, 'err'))
      .finally(() => setLoading(false));
  }, [reloadProjects, reloadHolidays, toast, canProjects]);
  useEffect(() => {
    // Drop the previous project's data at once so a newly created/selected project never shows old details.
    setProject((p) => (p?.id === projectId ? p : null));
    setActivities((a) => (a[0]?.projectId === projectId ? a : []));
    reloadProject().catch((e) => toast(e.message, 'err'));
  }, [projectId, reloadProject, toast]);

  // ── Live updates: other people's saves appear here within seconds, no refresh needed ──
  const reloadProjectRef = useRef(reloadProject);
  reloadProjectRef.current = reloadProject;
  const [liveAt, setLiveAt] = useState<Date | null>(null);
  const onLive = useCallback((all: LiveChange[], others: LiveChange[], reloadAll: boolean) => {
    // the admin changed someone's access: refresh this account's menu at once
    if (all.some((c) => c.action === 'ACCESS_CHANGED')) api.me().then((r) => r.user && onUserRef.current(r.user)).catch(() => undefined);
    if (!canProjectsRef.current) { setLiveAt(new Date()); return; }
    const pid = pidRef.current;
    if (pid && (reloadAll || all.some((c) => c.projectId === pid))) reloadProjectRef.current().catch(() => undefined);
    if (reloadAll || all.some((c) => c.projectId !== 'GLOBAL')) reloadProjects().catch(() => undefined);
    if (reloadAll || all.some((c) => c.action.startsWith('HOLIDAY'))) reloadHolidays().catch(() => undefined);
    if (reloadAll) toast('Large update from another user loaded');
    setLiveAt(new Date());
    if (!others.length) return;
    const groups = new Map<string, { by: string; name: string; rows: Set<string> }>();
    for (const c of others) {
      const name = c.projectId === 'GLOBAL' ? 'the holiday calendar' : c.projectName || 'a project';
      const k = `${c.by}|${name}`;
      const g = groups.get(k) ?? { by: c.by || 'Someone', name, rows: new Set<string>() };
      if (c.activityId) g.rows.add(c.activityId);
      groups.set(k, g);
    }
    for (const g of [...groups.values()].slice(0, 3))
      toast(`${g.by} updated ${g.name}${g.rows.size > 1 ? ` (${g.rows.size} activities)` : g.rows.size === 1 ? ' (1 activity)' : ''}${saveFn.current ? '. Your unsaved edits are kept.' : ''}`);
  }, [reloadProjects, reloadHolidays, toast]);
  const liveStatus = useLiveUpdates(true, user.email, onLive);

  const cal = useMemo(() => new WorkCalendar(holidays), [holidays]);
  // The schedule logic runs on every activity; each department only sees its own sections.
  const visible = useMemo(() => activities.filter((a) => canSeeActivity(user, a)), [activities, user]);
  const model = useMemo<Model | null>(() => {
    if (!project || !activities.length || activities[0].projectId !== project.id || !visible.length) return null;
    const today = todayIso();
    const an = analyzeProject(activities, cal, today);
    const kpis = computeKpis(visible, cal, an);
    const curve = buildSCurve(visible, cal, an, hist);
    return {
      cal, today, an, kpis, curve, hist,
      sections: summarizeBy(visible, 'section', cal, an),
      depts: summarizeBy(visible, 'department', cal, an),
      validation: validateModel(visible, cal, an, curve, kpis, hist),
    };
  }, [project, activities, visible, cal, hist]);

  const setView = (v: View) => {
    setViewState(v);
    try { localStorage.setItem('swelect.view', v); } catch { /* private mode */ }
    setNavOpen(false);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0 });
  };
  const pageModule = allowed(user, view) ? moduleOf(view) : null;
  const viewUser = useMemo(() => (pageModule ? { ...user, canEdit: canEditModule(user, pageModule) } : user), [user, pageModule]);
  const ctx: Ctx = {
    user: viewUser, storeKind, projects, summaries, project, activities: visible, holidays, model, cal, view, setView,
    selectProject: (id) => setProjectId(id),
    openProject: (id) => { setProjectId(id); setView('dashboard'); },
    closeProject: () => { setProjectId(null); setView('projects'); },
    reloadProjects, reloadProject, reloadHolidays,
    applyUpdate: (r) => {
      setProject(r.project);
      setActivities(r.activities);
      setProjects((ps) => ps.map((p) => (p.id === r.project.id ? r.project : p)));
      reloadProjects().catch(() => undefined);
      api.progressHistory(r.project.id).then((h) => setHist(historyFromAudit(h.logs))).catch(() => undefined);
      markSaved();
    },
    toast,
    registerSave: (fn) => { saveFn.current = fn; },
    markSaved,
  };

  const logout = async () => {
    await api.logout().catch(() => undefined);
    onLogout();
  };

  const save = async () => {
    setBusy('save');
    try {
      if (saveFn.current) await saveFn.current();
      else await Promise.all([reloadProject(), reloadProjects()]);
      markSaved();
      toast('All changes saved to Supabase');
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setBusy('');
    }
  };
  const exportFile = async (kind: 'pdf' | 'xlsx') => {
    if (!project || !model) return toast('Open a project first', 'err');
    setBusy(kind);
    try {
      const report = generateReport(project, visible, model.an, model.kpis, model.sections, model.depts);
      const x = { project, activities: visible, cal: model.cal, today: model.today, an: model.an, kpis: model.kpis, sections: model.sections, depts: model.depts, curve: model.curve, hist: model.hist, validation: model.validation, report, user: user.email };
      if (kind === 'pdf') await (await import('@/lib/exportPdf')).exportPdf(x);
      else await (await import('@/lib/exportExcel')).exportExcel(x);
      toast(kind === 'pdf' ? 'PDF report downloaded' : 'Excel workbook downloaded');
    } catch (e) {
      toast(`Export failed: ${(e as Error).message}`, 'err');
    } finally {
      setBusy('');
    }
  };

  const navItems = NAV.filter((n) => allowed(user, n.view));
  const current = navItems.find((n) => n.view === view) ?? NAV[0];
  const onProjectPage = PROJECT_VIEWS.includes(current.view);
  let body: ReactNode;
  if (loading) body = <Spinner />;
  else if (current.needsProject && !projectId) body = <ProjectsView notice="Open a project here first. Password-protected projects ask for their password." />;
  else if (current.needsProject && !project) body = <Spinner label="Opening project…" />;
  else if (current.needsProject && project && !model)
    body = loadedFor === project.id && !visible.length
      ? <EmptySchedule project={project} full={hasFullAccess(user)} hasAny={activities.length > 0} cal={cal} onDone={() => Promise.all([reloadProject(), reloadProjects()]).then(() => undefined)} toast={toast} />
      : <Spinner label="Loading project schedule…" />;
  else
    body = {
      home: <HomeView />, news: <NewsView />, reputation: <ReputationView />, social: <SocialView />, leads: <LeadsView />, settings: <SettingsView />, access: <AccessView />,
      projects: <ProjectsView />, setup: <ProjectSetupPage />, schedule: <ScheduleSheet />, gantt: <GanttView />, dashboard: <Dashboard />,
      delays: <DelaysView />, staff: <StaffView />, report: <ReportView />, calendar: <CalendarView />, users: <UsersView />, audit: <AuditView />,
    }[current.view];

  const badges: Partial<Record<View, string>> = { schedule: `${visible.length || 165} Act`, delays: 'Live Risk', report: 'AI', staff: 'Incharge', };
  const timeStr = savedAt?.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' });

  return (
    <AppCtx.Provider value={ctx}>
      <div className="min-h-screen bg-dark-950 text-slate-200">
        <div className="fixed inset-x-0 top-0 z-50 h-1 bg-gradient-to-r from-blue-700 via-blue-500 to-blue-700" />
        {/* Sidebar */}
        <aside className={clsx('fixed inset-y-0 left-0 z-40 mt-1 flex w-72 flex-col border-r border-dark-700 bg-[#0a0e16] transition-transform lg:translate-x-0', navOpen ? 'translate-x-0' : '-translate-x-full')}>
          <div className="border-b border-dark-700 px-5 pb-4 pt-5">
            <div className="flex justify-center rounded-xl bg-white py-3"><Logo size="md" /></div>
            <div className="mt-3 flex items-center justify-between">
              <span className="font-mono text-[11px] font-bold tracking-[0.15em] text-solar-gold">SWELECT WORKSPACE</span>
              <span className="h-2 w-2 rounded-full bg-brand-emerald" />
            </div>
            <div className="font-mono text-[11px] text-slate-400">Projects · Marketing · Sales</div>
          </div>
          {project && onProjectPage && (
            <div className="mx-4 mt-4 rounded-xl border border-dark-700 bg-dark-900 p-3">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase text-slate-400"><Zap className="h-3.5 w-3.5 text-solar-amber" />Active Project</span>
                <span className="rounded border border-solar-amber/40 bg-solar-amber/10 px-1.5 py-0.5 font-mono text-[10px] font-bold text-solar-gold">{project.capacityMw} MW</span>
              </div>
              <div className="mt-1.5 truncate text-sm font-semibold text-white">{project.name}</div>
              <div className="truncate text-xs text-slate-400">{[project.district, project.state].filter(Boolean).join(', ')}</div>
              {!hasFullAccess(user) && <div className="mt-2 rounded bg-brand-blue/15 px-2 py-1 text-[11px] text-blue-200">View: {user.department} sections only</div>}
            </div>
          )}
          <nav className="mt-3 flex-1 space-y-0.5 overflow-y-auto px-4 py-2">
            {navItems.map((n, i) => (
              <div key={n.view}>
              {n.group && n.group !== navItems[i - 1]?.group && <div className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{n.group}</div>}
              <button onClick={() => setView(n.view)}
                className={clsx('flex w-full items-center gap-3 rounded-lg border-l-2 px-3 py-2 text-[14px] transition', view === n.view ? 'border-solar-amber bg-gradient-to-r from-solar-amber/20 to-transparent font-semibold text-solar-gold' : 'border-transparent text-slate-200 hover:bg-dark-800')}>
                {n.icon}
                <span className="flex-1 text-left">{n.label}</span>
                {badges[n.view] && <span className="rounded bg-dark-700 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">{badges[n.view]}</span>}
              </button>
              </div>
            ))}
          </nav>
          <div className="border-t border-dark-700 p-4">
            <div className="flex items-center gap-3 rounded-xl border border-dark-700 bg-dark-900 p-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-solar-amber/20 text-xs font-extrabold text-solar-gold">{user.department}</div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-white">{DEPARTMENT_NAMES[user.department as Department] ?? user.name}</div>
                <div className="truncate text-xs text-slate-400">{user.email}</div>
              </div>
              <button title="Change password" onClick={() => setPwOpen(true)} className="text-slate-400 hover:text-white"><KeyRound className="h-4 w-4" /></button>
              <button title="Sign out" onClick={logout} className="text-slate-400 hover:text-white"><LogOut className="h-4 w-4" /></button>
            </div>
          </div>
        </aside>
        {navOpen && <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setNavOpen(false)} />}

        <div className="flex min-w-0 flex-col pt-1 lg:pl-72">
          <header className="sticky top-1 z-20 flex flex-wrap items-center gap-2 border-b border-dark-700 bg-[#0a0e16]/95 px-3 py-2 backdrop-blur sm:gap-2.5 sm:px-4 sm:py-3 lg:px-6">
            <button className="rounded p-1.5 text-slate-300 hover:bg-dark-800 lg:hidden" onClick={() => setNavOpen(true)} aria-label="Menu"><Menu className="h-5 w-5" /></button>
            <Logo size="sm" />
            <span className="hidden text-sm font-bold text-white sm:inline">{current.label}</span>
            {onProjectPage && projects.length > 0 && (
              <div className="order-last flex w-full items-center gap-2 sm:order-none sm:w-auto">
                <span className="truncate rounded-lg border border-dark-600 bg-dark-900 px-3 py-2 text-sm font-semibold text-white sm:max-w-[300px]">
                  {project ? `${project.locked ? '🔒 ' : ''}${project.name} (${project.capacityMw} MW - ${project.projectType})` : 'No project open'}
                </span>
                {view !== 'projects' && <button onClick={() => setView('projects')} className="shrink-0 rounded-lg border border-dark-600 px-2.5 py-2 text-xs font-semibold text-slate-300 hover:border-solar-amber/60 hover:text-white">{project ? 'Change' : 'Open a project'}</button>}
              </div>
            )}
            {onProjectPage && project && <span className={clsx('hidden rounded-full border px-3 py-1 text-xs font-semibold sm:inline', statusPill(project.status))}>● {project.status}</span>}
            {onProjectPage && project?.locked && (
              <button title="Lock this project again" aria-label="Lock project"
                onClick={async () => { try { await api.lockProject(project.id); setProjectId(null); setView('projects'); await reloadProjects(); toast('Project locked'); } catch (e) { toast((e as Error).message, 'err'); } }}
                className="flex items-center gap-1.5 rounded-lg border border-solar-amber/50 bg-solar-amber/10 px-2.5 py-1.5 text-xs font-semibold text-solar-gold hover:bg-solar-amber/20"><Lock className="h-3.5 w-3.5" /><span className="hidden sm:inline">Lock</span></button>
            )}
            {onProjectPage && project && <span className="hidden rounded border border-dark-600 bg-dark-900 px-2.5 py-1 font-mono text-xs text-slate-300 md:inline">{project.state || '—'} • {project.capacityMw} MW</span>}
            <div className="ml-auto flex flex-wrap items-center gap-1.5 sm:gap-2">
              {storeKind === 'memory' ? (
                <span className="hidden rounded-lg md:inline border border-brand-rose/50 bg-brand-rose/10 px-3 py-1.5 text-xs font-semibold text-rose-300">Demo mode · not saved</span>
              ) : (
                <span className={clsx('hidden items-center gap-1.5 rounded-lg border px-3 py-1.5 font-mono text-xs font-semibold md:flex', syncErr ? 'border-brand-rose/50 bg-brand-rose/10 text-rose-300' : 'border-brand-emerald/40 bg-brand-emerald/10 text-emerald-300')}>
                  <Cloud className="h-3.5 w-3.5" />{syncErr ? 'Sync error' : savedAt ? `Saved ${timeStr}` : 'Supabase Synced'}<span className={clsx('h-1.5 w-1.5 rounded-full', syncErr ? 'bg-brand-rose' : 'bg-brand-emerald')} />
                </span>
              )}
              <span title={liveStatus === 'live' ? `Live: changes by other users appear within seconds${liveAt ? ` (last update ${liveAt.toLocaleTimeString()})` : ''}` : liveStatus === 'polling' ? 'Auto-sync: checking for other users\' changes every 10 seconds' : liveStatus === 'offline' ? 'No internet connection. Changes will sync when you are back online.' : 'Connecting…'}
                className={clsx('flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold', liveStatus === 'live' ? 'border-brand-emerald/40 bg-brand-emerald/10 text-emerald-300' : liveStatus === 'offline' ? 'border-brand-rose/50 bg-brand-rose/10 text-rose-300' : 'border-solar-amber/40 bg-solar-amber/10 text-solar-gold')}>
                <span className="relative flex h-2 w-2">
                  {liveStatus === 'live' && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-emerald opacity-60" />}
                  <span className={clsx('relative inline-flex h-2 w-2 rounded-full', liveStatus === 'live' ? 'bg-brand-emerald' : liveStatus === 'offline' ? 'bg-brand-rose' : 'bg-solar-gold')} />
                </span>
                <span className="hidden sm:inline">{liveStatus === 'live' ? 'Live' : liveStatus === 'polling' ? 'Auto-sync' : liveStatus === 'offline' ? 'Offline' : 'Connecting'}</span>
              </span>
              {onProjectPage && <>
              <button onClick={save} disabled={!!busy} aria-label="Save" title="Save" className="flex items-center gap-1.5 rounded-lg border border-solar-amber/50 bg-solar-amber/10 px-3 py-1.5 text-sm font-semibold text-solar-gold hover:bg-solar-amber/20">
                {busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}<span className="hidden sm:inline">Save</span>
              </button>
              {user.canExport && (
                <>
                  <button onClick={() => exportFile('xlsx')} disabled={!!busy} aria-label="Export Excel" title="Export Excel" className="flex items-center gap-1.5 rounded-lg border border-brand-emerald/50 bg-brand-emerald/10 px-3 py-1.5 text-sm font-semibold text-emerald-300 hover:bg-brand-emerald/20">
                    {busy === 'xlsx' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}<span className="hidden sm:inline">Excel</span>
                  </button>
                  <button onClick={() => exportFile('pdf')} disabled={!!busy} aria-label="Export PDF" title="Export PDF" className="flex items-center gap-1.5 rounded-lg border border-brand-rose/50 bg-brand-rose/10 px-3 py-1.5 text-sm font-semibold text-rose-300 hover:bg-brand-rose/20">
                    {busy === 'pdf' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}<span className="hidden sm:inline">PDF</span>
                  </button>
                </>
              )}
              </>}
              <span className="hidden items-center gap-1.5 rounded-lg border border-solar-amber/40 bg-dark-900 px-3 py-1.5 text-xs font-bold text-solar-gold sm:flex"><span className="h-2 w-2 rounded-full bg-solar-gold" />{user.department}</span>
            </div>
          </header>
          <main className="flex-1 px-3 py-4 sm:px-4 sm:py-5 lg:px-6">{body}</main>
          <footer className="border-t border-dark-800 px-6 py-3 text-center text-[11px] text-slate-500">SWELECT Energy Systems Limited · Powering the world responsibly · Confidential</footer>
        </div>

        <PasswordModal open={pwOpen} forced={user.mustChangePassword} onClose={() => setPwOpen(false)} onDone={() => { setPwOpen(false); onUser({ ...user, mustChangePassword: false }); toast('Password changed'); }} />

        <div className="fixed bottom-4 right-4 z-[60] space-y-2">
          {toasts.map((t) => (
            <div key={t.id} className={clsx('flex max-w-sm items-start gap-2 rounded-lg border px-4 py-3 text-sm shadow-xl', isCredit(t.msg) && 'text-base font-extrabold', t.kind === 'ok' ? 'border-brand-emerald/40 bg-dark-850 text-emerald-200' : 'border-brand-rose/50 bg-dark-850 text-rose-200')}>
              {t.kind === 'ok' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" />}
              {t.msg}
            </div>
          ))}
        </div>
      </div>
    </AppCtx.Provider>
  );
}


function OfflineScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-dark-950 p-6">
      <div className="max-w-sm rounded-2xl border border-dark-700 bg-[#0b111c] p-8 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white"><Logo size="sm" /></div>
        <div className="mt-4 text-lg font-bold text-white">You&apos;re offline</div>
        <p className="mt-2 text-sm text-slate-400">SWELECT Project Control needs the internet to show live project data. It will open by itself as soon as you&apos;re connected.</p>
        <div className="mt-5"><Button onClick={() => location.reload()}>Try again</Button></div>
      </div>
    </div>
  );
}

/** Shown instead of an endless spinner when a project has no activities (or none for this department). */
function EmptySchedule({ project, full, hasAny, cal, onDone, toast }: { project: Project; full: boolean; hasAny: boolean; cal: WorkCalendar; onDone: () => Promise<void>; toast: (m: string, k?: 'ok' | 'err') => void }) {
  const [busy, setBusy] = useState(false);
  const rebuild = async () => {
    setBusy(true);
    try {
      const wd = Math.max(5, cal.countWorking(project.plannedStartDate, project.plannedEndDate));
      await api.updateProject(project.id, { refit: true, plannedDuration: wd } as Partial<Project>);
      await onDone();
      toast('Standard schedule rebuilt');
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mx-auto mt-10 max-w-xl rounded-2xl border border-dark-700 bg-[#0b111c] p-8 text-center">
      <div className="text-lg font-bold text-white">{hasAny ? 'No activities for your department in this project' : 'This project has no activities'}</div>
      <p className="mt-2 text-sm text-slate-400">{hasAny
        ? 'Your login only shows your own department\'s sections, and this project has none yet. Ask Planning (PLAN) to add them.'
        : 'The schedule is empty. Rebuild the standard 165-activity schedule, or import an Excel file from the Excel Import page.'}</p>
      {!hasAny && full && <div className="mt-5"><Button onClick={rebuild} loading={busy}>Rebuild standard schedule</Button></div>}
    </div>
  );
}

function PasswordModal({ open, forced, onClose, onDone }: { open: boolean; forced: boolean; onClose: () => void; onDone: () => void }) {
  const [cur, setCur] = useState('');
  const [np, setNp] = useState('');
  const [np2, setNp2] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setErr('');
    if (np !== np2) return setErr('New passwords do not match');
    setBusy(true);
    try {
      await api.changePassword(cur, np);
      setCur(''); setNp(''); setNp2('');
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={forced ? () => undefined : onClose} title={forced ? 'Set your own password' : 'Change password'}>
      {forced && <p className="mb-4 rounded-lg bg-solar-amber/10 p-3 text-sm text-solar-gold">You signed in with a temporary password. Choose a new one to continue editing.</p>}
      <div className="space-y-3">
        <Field label="Current password"><Input type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" /></Field>
        <Field label="New password" hint="At least 8 characters with letters and numbers"><Input type="password" value={np} onChange={(e) => setNp(e.target.value)} autoComplete="new-password" /></Field>
        <Field label="Confirm new password"><Input type="password" value={np2} onChange={(e) => setNp2(e.target.value)} autoComplete="new-password" /></Field>
        {err && <p className={isCredit(err) ? 'text-base font-extrabold text-brand-rose' : 'text-sm text-brand-rose'}>{err}</p>}
        <div className="flex justify-end gap-2 pt-2">
          {!forced && <Button variant="ghost" onClick={onClose}>Cancel</Button>}
          <Button onClick={submit} loading={busy}>Update password</Button>
        </div>
      </div>
    </Modal>
  );
}
