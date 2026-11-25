import { NextResponse } from 'next/server';
import { audit, body, handler, ok, requireUser } from '@/server/auth';
import { createProject } from '@/server/projectService';
import { checkNew, lockState, savePassword } from '@/server/projectLock';
import { getStore } from '@/server/store';

export const GET = handler(async () => {
  const u = await requireUser({ module: 'projects' });
  const store = getStore();
  const [projects, summaries, lock] = await Promise.all([store.listProjects(), store.activitySummaries(), lockState(u)]);
  // A locked project shows its name and place, but no progress numbers, until its password is entered.
  return ok({ projects: projects.map(lock.decorate), summaries: summaries.filter((s) => lock.open(s.projectId)) });
});

export const POST = handler(async (req: Request) => {
  const u = await requireUser({ edit: true, module: 'projects' });
  const { projectPassword, ...fields } = await body<Record<string, unknown>>(req);
  const wantsPassword = typeof projectPassword === 'string' && projectPassword !== '';
  if (wantsPassword) checkNew(projectPassword); // reject a bad password before anything is created
  const created = await createProject(u, fields);
  const res = NextResponse.json({ ...created, project: { ...created.project, locked: wantsPassword, unlocked: true } }, { status: 201 });
  if (wantsPassword) {
    await savePassword(u, created.project.id, { newPassword: projectPassword }, res);
    await getStore().addAudit([audit(u, { action: 'PROJECT_PASSWORD_SET', projectId: created.project.id, projectName: created.project.name, newValue: 'Project password set' })]);
  }
  return res;
});
