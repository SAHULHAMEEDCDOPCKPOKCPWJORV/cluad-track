'use client';
import type { Activity, AppUser, AuditLog, Holiday, Project, SessionUser } from './types';
import type { Level, ModuleKey } from './access';
import type { Digest, NewsItem, FetchReport } from '@/server/news';
import type { ReputationReport, Review } from '@/server/reputation';
import type { AccountView, PostView, SyncResult } from '@/server/social';
import type { Lead, LeadInput, LeadPatch } from '@/server/leads';
import type { Company, NewsSource, Recipients, SalesPerson, SecretName } from '@/server/config';

export type { Digest, NewsItem, ReputationReport, Review, AccountView, PostView, Lead, LeadPatch, Company, NewsSource, Recipients, SalesPerson, SecretName };
export interface LastFetch { at: string; added: number; sources: FetchReport[] }
export interface SocialData { accounts: AccountView[]; posts: PostView[]; contentTypes: { type: string; posts: number; avgEngagement: number }[]; weekdays: { day: string; posts: number; avgEngagement: number }[]; results?: SyncResult[] }
export interface GroupStat { name: string; leads: number; open: number; won: number; lost: number; conversion: number; winRate: number | null; wonValue: number; avgDaysToWin: number | null; overdue: number }
export interface LeadStats { total: number; newToday: number; dueToday: number; overdue: number; noFollowup: number; open: number; wonThisMonth: number; conversion: number; pipelineValue: number; funnel: { stage: string; count: number }[]; byStage: { stage: string; count: number }[]; byCampaign: GroupStat[]; bySource: GroupStat[]; byOwner: GroupStat[] }
export interface HomeData {
  news: { count24h: number; top: NewsItem[] };
  reputation: { score: number; mentions24h: number; negative30d: number; googleRating: number | null };
  social: { connected: number; followers: number; accounts: { platform: string; followers: number | null; growth30d: number | null }[] };
  leads: { newToday: number; dueToday: number; overdue: number; open: number; wonThisMonth: number; conversion: number } | null;
}
export interface SettingsData {
  secrets: Record<SecretName, { set: boolean; value?: string; hint?: string; fromEnv?: boolean }>;
  sources: NewsSource[]; competitors: Company[]; salesTeam: SalesPerson[]; recipients: Recipients;
  lastRun: Record<string, unknown> | null; lastFetch: LastFetch | null;
}

export interface ProjectSummary {
  projectId: string;
  activities: number;
  completed: number;
  delayed: number;
  onHold: number;
  progress: number;
}

export interface LiveChange { id: string; projectId: string; projectName: string | null; activityId: string | null; action: string; by: string | null; email: string | null; at: string }

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Time of this browser's last successful save, so live updates can skip echoes of our own changes. */
export let lastLocalWrite = 0;

async function req<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
    credentials: 'same-origin',
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`);
  if (init?.method && init.method !== 'GET') lastLocalWrite = Date.now();
  return data as T;
}

export interface AccessUser extends AppUser { defaults: Record<ModuleKey, Level>; override: Partial<Record<ModuleKey, Level>> | null }
export interface AccessData { modules: { key: ModuleKey; label: string; hint: string }[]; users: AccessUser[] }

export const api = {
  me: () => req<{ user: SessionUser | null; store: string }>('/api/auth/me'),
  login: (email: string, password: string) => req<{ user: SessionUser }>('/api/auth/login', { method: 'POST', json: { email, password } }),
  logout: () => req('/api/auth/logout', { method: 'POST' }),
  authConfig: () => req<{ googleClientId: string | null }>('/api/auth/config'),
  googleLogin: (credential: string) => req<{ user: SessionUser }>('/api/auth/google', { method: 'POST', json: { credential } }),
  changePassword: (currentPassword: string, newPassword: string) => req('/api/auth/password', { method: 'POST', json: { currentPassword, newPassword } }),
  projects: () => req<{ projects: Project[]; summaries: ProjectSummary[] }>('/api/projects'),
  project: (id: string) => req<{ project: Project; activities: Activity[] }>(`/api/projects/${encodeURIComponent(id)}`),
  createProject: (p: Partial<Project> & { projectPassword?: string }) => req<{ project: Project; activities: Activity[] }>('/api/projects', { method: 'POST', json: p }),
  /** Opens a password-protected project (stays open on this device for 8 hours). */
  unlockProject: (id: string, password: string) => req<{ ok: boolean }>(`/api/projects/${encodeURIComponent(id)}/unlock`, { method: 'POST', json: { password } }),
  lockProject: (id: string) => req<{ ok: boolean }>(`/api/projects/${encodeURIComponent(id)}/unlock`, { method: 'DELETE' }),
  /** Set, change or remove a project password. */
  setProjectPassword: (id: string, json: { newPassword?: string; currentPassword?: string; remove?: boolean }) =>
    req<{ ok: boolean; locked: boolean }>(`/api/projects/${encodeURIComponent(id)}/password`, { method: 'PUT', json }),
  updateProject: (id: string, p: Partial<Project>) => req<{ project: Project }>(`/api/projects/${encodeURIComponent(id)}`, { method: 'PATCH', json: p }),
  deleteProject: (id: string) => req(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  updateActivities: (id: string, json: { activities?: Partial<Activity>[]; action?: string; deleteIds?: string[] }) =>
    req<{ project: Project; activities: Activity[]; changed: number }>(`/api/projects/${encodeURIComponent(id)}/activities`, { method: 'PUT', json }),
  holidays: () => req<{ holidays: Holiday[] }>('/api/holidays'),
  addHoliday: (h: Holiday) => req('/api/holidays', { method: 'POST', json: h }),
  deleteHoliday: (date: string) => req(`/api/holidays?date=${date}`, { method: 'DELETE' }),
  audit: (projectId?: string) => req<{ logs: AuditLog[] }>(`/api/audit${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`),
  progressHistory: (projectId: string) => req<{ logs: AuditLog[] }>(`/api/audit?projectId=${encodeURIComponent(projectId)}&field=progressPercent&limit=5000`),
  users: () => req<{ users: AppUser[] }>('/api/users'),
  access: () => req<AccessData>('/api/access'),
  saveAccess: (userId: string, access: Partial<Record<ModuleKey, Level>> | null) => req<AccessData>('/api/access', { method: 'PUT', json: { userId, access } }),
  live: (since?: string) => req<{ now: string; changes: LiveChange[]; truncated?: boolean }>(`/api/live${since ? `?since=${encodeURIComponent(since)}` : ''}`),
  createUser: (u: Partial<AppUser>) => req<{ user: AppUser; temporaryPassword: string }>('/api/users', { method: 'POST', json: u }),
  updateUser: (u: Partial<AppUser> & { id: string; resetPassword?: boolean }) => req<{ ok: boolean; temporaryPassword?: string }>('/api/users', { method: 'PATCH', json: u }),
  // marketing & sales
  home: () => req<HomeData>('/api/home'),
  news: (days = 7) => req<{ items: NewsItem[]; digest: Digest; lastFetch: LastFetch | null }>(`/api/news?days=${days}`),
  refreshNews: () => req<{ items: NewsItem[]; digest: Digest; lastFetch: LastFetch | null }>('/api/news', { method: 'POST' }),
  reputation: () => req<{ report: ReputationReport; mentions: NewsItem[]; reviews: Review[] }>('/api/reputation'),
  refreshReputation: () => req<{ report: ReputationReport; mentions: NewsItem[]; reviews: Review[] }>('/api/reputation', { method: 'POST' }),
  social: () => req<SocialData>('/api/social'),
  socialAction: (json: Record<string, unknown>) => req<SocialData>('/api/social', { method: 'POST', json }),
  leads: () => req<{ leads: Lead[]; stats: LeadStats; stages: string[]; team: string[] }>('/api/leads'),
  leadHistory: (id: string) => req<{ history: { at: string; by: string; kind: string; text: string }[] }>(`/api/leads?history=${encodeURIComponent(id)}`),
  addLead: (lead: LeadInput) => req<{ lead: Lead; duplicate: boolean }>('/api/leads', { method: 'POST', json: { lead } }),
  importLeads: (rows: Record<string, unknown>[]) => req<{ added: number; merged: number; errors: string[] }>('/api/leads', { method: 'POST', json: { rows } }),
  updateLead: (id: string, patch: LeadPatch) => req<{ lead: Lead }>('/api/leads', { method: 'PATCH', json: { id, ...patch } }),
  settings: () => req<SettingsData>('/api/settings'),
  saveSettings: (json: Record<string, unknown>) => req<SettingsData>('/api/settings', { method: 'PUT', json }),
  runAutomation: (sendEmails: boolean) => req<Record<string, unknown>>('/api/automation/run', { method: 'POST', json: { sendEmails } }),
};
