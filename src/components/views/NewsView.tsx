'use client';
import { useEffect, useMemo, useState } from 'react';
import { Copy, ExternalLink, Newspaper, RefreshCw, Search } from 'lucide-react';
import { api, type Digest, type LastFetch, type NewsItem } from '@/lib/api';
import { useApp } from '../AppShell';
import { Button, Card, Empty, Input, Segmented, Select, Spinner } from '../ui';
import { Chip, copyText, PageTitle, timeAgo } from '../mkt';

const BRAND = 'SWELECT';

function Story({ n }: { n: NewsItem }) {
  return (
    <a href={n.url} target="_blank" rel="noopener noreferrer" className="group block rounded-xl border border-dark-700 bg-dark-850 p-4 transition hover:border-solar-amber/50">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-semibold leading-snug text-white group-hover:text-solar-gold">{n.title}</div>
          {n.summary && <p className="mt-1 line-clamp-2 text-sm text-slate-400">{n.summary}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
            <span className="font-medium text-slate-300">{n.source}</span>
            <span>· {timeAgo(n.publishedAt)}</span>
            <span className="rounded-full border border-dark-600 px-2 py-0.5 text-[11px] text-slate-300">{n.category}</span>
            {n.companies.map((c) => (
              <span key={c} className={c === BRAND ? 'rounded-full bg-solar-amber/20 px-2 py-0.5 text-[11px] font-bold text-solar-gold' : 'rounded-full bg-blue-500/10 px-2 py-0.5 text-[11px] text-blue-300'}>{c}</span>
            ))}
          </div>
        </div>
        <ExternalLink className="mt-1 h-4 w-4 shrink-0 text-slate-500 group-hover:text-solar-gold" />
      </div>
    </a>
  );
}

export function digestText(d: Digest) {
  const date = new Date(d.day).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
  const line = (n: NewsItem) => `• ${n.title} (${n.source})\n  ${n.url}`;
  const parts = [`Solar & Renewable News – ${date}`, `${d.total} stories in the last 24 hours`];
  if (d.brand.length) parts.push(`\nSWELECT IN THE NEWS\n${d.brand.map(line).join('\n')}`);
  if (d.competitors.length) parts.push(`\nCOMPETITORS\n${d.competitors.map((n) => `${line(n)}\n  [${n.companies.join(', ')}]`).join('\n')}`);
  for (const g of d.byCategory) parts.push(`\n${g.category.toUpperCase()}\n${g.items.map(line).join('\n')}`);
  return parts.join('\n');
}

export default function NewsView() {
  const { toast } = useApp();
  const [data, setData] = useState<{ items: NewsItem[]; digest: Digest; lastFetch: LastFetch | null } | null>(null);
  const [mode, setMode] = useState<'digest' | 'all'>('digest');
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('All');
  const [company, setCompany] = useState('all');
  const [days, setDays] = useState(7);

  const load = (d = days) => api.news(d).then(setData).catch((e) => toast(e.message, 'err'));
  useEffect(() => { load(days); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [days]);
  // first visit of the day: the server fetches in the background; pick up the result a little later
  useEffect(() => { const t = setTimeout(() => load(), 12000); return () => clearTimeout(t); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const refresh = async () => {
    setBusy(true);
    try { const r = await api.refreshNews(); setData(r); toast(`News updated · ${r.lastFetch?.added ?? 0} new stories`); } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  };

  const items = data?.items ?? [];
  const cats = useMemo(() => { const m = new Map<string, number>(); for (const i of items) m.set(i.category, (m.get(i.category) ?? 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1]); }, [items]);
  const companies = useMemo(() => [...new Set(items.flatMap((i) => i.companies))].filter((c) => c !== BRAND).sort(), [items]);
  const shown = items.filter((i) =>
    (cat === 'All' || i.category === cat) &&
    (company === 'all' || (company === 'brand' ? i.companies.includes(BRAND) : company === 'any' ? i.companies.some((c) => c !== BRAND) : i.companies.includes(company))) &&
    (!q || `${i.title} ${i.summary} ${i.source}`.toLowerCase().includes(q.toLowerCase())));

  if (!data) return <Spinner label="Collecting today's renewable-energy news…" />;
  const lf = data.lastFetch;
  const d = data.digest;
  const sources = lf?.sources ?? [];
  const failing = sources.filter((s) => s.error);

  return (
    <div className="space-y-5">
      <PageTitle icon={<Newspaper className="h-5 w-5" />} title="Solar & Renewable News"
        subtitle={<>Collected automatically from {sources.length || 'your'} sources · updated {timeAgo(lf?.at)}{failing.length ? <span className="text-emerald-300"> · {failing.length} source{failing.length > 1 ? 's' : ''} not responding</span> : null}</>}
        right={<>
          <Button variant="outline" onClick={async () => { if (await copyText(digestText(d))) toast('Digest copied. Paste it into an email or WhatsApp.'); }}><Copy className="h-4 w-4" />Copy digest</Button>
          <Button onClick={refresh} loading={busy}><RefreshCw className="h-4 w-4" />Refresh</Button>
        </>} />

      <Segmented value={mode} onChange={setMode} options={[{ value: 'digest', label: "Today's digest" }, { value: 'all', label: 'All news' }]} />

      {mode === 'digest' ? (
        d.total === 0 ? <Empty title="No stories in the last 24 hours yet" text="Press Refresh, or check back after the 6 AM update." /> : (
          <div className="space-y-5">
            <p className="text-sm text-slate-400">{d.total} renewable-energy stories in the last 24 hours, grouped by topic.</p>
            {d.brand.length > 0 && <Card title="SWELECT in the news" className="border-solar-amber/40"><div className="space-y-2">{d.brand.map((n) => <Story key={n.id} n={n} />)}</div></Card>}
            {d.competitors.length > 0 && <Card title="Competitors" subtitle="Stories that name a tracked competitor"><div className="space-y-2">{d.competitors.map((n) => <Story key={n.id} n={n} />)}</div></Card>}
            {d.byCategory.map((g) => <Card key={g.category} title={g.category} subtitle={`${g.items.length} stor${g.items.length === 1 ? 'y' : 'ies'}`}><div className="space-y-2">{g.items.map((n) => <Story key={n.id} n={n} />)}</div></Card>)}
          </div>
        )
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" /><Input className="w-full pl-9" placeholder="Search news…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
            <Select value={company} onChange={(e) => setCompany(e.target.value)}>
              <option value="all">All companies</option><option value="brand">SWELECT</option><option value="any">Any competitor</option>
              {companies.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
            <Select value={days} onChange={(e) => setDays(Number(e.target.value))}>{[1, 3, 7, 14, 30].map((n) => <option key={n} value={n}>Last {n} day{n > 1 ? 's' : ''}</option>)}</Select>
          </div>
          <div className="flex flex-wrap gap-1.5"><Chip active={cat === 'All'} onClick={() => setCat('All')} count={items.length}>All</Chip>{cats.map(([c, n]) => <Chip key={c} active={cat === c} onClick={() => setCat(c)} count={n}>{c}</Chip>)}</div>
          {shown.length ? <div className="space-y-2">{shown.slice(0, 200).map((n) => <Story key={n.id} n={n} />)}</div> : <Empty title="No stories match" text="Try another topic or a longer period." />}
        </div>
      )}
    </div>
  );
}
