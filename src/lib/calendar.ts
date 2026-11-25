// Working calendar engine: Sundays off, Saturdays working, gazetted holidays excluded.
// All dates are plain 'YYYY-MM-DD' strings, handled in UTC to avoid timezone drift.
import type { Holiday } from './types';

export const DEFAULT_HOLIDAYS: Holiday[] = [
  // 2026 – DoPT gazetted holidays (Central Government offices)
  { date: '2026-01-26', name: 'Republic Day', type: 'National' },
  { date: '2026-03-04', name: 'Holi', type: 'Gazetted' },
  { date: '2026-03-21', name: 'Id-ul-Fitr', type: 'Gazetted' },
  { date: '2026-03-26', name: 'Ram Navami', type: 'Gazetted' },
  { date: '2026-03-31', name: 'Mahavir Jayanti', type: 'Gazetted' },
  { date: '2026-04-03', name: 'Good Friday', type: 'Gazetted' },
  { date: '2026-05-01', name: 'Buddha Purnima', type: 'Gazetted' },
  { date: '2026-05-27', name: 'Id-ul-Zuha (Bakrid)', type: 'Gazetted' },
  { date: '2026-06-26', name: 'Muharram', type: 'Gazetted' },
  { date: '2026-08-15', name: 'Independence Day', type: 'National' },
  { date: '2026-08-26', name: "Prophet Mohammad's Birthday", type: 'Gazetted' },
  { date: '2026-09-04', name: 'Janmashtami', type: 'Gazetted' },
  { date: '2026-10-02', name: "Mahatma Gandhi's Birthday", type: 'National' },
  { date: '2026-10-20', name: 'Dussehra', type: 'Gazetted' },
  { date: '2026-11-08', name: 'Diwali (Deepavali)', type: 'Gazetted' },
  { date: '2026-11-24', name: "Guru Nanak's Birthday", type: 'Gazetted' },
  { date: '2026-12-25', name: 'Christmas Day', type: 'Gazetted' },
  // 2027 – DoPT O.M. No. 12/2/2023-JCA dated 16.07.2026 (moon-sighting dates may shift)
  { date: '2027-01-26', name: 'Republic Day', type: 'National' },
  { date: '2027-03-10', name: 'Id-ul-Fitr', type: 'Gazetted' },
  { date: '2027-03-23', name: 'Holi', type: 'Gazetted' },
  { date: '2027-03-26', name: 'Good Friday', type: 'Gazetted' },
  { date: '2027-04-15', name: 'Ram Navami', type: 'Gazetted' },
  { date: '2027-04-19', name: 'Mahavir Jayanti', type: 'Gazetted' },
  { date: '2027-05-17', name: 'Id-ul-Zuha (Bakrid)', type: 'Gazetted' },
  { date: '2027-05-20', name: 'Buddha Purnima', type: 'Gazetted' },
  { date: '2027-06-16', name: 'Muharram', type: 'Gazetted' },
  { date: '2027-08-15', name: 'Independence Day / Id-e-Milad', type: 'National' },
  { date: '2027-08-25', name: 'Janmashtami', type: 'Gazetted' },
  { date: '2027-10-02', name: "Mahatma Gandhi's Birthday", type: 'National' },
  { date: '2027-10-09', name: 'Dussehra', type: 'Gazetted' },
  { date: '2027-10-29', name: 'Diwali (Deepavali)', type: 'Gazetted' },
  { date: '2027-11-14', name: "Guru Nanak's Birthday", type: 'Gazetted' },
  { date: '2027-12-25', name: 'Christmas Day', type: 'Gazetted' },
];

const DAY = 86400000;

export function toDate(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
export function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
export function addDays(iso: string, n: number): string {
  return toIso(new Date(toDate(iso).getTime() + n * DAY));
}
export function diffDays(a: string, b: string): number {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / DAY);
}
export function todayIso(): string {
  // India Standard Time "today"
  const now = new Date(Date.now() + 330 * 60000);
  return now.toISOString().slice(0, 10);
}
export function isValidIso(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(toDate(s).getTime());
}

/** DD-MM-YYYY */
export function fmt(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}-${m}-${y}`;
}
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtShort(iso: string): string {
  const d = toDate(iso);
  return `${String(d.getUTCDate()).padStart(2, '0')}-${MON[d.getUTCMonth()]}`;
}
export function fmtMonth(iso: string): string {
  const d = toDate(iso);
  return `${MON[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`;
}

/** Parse DD-MM-YYYY, DD/MM/YYYY, YYYY-MM-DD, Excel serials or Date objects. */
export function parseAnyDate(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return toIso(new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate())));
  }
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    return toIso(new Date(Date.UTC(1899, 11, 30) + v * DAY));
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return toIso(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])));
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return toIso(new Date(Date.UTC(y, +m[2] - 1, +m[1])));
  }
  m = s.match(/^(\d{1,2})[- ]([A-Za-z]{3})[a-z]*[- ](\d{2,4})$/);
  if (m) {
    const mi = MON.findIndex((x) => x.toLowerCase() === m![2].toLowerCase());
    if (mi >= 0) return toIso(new Date(Date.UTC(m[3].length === 2 ? 2000 + +m[3] : +m[3], mi, +m[1])));
  }
  return null;
}

export class WorkCalendar {
  private holidays: Map<string, string>;
  constructor(holidays: Holiday[] = DEFAULT_HOLIDAYS) {
    this.holidays = new Map(holidays.map((h) => [h.date, h.name]));
  }
  holidayName(iso: string) {
    return this.holidays.get(iso) ?? null;
  }
  isSunday(iso: string) {
    return toDate(iso).getUTCDay() === 0;
  }
  isWorking(iso: string) {
    return !this.isSunday(iso) && !this.holidays.has(iso);
  }
  /** First working day on or after iso. */
  nextWorking(iso: string) {
    let d = iso;
    for (let i = 0; i < 60 && !this.isWorking(d); i++) d = addDays(d, 1);
    return d;
  }
  /** First working day on or before iso. */
  prevWorking(iso: string) {
    let d = iso;
    for (let i = 0; i < 60 && !this.isWorking(d); i++) d = addDays(d, -1);
    return d;
  }
  /** End date for an activity starting at `start` lasting `n` working days (inclusive). n<=0 → start. */
  finishFrom(start: string, n: number) {
    let d = this.nextWorking(start);
    for (let left = Math.round(n) - 1; left > 0; ) {
      d = addDays(d, 1);
      if (this.isWorking(d)) left--;
    }
    return d;
  }
  /** Move forward n working days (n=1 → next working day after iso). */
  addWorking(iso: string, n: number) {
    let d = iso;
    let left = Math.round(n);
    const step = left >= 0 ? 1 : -1;
    left = Math.abs(left);
    while (left > 0) {
      d = addDays(d, step);
      if (this.isWorking(d)) left--;
    }
    return d;
  }
  /** Working days in [a, b] inclusive (0 if b < a). */
  countWorking(a: string, b: string) {
    if (b < a) return 0;
    let n = 0;
    for (let d = a; d <= b; d = addDays(d, 1)) if (this.isWorking(d)) n++;
    return n;
  }
  /** Signed working-day difference from a to b (positive if b is later). */
  workingDiff(a: string, b: string) {
    if (a === b) return 0;
    return b > a ? this.countWorking(addDays(a, 1), b) : -this.countWorking(addDays(b, 1), a);
  }
}

/** Fast lookup of cumulative working-day index over a date range. */
export class WorkIndex {
  readonly start: string;
  private cum: number[];
  constructor(cal: WorkCalendar, start: string, end: string) {
    this.start = start;
    this.cum = [];
    let c = 0;
    const days = Math.max(0, diffDays(start, end)) + 1;
    for (let i = 0; i < days; i++) {
      if (cal.isWorking(addDays(start, i))) c++;
      this.cum.push(c);
    }
  }
  /** Number of working days from range start up to and including iso. */
  at(iso: string) {
    const i = diffDays(this.start, iso);
    if (i < 0) return 0;
    if (i >= this.cum.length) return this.cum[this.cum.length - 1] + (i - this.cum.length + 1) * (6 / 7);
    return this.cum[i];
  }
}
