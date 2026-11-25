'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { ArrowRight, BarChart3, FolderKanban, Newspaper, ShieldCheck, Users2, ExternalLink } from 'lucide-react';
import { api, type HomeData } from '@/lib/api';
import { canView } from '@/lib/access';
import { useApp, type View } from '../AppShell';
import { fmtNum, timeAgo } from '../mkt';

function Tile({ icon, title, text, value, note, onClick, accent }: { icon: ReactNode; title: string; text: string; value: ReactNode; note?: ReactNode; onClick: () => void; accent: string }) {
  return (
    <button onClick={onClick} className="group flex flex-col rounded-2xl border border-dark-700 bg-dark-850 p-5 text-left transition hover:-translate-y-0.5 hover:border-solar-amber/50">
      <div className="flex items-center justify-between">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl" style={{ background: `${accent}22`, color: accent }}>{icon}</div>
        <ArrowRight className="h-4 w-4 text-slate-500 transition group-hover:translate-x-0.5 group-hover:text-solar-gold" />
      </div>
      <div className="mt-4 text-lg font-bold text-white">{title}</div>
      <div className="text-sm text-slate-400">{text}</div>
      <div className="mt-4 text-2xl font-bold tabular-nums" style={{ color: accent }}>{value}</div>
      {note && <div className="text-xs text-slate-500">{note}</div>}
    </button>
  );
}

export default function HomeView() {
  const { user, projects, summaries, setView } = useApp();
  const [d, setD] = useState<HomeData | null>(null);
  useEffect(() => { api.home().then(setD).catch(() => undefined); }, []);
  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const sums = Object.values(summaries);
  const avg = sums.length ? Math.round(sums.reduce((s, x) => s + x.progress, 0) / sums.length) : 0;
  const delayed = sums.reduce((s, x) => s + x.delayed, 0);
  const go = (v: View) => setView(v);
  const dash = <span className="text-slate-600">…</span>;

  return (
    <div className="space-y-6">
      <div>
        <div className="text-sm text-slate-400">{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
        <h1 className="mt-1 text-2xl font-bold text-white md:text-3xl">{hello}, {user.name.split(' ')[0] || user.department}</h1>
        <p className="mt-1 text-slate-400">Everything at SWELECT today, in one place. Pick where to start.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {canView(user, 'projects') && <Tile icon={<FolderKanban className="h-5 w-5" />} accent="#3b82f6" title="Projects" text="Schedules, Gantt, S-curves" value={`${projects.length}`} note={`projects · ${avg}% average progress${delayed ? ` · ${delayed} delayed activities` : ''}`} onClick={() => go('projects')} />}
        {canView(user, 'news') && <Tile icon={<Newspaper className="h-5 w-5" />} accent="#10b981" title="Solar News" text="Today's industry digest" value={d ? d.news.count24h : dash} note="stories in the last 24 hours" onClick={() => go('news')} />}
        {canView(user, 'reputation') && <Tile icon={<ShieldCheck className="h-5 w-5" />} accent="#10b981" title="Reputation" text="Mentions & reviews" value={d ? `${d.reputation.score}/100` : dash} note={d ? `${d.reputation.mentions24h} new mentions · ${d.reputation.negative30d} negative in 30 days` : undefined} onClick={() => go('reputation')} />}
        {canView(user, 'social') && <Tile icon={<BarChart3 className="h-5 w-5" />} accent="#8b5cf6" title="Social Media" text="Performance vs competitors" value={d ? (d.social.connected ? fmtNum(d.social.followers) : 'Connect') : dash} note={d?.social.connected ? `followers on ${d.social.connected} channel${d.social.connected > 1 ? 's' : ''}` : 'accounts not connected yet'} onClick={() => go('social')} />}
        {canView(user, 'leads') && <Tile icon={<Users2 className="h-5 w-5" />} accent="#14b8a6" title="Leads" text="Follow-ups & conversion" value={d?.leads ? d.leads.dueToday + d.leads.overdue : dash} note={d?.leads ? `to follow up today${d.leads.overdue ? ` (${d.leads.overdue} overdue)` : ''} · ${d.leads.newToday} new` : undefined} onClick={() => go('leads')} />}
      </div>
      {!['projects', 'news', 'reputation', 'social', 'leads'].some((m) => canView(user, m as 'news')) && (
        <p className="rounded-2xl border border-dark-700 bg-dark-850 p-5 text-slate-400">Your account does not have access to any section yet. Ask an admin to give you access under <b className="text-slate-200">Access Control</b>.</p>
      )}

      {d && d.news.top.length > 0 && (
        <section className="rounded-2xl border border-dark-700 bg-dark-850 p-5">
          <div className="mb-3 flex items-center justify-between"><h3 className="font-semibold text-white">Top stories today</h3><button onClick={() => go('news')} className="text-sm text-solar-gold hover:underline">See all news</button></div>
          <div className="grid gap-3 md:grid-cols-2">
            {d.news.top.map((n) => (
              <a key={n.id} href={n.url} target="_blank" rel="noopener noreferrer" className="group flex gap-3 rounded-xl border border-dark-700 p-3 hover:border-solar-amber/50">
                <div className="min-w-0 flex-1"><div className="line-clamp-2 text-sm font-semibold text-white group-hover:text-solar-gold">{n.title}</div><div className="mt-1 text-xs text-slate-500">{n.source} · {timeAgo(n.publishedAt)} · {n.category}</div></div>
                <ExternalLink className="h-4 w-4 shrink-0 text-slate-500" />
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
