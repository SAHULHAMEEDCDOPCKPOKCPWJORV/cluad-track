// Rule-based "AI-assisted" analysis engine: executive summary, department audit,
// delay risk mitigation and duration-impact protocols. Deterministic – no external AI calls.
import type { Activity, Project } from './types';
import { DEPARTMENT_NAMES, type Department } from './types';
import { fmt } from './calendar';
import type { GroupSummary, Kpis, ProjectAnalysis } from './schedule';

export type Health = 'On Track' | 'At Risk' | 'Critical';

export const PROTOCOLS: Record<string, string[]> = {
  PLAN: ['Re-baseline the L2 schedule and circulate a 4-week look-ahead', 'Hold a daily 15-minute constraint review with all department leads', 'Escalate decision blockers to the project sponsor within 48 hours'],
  LAND: ['Deploy an additional liaison officer for pending NOCs/approvals', 'Fix weekly follow-up meetings with revenue / Discom officials', 'Prepare parallel documentation so approvals are not sequential'],
  ENG: ['Release drawings in priority packages (civil → MMS → electrical)', 'Run design reviews in parallel with vendor drawing approvals', 'Add a second design team shift for critical drawings'],
  PRO: ['Expedite with vendor through daily dispatch tracking', 'Qualify an alternate vendor for the delayed package', 'Use part-dispatch / air-freight for critical-path items'],
  SITE: ['Add crews / second shift on the delayed front', 'Re-sequence blocks so ready fronts are worked first', 'Increase equipment (piling rigs, cranes) for 2–3 weeks'],
  TRN: ['Engage right-of-way specialist and district administration early', 'Pre-order long-lead bay equipment', 'Parallel-track line works and substation bay works'],
  COMM: ['Prepare commissioning test packs ahead of mechanical completion', 'Book Discom / SNA inspection slots in advance', 'Pre-commission inverter blocks as soon as each block is ready'],
};

export interface DeptAudit {
  dept: string;
  name: string;
  score: number;
  rating: 'Excellent' | 'Good' | 'Needs Attention' | 'Critical';
  total: number;
  completed: number;
  delayed: number;
  onHold: number;
  planned: number;
  actual: number;
  spi: number;
  finding: string;
}

export interface RiskItem {
  activityId: string;
  activityName: string;
  section: string;
  department: string;
  status: string;
  delayDays: number;
  ownSlip: number;
  critical: boolean;
  totalFloat: number;
  finishImpact: number;
  downstreamDelayed: number;
  severity: 'Critical' | 'High' | 'Medium' | 'Low';
  remainingDays: number;
  crashFactor: number; // required productivity multiplier to recover the slip
  mitigation: string[];
  remarks: string;
}

export interface ProjectReport {
  health: Health;
  headline: string;
  summary: string[];
  deptAudit: DeptAudit[];
  risks: RiskItem[];
  recommendations: string[];
}

export function projectHealth(k: Kpis): Health {
  if (k.spi < 0.85 || k.projectDelay > 20 || k.criticalDelays >= 5) return 'Critical';
  if (k.spi < 0.95 || k.projectDelay > 0 || k.criticalDelays > 0 || k.onHold > 0) return 'At Risk';
  return 'On Track';
}

export function buildRisks(acts: Activity[], an: ProjectAnalysis): RiskItem[] {
  const out: RiskItem[] = [];
  for (const a of acts) {
    const m = an.byId.get(a.activityId);
    if (!m) continue;
    if (!(m.status === 'Delayed' || m.status === 'On Hold' || (m.rootCause && m.status !== 'Completed'))) continue;
    const remainingDays = a.isMilestone ? 0 : Math.max(1, Math.ceil(a.plannedDuration * (1 - Number(a.progressPercent) / 100)));
    // Realistic compression: at most 50% of the remaining duration can be recovered by crashing.
    const recover = Math.min(m.delayDays, Math.floor(remainingDays * 0.5));
    const crashFactor = remainingDays > recover ? Math.round((remainingDays / (remainingDays - recover)) * 100) / 100 : 1;
    let severity: RiskItem['severity'] = 'Low';
    if (m.status === 'On Hold' && m.critical) severity = 'Critical';
    else if (m.critical && m.delayDays > 0) severity = m.delayDays > 10 ? 'Critical' : 'High';
    else if (m.delayDays > 15 || m.downstreamDelayed > 10) severity = 'High';
    else if (m.delayDays > 5) severity = 'Medium';
    const protos = PROTOCOLS[String(a.department)] ?? PROTOCOLS.PLAN;
    const mitigation = [...protos];
    if (m.status === 'On Hold') mitigation.unshift(`Release hold: ${a.remarks || 'record hold reason and owner'}`);
    if (crashFactor > 1.05) mitigation.push(`Raise productivity ×${crashFactor} on the remaining ${remainingDays} working days to recover ${recover} of ${m.delayDays}d`);
    if (m.delayDays > recover) mitigation.push(`${m.delayDays - recover}d cannot be recovered by crashing alone: fast-track successors or re-sequence`);
    out.push({
      activityId: a.activityId,
      activityName: a.activityName,
      section: a.section,
      department: String(a.department),
      status: m.status,
      delayDays: m.delayDays,
      ownSlip: m.ownSlip,
      critical: m.critical,
      totalFloat: m.totalFloat,
      finishImpact: m.finishImpact,
      downstreamDelayed: m.downstreamDelayed,
      severity,
      remainingDays,
      crashFactor,
      mitigation,
      remarks: a.remarks ?? '',
    });
  }
  const rank = { Critical: 0, High: 1, Medium: 2, Low: 3 };
  return out.sort((x, y) => rank[x.severity] - rank[y.severity] || y.finishImpact - x.finishImpact || y.delayDays - x.delayDays);
}

export function auditDepartments(depts: GroupSummary[]): DeptAudit[] {
  return depts.map((d) => {
    const completionRatio = d.total ? d.completed / d.total : 0;
    const score = Math.max(0, Math.min(100, Math.round(d.spi * 70 + completionRatio * 15 + 15 - d.delayed * 2 - d.onHold * 4)));
    const rating: DeptAudit['rating'] = score >= 85 ? 'Excellent' : score >= 70 ? 'Good' : score >= 50 ? 'Needs Attention' : 'Critical';
    let finding: string;
    if (d.planned === 0 && d.actual === 0) finding = 'Scope not yet due; no performance data.';
    else if (d.spi >= 1) finding = `Ahead of plan (${d.actual}% vs ${d.planned}% planned).`;
    else if (d.spi >= 0.9) finding = `Marginally behind (${d.actual}% vs ${d.planned}%); monitor weekly.`;
    else finding = `Behind plan by ${Math.round((d.planned - d.actual) * 10) / 10}% with ${d.delayed} delayed activit${d.delayed === 1 ? 'y' : 'ies'}; recovery plan required.`;
    if (d.onHold) finding += ` ${d.onHold} on hold.`;
    return {
      dept: d.key,
      name: DEPARTMENT_NAMES[d.key as Department] ?? d.key,
      score,
      rating,
      total: d.total,
      completed: d.completed,
      delayed: d.delayed,
      onHold: d.onHold,
      planned: d.planned,
      actual: d.actual,
      spi: d.spi,
      finding,
    };
  });
}

export function generateReport(project: Project, acts: Activity[], an: ProjectAnalysis, k: Kpis, sections: GroupSummary[], depts: GroupSummary[]): ProjectReport {
  const health = projectHealth(k);
  const risks = buildRisks(acts, an);
  const audit = auditDepartments(depts);
  const worstSection = [...sections].filter((s) => s.planned > 0).sort((a, b) => a.spi - b.spi)[0];
  const bestSection = [...sections].filter((s) => s.planned > 0).sort((a, b) => b.spi - a.spi)[0];
  const top = risks.slice(0, 3);
  const headline =
    health === 'On Track'
      ? `${project.name} is on track at ${k.overallProgress}% complete (plan ${k.plannedProgress}%).`
      : health === 'At Risk'
        ? `${project.name} is at risk: ${k.overallProgress}% complete against ${k.plannedProgress}% planned.`
        : `${project.name} needs urgent recovery: ${k.overallProgress}% complete against ${k.plannedProgress}% planned.`;
  const summary = [
    `${project.capacityMw} MW ${project.projectType} at ${[project.village, project.district, project.state].filter(Boolean).join(', ')}. Planned ${fmt(project.plannedStartDate)} to ${fmt(k.plannedFinish)}.`,
    `Schedule Performance Index is ${k.spiValid ? k.spi.toFixed(2) : 'not available yet (no work was planned by today)'} (variance ${k.scheduleVariance > 0 ? '+' : ''}${k.scheduleVariance}%). ${k.completed} of ${k.total} activities completed, ${k.inProgress} in progress, ${k.delayed} delayed, ${k.onHold} on hold.`,
    k.projectDelay > 0
      ? `Forecast finish is ${fmt(k.forecastFinish)}, ${k.projectDelay} working days beyond the planned finish, driven by ${k.criticalDelays} critical-path issue(s).`
      : `Forecast finish ${fmt(k.forecastFinish)} is within the planned finish date.`,
  ];
  if (worstSection && bestSection && worstSection.key !== bestSection.key)
    summary.push(`Strongest section: ${bestSection.key} (SPI ${bestSection.spi.toFixed(2)}). Weakest: ${worstSection.key} (SPI ${worstSection.spi.toFixed(2)}).`);
  if (top.length) summary.push(`Top risks: ${top.map((r) => `${r.activityId} ${r.activityName} (+${r.delayDays}d${r.critical ? ', critical' : ''})`).join('; ')}.`);

  const recommendations: string[] = [];
  if (k.criticalDelays) recommendations.push(`Focus recovery on the ${k.criticalDelays} delayed critical-path activities; non-critical delays have float.`);
  if (k.onHold) recommendations.push(`Resolve ${k.onHold} hold(s) – each hold has an owner and a target release date in the weekly review.`);
  const weakDepts = audit.filter((d) => d.rating === 'Critical' || d.rating === 'Needs Attention');
  if (weakDepts.length) recommendations.push(`Department recovery plans required from: ${weakDepts.map((d) => d.dept).join(', ')}.`);
  if (k.spi < 0.95) recommendations.push('Issue a 6-week recovery schedule with crash/fast-track options and re-forecast weekly.');
  if (!recommendations.length) recommendations.push('Maintain current pace; continue weekly progress updates and look-ahead planning.');
  return { health, headline, summary, deptAudit: audit, risks, recommendations };
}
