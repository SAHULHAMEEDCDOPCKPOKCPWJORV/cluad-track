// One colour per section, shared by the schedule page, dashboard and Excel export.
import { SECTION_NAMES, CUSTOM_SECTION } from './master';

export const SECTION_PALETTE = ['#10b981', '#06b6d4', '#10b981', '#8b5cf6', '#f43f5e', '#3b82f6', '#34d399', '#14b8a6', '#e879f9', '#84cc16', '#10b981', '#0ea5e9', '#ec4899', '#22c55e', '#6366f1'];
const ORDER = [...SECTION_NAMES, CUSTOM_SECTION];

/** Sections in display order (website headings first, then the sheet's own headings in row order). */
export function orderSections(sections: string[]): string[] {
  return [...new Set(sections)].sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99));
}

export function sectionColorMap(sections: string[]): Map<string, string> {
  return new Map(orderSections(sections).map((s, i) => [s, SECTION_PALETTE[i % SECTION_PALETTE.length]]));
}

/** Mix a #rrggbb colour with white (amount 0 = colour, 1 = white). */
export function tint(hex: string, amount: number): string {
  const h = hex.replace('#', '');
  const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return `#${c.map((v) => Math.round(v + (255 - v) * amount).toString(16).padStart(2, '0')).join('')}`;
}

/** Cuts a section S-curve a little after the section is finished, so the curve fills the chart. */
export function trimCurve<T extends { planned: number; actual: number | null; forecast: number | null }>(curve: T[], pad = 2): T[] {
  const first = (f: (p: T) => boolean) => curve.findIndex(f);
  const p = first((q) => q.planned >= 99.5);
  const a = first((q) => q.actual != null && q.actual >= 99.5);
  const f = first((q) => q.forecast != null && q.forecast >= 99.5);
  const lastActual = curve.reduce((m, q, i) => (q.actual != null ? i : m), -1);
  const ends = [p, a >= 0 ? a : lastActual, f].filter((i) => i >= 0);
  if (!ends.length || p < 0) return curve;
  return curve.slice(0, Math.min(curve.length, Math.max(...ends) + 1 + pad));
}
