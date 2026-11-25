'use client';
import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Trash2, Calculator, CalendarCheck, CalendarX, Sun } from 'lucide-react';
import { useApp } from '../AppShell';
import { Card, Button, C, Field, Input, Select } from '../ui';
import { VBars, Donut, Legendish } from '../charts';
import { api } from '@/lib/api';
import { addDays, fmt, todayIso, toDate, isValidIso } from '@/lib/calendar';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function CalendarView() {
  const { holidays, cal, user, reloadHolidays, toast, project, activities } = useApp();
  const today = todayIso();
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const [form, setForm] = useState({ date: '', name: '', type: 'Gazetted' });
  const [calc, setCalc] = useState({ start: today, days: 30 });
  const isAdmin = user.role === 'Admin';

  // activity load per day for heatmap overlay
  const load = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of activities) {
      if (a.isMilestone || a.plannedStartDate.slice(0, 4) > String(year) || a.plannedEndDate.slice(0, 4) < String(year)) continue;
      for (let d = a.plannedStartDate; d <= a.plannedEndDate; d = addDays(d, 1)) if (d.startsWith(String(year))) m.set(d, (m.get(d) ?? 0) + 1);
    }
    return m;
  }, [activities, year]);
  const maxLoad = Math.max(1, ...load.values());

  const stats = useMemo(() => {
    const per = MONTHS.map((mo, i) => {
      let work = 0, sun = 0, hol = 0, sat = 0;
      const first = `${year}-${String(i + 1).padStart(2, '0')}-01`;
      for (let d = first; d.slice(5, 7) === first.slice(5, 7); d = addDays(d, 1)) {
        if (cal.isSunday(d)) sun++;
        else if (cal.holidayName(d)) hol++;
        else work++;
        if (toDate(d).getUTCDay() === 6 && cal.isWorking(d)) sat++;
      }
      return { month: mo, 'Working days': work, Sundays: sun, Holidays: hol, sat };
    });
    return { per, work: per.reduce((s, x) => s + x['Working days'], 0), sun: per.reduce((s, x) => s + x.Sundays, 0), hol: per.reduce((s, x) => s + x.Holidays, 0), sat: per.reduce((s, x) => s + x.sat, 0) };
  }, [cal, year]);

  const yearHols = holidays.filter((h) => h.date.startsWith(String(year)));
  const add = async () => {
    try {
      await api.addHoliday(form);
      toast('Holiday added');
      setForm({ date: '', name: '', type: 'Gazetted' });
      await reloadHolidays();
    } catch (e) {
      toast((e as Error).message, 'err');
    }
  };
  const del = async (date: string) => {
    if (!confirm(`Remove holiday on ${fmt(date)}?`)) return;
    try {
      await api.deleteHoliday(date);
      toast('Holiday removed');
      await reloadHolidays();
    } catch (e) {
      toast((e as Error).message, 'err');
    }
  };
  const calcEnd = isValidIso(calc.start) && calc.days > 0 ? cal.finishFrom(calc.start, calc.days) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-lg border border-dark-600 bg-dark-900 p-1">
          <Button variant="ghost" size="sm" onClick={() => setYear(year - 1)}><ChevronLeft className="h-4 w-4" /></Button>
          <span className="px-3 font-mono text-lg font-bold text-white">{year}</span>
          <Button variant="ghost" size="sm" onClick={() => setYear(year + 1)}><ChevronRight className="h-4 w-4" /></Button>
        </div>
        <div className="grid flex-1 grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { l: 'Working days', v: stats.work, c: C.emerald, i: <CalendarCheck className="h-5 w-5" /> },
            { l: 'Working Saturdays', v: stats.sat, c: C.cyan, i: <Sun className="h-5 w-5" /> },
            { l: 'Sundays (0% working)', v: stats.sun, c: C.slate, i: <CalendarX className="h-5 w-5" /> },
            { l: 'Gazetted holidays (weekday)', v: stats.hol, c: C.amber, i: <CalendarX className="h-5 w-5" /> },
          ].map((t) => (
            <div key={t.l} className="flex items-center gap-3 rounded-xl border border-dark-700 bg-dark-850/80 p-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: `${t.c}22`, color: t.c }}>{t.i}</div>
              <div><div className="text-[10px] uppercase tracking-wide text-slate-400">{t.l}</div><div className="text-lg font-bold text-white">{t.v}</div></div>
            </div>
          ))}
        </div>
      </div>

      <Card title={`Working Calendar ${year}`} subtitle={project ? `Cell shading = number of ${project.name} activities planned that day` : 'Sundays off · Saturdays working · gazetted holidays excluded'}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {MONTHS.map((mo, mi) => {
            const first = `${year}-${String(mi + 1).padStart(2, '0')}-01`;
            const offset = (toDate(first).getUTCDay() + 6) % 7;
            const days: string[] = [];
            for (let d = first; d.slice(5, 7) === first.slice(5, 7); d = addDays(d, 1)) days.push(d);
            return (
              <div key={mo} className="rounded-lg border border-dark-700 bg-dark-900 p-2.5">
                <div className="mb-1.5 flex justify-between text-xs"><span className="font-semibold text-solar-gold">{mo}</span><span className="text-slate-500">{stats.per[mi]['Working days']} wd</span></div>
                <div className="grid grid-cols-7 gap-0.5 text-center text-[10px]">
                  {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <div key={i} className="text-slate-500">{d}</div>)}
                  {Array.from({ length: offset }).map((_, i) => <div key={`o${i}`} />)}
                  {days.map((d) => {
                    const hol = cal.holidayName(d);
                    const sun = cal.isSunday(d);
                    const l = load.get(d) ?? 0;
                    const bg = hol ? `${C.amber}cc` : sun ? 'rgb(var(--dk-700))' : l ? `rgba(6,182,212,${0.12 + (l / maxLoad) * 0.7})` : 'rgb(var(--dk-800))';
                    return (
                      <div key={d} title={`${fmt(d)}${hol ? ` · ${hol}` : sun ? ' · Sunday (non-working)' : ''}${l ? ` · ${l} activities` : ''}`}
                        className={`flex h-6 items-center justify-center rounded ${d === today ? 'ring-1 ring-solar-gold' : ''} ${hol ? 'font-bold !text-slate-950' : sun ? 'text-slate-600' : 'text-slate-200'}`} style={{ background: bg }}>
                        {Number(d.slice(8))}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap gap-4 text-[11px] text-slate-400">
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded" style={{ background: `${C.amber}cc` }} />Gazetted holiday</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-dark-700" />Sunday</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded" style={{ background: 'rgba(6,182,212,0.6)' }} />Planned activity load</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded ring-1 ring-solar-gold" />Today</span>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Monthly Working Days" className="xl:col-span-2">
          <VBars data={stats.per} xKey="month" stacked height={240} bars={[{ key: 'Working days', name: 'Working days', color: C.emerald }, { key: 'Holidays', name: 'Holidays', color: C.amber }, { key: 'Sundays', name: 'Sundays', color: C.slate }]} />
        </Card>
        <Card title="Year Composition">
          <Donut height={170} center={String(stats.work)} sub="working days" data={[{ name: 'Working', value: stats.work, color: C.emerald }, { name: 'Holidays', value: stats.hol, color: C.amber }, { name: 'Sundays', value: stats.sun, color: C.slate }]} />
          <div className="mt-3"><Legendish items={[{ name: 'Working', value: stats.work, color: C.emerald }, { name: 'Holidays', value: stats.hol, color: C.amber }, { name: 'Sundays', value: stats.sun, color: C.slate }]} /></div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card title={`Gazetted Holidays ${year}`} subtitle={`${yearHols.length} days · dates of moon-based festivals may shift`} className="xl:col-span-2" bodyClass="p-0">
          <table className="w-full text-sm">
            <tbody>
              {yearHols.map((h) => (
                <tr key={h.date} className="border-t border-dark-800">
                  <td className="px-4 py-2 font-mono text-slate-300">{fmt(h.date)}</td>
                  <td className="px-2 text-slate-400">{toDate(h.date).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' })}</td>
                  <td className="px-2 text-white">{h.name}</td>
                  <td className="px-2 text-xs text-slate-500">{h.type}{cal.isSunday(h.date) && ' · falls on Sunday'}</td>
                  <td className="px-4 text-right">{isAdmin && <button onClick={() => del(h.date)} className="text-slate-500 hover:text-brand-rose"><Trash2 className="h-4 w-4" /></button>}</td>
                </tr>
              ))}
              {!yearHols.length && <tr><td className="px-4 py-6 text-center text-slate-500">No holidays recorded for {year}. {isAdmin ? 'Add them below.' : 'Ask the Planning admin to add them.'}</td></tr>}
            </tbody>
          </table>
          {isAdmin && (
            <div className="flex flex-wrap items-end gap-2 border-t border-dark-700 p-4">
              <Field label="Date"><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
              <div className="min-w-[200px] flex-1"><Field label="Holiday name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field></div>
              <Field label="Type"><Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}><option>Gazetted</option><option>National</option><option>State</option><option>Company</option></Select></Field>
              <Button onClick={add} disabled={!form.date || !form.name}><Plus className="h-4 w-4" />Add</Button>
            </div>
          )}
        </Card>
        <Card title={<span className="flex items-center gap-1.5"><Calculator className="h-4 w-4 text-solar-amber" />Working-day Calculator</span>}>
          <div className="space-y-3">
            <Field label="Start date"><Input type="date" value={calc.start} onChange={(e) => setCalc({ ...calc, start: e.target.value })} /></Field>
            <Field label="Duration (working days)"><Input type="number" min={1} value={calc.days} onChange={(e) => setCalc({ ...calc, days: Number(e.target.value) })} /></Field>
            {calcEnd && (
              <div className="rounded-lg bg-dark-900 p-3 text-sm">
                <div className="text-slate-400">Finish date</div>
                <div className="text-2xl font-bold text-solar-gold">{fmt(calcEnd)}</div>
                <div className="mt-1 text-xs text-slate-500">{Math.round((toDate(calcEnd).getTime() - toDate(calc.start).getTime()) / 86400000) + 1} calendar days · first working day {fmt(cal.nextWorking(calc.start))}</div>
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
