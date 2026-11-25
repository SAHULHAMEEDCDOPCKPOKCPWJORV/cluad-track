'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { CalendarClock, Download, Phone, Plus, Search, Upload, Users2, Mail, Zap } from 'lucide-react';
import { api, type Lead, type LeadStats } from '@/lib/api';
import { useApp } from '../AppShell';
import { Button, C, Card, Empty, Field, Input, Modal, Segmented, Select, Spinner } from '../ui';
import { HBars } from '../charts';
import { fmtINR, PageTitle, Stat, timeAgo } from '../mkt';

const STAGE_COLOR: Record<string, string> = { New: C.blue, Contacted: C.cyan, Qualified: C.violet, 'Site Visit': C.orange, 'Proposal Sent': C.amber, Negotiation: '#e879f9', Won: C.emerald, Lost: C.rose };
const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (n: number) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10);
const fmtDay = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—');

function StagePill({ stage }: { stage: string }) {
  const c = STAGE_COLOR[stage] ?? C.slate;
  return <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: `${c}22`, color: c, border: `1px solid ${c}55` }}>{stage}</span>;
}
function Due({ date }: { date: string | null }) {
  if (!date) return <span className="text-xs text-slate-500">No follow-up</span>;
  const t = today();
  const cls = date < t ? 'text-rose-300 font-semibold' : date === t ? 'text-emerald-300 font-semibold' : 'text-slate-400';
  return <span className={clsx('text-xs', cls)}>{date < t ? `Overdue · ${fmtDay(date)}` : date === t ? 'Due today' : `Next: ${fmtDay(date)}`}</span>;
}

export default function LeadsView() {
  const { user, toast } = useApp();
  const [data, setData] = useState<{ leads: Lead[]; stats: LeadStats; stages: string[]; team: string[] } | null>(null);
  const [tab, setTab] = useState<'follow' | 'pipeline' | 'all' | 'campaigns'>('follow');
  const [open, setOpen] = useState<Lead | null>(null);
  const [adding, setAdding] = useState(false);
  const [mine, setMine] = useState(false);
  const [q, setQ] = useState('');
  const [fStage, setFStage] = useState('');
  const [fOwner, setFOwner] = useState('');
  const [fCampaign, setFCampaign] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => api.leads().then(setData).catch((e) => toast(e.message, 'err')), [toast]);
  useEffect(() => {
    load();
    // new leads from forms/ads arrive any time: refresh every 20 seconds while this page is on screen
    const t = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 20000);
    return () => clearInterval(t);
  }, [load]);

  const leads = useMemo(() => data?.leads ?? [], [data]);
  const myName = useMemo(() => data?.team.find((n) => n.toLowerCase() === user.name.toLowerCase() || user.email.toLowerCase().startsWith(n.toLowerCase().split(' ')[0])) ?? '', [data, user]);
  if (!data) return <Spinner label="Loading leads…" />;
  const st = data.stats;
  const openStages = data.stages.filter((s) => s !== 'Won' && s !== 'Lost');
  const scoped = mine && myName ? leads.filter((l) => l.owner === myName) : leads;
  const followups = scoped.filter((l) => openStages.includes(l.stage) && (!l.nextFollowup || l.nextFollowup <= today())).sort((a, b) => String(a.nextFollowup ?? '0').localeCompare(String(b.nextFollowup ?? '0')));
  const campaigns = [...new Set(leads.map((l) => l.campaign).filter(Boolean))].sort();
  const owners = [...new Set([...data.team, ...leads.map((l) => l.owner).filter(Boolean)])].sort();
  const filtered = scoped.filter((l) => (!fStage || l.stage === fStage) && (!fOwner || l.owner === fOwner) && (!fCampaign || l.campaign === fCampaign) &&
    (!q || `${l.name} ${l.company} ${l.phone} ${l.email} ${l.city} ${l.requirement}`.toLowerCase().includes(q.toLowerCase())));

  const onSaved = (l: Lead) => { setData((d) => d && { ...d, leads: d.leads.map((x) => (x.id === l.id ? l : x)) }); setOpen(l); load(); };

  const exportXlsx = async () => {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Leads');
    ws.columns = [
      { header: 'Name', key: 'name', width: 24 }, { header: 'Company', key: 'company', width: 24 }, { header: 'Phone', key: 'phone', width: 16 }, { header: 'Email', key: 'email', width: 26 },
      { header: 'City', key: 'city', width: 14 }, { header: 'State', key: 'state', width: 14 }, { header: 'Requirement', key: 'requirement', width: 28 }, { header: 'Segment', key: 'segment', width: 14 },
      { header: 'Source', key: 'source', width: 16 }, { header: 'Campaign', key: 'campaign', width: 22 }, { header: 'Owner', key: 'owner', width: 16 }, { header: 'Stage', key: 'stage', width: 14 },
      { header: 'Value (₹)', key: 'value', width: 14 }, { header: 'Next follow-up', key: 'nextFollowup', width: 14 }, { header: 'Last contacted', key: 'lastContacted', width: 18 },
      { header: 'Created', key: 'createdAt', width: 18 }, { header: 'Lost reason', key: 'lostReason', width: 20 }, { header: 'Notes', key: 'notes', width: 40 },
    ];
    filtered.forEach((l) => ws.addRow({ ...l, lastContacted: l.lastContacted?.slice(0, 16).replace('T', ' ') ?? '', createdAt: l.createdAt.slice(0, 16).replace('T', ' ') }));
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B1220' } };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.autoFilter = { from: 'A1', to: 'R1' };
    const camp = wb.addWorksheet('Campaigns');
    camp.columns = [{ header: 'Campaign', key: 'name', width: 30 }, { header: 'Leads', key: 'leads', width: 10 }, { header: 'Open', key: 'open', width: 10 }, { header: 'Won', key: 'won', width: 10 }, { header: 'Lost', key: 'lost', width: 10 }, { header: 'Conversion %', key: 'conversion', width: 14 }, { header: 'Won value (₹)', key: 'wonValue', width: 16 }, { header: 'Avg days to win', key: 'avgDaysToWin', width: 16 }, { header: 'Overdue', key: 'overdue', width: 10 }];
    st.byCampaign.forEach((c) => camp.addRow(c));
    camp.getRow(1).font = { bold: true };
    const buf = await wb.xlsx.writeBuffer();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    a.download = `SWELECT-Leads-${today()}.xlsx`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importXlsx = async (file: File) => {
    try {
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      if (file.name.toLowerCase().endsWith('.csv')) {
        const text = await file.text();
        const [head, ...lines] = text.split(/\r?\n/).filter((l) => l.trim());
        const cols = head.split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
        const rows = lines.map((l) => Object.fromEntries(l.split(',').map((v, i) => [cols[i], v.trim().replace(/^"|"$/g, '')])));
        const r = await api.importLeads(rows);
        toast(`Imported: ${r.added} new, ${r.merged} matched existing leads${r.errors.length ? ` · ${r.errors.length} skipped` : ''}`);
      } else {
        await wb.xlsx.load(await file.arrayBuffer());
        const ws = wb.worksheets[0];
        // header = the first row with at least 2 filled cells
        let headerRow = 1;
        for (let i = 1; i <= Math.min(10, ws.rowCount); i++) if (ws.getRow(i).actualCellCount >= 2) { headerRow = i; break; }
        const headers: string[] = [];
        ws.getRow(headerRow).eachCell((c, i) => { headers[i] = String(c.text ?? '').trim(); });
        const rows: Record<string, unknown>[] = [];
        for (let i = headerRow + 1; i <= ws.rowCount; i++) {
          const row: Record<string, unknown> = {};
          ws.getRow(i).eachCell((c, j) => { if (headers[j]) row[headers[j]] = c.text; });
          if (Object.keys(row).length) rows.push(row);
        }
        const r = await api.importLeads(rows);
        toast(`Imported: ${r.added} new, ${r.merged} matched existing leads${r.errors.length ? ` · ${r.errors.length} skipped` : ''}`);
      }
      load();
    } catch (e) { toast(`Import failed: ${(e as Error).message}`, 'err'); }
  };

  return (
    <div className="space-y-5">
      <PageTitle icon={<Users2 className="h-5 w-5" />} title="Leads & Follow-ups" subtitle="Campaign leads arrive here automatically, are assigned to a salesperson and reminded every morning"
        right={<>
          <input ref={fileRef} type="file" accept=".xlsx,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importXlsx(f); e.target.value = ''; }} />
          {user.canEdit && <Button variant="outline" onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4" />Import Excel</Button>}
          {user.canExport && <Button variant="outline" onClick={exportXlsx}><Download className="h-4 w-4" />Export</Button>}
          {user.canEdit && <Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" />Add lead</Button>}
        </>} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="New today" value={st.newToday} tone="accent" />
        <Stat label="Follow up today" value={st.dueToday} tone={st.dueToday ? 'warn' : 'neutral'} onClick={() => setTab('follow')} />
        <Stat label="Overdue" value={st.overdue} tone={st.overdue ? 'bad' : 'good'} onClick={() => setTab('follow')} />
        <Stat label="Open leads" value={st.open} hint={st.pipelineValue ? fmtINR(st.pipelineValue) : undefined} onClick={() => setTab('pipeline')} />
        <Stat label="Won this month" value={st.wonThisMonth} tone="good" />
        <Stat label="Conversion" value={`${st.conversion}%`} hint={`${st.total} leads in total`} onClick={() => setTab('campaigns')} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Segmented value={tab} onChange={setTab} options={[{ value: 'follow', label: `Follow-ups (${followups.length})` }, { value: 'pipeline', label: 'Pipeline' }, { value: 'all', label: 'All leads' }, { value: 'campaigns', label: 'Campaigns' }]} />
        {myName && <label className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />Only my leads ({myName})</label>}
      </div>

      {leads.length === 0 && (
        <Card title="How leads come in automatically">
          <div className="grid gap-3 text-sm text-slate-300 md:grid-cols-3">
            <div className="flex gap-2"><Zap className="h-4 w-4 shrink-0 text-solar-gold" /><span><b>Website & landing-page forms</b>, Zapier, IndiaMART or JustDial forwarding send leads to the app's lead link.</span></div>
            <div className="flex gap-2"><Zap className="h-4 w-4 shrink-0 text-solar-gold" /><span><b>Facebook & Instagram Lead Ads</b> and <b>Google Ads lead forms</b> deliver leads the moment they are submitted.</span></div>
            <div className="flex gap-2"><Zap className="h-4 w-4 shrink-0 text-solar-gold" /><span><b>Excel</b>: import any lead sheet. Columns are recognised by name and duplicates are merged.</span></div>
          </div>
          <p className="mt-3 text-xs text-slate-500">An admin finds the lead link and keys under Connections & Settings → Leads.</p>
        </Card>
      )}

      {tab === 'follow' && (followups.length === 0 ? <Empty title="All caught up" text="No follow-ups due today." /> : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {followups.map((l) => <LeadCard key={l.id} l={l} onOpen={() => setOpen(l)} />)}
        </div>
      ))}

      {tab === 'pipeline' && (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {data.stages.map((s) => {
            const xs = scoped.filter((l) => l.stage === s);
            return (
              <div key={s} className="w-72 shrink-0 rounded-2xl border border-dark-700 bg-dark-900/60 p-2.5">
                <div className="mb-2 flex items-center justify-between px-1"><StagePill stage={s} /><span className="text-xs text-slate-500">{xs.length}{xs.some((l) => l.value) ? ` · ${fmtINR(xs.reduce((a, l) => a + (l.value ?? 0), 0))}` : ''}</span></div>
                <div className="max-h-[60vh] space-y-2 overflow-y-auto">{xs.slice(0, 100).map((l) => <LeadCard key={l.id} l={l} compact onOpen={() => setOpen(l)} />)}</div>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'all' && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <div className="relative min-w-[220px] flex-1"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" /><Input className="w-full pl-9" placeholder="Search name, company, phone, city…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
            <Select value={fStage} onChange={(e) => setFStage(e.target.value)}><option value="">All stages</option>{data.stages.map((s) => <option key={s}>{s}</option>)}</Select>
            <Select value={fOwner} onChange={(e) => setFOwner(e.target.value)}><option value="">All owners</option>{owners.map((s) => <option key={s}>{s}</option>)}</Select>
            <Select value={fCampaign} onChange={(e) => setFCampaign(e.target.value)}><option value="">All campaigns</option>{campaigns.map((s) => <option key={s}>{s}</option>)}</Select>
          </div>
          <Card bodyClass="p-0"><div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="border-b border-dark-700 text-left text-xs text-slate-400"><th className="p-3">Lead</th><th className="p-3">Phone</th><th className="p-3">Campaign / source</th><th className="p-3">Owner</th><th className="p-3">Stage</th><th className="p-3">Follow-up</th><th className="p-3">Added</th></tr></thead>
            <tbody>{filtered.slice(0, 500).map((l) => (
              <tr key={l.id} onClick={() => setOpen(l)} className="cursor-pointer border-b border-dark-800 hover:bg-dark-800/60">
                <td className="p-3"><div className="font-semibold text-white">{l.name}</div><div className="text-xs text-slate-500">{[l.company, l.city].filter(Boolean).join(' · ')}</div></td>
                <td className="p-3 font-mono text-xs text-slate-300">{l.phone || '—'}</td>
                <td className="p-3 text-slate-300">{l.campaign || '—'}<div className="text-xs text-slate-500">{l.source}</div></td>
                <td className="p-3 text-slate-300">{l.owner || <span className="text-emerald-300">Unassigned</span>}</td>
                <td className="p-3"><StagePill stage={l.stage} /></td>
                <td className="p-3">{openStages.includes(l.stage) ? <Due date={l.nextFollowup} /> : <span className="text-xs text-slate-500">—</span>}</td>
                <td className="p-3 text-xs text-slate-500">{timeAgo(l.createdAt)}</td>
              </tr>))}</tbody>
          </table></div>{filtered.length === 0 && <div className="p-6"><Empty title="No leads match" /></div>}</Card>
        </div>
      )}

      {tab === 'campaigns' && (
        <div className="space-y-5">
          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="Sales funnel" subtitle="How many leads reached each stage">
              <HBars data={st.funnel.map((f) => ({ name: f.stage, value: f.count }))} keys={[{ key: 'value', name: 'Leads', color: C.amber }]} unit="" max={Math.max(1, st.total)} />
            </Card>
            <Card title="Conversion by source" subtitle="Won ÷ all leads from that source">
              <HBars data={st.bySource.slice(0, 10).map((s) => ({ name: s.name, value: s.conversion }))} keys={[{ key: 'value', name: 'Conversion %', color: C.emerald }]} max={Math.max(10, ...st.bySource.map((s) => s.conversion))} />
            </Card>
          </div>
          {[['Campaigns', st.byCampaign], ['Salespeople', st.byOwner]].map(([title, rows]) => (
            <Card key={title as string} title={title as string} bodyClass="p-0"><div className="overflow-x-auto"><table className="w-full text-sm">
              <thead><tr className="border-b border-dark-700 text-left text-xs text-slate-400"><th className="p-3">Name</th><th className="p-3 text-right">Leads</th><th className="p-3 text-right">Open</th><th className="p-3 text-right">Won</th><th className="p-3 text-right">Lost</th><th className="p-3 text-right">Conversion</th><th className="p-3 text-right">Won value</th><th className="p-3 text-right">Avg days to win</th><th className="p-3 text-right">Overdue</th></tr></thead>
              <tbody>{(rows as LeadStats['byCampaign']).map((c) => (
                <tr key={c.name} className="border-b border-dark-800"><td className="p-3 font-medium text-white">{c.name}</td><td className="p-3 text-right tabular-nums">{c.leads}</td><td className="p-3 text-right tabular-nums">{c.open}</td><td className="p-3 text-right tabular-nums text-emerald-300">{c.won}</td><td className="p-3 text-right tabular-nums text-slate-400">{c.lost}</td><td className="p-3 text-right font-semibold tabular-nums">{c.conversion}%</td><td className="p-3 text-right tabular-nums">{c.wonValue ? fmtINR(c.wonValue) : '—'}</td><td className="p-3 text-right tabular-nums">{c.avgDaysToWin ?? '—'}</td><td className={clsx('p-3 text-right tabular-nums', c.overdue && 'font-semibold text-rose-300')}>{c.overdue}</td></tr>
              ))}</tbody>
            </table></div></Card>
          ))}
        </div>
      )}

      {open && <LeadModal lead={open} stages={data.stages} owners={owners} onClose={() => setOpen(null)} onSaved={onSaved} />}
      {adding && <AddLeadModal owners={owners} onClose={() => setAdding(false)} onAdded={(l, dup) => { setAdding(false); toast(dup ? `${l.name} already exists. The new enquiry was added to their history.` : `Lead added${l.owner ? ` and assigned to ${l.owner}` : ''}`); load(); }} />}
    </div>
  );
}

function LeadCard({ l, onOpen, compact }: { l: Lead; onOpen: () => void; compact?: boolean }) {
  return (
    <button onClick={onOpen} className="w-full rounded-xl border border-dark-700 bg-dark-850 p-3.5 text-left transition hover:border-solar-amber/50">
      <div className="flex items-start justify-between gap-2"><div className="min-w-0"><div className="truncate font-semibold text-white">{l.name}</div>{l.company && <div className="truncate text-xs text-slate-400">{l.company}</div>}</div>{!compact && <StagePill stage={l.stage} />}</div>
      {!compact && l.requirement && <div className="mt-1.5 line-clamp-2 text-xs text-slate-400">{l.requirement}</div>}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2"><Due date={l.nextFollowup} /><span className="text-xs text-slate-500">{l.owner || 'Unassigned'}</span></div>
      {!compact && <div className="mt-1 text-[11px] text-slate-500">{l.campaign || l.source}{l.phone ? ` · ${l.phone}` : ''}</div>}
    </button>
  );
}

function LeadModal({ lead, stages, owners, onClose, onSaved }: { lead: Lead; stages: string[]; owners: string[]; onClose: () => void; onSaved: (l: Lead) => void }) {
  const { toast, user } = useApp();
  const [l, setL] = useState(lead);
  const [note, setNote] = useState('');
  // after a call the next follow-up moves forward: keep a future date, otherwise suggest 2 days from today
  const suggest = (l: Lead) => (l.nextFollowup && l.nextFollowup > today() ? l.nextFollowup : plusDays(2));
  const [next, setNext] = useState(suggest(lead));
  const [lostReason, setLostReason] = useState(lead.lostReason);
  const [history, setHistory] = useState<{ at: string; by: string; kind: string; text: string }[]>([]);
  const [busy, setBusy] = useState('');
  useEffect(() => { setL(lead); setNext(suggest(lead)); api.leadHistory(lead.id).then((h) => setHistory(h.history)).catch(() => undefined); }, [lead]);

  const save = async (patch: Parameters<typeof api.updateLead>[1], label: string, ok: string) => {
    setBusy(label);
    try { const r = await api.updateLead(l.id, patch); onSaved(r.lead); setNote(''); toast(ok); api.leadHistory(l.id).then((h) => setHistory(h.history)).catch(() => undefined); } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(''); }
  };
  const editable = user.canEdit;
  return (
    <Modal open onClose={onClose} title={<span className="flex items-center gap-2">{l.name}<StagePill stage={l.stage} /></span>} wide>
      <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {l.phone && <a href={`tel:${l.phone}`} className="inline-flex items-center gap-1.5 rounded-lg border border-dark-600 px-3 py-1.5 text-sm text-slate-200 hover:border-solar-amber"><Phone className="h-4 w-4" />{l.phone}</a>}
            {l.phone && <a href={`https://wa.me/${l.phone.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 px-3 py-1.5 text-sm text-emerald-300">WhatsApp</a>}
            {l.email && <a href={`mailto:${l.email}`} className="inline-flex items-center gap-1.5 rounded-lg border border-dark-600 px-3 py-1.5 text-sm text-slate-200 hover:border-solar-amber"><Mail className="h-4 w-4" />{l.email}</a>}
          </div>
          <div className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
            {([['Company', l.company], ['City / state', [l.city, l.state].filter(Boolean).join(', ')], ['Requirement', l.requirement], ['Segment', l.segment], ['Campaign', l.campaign], ['Source', l.source], ['Added', new Date(l.createdAt).toLocaleString('en-IN')], ['Last contacted', l.lastContacted ? timeAgo(l.lastContacted) : 'Not yet']] as [string, string][]).map(([k, v]) => (
              <div key={k} className="flex gap-2 border-b border-dark-800 py-1.5"><span className="w-28 shrink-0 text-slate-500">{k}</span><span className="text-slate-200">{v || '—'}</span></div>
            ))}
          </div>

          {editable && (
            <div className="rounded-xl border border-dark-700 bg-dark-900/60 p-4">
              <div className="mb-2 flex items-center gap-2 font-semibold text-white"><CalendarClock className="h-4 w-4 text-solar-gold" />Log a call / follow-up</div>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="What happened? e.g. Spoke to owner, wants 150 kW rooftop quote" className="w-full rounded-lg border border-dark-600 bg-dark-900 px-3 py-2 text-sm text-slate-100 focus:border-solar-amber focus:outline-none" />
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <Field label="Next follow-up"><Input type="date" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
                <div className="flex gap-1">{[1, 3, 7].map((d) => <button key={d} onClick={() => setNext(plusDays(d))} className="rounded-md border border-dark-600 px-2 py-1.5 text-xs text-slate-300 hover:border-solar-amber">+{d}d</button>)}</div>
                <Button className="ml-auto" loading={busy === 'call'} disabled={!note.trim()} onClick={() => save({ logCall: note.trim(), nextFollowup: next }, 'call', 'Follow-up saved')}>Save follow-up</Button>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-4">
          {editable && (
            <>
              <Field label="Stage">
                <div className="flex flex-wrap gap-1.5">{stages.map((s) => (
                  <button key={s} disabled={!!busy} onClick={() => { if (s === l.stage) return; if (s === 'Lost' && !lostReason.trim()) { toast('Type a reason below first, then press Lost', 'err'); return; } save({ stage: s, lostReason: s === 'Lost' ? lostReason : undefined }, 'stage', `Moved to ${s}`); }}
                    className={clsx('rounded-full border px-2.5 py-1 text-xs font-semibold transition', s === l.stage ? 'border-solar-amber bg-solar-amber text-dark-950' : 'border-dark-600 text-slate-300 hover:border-solar-amber/60')}>{s}</button>
                ))}</div>
              </Field>
              <Field label="Reason if lost"><Input value={lostReason} onChange={(e) => setLostReason(e.target.value)} placeholder="e.g. Price, chose competitor" /></Field>
              <Field label="Owner"><Select value={l.owner} onChange={(e) => save({ owner: e.target.value }, 'owner', `Assigned to ${e.target.value || 'nobody'}`)}><option value="">Unassigned</option>{owners.map((o) => <option key={o}>{o}</option>)}</Select></Field>
              <Field label="Deal value (₹)"><Input type="number" defaultValue={l.value ?? ''} onBlur={(e) => { const v = e.target.value === '' ? null : Number(e.target.value); if (v !== l.value) save({ value: v }, 'value', 'Value saved'); }} /></Field>
            </>
          )}
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">History</div>
            <div className="max-h-72 space-y-2 overflow-y-auto pr-1">{history.map((h, i) => (
              <div key={i} className="rounded-lg border border-dark-700 p-2.5 text-xs"><div className="flex justify-between text-slate-500"><span className="font-semibold text-slate-300">{h.kind}</span><span>{timeAgo(h.at)}</span></div><div className="mt-1 text-slate-300">{h.text}</div><div className="mt-0.5 text-slate-500">{h.by}</div></div>
            ))}{!history.length && <div className="text-xs text-slate-500">No history yet</div>}</div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function AddLeadModal({ owners, onClose, onAdded }: { owners: string[]; onClose: () => void; onAdded: (l: Lead, dup: boolean) => void }) {
  const { toast } = useApp();
  const [f, setF] = useState({ name: '', phone: '', email: '', company: '', city: '', state: '', requirement: '', segment: 'Commercial', source: 'Phone enquiry', campaign: '', owner: '', value: '' });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const add = async () => {
    setBusy(true);
    try { const r = await api.addLead(f); onAdded(r.lead, r.duplicate); } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Add a lead" wide>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Name *"><Input value={f.name} onChange={set('name')} autoFocus /></Field>
        <Field label="Phone"><Input value={f.phone} onChange={set('phone')} placeholder="10-digit mobile" /></Field>
        <Field label="Email"><Input value={f.email} onChange={set('email')} /></Field>
        <Field label="Company"><Input value={f.company} onChange={set('company')} /></Field>
        <Field label="City"><Input value={f.city} onChange={set('city')} /></Field>
        <Field label="State"><Input value={f.state} onChange={set('state')} placeholder="Used to pick the salesperson" /></Field>
        <Field label="Requirement"><Input value={f.requirement} onChange={set('requirement')} placeholder="e.g. 100 kW rooftop" /></Field>
        <Field label="Segment"><Select value={f.segment} onChange={set('segment')}>{['Residential', 'Commercial', 'Industrial', 'Institutional', 'Open access / IPP', 'Other'].map((s) => <option key={s}>{s}</option>)}</Select></Field>
        <Field label="Source"><Input value={f.source} onChange={set('source')} /></Field>
        <Field label="Campaign"><Input value={f.campaign} onChange={set('campaign')} /></Field>
        <Field label="Owner" hint="Leave empty to assign automatically"><Select value={f.owner} onChange={set('owner')}><option value="">Assign automatically</option>{owners.map((o) => <option key={o}>{o}</option>)}</Select></Field>
        <Field label="Deal value (₹)"><Input type="number" value={f.value} onChange={set('value')} /></Field>
      </div>
      <div className="mt-5 flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={add} loading={busy} disabled={!f.name.trim() && !f.phone.trim()}>Add lead</Button></div>
    </Modal>
  );
}
