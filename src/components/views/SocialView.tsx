'use client';
import { useEffect, useMemo, useState } from 'react';
import { BarChart3, ExternalLink, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { api, type SocialData } from '@/lib/api';
import { canEditModule } from '@/lib/access';
import { useApp } from '../AppShell';
import { Button, C, Card, Empty, Field, Input, Modal, Segmented, Select, SERIES, Spinner, tooltipStyle } from '../ui';
import { HBars, VBars } from '../charts';
import { fmtNum, PageTitle, SetupNote, Stat, timeAgo } from '../mkt';

const PLATFORMS = ['Instagram', 'Facebook', 'LinkedIn', 'YouTube', 'X'];

export default function SocialView() {
  const { user, toast, setView } = useApp();
  const [data, setData] = useState<SocialData | null>(null);
  const [tab, setTab] = useState<'overview' | 'posts' | 'competitors'>('overview');
  const [platform, setPlatform] = useState('Instagram');
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState(false);
  const canEdit = canEditModule(user, 'social');
  useEffect(() => { api.social().then(setData).catch((e) => toast(e.message, 'err')); }, [toast]);

  const own = useMemo(() => data?.accounts.filter((a) => a.isOwn) ?? [], [data]);
  const platforms = useMemo(() => [...new Set(data?.accounts.map((a) => a.platform) ?? [])], [data]);
  if (!data) return <Spinner label="Loading social media numbers…" />;

  const sync = async () => {
    setBusy(true);
    try {
      const r = await api.socialAction({ action: 'sync' });
      setData(r);
      const failed = r.results?.filter((x) => !x.ok) ?? [];
      toast(r.results?.length ? `Updated ${r.results.length - failed.length} of ${r.results.length} accounts${failed.length ? ` · ${failed[0].account}: ${failed[0].message}` : ''}` : 'No accounts connected yet', failed.length ? 'err' : 'ok');
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  };

  const nothing = data.accounts.length === 0;
  const ownPosts = data.posts.filter((p) => p.isOwn);
  const last30 = ownPosts.filter((p) => Date.parse(p.postedAt) > Date.now() - 30 * 86400_000);
  const totalFollowers = own.reduce((s, a) => s + (a.followers ?? 0), 0);
  const avgEr = own.filter((a) => a.engagementRate != null);

  // follower trend for own accounts
  const days = [...new Set(own.flatMap((a) => a.trend.map((t) => t.day)))].sort();
  const trend = days.map((d) => ({ day: d.slice(5).split('-').reverse().join('/'), ...Object.fromEntries(own.map((a) => [`${a.platform}`, a.trend.find((t) => t.day === d)?.followers ?? null])) }));

  const bench = data.accounts.filter((a) => a.platform === platform && a.followers != null).sort((a, b) => (b.followers ?? 0) - (a.followers ?? 0));
  const ownRank = bench.findIndex((a) => a.isOwn) + 1;

  return (
    <div className="space-y-5">
      <PageTitle icon={<BarChart3 className="h-5 w-5" />} title="Social Media Performance" subtitle="SWELECT's channels, what content works, and how we compare with competitors"
        right={canEdit && <>
          <Button variant="outline" onClick={() => setManual(true)}><Plus className="h-4 w-4" />Add numbers by hand</Button>
          <Button onClick={sync} loading={busy}><RefreshCw className="h-4 w-4" />Update now</Button>
        </>} />

      {own.length === 0 && (
        <SetupNote title="Connect SWELECT's social accounts" action={user.role === 'Admin' ? <Button size="sm" variant="outline" onClick={() => setView('settings')}>Open Connections & Settings</Button> : undefined}>
          Your page admin connects Facebook & Instagram (one Meta page token), LinkedIn and YouTube once in Connections & Settings. After that, numbers update every morning by themselves.
          Competitors' Instagram and YouTube numbers are read through the same connection. For other platforms you can add numbers by hand.
        </SetupNote>
      )}

      <Segmented value={tab} onChange={setTab} options={[{ value: 'overview', label: 'Our channels' }, { value: 'posts', label: 'Posts & content' }, { value: 'competitors', label: 'Competitors' }]} />

      {tab === 'overview' && (nothing ? <Empty title="No numbers yet" text="Connect the accounts, or add numbers by hand." /> : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Total followers" value={fmtNum(totalFollowers)} tone="accent" hint={`${own.length} channel${own.length === 1 ? '' : 's'}`} />
            <Stat label="Posts in 30 days" value={last30.length} hint={`${(last30.length / 4.3).toFixed(1)} per week`} />
            <Stat label="Avg engagement rate" value={avgEr.length ? `${(avgEr.reduce((s, a) => s + (a.engagementRate ?? 0), 0) / avgEr.length).toFixed(2)}%` : '—'} hint="Likes + comments + shares ÷ followers" />
            <Stat label="Engagement in 30 days" value={fmtNum(last30.reduce((s, p) => s + p.engagement, 0))} hint="Likes, comments, shares, saves" />
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {own.map((a) => (
              <div key={a.id} className="rounded-2xl border border-dark-700 bg-dark-850 p-4">
                <div className="flex items-center justify-between"><span className="font-semibold text-white">{a.platform}</span><span className="text-xs text-slate-500">@{a.handle}</span></div>
                <div className="mt-2 text-2xl font-bold text-solar-gold">{fmtNum(a.followers)}</div>
                <div className="text-xs text-slate-400">followers {a.growth30d != null && <span className={a.growth30d >= 0 ? 'text-emerald-300' : 'text-rose-300'}>· {a.growth30d >= 0 ? '+' : ''}{a.growth30d}% in 30 days</span>}</div>
                <div className="mt-2 text-xs text-slate-500">Engagement {a.engagementRate ?? '—'}% · {a.posts30d} posts / 30 days · updated {a.lastUpdated ? timeAgo(a.lastUpdated) : '—'}</div>
              </div>
            ))}
          </div>
          {trend.length > 1 && (
            <Card title="Followers over time">
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={trend}><CartesianGrid stroke={C.grid} vertical={false} /><XAxis dataKey="day" stroke={C.axis} fontSize={11} /><YAxis stroke={C.axis} fontSize={11} tickFormatter={(v) => fmtNum(v)} width={50} /><Tooltip {...tooltipStyle} /><Legend />
                  {own.map((a, i) => <Line key={a.id} type="monotone" dataKey={a.platform} stroke={SERIES[i % SERIES.length]} strokeWidth={2} dot={false} connectNulls />)}
                </LineChart>
              </ResponsiveContainer>
            </Card>
          )}
        </div>
      ))}

      {tab === 'posts' && (ownPosts.length === 0 ? <Empty title="No posts read yet" text="Posts appear once Instagram, Facebook or YouTube is connected." /> : (
        <div className="space-y-5">
          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="What type of content works best" subtitle="Average engagement per post">
              <HBars data={data.contentTypes.map((t) => ({ name: `${t.type} (${t.posts})`, value: t.avgEngagement }))} keys={[{ key: 'value', name: 'Avg engagement', color: C.amber }]} unit="" max={Math.max(1, ...data.contentTypes.map((t) => t.avgEngagement))} />
            </Card>
            <Card title="Best day to post" subtitle="Average engagement by weekday">
              <VBars data={data.weekdays.map((d) => ({ day: d.day, Engagement: d.avgEngagement }))} xKey="day" height={220} bars={[{ key: 'Engagement', name: 'Avg engagement', color: C.cyan }]} />
            </Card>
          </div>
          <Card title="Top posts" subtitle="SWELECT posts ranked by engagement" bodyClass="p-0">
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead><tr className="border-b border-dark-700 text-left text-xs text-slate-400"><th className="p-3">Post</th><th className="p-3">Channel</th><th className="p-3">Type</th><th className="p-3 text-right">Likes</th><th className="p-3 text-right">Comments</th><th className="p-3 text-right">Shares</th><th className="p-3 text-right">Reach</th><th className="p-3">Date</th></tr></thead>
              <tbody>{ownPosts.slice().sort((a, b) => b.engagement - a.engagement).slice(0, 40).map((p) => (
                <tr key={p.id} className="border-b border-dark-800 hover:bg-dark-800/50">
                  <td className="max-w-[340px] p-3"><a href={p.permalink} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-slate-200 hover:text-solar-gold"><span className="truncate">{p.text || '(no caption)'}</span><ExternalLink className="h-3.5 w-3.5 shrink-0" /></a></td>
                  <td className="p-3 text-slate-300">{p.platform}</td><td className="p-3 text-slate-400">{p.mediaType}</td>
                  <td className="p-3 text-right tabular-nums">{fmtNum(p.likes)}</td><td className="p-3 text-right tabular-nums">{fmtNum(p.comments)}</td><td className="p-3 text-right tabular-nums">{fmtNum(p.shares)}</td><td className="p-3 text-right tabular-nums">{fmtNum(p.reach)}</td>
                  <td className="p-3 text-slate-400">{timeAgo(p.postedAt)}</td>
                </tr>))}</tbody>
            </table></div>
          </Card>
        </div>
      ))}

      {tab === 'competitors' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={platform} onChange={(e) => setPlatform(e.target.value)}>{[...new Set([...PLATFORMS, ...platforms])].map((p) => <option key={p}>{p}</option>)}</Select>
            {ownRank > 0 && <span className="rounded-full bg-solar-amber/15 px-3 py-1 text-sm font-semibold text-solar-gold">SWELECT ranks #{ownRank} of {bench.length} on {platform}</span>}
          </div>
          {bench.length === 0 ? <Empty title={`No ${platform} numbers yet`} text={platform === 'Instagram' || platform === 'YouTube' ? 'Competitor numbers fill in automatically once SWELECT’s Instagram / YouTube is connected.' : 'Add competitors’ numbers by hand with “Add numbers by hand”.'} /> : (
            <>
              <Card title={`Followers on ${platform}`}>
                <HBars data={bench.slice(0, 15).map((a) => ({ name: a.isOwn ? `★ ${a.name}` : a.name, value: a.followers ?? 0 }))} keys={[{ key: 'value', name: 'Followers', color: C.amber }]} unit="" max={Math.max(1, ...bench.map((a) => a.followers ?? 0))} />
              </Card>
              <Card title="Comparison" subtitle="Engagement rate = average likes + comments + shares per post ÷ followers" bodyClass="p-0">
                <div className="overflow-x-auto"><table className="w-full text-sm">
                  <thead><tr className="border-b border-dark-700 text-left text-xs text-slate-400"><th className="p-3">#</th><th className="p-3">Company</th><th className="p-3 text-right">Followers</th><th className="p-3 text-right">30-day growth</th><th className="p-3 text-right">Engagement rate</th><th className="p-3 text-right">Avg likes</th><th className="p-3 text-right">Posts / 30 days</th><th className="p-3">Updated</th>{canEdit && <th className="p-3" />}</tr></thead>
                  <tbody>{bench.map((a, i) => (
                    <tr key={a.id} className={a.isOwn ? 'border-b border-dark-800 bg-solar-amber/10 font-semibold' : 'border-b border-dark-800'}>
                      <td className="p-3 text-slate-400">{i + 1}</td><td className="p-3 text-white">{a.name}<span className="ml-1 text-xs font-normal text-slate-500">@{a.handle}</span></td>
                      <td className="p-3 text-right tabular-nums">{fmtNum(a.followers)}</td>
                      <td className={`p-3 text-right tabular-nums ${a.growth30d == null ? 'text-slate-500' : a.growth30d >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{a.growth30d == null ? '—' : `${a.growth30d >= 0 ? '+' : ''}${a.growth30d}%`}</td>
                      <td className="p-3 text-right tabular-nums">{a.engagementRate == null ? '—' : `${a.engagementRate}%`}</td>
                      <td className="p-3 text-right tabular-nums">{fmtNum(a.avgLikes)}</td><td className="p-3 text-right tabular-nums">{a.posts30d || '—'}</td>
                      <td className="p-3 text-xs text-slate-500">{a.lastUpdated ? timeAgo(a.lastUpdated) : '—'}{a.source === 'manual' ? ' · by hand' : ''}</td>
                      {canEdit && <td className="p-3"><button title="Remove" onClick={async () => { if (confirm(`Remove ${a.name} (${a.platform}) and its history?`)) setData(await api.socialAction({ action: 'delete', accountId: a.id })); }} className="text-slate-500 hover:text-rose-300"><Trash2 className="h-4 w-4" /></button></td>}
                    </tr>))}</tbody>
                </table></div>
              </Card>
            </>
          )}
        </div>
      )}

      <ManualModal open={manual} onClose={() => setManual(false)} onSaved={(d) => { setData(d); setManual(false); toast('Numbers saved'); }} />
    </div>
  );
}

function ManualModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: (d: SocialData) => void }) {
  const { toast } = useApp();
  const [f, setF] = useState({ platform: 'LinkedIn', name: '', handle: '', isOwn: false, followers: '', posts: '', engagementRate: '' });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { onSaved(await api.socialAction({ action: 'manual', ...f, handle: f.handle || f.name })); setF({ ...f, name: '', handle: '', followers: '', posts: '', engagementRate: '' }); } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Add numbers by hand">
      <p className="mb-4 text-sm text-slate-400">Use this for anything not connected, e.g. a competitor's LinkedIn followers. Today's date is used.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Platform"><Select value={f.platform} onChange={(e) => setF({ ...f, platform: e.target.value })}>{PLATFORMS.map((p) => <option key={p}>{p}</option>)}</Select></Field>
        <Field label="Whose account"><Select value={f.isOwn ? 'own' : 'comp'} onChange={(e) => setF({ ...f, isOwn: e.target.value === 'own' })}><option value="comp">A competitor</option><option value="own">SWELECT</option></Select></Field>
        <Field label="Company name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Waaree Energies" /></Field>
        <Field label="Account / page name" hint="Optional"><Input value={f.handle} onChange={(e) => setF({ ...f, handle: e.target.value })} placeholder="e.g. waaree-energies" /></Field>
        <Field label="Followers"><Input type="number" min={0} value={f.followers} onChange={(e) => setF({ ...f, followers: e.target.value })} /></Field>
        <Field label="Engagement rate %" hint="Optional"><Input type="number" step="0.01" value={f.engagementRate} onChange={(e) => setF({ ...f, engagementRate: e.target.value })} /></Field>
      </div>
      <div className="mt-5 flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} disabled={!f.name || !f.followers}>Save</Button></div>
    </Modal>
  );
}
