// Small table helper for the marketing & sales modules.
// Production: Supabase (service role, server only). Local demo/tests: in-memory tables.
import { getDb, HttpError } from './store';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;

const KEYS: Record<string, string[]> = {
  swelect_social_snapshots: ['account_id', 'day'],
  swelect_settings: ['key'],
};
const keyOf = (table: string, r: Row) => (KEYS[table] ?? ['id']).map((k) => String(r[k])).join('|');

const g = globalThis as unknown as { __swMemTables?: Map<string, Map<string, Row>> };
const mem = (table: string) => {
  g.__swMemTables ??= new Map();
  let t = g.__swMemTables.get(table);
  if (!t) g.__swMemTables.set(table, (t = new Map()));
  return t;
};

export interface Query {
  eq?: Record<string, unknown>;
  gte?: [string, string | number];
  lte?: [string, string | number];
  inList?: [string, unknown[]];
  order?: [string, 'asc' | 'desc'];
  limit?: number;
  columns?: string;
}

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new HttpError(500, `Database error: ${res.error.message}`);
  return res.data;
}

export async function select(table: string, q: Query = {}): Promise<Row[]> {
  const db = getDb();
  if (db) {
    let b = db.from(table).select(q.columns ?? '*');
    for (const [k, v] of Object.entries(q.eq ?? {})) b = b.eq(k, v as never);
    if (q.gte) b = b.gte(q.gte[0], q.gte[1]);
    if (q.lte) b = b.lte(q.lte[0], q.lte[1]);
    if (q.inList) b = b.in(q.inList[0], q.inList[1] as never[]);
    if (q.order) b = b.order(q.order[0], { ascending: q.order[1] === 'asc', nullsFirst: false });
    b = b.limit(Math.min(q.limit ?? 1000, 5000));
    return (check(await b) as unknown as Row[]) ?? [];
  }
  let rows = [...mem(table).values()];
  for (const [k, v] of Object.entries(q.eq ?? {})) rows = rows.filter((r) => r[k] === v);
  if (q.gte) rows = rows.filter((r) => r[q.gte![0]] != null && r[q.gte![0]] >= q.gte![1]);
  if (q.lte) rows = rows.filter((r) => r[q.lte![0]] != null && r[q.lte![0]] <= q.lte![1]);
  if (q.inList) rows = rows.filter((r) => q.inList![1].includes(r[q.inList![0]]));
  if (q.order) {
    const [k, dir] = q.order;
    rows.sort((a, b) => (a[k] == null ? 1 : b[k] == null ? -1 : String(a[k]).localeCompare(String(b[k]), undefined, { numeric: true })) * (dir === 'asc' ? 1 : -1));
  }
  return rows.slice(0, q.limit ?? 1000).map((r) => ({ ...r }));
}

/** Insert or update rows. With ignoreDuplicates, existing rows are left untouched (returns only new ones). */
export async function upsert(table: string, rows: Row[], opts: { onConflict?: string; ignoreDuplicates?: boolean } = {}): Promise<Row[]> {
  if (!rows.length) return [];
  const db = getDb();
  if (db) {
    const out: Row[] = [];
    for (let i = 0; i < rows.length; i += 500) {
      const res = await db.from(table).upsert(rows.slice(i, i + 500), { onConflict: opts.onConflict ?? (KEYS[table] ?? ['id']).join(','), ignoreDuplicates: !!opts.ignoreDuplicates }).select();
      out.push(...((check(res) as Row[]) ?? []));
    }
    return out;
  }
  const t = mem(table);
  const out: Row[] = [];
  for (const r of rows) {
    const k = keyOf(table, r);
    if (t.has(k)) {
      if (opts.ignoreDuplicates) continue;
      t.set(k, { ...t.get(k), ...r });
    } else t.set(k, { ...r });
    out.push({ ...t.get(k) });
  }
  return out;
}

export async function update(table: string, eq: Record<string, unknown>, patch: Row): Promise<void> {
  const db = getDb();
  if (db) {
    let b = db.from(table).update(patch);
    for (const [k, v] of Object.entries(eq)) b = b.eq(k, v as never);
    check(await b);
    return;
  }
  for (const r of mem(table).values()) if (Object.entries(eq).every(([k, v]) => r[k] === v)) Object.assign(r, patch);
}

export async function remove(table: string, eq: Record<string, unknown>): Promise<void> {
  const db = getDb();
  if (db) {
    let b = db.from(table).delete();
    for (const [k, v] of Object.entries(eq)) b = b.eq(k, v as never);
    check(await b);
    return;
  }
  const t = mem(table);
  for (const [k, r] of t) if (Object.entries(eq).every(([kk, v]) => r[kk] === v)) t.delete(k);
}

// ───────── settings (one JSON value per key) ─────────
export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const rows = await select('swelect_settings', { eq: { key }, limit: 1 });
  return rows[0] ? (rows[0].value as T) : fallback;
}
export async function setSetting(key: string, value: unknown) {
  await upsert('swelect_settings', [{ key, value, updated_at: new Date().toISOString() }]);
}
