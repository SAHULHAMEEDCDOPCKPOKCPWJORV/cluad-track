// Parallel matching of imported rows against the 165-activity master list.
import { MASTER_ACTIVITIES, MASTER_BY_ID, type MasterActivity } from './master';

const STOP = new Set(['and', 'the', 'of', 'for', 'to', 'in', 'at', 'with', 'from', 'a', 'an', 'on', 'by', 'where', 'applicable']);

export function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !STOP.has(t))
    .map((t) => (t.length > 4 && t.endsWith('s') ? t.slice(0, -1) : t));
}

export function similarity(a: string, b: string): number {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  // Dice coefficient – forgiving for short names
  return (2 * inter) / (A.size + B.size);
}

export interface MatchResult {
  activityId: string;
  master: MasterActivity;
  score: number;
  method: 'id' | 'exact' | 'fuzzy';
}

export function matchToMaster(row: { activityId?: string; activityName?: string }, threshold = 0.55): MatchResult | null {
  const id = (row.activityId ?? '').trim().toUpperCase();
  if (id && MASTER_BY_ID.has(id)) return { activityId: id, master: MASTER_BY_ID.get(id)!, score: 1, method: 'id' };
  const name = (row.activityName ?? '').trim();
  if (!name) return null;
  let best: MasterActivity | null = null;
  let bestScore = 0;
  for (const m of MASTER_ACTIVITIES) {
    if (m.name.toLowerCase() === name.toLowerCase()) return { activityId: m.activityId, master: m, score: 1, method: 'exact' };
    const s = similarity(name, m.name);
    if (s > bestScore) {
      bestScore = s;
      best = m;
    }
  }
  if (best && bestScore >= threshold) return { activityId: best.activityId, master: best, score: Math.round(bestScore * 100) / 100, method: 'fuzzy' };
  return null;
}
