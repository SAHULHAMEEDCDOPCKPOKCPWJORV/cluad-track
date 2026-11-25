'use client';
// Chart pictures (PNG data URLs) for the PDF and Excel exports, drawn on a canvas.
import type { SPoint } from './schedule';

type Ctx = CanvasRenderingContext2D;
const FONT = 'Arial, Helvetica, sans-serif';

function canvas(W: number, H: number, bg: string): [HTMLCanvasElement, Ctx] {
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  return [cv, g];
}

function rounded(g: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}

/** Coloured title strip used on every chart picture. */
function titleBar(g: Ctx, W: number, title: string, accent: string, sub?: string) {
  g.fillStyle = accent;
  g.fillRect(0, 0, W, 8);
  g.fillStyle = '#0f172a';
  g.font = `bold 26px ${FONT}`;
  g.fillText(title, 28, 48);
  if (sub) {
    g.fillStyle = '#64748b';
    g.font = `17px ${FONT}`;
    g.fillText(sub, 28, 74);
  }
}

export interface SCurveOpts {
  width?: number;
  height?: number;
  title?: string;
  sub?: string;
  today?: string;
  light?: boolean;
  accent?: string;
  colors?: { planned?: string; actual?: string; forecast?: string };
}

export function sCurvePng(points: SPoint[], opts: SCurveOpts = {}): string {
  const W = opts.width ?? 1200;
  const H = opts.height ?? 520;
  const light = opts.light ?? true;
  const [cv, g] = canvas(W, H, light ? '#ffffff' : '#0c1018');
  const fg = light ? '#1e293b' : '#e2e8f0';
  const grid = light ? '#e2e8f0' : '#1e283b';
  const col = { planned: opts.colors?.planned ?? '#3b82f6', actual: opts.colors?.actual ?? '#10b981', forecast: opts.colors?.forecast ?? '#f43f5e' };
  const accent = opts.accent ?? col.actual;
  const L = 78, R = 34, T = opts.title ? (opts.sub ? 120 : 104) : 40, B = 64;
  const pw = W - L - R, ph = H - T - B;
  if (opts.title) titleBar(g, W, opts.title, accent, opts.sub);
  else { g.fillStyle = accent; g.fillRect(0, 0, W, 6); }
  // plot background + grid
  g.fillStyle = light ? '#f8fafc' : '#0b111c';
  g.fillRect(L, T, pw, ph);
  g.font = `16px ${FONT}`;
  g.lineWidth = 1;
  for (let i = 0; i <= 5; i++) {
    const y = T + ph - (i / 5) * ph;
    g.strokeStyle = grid;
    g.beginPath();
    g.moveTo(L, y);
    g.lineTo(L + pw, y);
    g.stroke();
    g.fillStyle = '#64748b';
    g.textAlign = 'right';
    g.fillText(`${i * 20}%`, L - 10, y + 5);
  }
  g.textAlign = 'left';
  const n = points.length;
  if (n < 2) {
    g.fillStyle = '#64748b';
    g.fillText('Not enough data for a curve yet', L + 20, T + ph / 2);
    return cv.toDataURL('image/png');
  }
  const X = (i: number) => L + (i / (n - 1)) * pw;
  const Y = (v: number) => T + ph - (Math.max(0, Math.min(100, v)) / 100) * ph;
  // month labels on the x axis
  g.fillStyle = '#64748b';
  g.textAlign = 'center';
  const step = Math.max(1, Math.ceil(n / 10));
  for (let i = 0; i < n; i += step) {
    g.strokeStyle = grid;
    g.beginPath();
    g.moveTo(X(i), T + ph);
    g.lineTo(X(i), T + ph + 6);
    g.stroke();
    g.fillText(points[i].label, X(i), T + ph + 26);
  }
  g.textAlign = 'left';
  const line = (key: 'planned' | 'actual' | 'forecast', color: string, dash: number[] = [], fill = false, width = 4) => {
    const pts: [number, number][] = [];
    points.forEach((p, i) => { const v = p[key]; if (v != null) pts.push([X(i), Y(v)]); });
    if (!pts.length) return;
    if (fill) {
      const grad = g.createLinearGradient(0, T, 0, T + ph);
      grad.addColorStop(0, `${color}55`);
      grad.addColorStop(1, `${color}05`);
      g.beginPath();
      g.moveTo(pts[0][0], T + ph);
      pts.forEach(([x, y]) => g.lineTo(x, y));
      g.lineTo(pts[pts.length - 1][0], T + ph);
      g.closePath();
      g.fillStyle = grad;
      g.fill();
    }
    g.beginPath();
    g.setLineDash(dash);
    g.strokeStyle = color;
    g.lineWidth = width;
    g.lineJoin = 'round';
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.stroke();
    g.setLineDash([]);
    // end point dot + value
    const [lx, ly] = pts[pts.length - 1];
    const lastV = [...points].reverse().find((p) => p[key] != null)?.[key] as number;
    g.fillStyle = color;
    g.beginPath();
    g.arc(lx, ly, 7, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(lx, ly, 3, 0, Math.PI * 2);
    g.fill();
    if (key !== 'forecast') {
      g.font = `bold 16px ${FONT}`;
      const t = `${Math.round(lastV * 10) / 10}%`;
      const tw = g.measureText(t).width + 12;
      const bx = Math.min(lx + 10, L + pw - tw), by = Math.max(T + 2, ly - 30);
      g.fillStyle = color;
      rounded(g, bx, by, tw, 24, 6);
      g.fill();
      g.fillStyle = '#ffffff';
      g.fillText(t, bx + 6, by + 17);
    }
  };
  line('planned', col.planned, [], true);
  line('forecast', col.forecast, [12, 8], false, 3);
  line('actual', col.actual, [], true, 4.5);
  if (opts.today) {
    const ti = points.findIndex((p) => p.date >= opts.today!);
    if (ti >= 0) {
      g.strokeStyle = '#dc2626';
      g.lineWidth = 2;
      g.setLineDash([6, 6]);
      g.beginPath();
      g.moveTo(X(ti), T);
      g.lineTo(X(ti), T + ph);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = '#dc2626';
      rounded(g, X(ti) - 34, T + 6, 68, 24, 6);
      g.fill();
      g.fillStyle = '#ffffff';
      g.font = `bold 14px ${FONT}`;
      g.textAlign = 'center';
      g.fillText('TODAY', X(ti), T + 23);
      g.textAlign = 'left';
    }
  }
  g.strokeStyle = '#cbd5e1';
  g.lineWidth = 1;
  g.strokeRect(L, T, pw, ph);
  // legend (top right)
  g.font = `16px ${FONT}`;
  const items: [string, string, boolean][] = [['Planned', col.planned, false], ['Actual', col.actual, false], ['Forecast', col.forecast, true]];
  let lx = W - R;
  for (const [t, c, dashed] of [...items].reverse()) {
    const w = g.measureText(t).width + 44;
    lx -= w;
    g.strokeStyle = c;
    g.lineWidth = 4;
    g.setLineDash(dashed ? [8, 5] : []);
    g.beginPath();
    g.moveTo(lx, T - 18);
    g.lineTo(lx + 28, T - 18);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = fg;
    g.fillText(t, lx + 34, T - 12);
    lx -= 12;
  }
  return cv.toDataURL('image/png');
}

/** Doughnut chart with a big centre value and a legend on the right. */
export function donutPng(data: { name: string; value: number; color: string }[], opts: { title: string; center: string; sub?: string; width?: number; height?: number; accent?: string }): string {
  const W = opts.width ?? 760, H = opts.height ?? 520;
  const [cv, g] = canvas(W, H, '#ffffff');
  titleBar(g, W, opts.title, opts.accent ?? '#10b981');
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const cx = 230, cy = 100 + (H - 100) / 2, r = Math.min(190, (H - 140) / 2), inner = r * 0.6;
  let a0 = -Math.PI / 2;
  for (const d of data) {
    if (!d.value) continue;
    const a1 = a0 + (d.value / total) * Math.PI * 2;
    g.beginPath();
    g.moveTo(cx, cy);
    g.arc(cx, cy, r, a0, a1);
    g.closePath();
    g.fillStyle = d.color;
    g.fill();
    g.strokeStyle = '#ffffff';
    g.lineWidth = 3;
    g.stroke();
    a0 = a1;
  }
  g.beginPath();
  g.arc(cx, cy, inner, 0, Math.PI * 2);
  g.fillStyle = '#ffffff';
  g.fill();
  g.textAlign = 'center';
  g.fillStyle = '#0f172a';
  g.font = `bold 52px ${FONT}`;
  g.fillText(opts.center, cx, cy + 14);
  if (opts.sub) {
    g.fillStyle = '#64748b';
    g.font = `18px ${FONT}`;
    g.fillText(opts.sub, cx, cy + 44);
  }
  g.textAlign = 'left';
  // legend
  let y = cy - (data.length * 52) / 2 + 20;
  for (const d of data) {
    g.fillStyle = d.color;
    rounded(g, 470, y - 20, 26, 26, 6);
    g.fill();
    g.fillStyle = '#1e293b';
    g.font = `20px ${FONT}`;
    g.fillText(d.name, 508, y);
    g.font = `bold 20px ${FONT}`;
    g.textAlign = 'right';
    g.fillText(`${d.value}  (${Math.round((d.value / total) * 100)}%)`, W - 28, y);
    g.textAlign = 'left';
    y += 52;
  }
  return cv.toDataURL('image/png');
}

/** Horizontal planned-vs-actual bars, one coloured row per item. */
export function barsPng(rows: { name: string; planned: number; actual: number; color: string }[], opts: { title: string; sub?: string; width?: number; accent?: string }): string {
  const W = opts.width ?? 1200;
  const rowH = 64, T = opts.sub ? 120 : 100, B = 50;
  const H = T + rows.length * rowH + B;
  const [cv, g] = canvas(W, H, '#ffffff');
  titleBar(g, W, opts.title, opts.accent ?? '#3b82f6', opts.sub);
  const L = 380, R = 110, pw = W - L - R;
  // grid
  g.font = `15px ${FONT}`;
  for (let i = 0; i <= 4; i++) {
    const x = L + (i / 4) * pw;
    g.strokeStyle = '#e2e8f0';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x, T - 8);
    g.lineTo(x, T + rows.length * rowH);
    g.stroke();
    g.fillStyle = '#94a3b8';
    g.textAlign = 'center';
    g.fillText(`${i * 25}%`, x, T + rows.length * rowH + 26);
  }
  rows.forEach((r, i) => {
    const y = T + i * rowH;
    if (i % 2 === 0) { g.fillStyle = '#f8fafc'; g.fillRect(0, y, W, rowH); }
    g.fillStyle = r.color;
    rounded(g, 24, y + 18, 10, rowH - 36, 3);
    g.fill();
    g.fillStyle = '#1e293b';
    g.font = `bold 18px ${FONT}`;
    g.textAlign = 'left';
    const name = r.name.length > 32 ? `${r.name.slice(0, 31)}…` : r.name;
    g.fillText(name, 44, y + rowH / 2 + 6);
    // planned (light) and actual (solid) bars
    g.fillStyle = `${r.color}40`;
    rounded(g, L, y + 12, (Math.min(100, r.planned) / 100) * pw, 18, 5);
    g.fill();
    g.fillStyle = r.color;
    rounded(g, L, y + 34, Math.max(2, (Math.min(100, r.actual) / 100) * pw), 18, 5);
    g.fill();
    g.font = `14px ${FONT}`;
    g.fillStyle = '#64748b';
    g.fillText(`Plan ${r.planned}%`, L + (Math.min(100, r.planned) / 100) * pw + 8, y + 26);
    g.font = `bold 16px ${FONT}`;
    g.fillStyle = '#0f172a';
    g.fillText(`${r.actual}%`, L + (Math.min(100, r.actual) / 100) * pw + 8, y + 49);
  });
  // legend
  g.font = `15px ${FONT}`;
  g.fillStyle = '#cbd5e1';
  rounded(g, W - 300, T - 34, 22, 12, 3);
  g.fill();
  g.fillStyle = '#475569';
  g.fillText('Planned (light)', W - 272, T - 23);
  g.fillStyle = '#475569';
  rounded(g, W - 150, T - 34, 22, 12, 3);
  g.fill();
  g.fillText('Actual (solid)', W - 122, T - 23);
  return cv.toDataURL('image/png');
}
