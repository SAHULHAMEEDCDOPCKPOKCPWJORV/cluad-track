import { randomBytes } from 'node:crypto';
import type { Activity, AuditLog, Project, SessionUser } from '@/lib/types';
import { WorkCalendar, isValidIso, todayIso } from '@/lib/calendar';
import { CUSTOM_SECTION } from '@/lib/master';
import { activityKey, analyzeProject, computeWeights, forwardSchedule, generateFromMaster, withDerivedFields } from '@/lib/schedule';
import { getStore, HttpError } from './store';
import { audit } from './auth';
import { canSeeActivity, hasFullAccess } from '@/lib/access';

export async function calendar() {
  const hs = await getStore().listHolidays();
  return new WorkCalendar(hs);
}

const str = (v: unknown, max = 300) => (v == null ? '' : String(v).slice(0, max).trim());

export function sanitizeProjectInput(b: Record<string, unknown>, prev?: Project): Project {
  const name = str(b.name ?? prev?.name, 200);
  if (!name) throw new HttpError(400, 'Project name is required');
  const start = (b.plannedStartDate ?? prev?.plannedStartDate) as string;
  if (!isValidIso(start)) throw new HttpError(400, 'Planned start date must be YYYY-MM-DD');
  const cap = Number(b.capacityMw ?? prev?.capacityMw ?? 0);
  if (!Number.isFinite(cap) || cap < 0) throw new HttpError(400, 'Capacity must be a positive number');
  const opt = (k: keyof Project) => {
    const v = b[k as string] !== undefined ? b[k as string] : prev?.[k];
    return v == null || v === '' ? null : isValidIso(v) ? (v as string) : (() => { throw new HttpError(400, `${String(k)} must be YYYY-MM-DD`); })();
  };
  return {
    id: prev?.id ?? `PRJ-${randomBytes(4).toString('hex').toUpperCase()}`,
    name,
    capacityMw: cap,
    projectType: str(b.projectType ?? prev?.projectType ?? 'Solar EPC', 40) || 'Solar EPC',
    state: str(b.state ?? prev?.state, 80),
    district: str(b.district ?? prev?.district, 80),
    village: str(b.village ?? prev?.village, 120),
    plannedStartDate: start,
    plannedEndDate: prev?.plannedEndDate ?? start,
    actualStartDate: opt('actualStartDate'),
    actualEndDate: opt('actualEndDate'),
    description: str(b.description ?? prev?.description, 2000),
    status: str(b.status ?? prev?.status ?? 'In Progress', 40) || 'In Progress',
    createdAt: prev?.createdAt,
  };
}

/**
 * Stretch or compress planned durations so the whole schedule finishes in about `targetWd` working days
 * from `start`, keeping the activity logic. Actual dates and progress are not touched.
 */
export function fitSchedule(acts: Activity[], cal: WorkCalendar, start: string, targetWd: number): Activity[] {
  const base = acts.map((a) => ({ ...a, plannedDuration: a.isMilestone ? 0 : Math.max(1, a.plannedDuration) }));
  const span = (l: Activity[]) => cal.countWorking(start, l.map((a) => a.plannedEndDate).sort().pop()!);
  let best = forwardSchedule(base, cal, start);
  let factor = targetWd / Math.max(1, span(best));
  for (let i = 0; i < 8; i++) {
    const trial = forwardSchedule(base.map((a) => ({ ...a, plannedDuration: a.isMilestone ? 0 : Math.max(1, Math.round(a.plannedDuration * factor)) })), cal, start);
    const got = span(trial);
    if (Math.abs(got - targetWd) < Math.abs(span(best) - targetWd)) best = trial;
    if (got === targetWd) break;
    factor *= targetWd / Math.max(1, got);
  }
  const w = computeWeights(best);
  return best.map((a, i) => ({ ...a, weightage: w[i] }));
}

const targetOf = (input: Record<string, unknown>) => {
  const n = Math.round(Number(input.plannedDuration));
  return Number.isFinite(n) && n >= 5 && n <= 3000 ? n : null;
};

/** Re-plan an existing project's planned dates to a new start and/or total duration. */
export async function refitProject(u: SessionUser, projectId: string, input: Record<string, unknown>) {
  if (!hasFullAccess(u)) throw new HttpError(403, 'Only Planning (PLAN) or Commissioning (COMM) can re-plan the whole schedule');
  const store = getStore();
  const project = await store.getProject(projectId);
  if (!project) throw new HttpError(404, 'Project not found');
  const cal = await calendar();
  let acts = await store.listActivities(projectId);
  // A project with no activities gets the standard master schedule again.
  if (!acts.length) acts = generateFromMaster(projectId, project.plannedStartDate, cal, u.email);
  const target = targetOf(input) ?? cal.countWorking(project.plannedStartDate, project.plannedEndDate);
  let list = fitSchedule(acts, cal, project.plannedStartDate, target);
  list = withDerivedFields(list, analyzeProject(list, cal, todayIso())).map((a) => ({ ...a, updatedBy: u.email }));
  await store.upsertActivities(list);
  const next: Project = { ...project, plannedEndDate: list.map((a) => a.plannedEndDate).sort().pop()! };
  await store.saveProject(next);
  await store.addAudit([audit(u, { action: 'RESCHEDULED', projectId, projectName: project.name, newValue: `Schedule fitted to ${target} working days: ${project.plannedStartDate} → ${next.plannedEndDate}` })]);
  return { project: next, activities: list };
}

export async function createProject(u: SessionUser, input: Record<string, unknown>) {
  const store = getStore();
  const p = sanitizeProjectInput(input);
  const cal = await calendar();
  let acts = generateFromMaster(p.id, p.plannedStartDate, cal, u.email);
  const target = targetOf(input);
  if (target) acts = fitSchedule(acts, cal, p.plannedStartDate, target).map((a) => ({ ...a, baselineStartDate: a.plannedStartDate, baselineEndDate: a.plannedEndDate }));
  p.plannedEndDate = acts.map((a) => a.plannedEndDate).sort().pop()!;
  await store.saveProject(p);
  await store.upsertActivities(acts);
  await store.addAudit([audit(u, { action: 'PROJECT_CREATED', projectId: p.id, projectName: p.name, newValue: `${p.capacityMw} MW, ${acts.length} activities, ${p.plannedStartDate} → ${p.plannedEndDate}` })]);
  return { project: p, activities: acts };
}

const EDITABLE = [
  'activityName', 'section', 'department', 'plannedDuration', 'plannedStartDate', 'plannedEndDate',
  'actualStartDate', 'actualEndDate', 'progressPercent', 'status', 'remarks', 'isMilestone', 'incharge', 'delayReason', 'inchargePerf',
] as const;
type Editable = (typeof EDITABLE)[number];

function cleanField(k: Editable, v: unknown): unknown {
  switch (k) {
    case 'plannedStartDate':
    case 'plannedEndDate':
      if (!isValidIso(v)) throw new HttpError(400, `${k} must be a valid date`);
      return v;
    case 'actualStartDate':
    case 'actualEndDate':
      if (v == null || v === '') return null;
      if (!isValidIso(v)) throw new HttpError(400, `${k} must be a valid date`);
      return v;
    case 'plannedDuration': {
      const n = Math.ceil(Number(v) - 1e-9); // part days count as a full day (5.4 -> 6)
      if (!Number.isFinite(n) || n < 0 || n > 2000) throw new HttpError(400, 'Duration must be 0–2000 working days');
      return n;
    }
    case 'progressPercent': {
      const n = Math.round(Number(v) * 10) / 10;
      if (!Number.isFinite(n) || n < 0 || n > 100) throw new HttpError(400, 'Progress must be 0–100');
      return n;
    }
    case 'inchargePerf': {
      if (v == null || v === '') return null; // empty = automatic (completed 100%, else 0%)
      const n = Math.round(Number(v) * 10) / 10;
      if (!Number.isFinite(n) || n < 0 || n > 100) throw new HttpError(400, 'Incharge performance must be 0–100');
      return n;
    }
    case 'isMilestone':
      return !!v;
    case 'status':
      return v === 'On Hold' ? 'On Hold' : 'Active';
    default:
      return str(v, k === 'remarks' || k === 'delayReason' ? 1000 : 200);
  }
}

export type ActivityPatch = Partial<Record<Editable, unknown>> & { activityId: string };

/** Apply edits (and new custom activities), recompute derived fields, persist, write audit trail. */
export async function updateActivities(
  u: SessionUser,
  projectId: string,
  patches: ActivityPatch[],
  opts: { action?: 'edit' | 'import' | 'reschedule' | 'rebaseline'; deleteIds?: string[] } = {},
) {
  const store = getStore();
  // Load project, holidays and activities at the same time (one database round trip instead of three).
  const [project, cal, current] = await Promise.all([store.getProject(projectId), calendar(), store.listActivities(projectId)]);
  if (!project) throw new HttpError(404, 'Project not found');
  const today = todayIso();
  const byId = new Map(current.map((a) => [a.activityId, { ...a }]));
  const logs: AuditLog[] = [];
  const touched = new Set<string>();
  const action = opts.action ?? 'edit';
  const actLabel = action === 'import' ? 'SCHEDULE_IMPORTED' : 'ACTIVITY_UPDATED';
  const full = hasFullAccess(u);
  if (!full && (action === 'reschedule' || action === 'rebaseline')) throw new HttpError(403, 'Only Planning (PLAN) or Commissioning (COMM) can re-plan the whole schedule');

  for (const p of patches ?? []) {
    const aid = str(p.activityId, 40).toUpperCase();
    if (!aid) continue;
    let a = byId.get(aid);
    if (a && !canSeeActivity(u, a)) throw new HttpError(403, `${aid} belongs to ${a.department}. You can only edit ${u.department} activities.`);
    if (!a) {
      const name = str(p.activityName, 200);
      if (!name) throw new HttpError(400, `New activity ${aid} needs a name`);
      const start = isValidIso(p.plannedStartDate) ? (p.plannedStartDate as string) : project.plannedStartDate;
      const dur = p.plannedDuration == null ? 1 : (cleanField('plannedDuration', p.plannedDuration) as number);
      a = {
        id: activityKey(projectId, aid), projectId, sNo: Math.max(0, ...[...byId.values()].map((x) => x.sNo)) + 1, activityId: aid,
        activityName: name, section: str(p.section, 120) || CUSTOM_SECTION, department: full ? str(p.department, 10) || u.department : u.department,
        plannedDuration: dur, plannedStartDate: start, plannedEndDate: dur > 0 ? cal.finishFrom(start, dur) : start,
        baselineStartDate: null, baselineEndDate: null, actualDuration: null, actualStartDate: null, actualEndDate: null,
        progressPercent: 0, weightage: 0, isMilestone: dur === 0, delayDays: 0, delayLabel: '0', status: 'Not Started', remarks: '', incharge: '', delayReason: '',
      };
      a.baselineStartDate = a.plannedStartDate;
      a.baselineEndDate = a.plannedEndDate;
      byId.set(aid, a);
      touched.add(aid);
      logs.push(audit(u, { action: 'ACTIVITY_ADDED', projectId, projectName: project.name, activityId: aid, activityName: name, newValue: `${a.plannedStartDate} → ${a.plannedEndDate}` }));
    }
    for (const k of EDITABLE) {
      if (!(k in p) || k === ('activityId' as string)) continue;
      if (!full && k === 'department') continue; // department staff cannot move activities to another department
      const nv = cleanField(k, p[k]);
      if (k === 'status') {
        const wasHold = a.status === 'On Hold';
        if (nv === 'On Hold' && !wasHold) {
          logs.push(audit(u, { action: 'HOLD_APPLIED', projectId, projectName: project.name, activityId: aid, activityName: a.activityName, fieldName: 'status', oldValue: String(a.status), newValue: 'On Hold' }));
          a.status = 'On Hold';
          touched.add(aid);
        } else if (nv !== 'On Hold' && wasHold) {
          logs.push(audit(u, { action: 'HOLD_RELEASED', projectId, projectName: project.name, activityId: aid, activityName: a.activityName, fieldName: 'status', oldValue: 'On Hold', newValue: 'Released' }));
          a.status = 'Not Started';
          touched.add(aid);
        }
        continue;
      }
      const ov = (a as unknown as Record<string, unknown>)[k];
      if ((ov ?? null) === (nv ?? null) || String(ov ?? '') === String(nv ?? '')) continue;
      (a as unknown as Record<string, unknown>)[k] = nv;
      touched.add(aid);
      logs.push(audit(u, { action: actLabel, projectId, projectName: project.name, activityId: aid, activityName: a.activityName, fieldName: k, oldValue: ov == null ? null : String(ov), newValue: nv == null ? null : String(nv) }));
    }
    if (action === 'import' && (p as Record<string, unknown>).actualDuration != null && Number((p as Record<string, unknown>).actualDuration) !== a.actualDuration) touched.add(aid);
    // Excel import keeps the sheet's row order.
    const so = (p as Record<string, unknown>).sNo;
    if (action === 'import' && so != null) {
      const n = Math.round(Number(so));
      if (Number.isFinite(n) && n > 0 && a.sNo !== n) { a.sNo = n; touched.add(aid); }
    }
    // Keep planned dates consistent with duration
    if (touched.has(aid)) {
      if (('plannedDuration' in p || 'plannedStartDate' in p) && !('plannedEndDate' in p)) {
        a.plannedEndDate = a.isMilestone || a.plannedDuration === 0 ? a.plannedStartDate : cal.finishFrom(a.plannedStartDate, a.plannedDuration);
      } else if ('plannedEndDate' in p && !('plannedDuration' in p)) {
        if (a.plannedEndDate < a.plannedStartDate) throw new HttpError(400, `${aid}: planned end is before planned start`);
        a.plannedDuration = a.isMilestone ? 0 : cal.countWorking(a.plannedStartDate, a.plannedEndDate);
      }
      // Progress ↔ actual dates
      if ('progressPercent' in p && a.progressPercent < 100 && !('actualEndDate' in p)) a.actualEndDate = null;
      if (a.progressPercent > 0 && !a.actualStartDate) a.actualStartDate = a.plannedStartDate <= today ? a.plannedStartDate : today;
      // An Excel import may carry a forecast actual finish for unfinished work; a manual finish date means done.
      if (a.actualEndDate && a.progressPercent < 100 && !(action === 'import' && 'progressPercent' in p)) a.progressPercent = 100;
      if (a.progressPercent >= 100 && !a.actualEndDate) a.actualEndDate = today;
      if (a.actualEndDate && !a.actualStartDate) a.actualStartDate = a.plannedStartDate <= a.actualEndDate ? a.plannedStartDate : a.actualEndDate;
      if (a.actualStartDate && a.actualEndDate && a.actualEndDate < a.actualStartDate) throw new HttpError(400, `${aid}: actual finish is before actual start`);
      a.actualDuration = a.actualStartDate && a.actualEndDate ? cal.countWorking(a.actualStartDate, a.actualEndDate) : null;
      // Excel import: keep the sheet's own actual duration.
      const ad = Number((p as Record<string, unknown>).actualDuration);
      if (action === 'import' && (p as Record<string, unknown>).actualDuration != null && Number.isFinite(ad) && ad >= 0) a.actualDuration = Math.ceil(ad - 1e-9);
      a.updatedBy = u.email;
    }
  }

  let list = [...byId.values()];
  const deleteIds = (opts.deleteIds ?? []).map((x) => str(x, 40).toUpperCase()).filter((x) => byId.has(x));
  for (const d of deleteIds) if (!canSeeActivity(u, byId.get(d)!)) throw new HttpError(403, `${d} belongs to another department`);
  if (deleteIds.length) {
    list = list.filter((a) => !deleteIds.includes(a.activityId));
    for (const d of deleteIds) logs.push(audit(u, { action: 'ACTIVITY_DELETED', projectId, projectName: project.name, activityId: d, activityName: byId.get(d)!.activityName }));
  }

  if (action === 'reschedule') {
    const before = new Map(list.map((a) => [a.activityId, a.plannedStartDate + a.plannedEndDate]));
    list = forwardSchedule(list, cal, project.plannedStartDate);
    for (const a of list) if (before.get(a.activityId) !== a.plannedStartDate + a.plannedEndDate) touched.add(a.activityId);
    logs.push(audit(u, { action: 'RESCHEDULED', projectId, projectName: project.name, newValue: `${touched.size} activities re-planned from logic` }));
  }
  if (action === 'rebaseline') {
    if (u.role !== 'Admin' && !u.canApprove) throw new HttpError(403, 'Only approvers can re-baseline');
    list = list.map((a) => ({ ...a, baselineStartDate: a.plannedStartDate, baselineEndDate: a.plannedEndDate }));
    list.forEach((a) => touched.add(a.activityId));
    logs.push(audit(u, { action: 'REBASELINED', projectId, projectName: project.name, newValue: 'Baseline = current plan' }));
  }

  // Weights + derived status/delay for the whole project
  const weights = computeWeights(list);
  list = list.map((a, i) => {
    if (Math.abs((a.weightage ?? 0) - weights[i]) > 1e-6) touched.add(a.activityId);
    return { ...a, weightage: weights[i] };
  });
  const before = new Map(list.map((a) => [a.activityId, `${a.status}|${a.delayDays}|${a.delayLabel}`]));
  list = withDerivedFields(list, analyzeProject(list, cal, today));
  for (const a of list) if (before.get(a.activityId) !== `${a.status}|${a.delayDays}|${a.delayLabel}`) touched.add(a.activityId);


  // Keep project dates in sync
  const plannedEnd = list.map((a) => a.plannedEndDate).sort().pop() ?? project.plannedEndDate;
  const firstActual = list.map((a) => a.actualStartDate).filter(Boolean).sort()[0] as string | undefined;
  const allDone = list.length > 0 && list.every((a) => a.progressPercent >= 100);
  const newProject: Project = {
    ...project,
    plannedEndDate: plannedEnd,
    actualStartDate: project.actualStartDate ?? firstActual ?? null,
    actualEndDate: allDone ? list.map((a) => a.actualEndDate!).sort().pop()! : project.actualEndDate,
    status: allDone ? 'Completed' : project.status,
  };
  // An import writes one history line per activity instead of one per changed field.
  let audits = logs;
  if (action === 'import') {
    const per = new Map<string, AuditLog>();
    audits = [];
    for (const l of logs) {
      if (l.action !== actLabel || !l.activityId) { audits.push(l); continue; }
      // Progress changes stay as their own line: they are the recorded history behind the actual S-curve.
      if (l.fieldName === 'progressPercent') { audits.push(l); continue; }
      const cur = per.get(l.activityId);
      if (cur) cur.newValue = `${cur.newValue}, ${l.fieldName}`;
      else { const x = { ...l, fieldName: 'import', oldValue: null, newValue: `Updated from Excel: ${l.fieldName}` }; per.set(l.activityId, x); audits.push(x); }
    }
  }
  // Save everything in parallel.
  await Promise.all([
    store.upsertActivities(list.filter((a) => touched.has(a.activityId))),
    deleteIds.length ? store.deleteActivities(deleteIds.map((d) => activityKey(projectId, d))) : null,
    JSON.stringify(newProject) !== JSON.stringify(project) ? store.saveProject(newProject) : null,
    audits.length ? store.addAudit(audits) : null,
  ]);
  return { project: newProject, activities: list.sort((a, b) => a.sNo - b.sNo), changed: touched.size };
}
