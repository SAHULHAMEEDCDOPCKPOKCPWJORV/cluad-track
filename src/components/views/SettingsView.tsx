'use client';
import { useEffect, useState } from 'react';
import { CheckCircle2, Copy, Plug, Plus, RefreshCw, Trash2, XCircle } from 'lucide-react';
import { api, type Company, type NewsSource, type Recipients, type SalesPerson, type SecretName, type SettingsData } from '@/lib/api';
import { useApp } from '../AppShell';
import { Button, Card, Field, Input, Spinner } from '../ui';
import { copyText, PageTitle, timeAgo } from '../mkt';

const ORIGIN = typeof window !== 'undefined' ? window.location.origin : 'https://cluad-track.vercel.app';

function SecretInput({ name, label, hint, data, value, onChange, onRemove, removed, plain }: { name: SecretName; label: string; hint?: string; data: SettingsData; value: string | undefined; onChange: (v: string | undefined) => void; onRemove: () => void; removed: boolean; plain?: boolean }) {
  const s = data.secrets[name];
  const editing = value !== undefined;
  if (removed) return <Field label={label}><div className="flex items-center gap-2 rounded-lg border border-rose-400/40 px-3 py-2 text-sm text-rose-300">Will be removed when you save<button className="ml-auto text-xs text-slate-300 underline" onClick={() => onChange(undefined)}>Undo</button></div></Field>;
  return (
    <Field label={label} hint={hint}>
      {s?.fromEnv ? <div className="rounded-lg border border-dark-600 px-3 py-2 text-sm text-emerald-300">Set on the server{s.value ? `: ${s.value}` : ''}</div>
        : !editing && s?.set ? (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm">
            <CheckCircle2 className="h-4 w-4 text-emerald-400" /><span className="flex-1 truncate text-slate-200">{s.value ?? `Saved ${s.hint}`}</span>
            <button className="text-xs text-slate-400 hover:text-white" onClick={() => onChange(s.value ?? '')}>Change</button>
            <button className="text-xs text-rose-300 hover:text-rose-200" onClick={onRemove}>Remove</button>
          </div>
        ) : <Input type={plain ? 'text' : 'password'} autoComplete="off" value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder={editing && s?.set ? 'Type the new value (empty = keep the saved one)' : 'Not set'} />}
    </Field>
  );
}

const Status = ({ ok, children }: { ok: boolean; children: React.ReactNode }) => (
  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${ok ? 'bg-emerald-500/10 text-emerald-300' : 'bg-slate-500/10 text-slate-400'}`}>{ok ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}{children}</span>
);

export default function SettingsView() {
  const { toast } = useApp();
  const [data, setData] = useState<SettingsData | null>(null);
  const [sec, setSec] = useState<Partial<Record<SecretName, string>>>({});
  const [removed, setRemoved] = useState<SecretName[]>([]);
  const [team, setTeam] = useState<SalesPerson[]>([]);
  const [comp, setComp] = useState<Company[]>([]);
  const [src, setSrc] = useState<NewsSource[]>([]);
  const [rec, setRec] = useState<Recipients>({ news: [], reputation: [], social: [], leads: [] });
  const [busy, setBusy] = useState('');
  const apply = (d: SettingsData) => { setData(d); setTeam(d.salesTeam); setComp(d.competitors); setSrc(d.sources); setRec(d.recipients); setSec({}); setRemoved([]); };
  useEffect(() => { api.settings().then(apply).catch((e) => toast(e.message, 'err')); }, [toast]);
  if (!data) return <Spinner label="Loading settings…" />;

  const save = async (what: string, body: Record<string, unknown>) => {
    setBusy(what);
    try { apply(await api.saveSettings(body)); toast('Saved'); } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(''); }
  };
  // send typed values, and empty values only for keys the admin chose to remove
  const saveSecrets = (keys: SecretName[], what: string) => save(what, { secrets: Object.fromEntries([
    ...keys.filter((k) => (sec[k] ?? '').trim() !== '').map((k) => [k, sec[k]!.trim()]),
    ...keys.filter((k) => removed.includes(k)).map((k) => [k, '']),
  ]) });
  const sv = (k: SecretName) => ({
    name: k, data, value: sec[k], removed: removed.includes(k),
    onChange: (v: string | undefined) => { setRemoved(removed.filter((x) => x !== k)); setSec((cur) => { const n = { ...cur }; if (v === undefined) delete n[k]; else n[k] = v; return n; }); },
    onRemove: () => setRemoved([...removed, k]),
  });
  const isSet = (k: SecretName) => !!data.secrets[k]?.set;
  const run = async (sendEmails: boolean) => {
    setBusy(sendEmails ? 'run-mail' : 'run');
    try { await api.runAutomation(sendEmails); apply(await api.settings()); toast(sendEmails ? 'Done. Reports collected and emails sent.' : 'Done. Everything collected and the reports are updated.'); } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(''); }
  };
  const leadKey = data.secrets.LEAD_WEBHOOK_KEY?.value;
  const leadUrl = leadKey ? `${ORIGIN}/api/leads/inbound?key=${leadKey}` : '';
  const lr = data.lastRun as { at?: string; seconds?: number; emails?: { to: string; ok: boolean; error?: string }[]; social?: { account: string; ok: boolean; message: string }[]; email?: string } | null;
  const list = (v: string) => v.split(/[\s,;]+/).filter(Boolean);

  return (
    <div className="space-y-5">
      <PageTitle icon={<Plug className="h-5 w-5" />} title="Connections & Settings" subtitle="Admin only. Keys are stored on the server and never shown again in full." />

      <Card title="Daily automation" subtitle="Runs by itself every morning at about 6:00 AM (India time): collects news, mentions, reviews and social numbers, then emails the reports"
        right={<div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" loading={busy === 'run'} onClick={() => run(false)}><RefreshCw className="h-4 w-4" />Run now</Button><Button size="sm" loading={busy === 'run-mail'} onClick={() => run(true)}>Run now + send emails</Button></div>}>
        {lr?.at ? (
          <div className="space-y-2 text-sm text-slate-300">
            <div>Last run {timeAgo(lr.at)} ({lr.seconds}s).</div>
            {lr.email && <div className="text-emerald-300">Email: {lr.email}</div>}
            {!!lr.emails?.length && <div className="flex flex-wrap gap-1.5">{lr.emails.map((e, i) => <Status key={i} ok={e.ok}>{e.to}{e.error ? `: ${e.error}` : ''}</Status>)}</div>}
            {Array.isArray(lr.social) && !!lr.social.length && <div className="flex flex-wrap gap-1.5">{lr.social.map((s, i) => <Status key={i} ok={s.ok}>{s.account}{s.ok ? '' : `: ${s.message}`}</Status>)}</div>}
          </div>
        ) : <div className="text-sm text-slate-400">Not run yet.</div>}
        {data.lastFetch && <div className="mt-3 flex flex-wrap gap-1.5">{data.lastFetch.sources.map((s) => <Status key={s.source} ok={!s.error}>{s.source}: {s.error ? s.error : `${s.found} read, ${s.added} new`}</Status>)}</div>}
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="Email reports" subtitle={<>Uses <a className="text-solar-gold underline" href="https://resend.com" target="_blank" rel="noopener noreferrer">Resend</a> (free for 3,000 emails a month). Verify your domain there, then paste the API key.</>}
          right={<Status ok={isSet('RESEND_API_KEY') && isSet('EMAIL_FROM')}>{isSet('RESEND_API_KEY') && isSet('EMAIL_FROM') ? 'Ready' : 'Not set up'}</Status>}>
          <div className="space-y-3">
            <SecretInput {...sv('RESEND_API_KEY')} label="Resend API key" />
            <SecretInput {...sv('EMAIL_FROM')} plain label="Send from" hint='e.g. SWELECT Reports <reports@swelectes.com>' />
            <Button size="sm" loading={busy === 'email'} onClick={() => saveSecrets(['RESEND_API_KEY', 'EMAIL_FROM'], 'email')}>Save email settings</Button>
            <div className="grid gap-3 border-t border-dark-700 pt-3 sm:grid-cols-2">
              {([['news', 'Daily news digest to'], ['reputation', 'Reputation report to'], ['social', 'Social media report to'], ['leads', 'Leads summary to (managers)']] as [keyof Recipients, string][]).map(([k, label]) => (
                <Field key={k} label={label} hint="Emails separated by commas">
                  <textarea rows={2} className="w-full rounded-lg border border-dark-600 bg-dark-900 px-3 py-2 text-sm text-slate-100 focus:border-solar-amber focus:outline-none" value={rec[k].join(', ')} onChange={(e) => setRec({ ...rec, [k]: list(e.target.value) })} />
                </Field>
              ))}
            </div>
            <Button size="sm" loading={busy === 'rec'} onClick={() => save('rec', { recipients: rec })}>Save recipients</Button>
          </div>
        </Card>

        <Card title="Leads: automatic capture" subtitle="Send leads from forms and ads straight into the app">
          <div className="space-y-3 text-sm">
            <Field label="Lead link (website forms, Zapier/Make, IndiaMART/JustDial forwarding, Google Ads lead forms)">
              {leadUrl ? (
                <div className="flex items-center gap-2"><code className="flex-1 truncate rounded-lg border border-dark-600 bg-dark-900 px-3 py-2 text-xs text-slate-200">{leadUrl}</code><Button size="sm" variant="outline" onClick={async () => { await copyText(leadUrl); toast('Lead link copied'); }}><Copy className="h-4 w-4" /></Button></div>
              ) : <div className="text-slate-400">No key yet.</div>}
            </Field>
            <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" loading={busy === 'key'} onClick={() => { if (!leadKey || confirm('Make a new key? Forms using the old link will stop sending leads until updated.')) save('key', { newLeadKey: true }); }}>{leadKey ? 'Make a new key' : 'Create lead key'}</Button></div>
            <p className="text-xs text-slate-500">Forms can send fields like name, phone, email, company, city, state, requirement, campaign. Add <code>&amp;source=Website&amp;campaign=Rooftop-Nov</code> to the link to tag leads. For Google Ads lead forms, use the link as the webhook URL and the key as the "Key".</p>
            <div className="border-t border-dark-700 pt-3">
              <div className="mb-1 font-semibold text-white">Facebook & Instagram Lead Ads</div>
              <p className="text-xs text-slate-500">In the Meta app, subscribe the Page to "leadgen" with callback URL <code>{ORIGIN}/api/leads/meta</code> and the verify token below. Uses the Meta page token from Social media.</p>
              <div className="mt-2 grid gap-3 sm:grid-cols-2"><SecretInput {...sv('META_VERIFY_TOKEN')} plain label="Verify token" hint="Any word you choose" /><SecretInput {...sv('META_APP_SECRET')} label="Meta app secret" hint="Checks that leads really come from Meta" /></div>
              <Button size="sm" className="mt-2" loading={busy === 'metalead'} onClick={() => saveSecrets(['META_VERIFY_TOKEN', 'META_APP_SECRET'], 'metalead')}>Save</Button>
            </div>
          </div>
        </Card>
      </div>

      <Card title="Sales team" subtitle="New leads go to the person covering the lead's state, otherwise to whoever has the fewest open leads. Each person gets a morning email with their follow-ups.">
        <div className="space-y-2">
          {team.map((p, i) => (
            <div key={i} className="grid items-end gap-2 sm:grid-cols-[1fr_1fr_1.3fr_auto_auto]">
              <Input placeholder="Name" value={p.name} onChange={(e) => setTeam(team.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <Input placeholder="Email" value={p.email} onChange={(e) => setTeam(team.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)))} />
              <Input placeholder="States covered (optional), e.g. Tamil Nadu, Kerala" value={(p.states ?? []).join(', ')} onChange={(e) => setTeam(team.map((x, j) => (j === i ? { ...x, states: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) } : x)))} />
              <label className="flex items-center gap-1.5 pb-2 text-xs text-slate-300"><input type="checkbox" checked={p.active} onChange={(e) => setTeam(team.map((x, j) => (j === i ? { ...x, active: e.target.checked } : x)))} />Active</label>
              <button className="pb-2 text-slate-500 hover:text-rose-300" onClick={() => setTeam(team.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
          <div className="flex gap-2 pt-1"><Button size="sm" variant="outline" onClick={() => setTeam([...team, { name: '', email: '', states: [], active: true }])}><Plus className="h-4 w-4" />Add person</Button><Button size="sm" loading={busy === 'team'} onClick={() => save('team', { salesTeam: team })}>Save team</Button></div>
        </div>
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="Social media accounts" subtitle="One Meta page token covers Facebook, Instagram, competitors' Instagram and Lead Ads"
          right={<Status ok={isSet('META_PAGE_TOKEN')}>{isSet('META_PAGE_TOKEN') ? 'Meta connected' : 'Not connected'}</Status>}>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <SecretInput {...sv('META_PAGE_ID')} plain label="Facebook Page ID" />
              <SecretInput {...sv('META_IG_USER_ID')} plain label="Instagram Business account ID" />
            </div>
            <SecretInput {...sv('META_PAGE_TOKEN')} label="Meta page access token (long-lived)" hint="Permissions: pages_read_engagement, read_insights, instagram_basic, instagram_manage_insights, leads_retrieval" />
            <div className="grid gap-3 border-t border-dark-700 pt-3 sm:grid-cols-2">
              <SecretInput {...sv('LINKEDIN_ORG_ID')} plain label="LinkedIn organisation ID" />
              <SecretInput {...sv('LINKEDIN_TOKEN')} label="LinkedIn access token" hint="Needs Community Management API approval; renew every 60 days" />
              <SecretInput {...sv('YOUTUBE_API_KEY')} label="YouTube Data API key" hint="Free from Google Cloud" />
              <SecretInput {...sv('YOUTUBE_CHANNEL')} plain label="SWELECT YouTube channel" hint="@handle or channel ID" />
            </div>
            <Button size="sm" loading={busy === 'social'} onClick={() => saveSecrets(['META_PAGE_ID', 'META_IG_USER_ID', 'META_PAGE_TOKEN', 'LINKEDIN_ORG_ID', 'LINKEDIN_TOKEN', 'YOUTUBE_API_KEY', 'YOUTUBE_CHANNEL'], 'social')}>Save social connections</Button>
          </div>
        </Card>

        <Card title="Google reviews" subtitle="Customer reviews and star rating for the reputation report" right={<Status ok={isSet('GOOGLE_PLACES_KEY')}>{isSet('GOOGLE_PLACES_KEY') ? 'Connected' : 'Not connected'}</Status>}>
          <div className="space-y-3">
            <SecretInput {...sv('GOOGLE_PLACES_KEY')} label="Google Places API key" hint="Google Cloud → Places API (New)" />
            <SecretInput {...sv('GOOGLE_PLACE_IDS')} plain label="SWELECT place IDs" hint="One or more, separated by commas (find them with Google's Place ID Finder)" />
            <Button size="sm" loading={busy === 'google'} onClick={() => saveSecrets(['GOOGLE_PLACES_KEY', 'GOOGLE_PLACE_IDS'], 'google')}>Save</Button>
          </div>
        </Card>
      </div>

      <Card title="Competitors" subtitle="Used to tag news, and to benchmark social media. Instagram username and YouTube @handle let the app read their public numbers.">
        <div className="space-y-2">
          <div className="hidden grid-cols-[1.2fr_1.6fr_1fr_1fr_1fr_auto] gap-2 px-1 text-xs text-slate-500 md:grid"><span>Company</span><span>Other names in news</span><span>Instagram</span><span>YouTube</span><span>Sector</span><span /></div>
          {comp.map((c, i) => (
            <div key={i} className="grid gap-2 md:grid-cols-[1.2fr_1.6fr_1fr_1fr_1fr_auto]">
              <Input value={c.name} placeholder="Company" onChange={(e) => setComp(comp.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <Input value={c.aliases.join(', ')} placeholder="e.g. adani green, adani solar" onChange={(e) => setComp(comp.map((x, j) => (j === i ? { ...x, aliases: e.target.value.split(',').map((s) => s.trim()) } : x)))} />
              <Input value={c.instagram ?? ''} placeholder="username" onChange={(e) => setComp(comp.map((x, j) => (j === i ? { ...x, instagram: e.target.value } : x)))} />
              <Input value={c.youtube ?? ''} placeholder="@handle" onChange={(e) => setComp(comp.map((x, j) => (j === i ? { ...x, youtube: e.target.value } : x)))} />
              <Input value={c.sector ?? ''} placeholder="Solar / Wind" onChange={(e) => setComp(comp.map((x, j) => (j === i ? { ...x, sector: e.target.value } : x)))} />
              <button className="text-slate-500 hover:text-rose-300" onClick={() => setComp(comp.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
          <div className="flex gap-2 pt-1"><Button size="sm" variant="outline" onClick={() => setComp([...comp, { name: '', aliases: [] }])}><Plus className="h-4 w-4" />Add competitor</Button><Button size="sm" loading={busy === 'comp'} onClick={() => save('comp', { competitors: comp })}>Save competitors</Button></div>
        </div>
      </Card>

      <Card title="News sources" subtitle="RSS feeds read every morning and whenever someone opens the News page (at most every 30 minutes)">
        <div className="space-y-2">
          {src.map((s, i) => {
            const st = data.lastFetch?.sources.find((x) => x.source === s.name);
            return (
              <div key={i} className="grid items-center gap-2 md:grid-cols-[1fr_2.2fr_auto_auto_auto]">
                <Input value={s.name} onChange={(e) => setSrc(src.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                <Input value={s.url} onChange={(e) => setSrc(src.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
                <select className="rounded-lg border border-dark-600 bg-dark-900 px-2 py-2 text-xs text-slate-200" value={s.kind} onChange={(e) => setSrc(src.map((x, j) => (j === i ? { ...x, kind: e.target.value as NewsSource['kind'] } : x)))}><option value="news">Industry news</option><option value="mention">SWELECT mentions</option></select>
                <label className="flex items-center gap-1.5 text-xs text-slate-300"><input type="checkbox" checked={s.enabled} onChange={(e) => setSrc(src.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)))} />On{st && <Status ok={!st.error}>{st.error ? 'error' : `${st.found}`}</Status>}</label>
                <button className="text-slate-500 hover:text-rose-300" onClick={() => setSrc(src.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>
              </div>
            );
          })}
          <div className="flex gap-2 pt-1"><Button size="sm" variant="outline" onClick={() => setSrc([...src, { name: '', url: 'https://', kind: 'news', enabled: true }])}><Plus className="h-4 w-4" />Add source</Button><Button size="sm" loading={busy === 'src'} onClick={() => save('src', { sources: src })}>Save sources</Button></div>
        </div>
      </Card>
    </div>
  );
}
