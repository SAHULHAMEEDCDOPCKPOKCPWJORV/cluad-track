// Data layer. Supabase (service-role, server only) in production; optional in-memory store for local demos.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import type { Activity, AppUser, AuditLog, Holiday, Project } from '@/lib/types';
import { DEFAULT_HOLIDAYS } from '@/lib/calendar';
import { resilientFetch, TtlCache } from './resilience';

export type UserRecord = AppUser & { passwordHash: string | null };

export interface Store {
  kind: 'supabase' | 'memory';
  getUserByEmail(email: string): Promise<UserRecord | null>;
  getUser(id: string): Promise<UserRecord | null>;
  listUsers(): Promise<AppUser[]>;
  createUser(u: AppUser, passwordHash: string): Promise<void>;
  updateUser(id: string, patch: Partial<UserRecord>): Promise<void>;
  listProjects(): Promise<Project[]>;
  getProject(id: string): Promise<Project | null>;
  saveProject(p: Project): Promise<void>;
  deleteProject(id: string): Promise<void>;
  listActivities(projectId: string): Promise<Activity[]>;
  activitySummaries(): Promise<ProjectSummary[]>;
  upsertActivities(acts: Activity[]): Promise<void>;
  deleteActivities(ids: string[]): Promise<void>;
  listHolidays(): Promise<Holiday[]>;
  upsertHolidays(h: Holiday[]): Promise<void>;
  deleteHoliday(date: string): Promise<void>;
  addAudit(logs: AuditLog[]): Promise<void>;
  listAudit(opts: { projectId?: string; limit?: number; field?: string }): Promise<AuditLog[]>;
  /** The newest `limit` changes (not sign-ins) recorded after `since`, returned oldest first. Feeds live updates. */
  listChangesSince(since: string, limit: number): Promise<AuditLog[]>;
}

export interface ProjectSummary {
  projectId: string;
  activities: number;
  completed: number;
  delayed: number;
  onHold: number;
  progress: number;
}

function summarise(rows: { project_id: string; progress_percent: number; weightage: number; status: string }[]): ProjectSummary[] {
  const m = new Map<string, ProjectSummary & { w: number; ew: number }>();
  for (const r of rows) {
    const s = m.get(r.project_id) ?? { projectId: r.project_id, activities: 0, completed: 0, delayed: 0, onHold: 0, progress: 0, w: 0, ew: 0 };
    s.activities++;
    if (Number(r.progress_percent) >= 100) s.completed++;
    if (r.status === 'Delayed') s.delayed++;
    if (r.status === 'On Hold') s.onHold++;
    s.w += Number(r.weightage) || 0;
    s.ew += ((Number(r.weightage) || 0) * Number(r.progress_percent)) / 100;
    m.set(r.project_id, s);
  }
  return [...m.values()].map(({ w, ew, ...s }) => ({ ...s, progress: w > 0 ? Math.round((ew / w) * 1000) / 10 : 0 }));
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// ───────────── row mappers ─────────────
const projectToRow = (p: Project) => ({
  id: p.id, name: p.name, capacity_mw: p.capacityMw, project_type: p.projectType, state: p.state, district: p.district,
  village: p.village, planned_start_date: p.plannedStartDate, planned_end_date: p.plannedEndDate,
  actual_start_date: p.actualStartDate, actual_end_date: p.actualEndDate, description: p.description, status: p.status,
  updated_at: new Date().toISOString(),
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
const rowToProject = (r: Row): Project => ({
  id: r.id, name: r.name, capacityMw: Number(r.capacity_mw ?? 0), projectType: r.project_type ?? 'Solar EPC', state: r.state ?? '',
  district: r.district ?? '', village: r.village ?? '', plannedStartDate: r.planned_start_date, plannedEndDate: r.planned_end_date,
  actualStartDate: r.actual_start_date, actualEndDate: r.actual_end_date, description: r.description ?? '', status: r.status ?? 'In Progress',
  createdAt: r.created_at, updatedAt: r.updated_at,
});
const activityToRow = (a: Activity) => ({
  id: a.id, project_id: a.projectId, s_no: a.sNo, activity_id: a.activityId, activity_name: a.activityName, section: a.section,
  department: a.department, planned_duration: a.plannedDuration, planned_start_date: a.plannedStartDate, planned_end_date: a.plannedEndDate,
  baseline_start_date: a.baselineStartDate, baseline_end_date: a.baselineEndDate, actual_duration: a.actualDuration,
  actual_start_date: a.actualStartDate, actual_end_date: a.actualEndDate, progress_percent: a.progressPercent, weightage: a.weightage,
  is_milestone: a.isMilestone, delay_days: a.delayDays, delay_label: a.delayLabel, status: a.status, remarks: a.remarks ?? '', incharge: a.incharge ?? '', delay_reason: a.delayReason ?? '', incharge_perf: a.inchargePerf ?? null,
  updated_at: new Date().toISOString(), updated_by: a.updatedBy ?? 'system',
});
const rowToActivity = (r: Row): Activity => ({
  id: r.id, projectId: r.project_id, sNo: r.s_no ?? 0, activityId: r.activity_id, activityName: r.activity_name, section: r.section,
  department: r.department, plannedDuration: Number(r.planned_duration ?? 0), plannedStartDate: r.planned_start_date, plannedEndDate: r.planned_end_date,
  baselineStartDate: r.baseline_start_date ?? null, baselineEndDate: r.baseline_end_date ?? null,
  actualDuration: r.actual_duration == null ? null : Number(r.actual_duration), actualStartDate: r.actual_start_date, actualEndDate: r.actual_end_date,
  progressPercent: Number(r.progress_percent ?? 0), weightage: Number(r.weightage ?? 0), isMilestone: !!r.is_milestone,
  delayDays: Number(r.delay_days ?? 0), delayLabel: r.delay_label ?? '0', status: r.status ?? 'Not Started', remarks: r.remarks ?? '', incharge: r.incharge ?? '', delayReason: r.delay_reason ?? '', inchargePerf: r.incharge_perf == null ? null : Number(r.incharge_perf),
  updatedAt: r.updated_at, updatedBy: r.updated_by,
});
const userToRow = (u: Partial<UserRecord>) => {
  const r: Row = {};
  if (u.id !== undefined) r.id = u.id;
  if (u.email !== undefined) r.email = u.email.toLowerCase();
  if (u.department !== undefined) r.department = u.department;
  if (u.role !== undefined) r.role = u.role;
  if (u.name !== undefined) r.name = u.name;
  if (u.isActive !== undefined) r.is_active = u.isActive;
  if (u.canEdit !== undefined) r.can_edit = u.canEdit;
  if (u.canExport !== undefined) r.can_export = u.canExport;
  if (u.canApprove !== undefined) r.can_approve = u.canApprove;
  if (u.mustChangePassword !== undefined) r.must_change_password = u.mustChangePassword;
  if (u.passwordHash !== undefined) r.password_hash = u.passwordHash;
  return r;
};
const rowToUser = (r: Row): UserRecord => ({
  id: r.id, email: r.email, department: r.department, role: r.role, name: r.name, isActive: r.is_active !== false,
  canEdit: r.can_edit !== false, canExport: r.can_export !== false, canApprove: !!r.can_approve,
  mustChangePassword: !!r.must_change_password, createdAt: r.created_at, passwordHash: r.password_hash ?? null,
});
const auditToRow = (l: AuditLog) => ({
  id: l.id, project_id: l.projectId, project_name: l.projectName, user_id: l.userId, user_email: l.userEmail, department: l.department,
  action: l.action, activity_id: l.activityId, activity_name: l.activityName, field_name: l.fieldName, old_value: l.oldValue,
  new_value: l.newValue, timestamp: l.timestamp,
});
const rowToAudit = (r: Row): AuditLog => ({
  id: r.id, projectId: r.project_id, projectName: r.project_name, userId: r.user_id, userEmail: r.user_email, department: r.department,
  action: r.action, activityId: r.activity_id, activityName: r.activity_name, fieldName: r.field_name, oldValue: r.old_value,
  newValue: r.new_value, timestamp: r.timestamp,
});
const publicUser = ({ passwordHash: _ph, ...u }: UserRecord): AppUser => u;

// ───────────── Supabase ─────────────
class SupabaseStore implements Store {
  kind = 'supabase' as const;
  // Short server-side caches for data read on almost every request but rarely changed.
  // Writes on this server clear them at once; other servers see a change within the time limit.
  private holidayCache = new TtlCache<Holiday[]>(60_000, 1);
  private userCache = new TtlCache<UserRecord | null>(30_000);
  constructor(readonly db: SupabaseClient) {}
  private check<T>(res: { data: T; error: { message: string } | null }): T {
    if (res.error) throw new HttpError(500, `Database error: ${res.error.message}`);
    return res.data;
  }
  async getUserByEmail(email: string) {
    const d = this.check(await this.db.from('swelect_users').select('*').eq('email', email.trim().toLowerCase()).maybeSingle());
    return d ? rowToUser(d) : null;
  }
  async getUser(id: string) {
    const hit = this.userCache.get(id);
    if (hit !== undefined) return hit;
    const u = await this.getUserFresh(id);
    this.userCache.set(id, u);
    return u;
  }
  private async getUserFresh(id: string) {
    const d = this.check(await this.db.from('swelect_users').select('*').eq('id', id).maybeSingle());
    return d ? rowToUser(d) : null;
  }
  async listUsers() {
    return (this.check(await this.db.from('swelect_users').select('*').order('created_at')) ?? []).map((r: Row) => publicUser(rowToUser(r)));
  }
  async createUser(u: AppUser, passwordHash: string) {
    this.check(await this.db.from('swelect_users').insert(userToRow({ ...u, passwordHash })));
  }
  async updateUser(id: string, patch: Partial<UserRecord>) {
    this.check(await this.db.from('swelect_users').update(userToRow(patch)).eq('id', id));
    this.userCache.delete(id);
  }
  async listProjects() {
    return (this.check(await this.db.from('swelect_projects').select('*').order('created_at', { ascending: false })) ?? []).map(rowToProject);
  }
  async getProject(id: string) {
    const d = this.check(await this.db.from('swelect_projects').select('*').eq('id', id).maybeSingle());
    return d ? rowToProject(d) : null;
  }
  async saveProject(p: Project) {
    this.check(await this.db.from('swelect_projects').upsert(projectToRow(p)));
  }
  async deleteProject(id: string) {
    this.check(await this.db.from('swelect_projects').delete().eq('id', id));
  }
  async listActivities(projectId: string) {
    return (this.check(await this.db.from('swelect_activities').select('*').eq('project_id', projectId).order('s_no').limit(2000)) ?? []).map(rowToActivity);
  }
  async activitySummaries() {
    const rows: { project_id: string; progress_percent: number; weightage: number; status: string }[] = [];
    for (let from = 0; ; from += 1000) {
      const page = this.check(await this.db.from('swelect_activities').select('project_id,progress_percent,weightage,status').range(from, from + 999)) ?? [];
      rows.push(...page);
      if (page.length < 1000) break;
    }
    return summarise(rows);
  }
  async upsertActivities(acts: Activity[]) {
    for (let i = 0; i < acts.length; i += 500) this.check(await this.db.from('swelect_activities').upsert(acts.slice(i, i + 500).map(activityToRow)));
  }
  async deleteActivities(ids: string[]) {
    if (ids.length) this.check(await this.db.from('swelect_activities').delete().in('id', ids));
  }
  async listHolidays() {
    const hit = this.holidayCache.get('all');
    if (hit) return hit;
    const h = (this.check(await this.db.from('swelect_holidays').select('*').order('date')) ?? []) as Holiday[];
    this.holidayCache.set('all', h);
    return h;
  }
  async upsertHolidays(h: Holiday[]) {
    this.check(await this.db.from('swelect_holidays').upsert(h));
    this.holidayCache.clear();
  }
  async deleteHoliday(date: string) {
    this.check(await this.db.from('swelect_holidays').delete().eq('date', date));
    this.holidayCache.clear();
  }
  async addAudit(logs: AuditLog[]) {
    for (let i = 0; i < logs.length; i += 500) this.check(await this.db.from('swelect_audit_logs').insert(logs.slice(i, i + 500).map(auditToRow)));
  }
  async listAudit({ projectId, limit = 500, field }: { projectId?: string; limit?: number; field?: string }) {
    let q = this.db.from('swelect_audit_logs').select('*').order('timestamp', { ascending: false }).limit(Math.min(limit, 5000));
    if (projectId) q = q.eq('project_id', projectId);
    if (field) q = q.eq('field_name', field);
    return (this.check(await q) ?? []).map(rowToAudit);
  }
  async listChangesSince(since: string, limit: number) {
    const q = this.db.from('swelect_audit_logs').select('id,project_id,project_name,user_email,department,action,activity_id,timestamp')
      .gt('timestamp', since).neq('action', 'LOGIN').order('timestamp', { ascending: false }).limit(limit);
    return (this.check(await q) ?? []).map(rowToAudit).reverse();
  }
}

// ───────────── Memory (local demo only) ─────────────
interface Mem {
  users: Map<string, UserRecord>;
  projects: Map<string, Project>;
  activities: Map<string, Activity>;
  holidays: Map<string, Holiday>;
  audit: AuditLog[];
}
class MemoryStore implements Store {
  kind = 'memory' as const;
  constructor(private m: Mem) {}
  async getUserByEmail(email: string) {
    return [...this.m.users.values()].find((u) => u.email.toLowerCase() === email.trim().toLowerCase()) ?? null;
  }
  async getUser(id: string) {
    return this.m.users.get(id) ?? null;
  }
  async listUsers() {
    return [...this.m.users.values()].map(publicUser);
  }
  async createUser(u: AppUser, passwordHash: string) {
    if (await this.getUserByEmail(u.email)) throw new HttpError(409, 'Email already exists');
    this.m.users.set(u.id, { ...u, passwordHash, createdAt: new Date().toISOString() });
  }
  async updateUser(id: string, patch: Partial<UserRecord>) {
    const u = this.m.users.get(id);
    if (u) this.m.users.set(id, { ...u, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) });
  }
  async listProjects() {
    return [...this.m.projects.values()].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }
  async getProject(id: string) {
    return this.m.projects.get(id) ?? null;
  }
  async saveProject(p: Project) {
    const prev = this.m.projects.get(p.id);
    this.m.projects.set(p.id, { ...p, createdAt: prev?.createdAt ?? new Date().toISOString(), updatedAt: new Date().toISOString() });
  }
  async deleteProject(id: string) {
    this.m.projects.delete(id);
    for (const [k, a] of this.m.activities) if (a.projectId === id) this.m.activities.delete(k);
  }
  async listActivities(projectId: string) {
    return [...this.m.activities.values()].filter((a) => a.projectId === projectId).sort((a, b) => a.sNo - b.sNo);
  }
  async activitySummaries() {
    return summarise([...this.m.activities.values()].map((a) => ({ project_id: a.projectId, progress_percent: a.progressPercent, weightage: a.weightage, status: String(a.status) })));
  }
  async upsertActivities(acts: Activity[]) {
    for (const a of acts) this.m.activities.set(a.id, { ...a, updatedAt: new Date().toISOString() });
  }
  async deleteActivities(ids: string[]) {
    for (const id of ids) this.m.activities.delete(id);
  }
  async listHolidays() {
    return [...this.m.holidays.values()].sort((a, b) => a.date.localeCompare(b.date));
  }
  async upsertHolidays(h: Holiday[]) {
    for (const x of h) this.m.holidays.set(x.date, x);
  }
  async deleteHoliday(date: string) {
    this.m.holidays.delete(date);
  }
  async addAudit(logs: AuditLog[]) {
    this.m.audit.unshift(...logs);
  }
  async listAudit({ projectId, limit = 500, field }: { projectId?: string; limit?: number; field?: string }) {
    return this.m.audit.filter((l) => (!projectId || l.projectId === projectId) && (!field || l.fieldName === field)).slice(0, limit);
  }
  async listChangesSince(since: string, limit: number) {
    return this.m.audit.filter((l) => l.timestamp > since && l.action !== 'LOGIN').sort((a, b) => a.timestamp.localeCompare(b.timestamp)).slice(-limit);
  }
}

export const SEED_USERS: Omit<AppUser, 'id'>[] = [
  { email: 'plan@swelect.com', department: 'PLAN', role: 'Admin', name: 'Planning & Project Control', isActive: true, canEdit: true, canExport: true, canApprove: true },
  { email: 'land@swelect.com', department: 'LAND', role: 'Department Lead', name: 'Land & Statutory Approvals', isActive: true, canEdit: true, canExport: true, canApprove: false },
  { email: 'eng@swelect.com', department: 'ENG', role: 'Department Lead', name: 'Engineering & Design', isActive: true, canEdit: true, canExport: true, canApprove: false },
  { email: 'pro@swelect.com', department: 'PRO', role: 'Department Lead', name: 'Procurement & Logistics', isActive: true, canEdit: true, canExport: true, canApprove: false },
  { email: 'site@swelect.com', department: 'SITE', role: 'Department Lead', name: 'Site Execution', isActive: true, canEdit: true, canExport: true, canApprove: false },
  { email: 'trn@swelect.com', department: 'TRN', role: 'Department Lead', name: 'Transmission & Evacuation', isActive: true, canEdit: true, canExport: true, canApprove: false },
  { email: 'comm@swelect.com', department: 'COMM', role: 'Department Lead', name: 'Testing & Commissioning', isActive: true, canEdit: true, canExport: true, canApprove: false },
];

const g = globalThis as unknown as { __swelectMem?: Mem; __swelectStore?: Store };

function memory(): Store {
  if (!g.__swelectMem) {
    const pw = process.env.DEMO_PASSWORD || 'Demo-pass1';
    const hash = bcrypt.hashSync(pw, 10);
    g.__swelectMem = {
      users: new Map(SEED_USERS.map((u, i) => [`U${i + 1}`, { ...u, id: `U${i + 1}`, passwordHash: hash, mustChangePassword: false, createdAt: new Date().toISOString() }])),
      projects: new Map(),
      activities: new Map(),
      holidays: new Map(DEFAULT_HOLIDAYS.map((h) => [h.date, h])),
      audit: [],
    };
  }
  return new MemoryStore(g.__swelectMem);
}

export function isDemoMode() {
  if (process.env.SWELECT_STORE === 'memory') return true;
  // Local development without keys: fall back to demo data so `npm run dev` always works.
  return process.env.NODE_ENV !== 'production' && !process.env.SUPABASE_SERVICE_ROLE_KEY;
}

export function getStore(): Store {
  if (g.__swelectStore) return g.__swelectStore;
  if (isDemoMode()) return (g.__swelectStore = memory());
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new HttpError(503, 'Server not configured: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  // Every database request goes through a timeout + retry-on-read + circuit breaker.
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: resilientFetch('Database', { timeoutMs: 10_000 }) } });
  return (g.__swelectStore = new SupabaseStore(db));
}

/** Raw database client for the marketing & sales modules (null in local demo mode). */
export function getDb(): SupabaseClient | null {
  const s = getStore();
  return s instanceof SupabaseStore ? s.db : null;
}
