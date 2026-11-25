export const DEPARTMENTS = ['PLAN', 'LAND', 'ENG', 'PRO', 'SITE', 'TRN', 'COMM'] as const;
export type Department = (typeof DEPARTMENTS)[number];

export const DEPARTMENT_NAMES: Record<Department, string> = {
  PLAN: 'Planning & Project Control',
  LAND: 'Land & Statutory Approvals',
  ENG: 'Engineering & Design',
  PRO: 'Procurement & Logistics',
  SITE: 'Site Execution',
  TRN: 'Transmission & Evacuation',
  COMM: 'Testing & Commissioning',
};

/** Every department a user account can belong to (project departments + marketing and sales). */
export const USER_DEPARTMENTS = [...DEPARTMENTS, 'MKT', 'SALES'] as const;
export const USER_DEPARTMENT_NAMES: Record<string, string> = { ...DEPARTMENT_NAMES, MKT: 'Marketing & Communications', SALES: 'Sales' };

export const STATUSES = ['Not Started', 'In Progress', 'Completed', 'Delayed', 'On Hold'] as const;
export type ActivityStatus = (typeof STATUSES)[number];

export const PROJECT_TYPES = ['Solar EPC', 'Solar IPP'] as const;
export const PROJECT_STATUSES = ['Planning', 'In Progress', 'On Hold', 'Completed'] as const;

export interface Project {
  id: string;
  name: string;
  capacityMw: number;
  projectType: string;
  state: string;
  district: string;
  village: string;
  plannedStartDate: string; // YYYY-MM-DD
  plannedEndDate: string;
  actualStartDate: string | null;
  actualEndDate: string | null;
  description: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
  /** Set by the server: this project has a password. */
  locked?: boolean;
  /** Set by the server: the project is open for this account (no password, or the password was entered). */
  unlocked?: boolean;
}

export interface Activity {
  id: string; // `${projectId}__${activityId}`
  projectId: string;
  sNo: number;
  activityId: string;
  activityName: string;
  section: string;
  department: Department | string;
  plannedDuration: number; // working days (0 = milestone)
  plannedStartDate: string;
  plannedEndDate: string;
  baselineStartDate: string | null;
  baselineEndDate: string | null;
  actualDuration: number | null;
  actualStartDate: string | null;
  actualEndDate: string | null;
  progressPercent: number;
  weightage: number;
  isMilestone: boolean;
  delayDays: number;
  delayLabel: string;
  status: ActivityStatus | string;
  remarks: string;
  incharge: string; // activity incharge (staff name)
  delayReason: string; // why the activity is delayed, entered by staff
  inchargePerf?: number | null; // manual incharge performance % (overrides the automatic 100/0)
  updatedAt?: string;
  updatedBy?: string;
}

export interface Holiday {
  date: string;
  name: string;
  type: string;
}

export interface AuditLog {
  id: string;
  projectId: string;
  projectName: string | null;
  userId: string | null;
  userEmail: string | null;
  department: string | null;
  action: string;
  activityId: string | null;
  activityName: string | null;
  fieldName: string | null;
  oldValue: string | null;
  newValue: string | null;
  timestamp: string;
}

export interface AppUser {
  id: string;
  email: string;
  department: string;
  role: 'Admin' | 'Department Lead' | 'Viewer' | string;
  name: string;
  isActive: boolean;
  canEdit: boolean;
  canExport: boolean;
  canApprove: boolean;
  mustChangePassword?: boolean;
  createdAt?: string;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  department: string;
  role: string;
  canEdit: boolean;
  canExport: boolean;
  canApprove: boolean;
  mustChangePassword: boolean;
  /** Which parts of the app this account can use (set by an admin under Access Control). */
  access?: Record<string, 'none' | 'view' | 'edit'>;
}

export const isAdmin = (u: { role: string } | null | undefined) => u?.role === 'Admin';

/** The owner account: the only account that can sign in, and its email and password are fixed. */
export const OWNER_EMAILS = ['plan@swelect.com'];
/** While true, every other account is blocked and only the owner can open the app. */
export const OWNER_ONLY = true;
export const CREDIT = 'This website is completely developed by Mr. SAHUL HAMEED M';
export const isCredit = (msg: string | null | undefined) => !!msg && msg.includes('SAHUL HAMEED M');
export const isOwner = (u: { email: string } | null | undefined) => !!u && OWNER_EMAILS.includes(u.email.toLowerCase());
