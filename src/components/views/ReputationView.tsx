'use client';
import { useEffect, useState } from 'react';
import { Copy, ExternalLink, RefreshCw, ShieldCheck, Star } from 'lucide-react';
import { api, type NewsItem, type ReputationReport, type Review } from '@/lib/api';
import { canEditModule } from '@/lib/access';
import { useApp } from '../AppShell';
import { Button, C, Card, Empty, Segmented, Spinner } from '../ui';
import { VBars } from '../charts';
import { copyText, PageTitle, SetupNote, Stat, timeAgo, Tone } from '../mkt';

function reportText(r: ReputationReport) {
  const date = new Date(r.day).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
  const lines = [`SWELECT Reputation Report – ${date}`, `Reputation score (30 days): ${r.score}/100`, `Last 24 hours: ${r.last24h.mentions} mentions (${r.last24h.positive} positive, ${r.last24h.negative} negative), ${r.last24h.reviews} new reviews`, `Google rating: ${r.googleRating ?? 'not connected'}`];
  if (r.newItems.length) lines.push('', 'NEW MENTIONS', ...r.newItems.map((m) => `• ${m.title} (${m.source})\n  ${m.url}`));
  if (r.watch.length) lines.push('', 'NEEDS ATTENTION', ...r.watch.map((w) => `• [${w.type}] ${w.title}\n  ${w.url}`));
  return lines.join('\n');
}

export default function ReputationView() {
  const { user, toast, setView } = useApp();
  const [data, setData] = useState<{ report: ReputationReport; mentions: NewsItem[]; reviews: Review[] } | null>(null);
  const [tab, setTab] = useState<'mentions' | 'reviews' | 'watch'>('mentions');
  const [tone, setTone] = useState<'all' | 'pos' | 'neg'>('all');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.reputation().then(setData).catch((e) => toast(e.message, 'err')); }, [toast]);

  if (!data) return <Spinner label="Checking what people say about SWELECT…" />;
  const r = data.report;
  const refresh = async () => {
    setBusy(true);
    try { setData(await api.refreshReputation()); toast('Mentions and reviews checked'); } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  };
  const mentions = data.mentions.filter((m) => tone === 'all' || (tone === 'pos' ? m.sentiment > 0 : m.sentiment < 0));
  const chart = r.daily.map((d) => ({ day: d.day.slice(5).split('-').reverse().join('/'), Positive: d.positive, Neutral: d.neutral, Negative: d.negative }));

  return (
    <div className="space-y-5">
      <PageTitle icon={<ShieldCheck className="h-5 w-5" />} title="SWELECT Reputation Monitor" subtitle="News, web mentions and customer reviews about SWELECT, checked every day"
        right={<>
          <Button variant="outline" onClick={async () => { if (await copyText(reportText(r))) toast('Daily report copied'); }}><Copy className="h-4 w-4" />Copy daily report</Button>
          {canEditModule(user, 'reputation') && <Button onClick={refresh} loading={busy}><RefreshCw className="h-4 w-4" />Check now</Button>}
        </>} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Reputation score (30 days)" value={`${r.score}/100`} tone={r.score >= 80 ? 'good' : r.score >= 60 ? 'warn' : 'bad'} hint="Share of mentions & reviews that are not negative" />
        <Stat label="New mentions (24 h)" value={r.last24h.mentions} hint={`${r.last30d.mentions} in the last 30 days`} tone="accent" />
        <Stat label="Negative (30 days)" value={r.last30d.negative} tone={r.last30d.negative ? 'bad' : 'good'} hint={r.last30d.negative ? 'See "Needs attention"' : 'Nothing negative'} onClick={() => setTab('watch')} />
        <Stat label="Google rating" value={r.googleRating ? <span className="inline-flex items-center gap-1">{r.googleRating}<Star className="h-5 w-5 fill-current" /></span> : '—'} hint={r.googleRating ? `${data.reviews.length} reviews read` : 'Not connected yet'} />
      </div>

      {!data.reviews.length && user.role === 'Admin' && (
        <SetupNote title="Add Google reviews" action={<Button size="sm" variant="outline" onClick={() => setView('settings')}>Open Connections & Settings</Button>}>
          Add a Google Places API key and SWELECT's Google Business place IDs to bring customer reviews and the star rating into this report.
        </SetupNote>
      )}

      <Card title="Mentions per day" subtitle="Last 30 days, by tone">
        <VBars data={chart} xKey="day" stacked height={200} bars={[{ key: 'Positive', name: 'Positive', color: C.emerald }, { key: 'Neutral', name: 'Neutral', color: C.slate }, { key: 'Negative', name: 'Negative', color: C.rose }]} />
      </Card>

      <Segmented value={tab} onChange={setTab} options={[{ value: 'mentions', label: `Mentions (${data.mentions.length})` }, { value: 'reviews', label: `Reviews (${data.reviews.length})` }, { value: 'watch', label: `Needs attention (${r.watch.length})` }]} />

      {tab === 'mentions' && (
        <div className="space-y-3">
          <Segmented value={tone} onChange={setTone} options={[{ value: 'all', label: 'All' }, { value: 'pos', label: 'Positive' }, { value: 'neg', label: 'Negative' }]} />
          {mentions.length ? mentions.slice(0, 150).map((m) => (
            <a key={m.id} href={m.url} target="_blank" rel="noopener noreferrer" className="group flex items-start gap-3 rounded-xl border border-dark-700 bg-dark-850 p-4 hover:border-solar-amber/50">
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-white group-hover:text-solar-gold">{m.title}</div>
                {m.summary && <p className="mt-1 line-clamp-2 text-sm text-slate-400">{m.summary}</p>}
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500"><Tone value={m.sentiment} /><span className="font-medium text-slate-300">{m.source}</span><span>· {timeAgo(m.publishedAt)}</span></div>
              </div>
              <ExternalLink className="mt-1 h-4 w-4 shrink-0 text-slate-500" />
            </a>
          )) : <Empty title="No mentions found" text="SWELECT has not been mentioned in the sources checked so far." />}
        </div>
      )}
      {tab === 'reviews' && (
        data.reviews.length ? <div className="space-y-3">{data.reviews.map((v) => (
          <div key={v.id} className="rounded-xl border border-dark-700 bg-dark-850 p-4">
            <div className="flex flex-wrap items-center gap-2"><span className="text-solar-gold">{'★'.repeat(Math.round(v.rating))}<span className="text-dark-600">{'★'.repeat(5 - Math.round(v.rating))}</span></span><span className="font-semibold text-white">{v.author}</span><Tone value={v.sentiment} /><span className="text-xs text-slate-500">{v.place} · {timeAgo(v.publishedAt)}</span></div>
            {v.text && <p className="mt-2 text-sm text-slate-300">{v.text}</p>}
          </div>
        ))}</div> : <Empty title="No reviews yet" text="Reviews appear here once Google reviews are connected." />
      )}
      {tab === 'watch' && (
        r.watch.length ? <div className="space-y-2">{r.watch.map((w, i) => (
          <a key={i} href={w.url} target="_blank" rel="noopener noreferrer" className="flex items-start gap-3 rounded-xl border border-rose-400/40 bg-rose-500/5 p-4 hover:border-rose-400">
            <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[11px] font-bold text-rose-300">{w.type}</span>
            <div className="min-w-0 flex-1"><div className="font-semibold text-white">{w.title}</div><div className="text-xs text-slate-500">{w.source}</div></div>
          </a>
        ))}</div> : <Empty title="Nothing needs attention" text="No negative mentions or reviews in the last 30 days." />
      )}
    </div>
  );
}
