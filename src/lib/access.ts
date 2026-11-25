// Department-based visibility: PLAN and COMM (and any Admin) see every section;
// other departments see only the activities their department owns.
import type { Activity } from './types';

export const FULL_ACCESS_DEPTS = ['PLAN', 'COMM'];

export const hasFullAccess = (u: { department: string; role: string }) => u.role === 'Admin' || FULL_ACCESS_DEPTS.includes(u.department);

export const canSeeActivity = (u: { department: string; role: string }, a: Pick<Activity, 'department'>) =>
  hasFullAccess(u) || String(a.department) === u.department;

// ───────── Access control: which parts of the app each account can use ─────────
export const MODULES = [
  { key: 'projects', label: 'Projects', hint: 'Project list, Excel import, Gantt, dashboard, delays, staff, reports, holidays' },
  { key: 'news', label: 'Solar News', hint: 'Daily industry news digest' },
  { key: 'reputation', label: 'Reputation', hint: 'Mentions, reviews, reputation report' },
  { key: 'social', label: 'Social Media', hint: 'Own channels and competitor benchmark' },
  { key: 'leads', label: 'Leads', hint: 'Leads, follow-ups, campaign conversion (contains customer phone numbers)' },
  { key: 'users', label: 'User list', hint: 'See who has an account' },
  { key: 'audit', label: 'Activity History', hint: 'Who changed what, and when' },
] as const;
export type ModuleKey = (typeof MODULES)[number]['key'];
export type Level = 'none' | 'view' | 'edit';
export type AccessMap = Record<ModuleKey, Level>;
type U = { department: string; role: string; canEdit?: boolean; access?: Partial<Record<string, Level>> };

const PROJECT_DEPTS = ['PLAN', 'LAND', 'ENG', 'PRO', 'SITE', 'TRN', 'COMM'];
/** What an account can use when the admin has not set anything for it. */
export function defaultAccess(u: U): AccessMap {
  const project = PROJECT_DEPTS.includes(u.department);
  const sales = u.department === 'SALES';
  const mkt = u.department === 'MKT';
  return {
    projects: project ? 'edit' : 'none',
    news: 'view',
    reputation: mkt ? 'edit' : 'view',
    social: mkt ? 'edit' : 'view',
    leads: sales || mkt ? 'edit' : 'none',
    users: 'view',
    audit: project ? 'view' : 'none',
  };
}
/** Admins always have everything; others get the admin's settings, falling back to the defaults. */
export function effectiveAccess(u: U, override?: Partial<Record<string, Level>> | null): AccessMap {
  if (u.role === 'Admin') return Object.fromEntries(MODULES.map((m) => [m.key, 'edit'])) as AccessMap;
  const d = defaultAccess(u);
  for (const m of MODULES) { const v = override?.[m.key]; if (v === 'none' || v === 'view' || v === 'edit') d[m.key] = v; }
  return d;
}
export const levelOf = (u: U, m: ModuleKey): Level => (u.role === 'Admin' ? 'edit' : ((u.access?.[m] as Level | undefined) ?? defaultAccess(u)[m]));
export const canView = (u: U, m: ModuleKey) => levelOf(u, m) !== 'none';
export const canEditModule = (u: U, m: ModuleKey) => levelOf(u, m) === 'edit' && u.canEdit !== false;
export const canUseLeads = (u: U) => canView(u, 'leads');
