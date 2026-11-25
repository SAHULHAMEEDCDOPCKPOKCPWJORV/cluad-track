'use client';
// Excel import (parse) + template download, using ExcelJS in the browser.
import type { Activity } from './types';
import { parseAnyDate, fmt } from './calendar';
import { matchToMaster, type MatchResult } from './matching';
import { SECTION_NAMES, CUSTOM_SECTION } from './master';

export type ImportField = 'activityId' | 'activityName' | 'section' | 'department' | 'plannedDuration' | 'plannedStartDate' | 'plannedEndDate' | 'actualDuration' | 'actualStartDate' | 'actualEndDate' | 'progressPercent' | 'incharge' | 'delayReason' | 'remarks' | 'extra';

const SYNONYMS: Record<ImportField, string[]> = {
  activityId: ['activity id', 'act id', 'activity code', 'code', 'id', 'wbs', 'task id'],
  activityName: ['activity name', 'activities', 'activity', 'activity description', 'task name', 'tasks', 'task', 'description', 'particulars', 'scope of work', 'work description', 'name', 'work package'],
  section: ['section', 'phase', 'package'],
  department: ['department', 'dept', 'responsible', 'owner'],
  actualDuration: ['actual duration', 'actual durations', 'act duration', 'actual days'],
  plannedDuration: ['planned duration', 'duration', 'dur', 'working days', 'days'],
  plannedStartDate: ['planned start', 'plan start', 'start date', 'start', 'baseline start', 'early start'],
  plannedEndDate: ['planned end', 'planned finish', 'plan end', 'plan finish', 'finish date', 'end date', 'finish', 'end', 'early finish'],
  actualStartDate: ['actual start', 'act start', 'act. start'],
  actualEndDate: ['actual end', 'actual finish', 'act end', 'act finish', 'act. end'],
  progressPercent: ['progress %', '% complete', 'percent complete', '% progress', 'progress', 'completion', 'complete %', 'status %', '%'],
  incharge: ['activity incharge', 'incharge', 'in charge', 'in-charge', 'responsible person', 'assigned to', 'person'],
  delayReason: ['delay reason', 'reason for delay', 'delay remarks', 'reason'],
  remarks: ['remarks', 'comments', 'notes', 'comment'],
  extra: [],
};
// Columns that are only a row number; everything else that is not mapped is kept in Remarks.
const IGNORE_HEADER = /^(s\.?\s*no\.?|sl\.?\s*no\.?|sr\.?\s*no\.?|#|no\.?|serial.*)$/;

export interface ImportRow {
  rowNo: number;
  values: Partial<Record<ImportField, string | number | null>>;
  match: MatchResult | null;
  decision: string; // master activityId | 'CUSTOM' | 'SKIP'
}

export interface ParsedImport {
  sheetName: string;
  headerRow: number;
  columns: Partial<Record<ImportField, number>>;
  headers: string[];
  rows: ImportRow[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cellVal(v: any): string | number | Date | null {
  if (v == null) return null;
  if (v instanceof Date || typeof v === 'number' || typeof v === 'string') return v;
  if (typeof v === 'object') {
    if ('result' in v) return cellVal(v.result);
    if ('richText' in v) return v.richText.map((t: { text: string }) => t.text).join('');
    if ('text' in v) return String(v.text);
  }
  return String(v);
}

const keyOf = (s: string) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z]+/g, '');
const SECTION_KEYS = new Map([...SECTION_NAMES, CUSTOM_SECTION].map((n) => [keyOf(n), n]));
/** Section heading rows (e.g. "Engineering & Design") and total rows are not activities. */
function headingOf(id: string, name: string): { section: string | null } | null {
  if (/^[A-Za-z]{2,6}-\d+/.test(id.trim())) return null; // a real activity code like ENG-01
  const t = `${id} ${name}`.trim();
  if (/\b(sub\s*-?\s*)?total\b|\btotal\s*(days|duration)\b|\bgrand total\b/i.test(t)) return { section: null };
  const n = name.replace(/^[\s\dA-Za-z]{0,3}[.)\-:]\s+/, '').replace(/\(.*?\)|[-–:]?\s*\d+\s*(days?|d)\b.*$/i, '').trim();
  const k = keyOf(n || id);
  if (k && SECTION_KEYS.has(k)) return { section: SECTION_KEYS.get(k)! };
  for (const [sk, sn] of SECTION_KEYS) if (k.length > 6 && sk.startsWith(k)) return { section: sn };
  return null;
}

/** Maps a section name from Excel (any spelling) to the matching website section heading. */
function sectionOf(name: string): string | null {
  const k = keyOf(name.replace(/^[\s\dA-Za-z]{0,3}[.)\-:]\s+/, ''));
  if (!k) return null;
  if (SECTION_KEYS.has(k)) return SECTION_KEYS.get(k)!;
  for (const [sk, sn] of SECTION_KEYS) if (k.length > 5 && (sk.startsWith(k) || sk.includes(k))) return sn;
  return null;
}

/** Best-guess department for a section heading from the sheet (so department logins see their rows). */
export function guessDept(section: string | null | undefined): string | null {
  const t = String(section ?? '').toLowerCase();
  if (!t) return null;
  if (/commission|synchron|testing|cod\b|handover/.test(t)) return 'COMM';
  if (/transmission|ohtl|evacuat|grid|tangedco|discom|bay|substation/.test(t)) return 'TRN';
  if (/procure|material|purchase|order|vendor|logistic|supply|services/.test(t)) return 'PRO';
  if (/engineer|design|drawing/.test(t)) return 'ENG';
  if (/land|statutory|approval|ceig|permit|clearance|noc|liaison/.test(t)) return 'LAND';
  if (/civil|site|mechanical|electrical|execution|install|erection|construct|module|mms|pile|structure/.test(t)) return 'SITE';
  if (/plan|initiation|kick|management/.test(t)) return 'PLAN';
  return null;
}

const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[_\n\r]+/g, ' ').replace(/\s+/g, ' ').replace(/[()]/g, '').trim();

function mapHeaders(headers: string[]) {
  const cols: Partial<Record<ImportField, number>> = {};
  const used = new Set<number>();
  // exact synonym first, then "contains"
  for (const pass of ['exact', 'contains'] as const) {
    for (const f of Object.keys(SYNONYMS) as ImportField[]) {
      if (f === 'extra') continue;
      if (cols[f] != null) continue;
      for (const syn of SYNONYMS[f]) {
        const idx = headers.findIndex((h, i) => !used.has(i) && !!h && (pass === 'exact' ? h === syn : syn.length > 2 && h.includes(syn)));
        if (idx >= 0) {
          cols[f] = idx;
          used.add(idx);
          break;
        }
      }
    }
  }
  return cols;
}

/** Bold text or a coloured fill marks a row as highlighted (how most sheets show section headings). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function styleOf(row: any): { bold: boolean; filled: boolean } {
  let bold = !!row?.font?.bold, filled = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  row?.eachCell?.({ includeEmpty: false }, (c: any) => {
    if (c.value == null || String(cellVal(c.value) ?? '').trim() === '') return;
    if (c.font?.bold) bold = true;
    const f = c.fill;
    if (f?.type === 'pattern' && f.pattern && f.pattern !== 'none') {
      const argb = String(f.fgColor?.argb ?? (f.fgColor?.theme != null ? `theme${f.fgColor.theme}` : ''));
      const hex = /^[0-9A-F]{8}$/i.test(argb) ? argb.slice(2) : /^[0-9A-F]{6}$/i.test(argb) ? argb : '';
      const light = hex ? [0, 2, 4].every((i) => parseInt(hex.slice(i, i + 2), 16) >= 0xee) : false; // zebra stripes are not headings
      if (argb && !light && argb !== 'theme0' && argb !== 'theme1') filled = true;
    }
  });
  return { bold, filled };
}

function readRows({ ws, row, cols, headers, rawHeaders }: { ws: { rowCount: number; getRow: (r: number) => { values: unknown } }; row: number; cols: Partial<Record<ImportField, number>>; headers: string[]; rawHeaders: string[] }): ImportRow[] {
  const rows: ImportRow[] = [];
  const used = new Set(Object.values(cols));
  const extraCols = headers.map((h, i) => i).filter((i) => headers[i] && !used.has(i) && !IGNORE_HEADER.test(headers[i]));
  // If almost every row is highlighted the styling means nothing, so ignore it.
  let filledRows = 0, total = 0;
  for (let r = row + 1; r <= ws.rowCount; r++) {
    const st = styleOf(ws.getRow(r));
    if (Array.from(ws.getRow(r).values as unknown[]).some((v) => v != null && String(cellVal(v) ?? '').trim() !== '')) { total++; if (st.bold || st.filled) filledRows++; }
  }
  const useStyle = total > 0 && filledRows / total < 0.6;
  let curSection: string | null = null;
  for (let r = row + 1; r <= ws.rowCount; r++) {
    const raw = Array.from(ws.getRow(r).values as unknown[]).slice(1).map(cellVal);
    if (!raw.some((v) => v != null && String(v).trim() !== '')) continue;
    const values: ImportRow['values'] = {};
    for (const [f, i] of Object.entries(cols) as [ImportField, number][]) {
      const v = raw[i];
      if (v == null || v === '') continue;
      if (f.endsWith('Date')) values[f] = parseAnyDate(v);
      else if (f === 'progressPercent' && typeof v === 'string' && /^(completed?|done|finished|closed)$/i.test(v.trim())) values[f] = 100;
      else if (f === 'progressPercent' && typeof v === 'string' && /^(not\s*started|pending|yet to start|nil|-)$/i.test(v.trim())) values[f] = 0;
      else if (f === 'plannedDuration' || f === 'actualDuration' || f === 'progressPercent') {
        const n = typeof v === 'number' ? v : Number(String(v).replace(/[%,\s]/g, ''));
        // Durations with a part day (5.4) count as a full day (6).
        values[f] = !Number.isFinite(n) ? null : f === 'progressPercent' ? n : Math.ceil(n - 1e-9);
      } else if (f === 'extra') continue;
      else values[f] = v instanceof Date ? fmt(parseAnyDate(v)) : String(v).trim();
    }
    // Every other filled column from the sheet is kept, e.g. "Vendor: ABC | Location: Block 3".
    const extra = extraCols.map((i) => [rawHeaders[i], raw[i]] as const).filter(([, v]) => v != null && String(v).trim() !== '')
      .map(([h, v]) => `${h}: ${v instanceof Date ? fmt(parseAnyDate(v)) : String(v).trim()}`).join(' | ');
    if (extra) values.extra = extra;
    if (!values.activityId && !values.activityName) continue;
    let h = headingOf(String(values.activityId ?? ''), String(values.activityName ?? ''));
    if (!h && useStyle && !/^[A-Za-z]{2,6}-\d+/.test(String(values.activityId ?? '').trim())) {
      const st = styleOf(ws.getRow(r));
      const hasDates = !!(values.plannedStartDate || values.plannedEndDate);
      // Highlighted row = section heading (bold rows even with summary dates; coloured rows only when they have no dates).
      if (st.bold || (st.filled && !hasDates)) {
        const text = String(values.activityName ?? values.activityId ?? raw.find((v) => typeof v === 'string' && v.trim()) ?? '').trim();
        const clean = text.replace(/^[\s\dA-Za-z]{0,3}[.)\-:]\s+/, '').replace(/\s*[-–:(]?\s*\d+\s*(working\s*)?(days?|d)\)?\s*$/i, '').trim();
        if (clean) h = { section: sectionOf(clean) ?? clean };
      }
    }
    if (h) {
      if (h.section) curSection = h.section;
      continue; // skip section headings and their total-days rows
    }
    // Section = the sheet's own Section column or highlighted heading (matched to a website section when the names agree).
    const own = values.section ? sectionOf(String(values.section)) ?? String(values.section).trim() : null;
    if (own) values.section = own;
    else if (curSection) values.section = curSection;
    else delete values.section;
    const match = matchToMaster({ activityId: String(values.activityId ?? ''), activityName: String(values.activityName ?? '') });
    rows.push({ rowNo: r, values, match, decision: match ? match.activityId : 'CUSTOM' });
  }
  return rows;
}

export async function parseExcel(file: File): Promise<ParsedImport> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const buf = await file.arrayBuffer();
  if (file.name.toLowerCase().endsWith('.csv')) {
    const text = new TextDecoder().decode(buf);
    const ws = wb.addWorksheet('CSV');
    text.split(/\r?\n/).filter(Boolean).forEach((line) => ws.addRow(line.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"'))));
  } else {
    await wb.xlsx.load(buf);
  }
  // Find the header row on every sheet, read its rows, and keep the sheet with the most activities.
  type Cand = { ws: (typeof wb.worksheets)[number]; row: number; cols: Partial<Record<ImportField, number>>; headers: string[]; rawHeaders: string[] };
  let best: (Cand & { rows: ImportRow[] }) | null = null;
  let anyHeader = false;
  for (const ws of wb.worksheets) {
    let cand: Cand | null = null;
    let candScore = 0;
    for (let r = 1; r <= Math.min(30, ws.rowCount); r++) {
      const rawVals = Array.from(ws.getRow(r).values as unknown[]).slice(1).map((v) => String(cellVal(v) ?? '').trim()); // Array.from fills empty cells
      const vals = rawVals.map(norm);
      const cols = mapHeaders(vals);
      if (cols.activityName == null && cols.activityId == null) continue;
      const score = Object.keys(cols).length + 3;
      if (Object.keys(cols).length >= 2 && score > candScore) { cand = { ws, row: r, cols, headers: vals, rawHeaders: rawVals }; candScore = score; }
    }
    if (!cand) continue;
    anyHeader = true;
    const rows = readRows(cand);
    if (!best || rows.length > best.rows.length) best = { ...cand, rows };
  }
  if (!best) throw new Error(anyHeader ? 'No activity rows found under the header.' : 'Could not find a header row. Include columns such as "Activity ID", "Activity Name", "Planned Start", "Planned End", "Progress %".');
  const { ws, row, cols, headers, rows } = best;
  if (!rows.length) throw new Error(`Sheet "${ws.name}" has a header row (row ${row}) but no activity rows below it.`);
  // Fractions (0–1) → percent
  const prog = rows.map((r) => r.values.progressPercent).filter((v): v is number => typeof v === 'number');
  const allFractions = prog.length > 0 && prog.every((v) => v <= 1);
  rows.forEach((r) => {
    const v = r.values.progressPercent;
    // Percent-formatted Excel cells arrive as fractions (0.75 = 75%).
    if (typeof v === 'number' && (allFractions || (v > 0 && v < 1))) r.values.progressPercent = Math.round(v * 1000) / 10;
  });
  return { sheetName: ws.name, headerRow: row, columns: cols, headers, rows };
}

export function downloadBlob(data: BlobPart, name: string, type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function downloadTemplate(projectName: string, acts: Activity[]) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Schedule Import', { views: [{ state: 'frozen', ySplit: 1, xSplit: 3 }] });
  ws.columns = [
    { header: 'Activity ID', key: 'id', width: 12 },
    { header: 'Activity Name', key: 'name', width: 48 },
    { header: 'Section', key: 'section', width: 30 },
    { header: 'Department', key: 'dept', width: 12 },
    { header: 'Planned Duration', key: 'dur', width: 16 },
    { header: 'Planned Start', key: 'ps', width: 14 },
    { header: 'Planned End', key: 'pe', width: 14 },
    { header: 'Actual Start', key: 'as', width: 14 },
    { header: 'Actual End', key: 'ae', width: 14 },
    { header: 'Progress %', key: 'pr', width: 12 },
    { header: 'Remarks', key: 'rm', width: 40 },
  ];
  for (const a of acts) ws.addRow({ id: a.activityId, name: a.activityName, section: a.section, dept: a.department, dur: a.plannedDuration, ps: fmt(a.plannedStartDate), pe: fmt(a.plannedEndDate), as: a.actualStartDate ? fmt(a.actualStartDate) : '', ae: a.actualEndDate ? fmt(a.actualEndDate) : '', pr: a.progressPercent, rm: a.remarks });
  const h = ws.getRow(1);
  h.font = { bold: true, color: { argb: 'FF030508' } };
  h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF59E0B' } };
  ws.autoFilter = { from: 'A1', to: 'K1' };
  const notes = wb.addWorksheet('How to use');
  [
    'SWELECT schedule import template',
    'Dates: DD-MM-YYYY. Duration: working days (Sundays and gazetted holidays excluded).',
    'Rows are matched to the 165-activity master list by Activity ID, then by name similarity.',
    'Rows that do not match can be added as project-specific (custom) activities during import.',
    'Leave a cell blank to keep the current value.',
  ].forEach((t, i) => (notes.getCell(`A${i + 1}`).value = t));
  notes.getColumn(1).width = 100;
  notes.getRow(1).font = { bold: true, size: 14 };
  downloadBlob(await wb.xlsx.writeBuffer(), `${projectName.replace(/[^\w-]+/g, '_')}_schedule_template.xlsx`);
}
