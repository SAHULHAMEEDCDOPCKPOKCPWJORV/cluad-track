'use client';
// Multi-sheet Excel export: colourful dashboard, Gantt chart, S-curves (overall + each section) and registers.
import type { Activity, Project } from './types';
import { addDays, fmt, toDate, toIso } from './calendar';
import { buildSCurve, fmtSpi, periodProgress, type ProgressHistory, type ValidationReport, type GroupSummary, type Kpis, type ProjectAnalysis, type SPoint } from './schedule';
import type { ProjectReport } from './report';
import type { WorkCalendar } from './calendar';
import { downloadBlob } from './excelImport';
import { sCurvePng, donutPng, barsPng } from './chartImage';
import { sectionColorMap, tint, trimCurve } from './sectionColors';
import { activityPerformance } from './performance';

export interface ExportCtx {
  project: Project;
  activities: Activity[];
  cal: WorkCalendar;
  today: string;
  an: ProjectAnalysis;
  kpis: Kpis;
  sections: GroupSummary[];
  depts: GroupSummary[];
  curve: SPoint[];
  hist?: ProgressHistory;
  validation?: ValidationReport;
  report: ProjectReport;
  user: string;
}

const argb = (hex: string) => `FF${hex.replace('#', '').toUpperCase()}`;
const NAVY = '#0f172a', SLATE = '#64748b', LINE = '#e2e8f0', ZEBRA = '#f8fafc', AMBER = '#10b981';
const STATUS_HEX: Record<string, string> = { Completed: '#10b981', 'In Progress': '#3b82f6', 'Not Started': '#94a3b8', Delayed: '#f43f5e', 'On Hold': '#10b981' };
const DEPT_HEX: Record<string, string> = { PLAN: '#10b981', LAND: '#84cc16', ENG: '#06b6d4', PRO: '#8b5cf6', SITE: '#34d399', TRN: '#3b82f6', COMM: '#10b981' };
const safeSheet = (s: string) => s.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type WS = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const solid = (hex: string): any => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: argb(hex) } });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const thin = (hex = LINE): any => ({ style: 'thin', color: { argb: argb(hex) } });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const box = (hex = LINE): any => ({ top: thin(hex), left: thin(hex), bottom: thin(hex), right: thin(hex) });

function title(ws: WS, text: string, sub: string, span: number, accent = AMBER) {
  ws.mergeCells(1, 1, 1, span);
  const t = ws.getCell(1, 1);
  t.value = text;
  t.font = { bold: true, size: 18, color: { argb: 'FFFFFFFF' } };
  t.fill = solid(NAVY);
  t.alignment = { vertical: 'middle', indent: 1 };
  ws.getRow(1).height = 34;
  ws.mergeCells(2, 1, 2, span);
  const s = ws.getCell(2, 1);
  s.value = sub;
  s.font = { italic: true, size: 10, color: { argb: 'FFFFFFFF' } };
  s.fill = solid(accent);
  s.alignment = { vertical: 'middle', indent: 1 };
  ws.getRow(2).height = 20;
}

type Col = { h: string; w?: number; align?: 'left' | 'center' | 'right'; fmt?: string };
/** Styled table: coloured header, borders, zebra rows, centred numbers. Returns the next free row. */
function table(ws: WS, startRow: number, cols: Col[], rows: (string | number | null)[][], headHex = NAVY) {
  cols.forEach((c, i) => {
    const cell = ws.getCell(startRow, i + 1);
    cell.value = c.h;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    cell.fill = solid(headHex);
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = box('#334155');
    if (c.w) ws.getColumn(i + 1).width = Math.max(ws.getColumn(i + 1).width ?? 0, c.w);
  });
  ws.getRow(startRow).height = 32;
  rows.forEach((r, i) => {
    const row = ws.getRow(startRow + 1 + i);
    row.height = 18;
    r.forEach((v, j) => {
      const cell = row.getCell(j + 1);
      cell.value = v;
      const c = cols[j];
      cell.alignment = { vertical: 'middle', horizontal: c?.align ?? (typeof v === 'number' || (typeof v === 'string' && /^\d{2}-\d{2}-\d{4}$/.test(v)) ? 'center' : 'left'), wrapText: false };
      cell.border = box();
      if (c?.fmt && typeof v === 'number') cell.numFmt = c.fmt;
      if (i % 2) cell.fill = solid(ZEBRA);
    });
  });
  return startRow + rows.length + 2;
}

function colourStatus(ws: WS, fromRow: number, count: number, col: number) {
  for (let i = 0; i < count; i++) {
    const c = ws.getCell(fromRow + i, col);
    const f = STATUS_HEX[String(c.value)];
    if (f) { c.fill = solid(tint(f, 0.75)); c.font = { bold: true, color: { argb: argb(f) } }; c.alignment = { horizontal: 'center', vertical: 'middle' }; }
  }
}
function colourProgress(ws: WS, fromRow: number, count: number, col: number) {
  for (let i = 0; i < count; i++) {
    const c = ws.getCell(fromRow + i, col);
    const v = Number(c.value);
    if (!Number.isFinite(v)) continue;
    const hex = v >= 100 ? '#10b981' : v > 0 ? '#10b981' : '#94a3b8';
    c.font = { bold: true, color: { argb: argb(hex) } };
    c.numFmt = '0.0"%"';
  }
}

const bar = (pct: number, n = 10) => '█'.repeat(Math.round((Math.max(0, Math.min(100, pct)) / 100) * n)) + '░'.repeat(n - Math.round((Math.max(0, Math.min(100, pct)) / 100) * n));

function activityRow(a: Activity, x: ExportCtx) {
  const m = x.an.byId.get(a.activityId)!;
  return [a.sNo, a.activityId, a.activityName, a.section, a.department, a.incharge || '', a.isMilestone ? 0 : a.plannedDuration, fmt(a.plannedStartDate), fmt(a.plannedEndDate),
    a.actualDuration ?? '', fmt(a.actualStartDate), fmt(a.actualEndDate), a.progressPercent, activityPerformance(a) ?? 0, m.status, m.delayDays, fmt(m.forecastEnd),
    m.critical ? 'Yes' : '', a.delayReason || '', a.remarks];
}
const ACT_COLS: Col[] = [
  { h: 'S.No', w: 6 }, { h: 'Activity ID', w: 11 }, { h: 'Activity Name', w: 46 }, { h: 'Section', w: 28 }, { h: 'Dept', w: 7, align: 'center' }, { h: 'Incharge', w: 16 },
  { h: 'Planned Duration', w: 10 }, { h: 'Planned Start', w: 12 }, { h: 'Planned End', w: 12 }, { h: 'Actual Duration', w: 10 }, { h: 'Actual Start', w: 12 }, { h: 'Actual End', w: 12 },
  { h: 'Progress %', w: 10 }, { h: 'Incharge Perf %', w: 10, fmt: '0"%"' }, { h: 'Status', w: 12 }, { h: 'Delay (wd)', w: 9 }, { h: 'Forecast End', w: 12 }, { h: 'Critical', w: 8, align: 'center' },
  { h: 'Delay Reason', w: 28 }, { h: 'Remarks', w: 36 },
];

/** Puts a PNG data URL on a sheet at (col,row) scaled to `width` pixels. */
function picture(wb: WS, ws: WS, dataUrl: string, col: number, row: number, width: number) {
  const [w, h] = pngSize(dataUrl);
  const height = Math.round((h / w) * width);
  ws.addImage(wb.addImage({ base64: dataUrl, extension: 'png' }), { tl: { col, row }, ext: { width, height }, editAs: 'oneCell' });
  return height;
}
function pngSize(dataUrl: string): [number, number] {
  const b = atob(dataUrl.split(',')[1].slice(0, 64));
  const n = (i: number) => ((b.charCodeAt(i) << 24) | (b.charCodeAt(i + 1) << 16) | (b.charCodeAt(i + 2) << 8) | b.charCodeAt(i + 3)) >>> 0;
  return [n(16), n(20)];
}
const ROW_PX = 20;

export async function exportExcel(x: ExportCtx) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'SWELECT Project Control';
  wb.created = new Date();
  const k = x.kpis;
  const p = x.project;
  const stamp = `${p.name} · ${p.capacityMw} MW ${p.projectType} · Data date ${fmt(x.today)} · Exported by ${x.user}`;
  const colors = sectionColorMap(x.sections.map((s) => s.key));
  const colorOf = (s: string) => colors.get(s) ?? '#64748b';
  const healthHex = x.report.health === 'On Track' ? '#10b981' : x.report.health === 'At Risk' ? '#10b981' : '#f43f5e';
  const secCurves = x.sections.map((s) => ({ s, curve: buildSCurve(x.activities.filter((a) => a.section === s.key), x.cal, x.an, x.hist) }));

  // 1. DASHBOARD (same view as the website dashboard)
  {
    const N = 20;
    const ws = wb.addWorksheet('Dashboard', { properties: { tabColor: { argb: argb(AMBER) } }, views: [{ showGridLines: false }] });
    for (let c = 1; c <= N; c++) ws.getColumn(c).width = 6.6;
    title(ws, `SWELECT Project Dashboard – ${p.name}`, stamp, N);
    // KPI tiles (5 tiles × 4 columns)
    const tiles = [
      { l: 'OVERALL PROGRESS', v: `${k.overallProgress}%`, n: `Planned ${k.plannedProgress}%`, c: '#10b981' },
      { l: 'SCHEDULE (SPI)', v: fmtSpi(k), n: `Variance ${k.scheduleVariance > 0 ? '+' : ''}${k.scheduleVariance}%`, c: k.spi >= 0.95 ? '#10b981' : k.spi >= 0.85 ? '#10b981' : '#f43f5e' },
      { l: 'COMPLETED', v: `${k.completed} / ${k.total}`, n: `${k.inProgress} in progress`, c: '#3b82f6' },
      { l: 'DELAYED', v: String(k.delayed), n: `${k.criticalDelays} on critical path`, c: '#f43f5e' },
      { l: 'FORECAST FINISH', v: fmt(k.forecastFinish), n: `Planned ${fmt(k.plannedFinish)}`, c: '#8b5cf6' },
    ];
    tiles.forEach((t, i) => {
      const c1 = i * 4 + 1, c2 = c1 + 3;
      const put = (r: number, val: string, font: object, h: number) => {
        ws.mergeCells(r, c1, r, c2);
        const cell = ws.getCell(r, c1);
        cell.value = val;
        cell.font = font;
        cell.fill = solid(t.c);
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        ws.getRow(r).height = h;
      };
      put(4, t.l, { bold: true, size: 9, color: { argb: 'FFFFFFFF' } }, 18);
      put(5, t.v, { bold: true, size: 22, color: { argb: 'FFFFFFFF' } }, 36);
      put(6, t.n, { size: 9, color: { argb: 'FFFFFFFF' } }, 18);
      for (let c = c1; c <= c2; c++) for (const r of [4, 5, 6]) ws.getCell(r, c).border = { left: c === c1 ? { style: 'medium', color: { argb: 'FFFFFFFF' } } : undefined, right: c === c2 ? { style: 'medium', color: { argb: 'FFFFFFFF' } } : undefined };
    });
    ws.mergeCells(8, 1, 8, N);
    const h = ws.getCell(8, 1);
    h.value = `Project health: ${x.report.health}  ·  ${x.report.headline}`;
    h.font = { bold: true, color: { argb: argb(healthHex) } };
    h.fill = solid(tint(healthHex, 0.85));
    h.alignment = { vertical: 'middle', indent: 1 };
    h.border = { left: { style: 'thick', color: { argb: argb(healthHex) } } };
    ws.getRow(8).height = 24;

    // Overall S-curve (full width)
    const W = 1000;
    let r = 9;
    const sH = picture(wb, ws, sCurvePng(x.curve, { title: 'Overall Project S-Curve', sub: `Planned vs actual vs forecast · Baseline finish ${fmt(k.plannedFinish)} · Forecast ${fmt(k.forecastFinish)}`, today: x.today, width: 1600, height: 680 }), 0, r, W);
    r += Math.ceil(sH / ROW_PX) + 1;
    // Status donut + department bars side by side
    const donut = donutPng((['Completed', 'In Progress', 'Not Started', 'Delayed', 'On Hold'] as const).map((s) => ({ name: s, value: { Completed: k.completed, 'In Progress': k.inProgress, 'Not Started': k.notStarted, Delayed: k.delayed, 'On Hold': k.onHold }[s], color: STATUS_HEX[s] })),
      { title: 'Activity Status', center: `${k.overallProgress}%`, sub: 'complete', width: 900, height: 560 });
    const dH = picture(wb, ws, donut, 0, r, 490);
    const dept = barsPng(x.depts.map((d) => ({ name: d.key, planned: d.planned, actual: d.actual, color: DEPT_HEX[d.key] ?? '#64748b' })), { title: 'Department Progress', width: 900, accent: '#3b82f6' });
    const pH = picture(wb, ws, dept, 10, r, 490);
    r += Math.ceil(Math.max(dH, pH) / ROW_PX) + 1;

    // Section summary table (merged cells so it lines up with the tiles)
    const cols: [string, number, number][] = [['', 1, 1], ['Section', 2, 6], ['Acts', 7, 7], ['Done', 8, 8], ['Plan', 9, 9], ['Actual', 10, 10], ['Progress', 11, 14], ['SPI', 15, 15], ['Delayed', 16, 16], ['Planned finish', 17, 18], ['Forecast finish', 19, 20]];
    const cellSpan = (row: number, c1: number, c2: number, v: string | number, style: Record<string, unknown>) => {
      if (c2 > c1) ws.mergeCells(row, c1, row, c2);
      const cell = ws.getCell(row, c1);
      cell.value = v;
      Object.assign(cell, style);
      for (let c = c1; c <= c2; c++) ws.getCell(row, c).border = box();
    };
    ws.mergeCells(r, 1, r, N);
    Object.assign(ws.getCell(r, 1), { value: 'Section-wise Summary', font: { bold: true, size: 13, color: { argb: argb(NAVY) } } });
    r++;
    cols.forEach(([t, c1, c2]) => cellSpan(r, c1, c2, t, { font: { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 }, fill: solid(NAVY), alignment: { horizontal: 'center', vertical: 'middle', wrapText: true } }));
    ws.getRow(r).height = 28;
    r++;
    for (const s of x.sections) {
      const c = colorOf(s.key);
      const late = s.forecastFinish > s.finish;
      const ctr = { horizontal: 'center', vertical: 'middle' };
      cellSpan(r, 1, 1, '', { fill: solid(c) });
      cellSpan(r, 2, 6, s.key, { font: { bold: true, color: { argb: argb(c) } }, fill: solid(tint(c, 0.9)), alignment: { vertical: 'middle', indent: 1 } });
      cellSpan(r, 7, 7, s.total, { alignment: ctr });
      cellSpan(r, 8, 8, s.completed, { alignment: ctr });
      cellSpan(r, 9, 9, s.planned / 100, { alignment: ctr, numFmt: '0%' });
      cellSpan(r, 10, 10, s.actual / 100, { alignment: ctr, numFmt: '0%', font: { bold: true, size: 10, color: { argb: argb(c) } } });
      cellSpan(r, 11, 14, bar(s.actual, 14), { font: { color: { argb: argb(c) }, size: 10 }, alignment: ctr });
      cellSpan(r, 15, 15, s.spi, { alignment: ctr, numFmt: '0.00', font: { bold: true, color: { argb: argb(s.spi >= 0.95 ? '#10b981' : s.spi >= 0.85 ? '#10b981' : '#f43f5e') } } });
      cellSpan(r, 16, 16, s.delayed, { alignment: ctr, font: { bold: s.delayed > 0, color: { argb: argb(s.delayed ? '#f43f5e' : SLATE) } } });
      cellSpan(r, 17, 18, fmt(s.finish), { alignment: ctr });
      cellSpan(r, 19, 20, fmt(s.forecastFinish), { alignment: ctr, font: { bold: true, color: { argb: argb(late ? '#f43f5e' : '#10b981') } } });
      ws.getRow(r).height = 20;
      r++;
    }
    r++;
    picture(wb, ws, barsPng(x.sections.map((s) => ({ name: s.key, planned: s.planned, actual: s.actual, color: colorOf(s.key) })), { title: 'Section Planned vs Actual', sub: 'Each section in its own colour', width: 1600, accent: '#10b981' }), 0, r, W);
    ws.pageSetup = { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 as never };
  }

  // 2. GANTT CHART (colourful weekly bars, grouped and coloured by section)
  {
    const ws = wb.addWorksheet('Gantt Chart', { properties: { tabColor: { argb: argb('#06b6d4') } }, views: [{ showGridLines: false }] });
    const base: Col[] = [
      { h: 'S.No', w: 5 }, { h: 'Activity ID', w: 10 }, { h: 'Activity Name', w: 42 }, { h: 'Dept', w: 6 }, { h: 'Incharge', w: 14 }, { h: 'Dur (d)', w: 6 },
      { h: 'Plan Start', w: 10.5 }, { h: 'Plan End', w: 10.5 }, { h: 'Act Start', w: 10.5 }, { h: 'Act End', w: 10.5 }, { h: 'Progress', w: 8 }, { h: 'Status', w: 11 },
    ];
    const NB = base.length;
    const start0 = x.activities.map((a) => a.actualStartDate && a.actualStartDate < a.plannedStartDate ? a.actualStartDate : a.plannedStartDate).reduce((a, b) => (a < b ? a : b));
    const sd = toDate(start0);
    const monday = toIso(new Date(sd.getTime() - ((sd.getUTCDay() + 6) % 7) * 86400000));
    const end = [k.forecastFinish, k.plannedFinish, ...x.activities.map((a) => a.actualEndDate ?? a.plannedEndDate)].reduce((a, b) => (a > b ? a : b));
    const weeks: string[] = [];
    for (let d = monday; d <= end; d = addDays(d, 7)) weeks.push(d);
    const W0 = NB + 1;
    const span = NB + weeks.length;
    title(ws, `Master Gantt Chart – ${p.name}`, `${stamp} · ${weeks.length} weeks · one colour per section`, Math.min(span, 40), '#06b6d4');
    base.forEach((c, i) => (ws.getColumn(i + 1).width = c.w));
    weeks.forEach((_, i) => (ws.getColumn(W0 + i).width = 3.4));
    // legend (row 3)
    const legend: [string, string, string][] = [['Done', '#10b981', 'FFFFFFFF'], ['Planned', tint('#10b981', 0.65), argb(NAVY)], ['Slip / late', '#fda4af', argb(NAVY)], ['◆ Milestone', '#a7f3d0', argb(NAVY)], ['Today', '#dc2626', 'FFFFFFFF']];
    ws.getCell(3, 3).value = 'Legend (bar colour = section colour):';
    ws.getCell(3, 3).font = { bold: true, size: 9, color: { argb: argb(SLATE) } };
    ws.getCell(3, 3).alignment = { horizontal: 'right', vertical: 'middle' };
    legend.forEach(([t, f, fc], i) => {
      const c = ws.getCell(3, 4 + i * 2);
      ws.mergeCells(3, 4 + i * 2, 3, 5 + i * 2);
      c.value = t;
      c.fill = solid(f);
      c.font = { bold: true, size: 9, color: { argb: fc } };
      c.alignment = { horizontal: 'center', vertical: 'middle' };
    });
    ws.getRow(3).height = 20;
    // header rows 4-5: base headers merged vertically, months over weeks, week day numbers
    base.forEach((c, i) => {
      ws.mergeCells(4, i + 1, 5, i + 1);
      const cell = ws.getCell(4, i + 1);
      cell.value = c.h;
      cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
      cell.fill = solid(NAVY);
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = box('#334155');
    });
    const MONTH_HEX = ['#1e3a8a', '#0e7490', '#047857', '#6d28d9', '#be123c', '#047857'];
    let mStart = 0, mi = 0;
    for (let i = 1; i <= weeks.length; i++) {
      if (i === weeks.length || weeks[i].slice(0, 7) !== weeks[mStart].slice(0, 7)) {
        if (i - 1 > mStart) ws.mergeCells(4, W0 + mStart, 4, W0 + i - 1);
        const c = ws.getCell(4, W0 + mStart);
        c.value = toDate(weeks[mStart]).toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' });
        c.font = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } };
        c.fill = solid(MONTH_HEX[mi++ % MONTH_HEX.length]);
        c.alignment = { horizontal: 'center', vertical: 'middle' };
        mStart = i;
      }
    }
    const todayIdx = weeks.findIndex((w) => w <= x.today && x.today <= addDays(w, 6));
    weeks.forEach((w, i) => {
      const c = ws.getCell(5, W0 + i);
      const isToday = i === todayIdx;
      c.value = isToday ? '▼' : Number(w.slice(8, 10));
      c.font = { size: 7, bold: isToday, color: { argb: isToday ? 'FFFFFFFF' : argb(SLATE) } };
      c.fill = solid(isToday ? '#dc2626' : '#f1f5f9');
      c.alignment = { horizontal: 'center', vertical: 'middle' };
      c.border = { right: thin('#cbd5e1'), bottom: thin('#94a3b8') };
    });
    ws.getRow(4).height = 22;
    ws.getRow(5).height = 30;

    const weekOf = (d: string) => Math.max(0, Math.min(weeks.length - 1, Math.floor((toDate(d).getTime() - toDate(monday).getTime()) / (7 * 86400000))));
    let r = 6;
    const groups = x.sections.map((s) => s.key);
    for (const g of groups) {
      const acts = x.activities.filter((a) => a.section === g);
      if (!acts.length) continue;
      const col = colorOf(g);
      const s = x.sections.find((q) => q.key === g)!;
      // section header row
      ws.mergeCells(r, 1, r, NB);
      const hc = ws.getCell(r, 1);
      hc.value = `▌ ${g}   ·   ${acts.length} activities   ·   ${s.actual}% done (plan ${s.planned}%)   ·   ${fmt(s.start)} → ${fmt(s.finish)}`;
      hc.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
      hc.fill = solid(col);
      hc.alignment = { vertical: 'middle', indent: 1 };
      const a0 = weekOf(s.start), a1 = weekOf(s.finish);
      const done = Math.round(a0 + (a1 - a0 + 1) * (s.actual / 100)) - 1;
      weeks.forEach((_, i) => {
        const c = ws.getCell(r, W0 + i);
        c.fill = solid(i >= a0 && i <= a1 ? (i <= done ? col : tint(col, 0.45)) : tint(col, 0.92));
        c.border = { top: thin(col), bottom: thin(col), left: i === todayIdx ? { style: 'medium', color: { argb: 'FFDC2626' } } : undefined };
      });
      ws.getRow(r).height = 22;
      r++;
      for (const a of acts) {
        const m = x.an.byId.get(a.activityId)!;
        const vals = [a.sNo, a.activityId, a.activityName, a.department, a.incharge || '', a.isMilestone ? '◆' : a.plannedDuration, fmt(a.plannedStartDate), fmt(a.plannedEndDate), fmt(a.actualStartDate), fmt(a.actualEndDate), a.progressPercent / 100, m.status];
        const row = ws.getRow(r);
        row.height = 18;
        vals.forEach((v, j) => {
          const c = row.getCell(j + 1);
          c.value = v;
          c.border = box();
          c.font = { size: 9, color: { argb: argb(j === 2 ? (m.critical ? '#be123c' : NAVY) : '#334155') }, bold: j === 2 && m.critical };
          c.alignment = { vertical: 'middle', horizontal: j === 2 || j === 4 ? 'left' : 'center', indent: j === 2 ? 1 : 0 };
        });
        row.getCell(1).fill = solid(tint(col, 0.8));
        const pc = row.getCell(11);
        pc.numFmt = '0%';
        pc.font = { size: 9, bold: true, color: { argb: argb(a.progressPercent >= 100 ? '#047857' : a.progressPercent > 0 ? '#047857' : SLATE) } };
        pc.fill = solid(a.progressPercent >= 100 ? '#d1fae5' : a.progressPercent > 0 ? '#d1fae5' : '#f1f5f9');
        const sc = row.getCell(12);
        const sh = STATUS_HEX[String(m.status)] ?? SLATE;
        sc.fill = solid(tint(sh, 0.8));
        sc.font = { size: 9, bold: true, color: { argb: argb(sh) } };
        // bars
        const ps = weekOf(a.plannedStartDate), pe = weekOf(a.plannedEndDate);
        const doneTo = ps + Math.round((pe - ps + 1) * (a.progressPercent / 100)) - 1;
        const fe = weekOf(m.forecastEnd);
        let lastBar = -1;
        weeks.forEach((w, i) => {
          const c = row.getCell(W0 + i);
          let fill: string | null = null;
          if (a.isMilestone) {
            if (i === pe) { c.value = '◆'; c.font = { size: 10, bold: true, color: { argb: argb(a.progressPercent >= 100 ? '#047857' : '#047857') } }; c.alignment = { horizontal: 'center', vertical: 'middle' }; fill = '#a7f3d0'; lastBar = i; }
          } else if (i >= ps && i <= pe) {
            fill = i <= doneTo ? col : tint(col, 0.65);
            lastBar = i;
          } else if (m.slip > 0 && i > pe && i <= fe) {
            fill = '#fda4af';
            lastBar = i;
          }
          if (fill) c.fill = solid(fill);
          c.border = {
            top: fill ? { style: 'thin', color: { argb: 'FFFFFFFF' } } : undefined,
            bottom: fill ? { style: 'thin', color: { argb: 'FFFFFFFF' } } : { style: 'hair', color: { argb: argb(LINE) } },
            right: { style: 'hair', color: { argb: argb(LINE) } },
            left: i === todayIdx ? { style: 'medium', color: { argb: 'FFDC2626' } } : undefined,
          };
          void w;
        });
        // % label just after the bar
        if (!a.isMilestone && lastBar >= 0 && lastBar + 1 < weeks.length) {
          const c2 = Math.min(W0 + weeks.length - 1, W0 + lastBar + 2);
          if (c2 > W0 + lastBar + 1) ws.mergeCells(r, W0 + lastBar + 1, r, c2);
          const c = row.getCell(W0 + lastBar + 1);
          c.value = `${Math.round(a.progressPercent)}%`;
          c.font = { size: 7, bold: true, color: { argb: argb(a.progressPercent >= 100 ? '#047857' : SLATE) } };
          c.alignment = { horizontal: 'left', vertical: 'middle' };
        }
        r++;
      }
    }
    ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 8 as never };
  }

  // 3. S-CURVES (overall + every section, each in its own colour)
  {
    const ws = wb.addWorksheet('S-Curves', { properties: { tabColor: { argb: argb('#10b981') } }, views: [{ showGridLines: false }] });
    for (let c = 1; c <= 20; c++) ws.getColumn(c).width = 6.6;
    title(ws, `S-Curves – ${p.name}`, `${stamp} · overall and section-wise cumulative progress`, 20, '#10b981');
    let r = 3;
    const oH = picture(wb, ws, sCurvePng(x.curve, { title: 'Overall Project S-Curve', sub: `Actual ${k.overallProgress}% vs planned ${k.plannedProgress}% at ${fmt(x.today)}`, today: x.today, width: 1600, height: 700 }), 0, r, 1000);
    r += Math.ceil(oH / ROW_PX) + 1;
    ws.mergeCells(r, 1, r, 20);
    Object.assign(ws.getCell(r, 1), { value: `Section-wise S-Curves (${secCurves.length} sections)`, font: { bold: true, size: 14, color: { argb: argb(NAVY) } }, alignment: { vertical: 'middle' } });
    ws.getRow(r).height = 26;
    r++;
    for (let i = 0; i < secCurves.length; i += 2) {
      let hMax = 0;
      for (let j = 0; j < 2 && i + j < secCurves.length; j++) {
        const { s, curve } = secCurves[i + j];
        const c = colorOf(s.key);
        const png = sCurvePng(trimCurve(curve), { title: `${i + j + 1}. ${s.key}`, sub: `Actual ${s.actual}% · Plan ${s.planned}% · SPI ${s.spi.toFixed(2)} · Finish ${fmt(s.forecastFinish)}`, today: x.today, width: 1000, height: 600, accent: c, colors: { planned: '#94a3b8', actual: c, forecast: '#f43f5e' } });
        hMax = Math.max(hMax, picture(wb, ws, png, j * 10, r, 490));
      }
      r += Math.ceil(hMax / ROW_PX) + 1;
    }
    // Data table: overall + each section (headers in the section colour)
    const at = (curve: SPoint[], date: string) => { let last: SPoint | undefined; for (const pt of curve) if (pt.date <= date) last = pt; return last; };
    const hdr: [string, string][] = [['Week ending', NAVY], ['Overall Plan %', '#3b82f6'], ['Overall Actual %', '#10b981'], ['Overall Forecast %', '#f43f5e'],
      ...secCurves.flatMap(({ s }) => [[`${s.key} – Plan %`, tint(colorOf(s.key), 0.25)], [`${s.key} – Actual %`, colorOf(s.key)]] as [string, string][])];
    const tws = wb.addWorksheet('S-Curve Data', { properties: { tabColor: { argb: argb('#10b981') } } });
    title(tws, 'S-Curve data – overall and section-wise (cumulative %)', stamp, Math.min(hdr.length, 30), '#10b981');
    hdr.forEach(([h, c], i) => {
      const cell = tws.getCell(4, i + 1);
      cell.value = h;
      cell.fill = solid(c);
      cell.font = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = box('#334155');
      tws.getColumn(i + 1).width = i ? 13 : 12;
    });
    tws.getRow(4).height = 48;
    x.curve.forEach((pt, ri) => {
      const vals = [fmt(pt.date), pt.planned, pt.actual, pt.forecast, ...secCurves.flatMap(({ curve }) => { const q = at(curve, pt.date); return [q?.planned ?? 0, pt.date <= x.today ? q?.actual ?? 0 : null]; })];
      const row = tws.getRow(5 + ri);
      const isNow = pt.date >= x.today && (ri === 0 || x.curve[ri - 1].date < x.today);
      vals.forEach((v, j) => {
        const c = row.getCell(j + 1);
        c.value = typeof v === 'number' ? Math.round(v * 10) / 1000 : v;
        if (typeof v === 'number') c.numFmt = '0.0%';
        c.alignment = { horizontal: 'center', vertical: 'middle' };
        c.border = box();
        if (isNow) c.fill = solid('#fee2e2');
        else if (ri % 2) c.fill = solid(ZEBRA);
      });
    });
    ws.pageSetup = { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 as never };
    ws.getCell(r, 1).value = 'The full weekly numbers are on the "S-Curve Data" sheet.';
    ws.getCell(r, 1).font = { italic: true, color: { argb: argb(SLATE) } };
  }

  // 4. Executive Overview & EVM
  {
    const ws = wb.addWorksheet('Executive Overview & EVM', { properties: { tabColor: { argb: argb('#8b5cf6') } }, views: [{ showGridLines: false }] });
    title(ws, 'Executive Overview & Earned Value', stamp, 8, '#8b5cf6');
    let r = 4;
    r = table(ws, r, [{ h: 'Project field', w: 30 }, { h: 'Value', w: 44, align: 'left' }], [
      ['Project', p.name], ['Capacity', `${p.capacityMw} MW`], ['Type', p.projectType], ['Location', [p.village, p.district, p.state].filter(Boolean).join(', ')],
      ['Planned start', fmt(p.plannedStartDate)], ['Planned finish', fmt(k.plannedFinish)], ['Forecast finish', fmt(k.forecastFinish)], ['Project health', x.report.health],
    ], '#8b5cf6');
    const eacWd = k.spi > 0 ? Math.round(x.cal.countWorking(p.plannedStartDate, k.plannedFinish) / k.spi) : null;
    r = table(ws, r, [{ h: 'KPI / EVM metric' }, { h: 'Value', align: 'center' }, { h: 'Notes', w: 50 }], [
      ['Budget at completion (BAC)', '100.0%', 'Weighted scope (duration-weighted activities)'],
      ['Planned value (PV)', `${k.plannedProgress}%`, 'Work that should be complete by data date'],
      ['Earned value (EV)', `${k.overallProgress}%`, 'Work actually complete (weighted)'],
      ['Schedule variance (SV = EV − PV)', `${k.scheduleVariance}%`, k.scheduleVariance < 0 ? 'Behind plan' : 'On / ahead of plan'],
      ['Schedule performance index (SPI)', fmtSpi(k), '≥ 1.00 on/ahead, < 0.95 at risk'],
      ['Estimated duration at completion', eacWd ? `${eacWd} working days` : '—', 'Planned working days ÷ SPI'],
      ['Total activities', k.total, ''], ['Completed', k.completed, ''], ['In progress', k.inProgress, ''], ['Not started', k.notStarted, ''],
      ['Delayed', k.delayed, ''], ['On hold', k.onHold, ''], ['Critical path delays', k.criticalDelays, ''],
      ['Project delay (forecast vs plan)', `${k.projectDelay} working days`, ''], ['Working days remaining', k.workingDaysRemaining, ''],
    ], '#8b5cf6');
    const secStart = r;
    r = table(ws, r, [{ h: 'Section' }, { h: 'Activities' }, { h: 'Planned %' }, { h: 'Actual %' }, { h: 'SPI' }, { h: 'Delayed' }, { h: 'Planned finish', w: 14 }, { h: 'Forecast finish', w: 14 }],
      x.sections.map((s) => [s.key, s.total, s.planned, s.actual, s.spi, s.delayed, fmt(s.finish), fmt(s.forecastFinish)]), '#8b5cf6');
    x.sections.forEach((s, i) => { const c = ws.getCell(secStart + 1 + i, 1); c.font = { bold: true, color: { argb: argb(colorOf(s.key)) } }; c.border = { ...box(), left: { style: 'thick', color: { argb: argb(colorOf(s.key)) } } }; });
    table(ws, r, [{ h: 'Department' }, { h: 'Score' }, { h: 'Rating' }, { h: 'Planned %' }, { h: 'Actual %' }, { h: 'SPI' }, { h: 'Delayed' }, { h: 'Finding' }],
      x.report.deptAudit.map((d) => [`${d.dept} – ${d.name}`, d.score, d.rating, d.planned, d.actual, d.spi, d.delayed, d.finding]), '#8b5cf6');
  }

  // 5. Master Baseline Schedule
  {
    const ws = wb.addWorksheet('Master Baseline Schedule');
    title(ws, 'Master Baseline Schedule – baseline vs current plan vs forecast', stamp, 11, '#3b82f6');
    table(ws, 4, [{ h: 'S.No', w: 6 }, { h: 'Activity ID', w: 11 }, { h: 'Activity Name', w: 46 }, { h: 'Section', w: 28 }, { h: 'Baseline Start', w: 13 }, { h: 'Baseline End', w: 13 },
      { h: 'Current Start', w: 13 }, { h: 'Current End', w: 13 }, { h: 'Forecast End', w: 13 }, { h: 'Plan vs Baseline (wd)', w: 12 }, { h: 'Forecast vs Baseline (wd)', w: 12 }],
      x.activities.map((a) => {
        const m = x.an.byId.get(a.activityId)!;
        const be = a.baselineEndDate ?? a.plannedEndDate;
        return [a.sNo, a.activityId, a.activityName, a.section, fmt(a.baselineStartDate ?? a.plannedStartDate), fmt(be), fmt(a.plannedStartDate), fmt(a.plannedEndDate), fmt(m.forecastEnd),
          x.cal.workingDiff(be, a.plannedEndDate), x.cal.workingDiff(be, m.forecastEnd)];
      }), '#3b82f6');
    x.activities.forEach((a, i) => (ws.getCell(5 + i, 4).font = { bold: true, color: { argb: argb(colorOf(a.section)) } }));
  }

  // 6. AI Duration Impact & Protocols
  {
    const ws = wb.addWorksheet('AI Duration Impact & Protocols');
    title(ws, 'AI-assisted Duration Impact Analysis & Recovery Protocols', `${stamp} · Health: ${x.report.health}`, 12, '#f43f5e');
    let r = 4;
    ws.getCell(r, 1).value = x.report.headline;
    ws.getCell(r, 1).font = { bold: true, size: 12 };
    r++;
    for (const s of x.report.summary) { ws.getCell(r++, 1).value = `• ${s}`; }
    r++;
    r = table(ws, r, [{ h: 'Activity ID', w: 11 }, { h: 'Activity', w: 42 }, { h: 'Section', w: 26 }, { h: 'Dept', w: 7 }, { h: 'Severity', w: 10 }, { h: 'Status', w: 11 }, { h: 'Delay (wd)', w: 9 },
      { h: 'Own slip', w: 9 }, { h: 'Float', w: 7 }, { h: 'Finish impact (wd)', w: 10 }, { h: 'Crash factor', w: 9 }, { h: 'Recovery protocol', w: 80 }],
      x.report.risks.map((q) => [q.activityId, q.activityName, q.section, q.department, q.severity, q.status, q.delayDays, q.ownSlip, q.totalFloat, q.finishImpact, q.crashFactor, q.mitigation.join(' | ')]), '#f43f5e');
    ws.getCell(r, 1).value = 'Recommendations';
    ws.getCell(r, 1).font = { bold: true, size: 12 };
    x.report.recommendations.forEach((t, i) => (ws.getCell(r + 1 + i, 1).value = `${i + 1}. ${t}`));
  }

  // 7. One sheet per section, in the section colour
  x.sections.forEach((s, i) => {
    const c = colorOf(s.key);
    const ws = wb.addWorksheet(safeSheet(`S${i + 1} ${s.key}`), { properties: { tabColor: { argb: argb(c) } } });
    title(ws, `Section ${i + 1}: ${s.key}`, `${s.total} activities · Actual ${s.actual}% vs planned ${s.planned}% · SPI ${s.spi} · Forecast finish ${fmt(s.forecastFinish)}`, 12, c);
    const acts = x.activities.filter((a) => a.section === s.key);
    table(ws, 4, ACT_COLS, acts.map((a) => activityRow(a, x)), c);
    colourProgress(ws, 5, acts.length, 13);
    colourStatus(ws, 5, acts.length, 15);
  });

  // Monthly progress (earned in the month vs cumulative) and the accuracy report
  {
    const ws = wb.addWorksheet('Monthly Progress', { properties: { tabColor: { argb: argb('#0ea5e9') } } });
    title(ws, 'Monthly and yearly progress', `${stamp} · Earned in period and cumulative are shown separately`, 6, '#0ea5e9');
    const cols = [{ h: 'Period', w: 14 }, { h: 'Planned earned (pp)' }, { h: 'Planned cumulative %' }, { h: 'Actual earned (pp)' }, { h: 'Actual cumulative %' }];
    const f = (v: number | null) => (v == null ? null : Math.round(v * 100) / 100);
    let r = table(ws, 4, cols, periodProgress(x.curve, 'month').map((m) => [m.period, f(m.plannedEarned), f(m.plannedCumulative), f(m.actualEarned), f(m.actualCumulative)]), '#0ea5e9');
    table(ws, r, [{ h: 'Year', w: 14 }, ...cols.slice(1)], periodProgress(x.curve, 'year').map((m) => [m.period, f(m.plannedEarned), f(m.plannedCumulative), f(m.actualEarned), f(m.actualCumulative)]), '#0ea5e9');
  }
  if (x.validation) {
    const v = x.validation;
    const ws = wb.addWorksheet('Validation Report', { properties: { tabColor: { argb: argb(v.verdict === 'Failed' ? '#f43f5e' : v.verdict === 'Verified' ? '#10b981' : '#10b981') } } });
    title(ws, 'Calculation validation report', `${stamp} · Result: ${v.verdict} · History coverage ${v.historyCoverage.toFixed(0)}% · Weights: ${v.weightSource}`, 4, '#10b981');
    const r = table(ws, 4, [{ h: 'Check', w: 54, align: 'left' }, { h: 'Result', w: 12 }, { h: 'Detail', w: 90, align: 'left' }], v.checks.map((c) => [c.label, c.status.toUpperCase(), c.detail]), '#10b981');
    v.checks.forEach((c, i) => { const cell = ws.getCell(5 + i, 2); cell.font = { bold: true, color: { argb: argb(c.status === 'pass' ? '#059669' : c.status === 'warn' ? '#047857' : '#dc2626') } }; });
    ws.getCell(r + 1, 1).value = 'This report shows what was checked. It does not claim the data itself is perfect: missing history and unapproved weights are listed as warnings.';
    ws.getCell(r + 1, 1).font = { italic: true, color: { argb: argb(SLATE) } };
  }

  // Full register last
  {
    const ws = wb.addWorksheet('All Activities');
    title(ws, 'Complete activity register', stamp, 12);
    table(ws, 4, ACT_COLS, x.activities.map((a) => activityRow(a, x)));
    ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: ACT_COLS.length } };
    x.activities.forEach((a, i) => (ws.getCell(5 + i, 4).font = { bold: true, color: { argb: argb(colorOf(a.section)) } }));
    colourProgress(ws, 5, x.activities.length, 13);
    colourStatus(ws, 5, x.activities.length, 15);
  }

  // Whole sheets: no frozen/split panes, and each sheet prints one page wide.
  for (const w of wb.worksheets) {
    w.views = [{ state: 'normal', showGridLines: !['Dashboard', 'S-Curves', 'Gantt Chart', 'Executive Overview & EVM'].includes(w.name) }];
    const portrait = w.name === 'Dashboard' || w.name === 'S-Curves';
    w.pageSetup = { ...(w.pageSetup ?? {}), orientation: portrait ? 'portrait' : 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: (w.name === 'Gantt Chart' ? 8 : 9) as never };
  }
  downloadBlob(await wb.xlsx.writeBuffer(), `SWELECT_${p.name.replace(/[^\w-]+/g, '_')}_${x.today}.xlsx`);
}
