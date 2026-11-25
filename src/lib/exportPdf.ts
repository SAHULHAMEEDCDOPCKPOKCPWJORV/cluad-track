'use client';
// PDF project report (jsPDF + autotable), landscape A4.
import { fmt } from './calendar';
import { sCurvePng } from './chartImage';
import type { ExportCtx } from './exportExcel';
import { fmtSpi } from './schedule';

// Standard PDF fonts only cover WinAnsi; replace characters they cannot draw.
const clean = (v: unknown): string =>
  String(v ?? '').replace(/→/g, '->').replace(/←/g, '<-').replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/◆/g, '*').replace(/[^\x00-\xFF–—‘’“”•…€]/g, '');

export async function exportPdf(x: ExportCtx) {
  const { jsPDF } = await import('jspdf');
  const { autoTable } = await import('jspdf-autotable');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const p = x.project;
  const k = x.kpis;
  const r = x.report;
  const healthRgb: [number, number, number] = r.health === 'On Track' ? [16, 185, 129] : r.health === 'At Risk' ? [16, 185, 129] : [244, 63, 94];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lastY = () => ((doc as any).lastAutoTable?.finalY ?? 40) as number;

  const banner = (t: string) => {
    doc.setFillColor(12, 16, 24);
    doc.rect(0, 0, W, 18, 'F');
    doc.setFillColor(16, 185, 129);
    doc.rect(0, 18, W, 1.2, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text('SWELECT Project Control', 10, 11.5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(clean(t), W - 10, 11.5, { align: 'right' });
    doc.setTextColor(30, 41, 59);
  };
  const heading = (t: string, y: number) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(5, 150, 105);
    doc.text(t, 10, y);
    doc.setTextColor(30, 41, 59);
    doc.setFont('helvetica', 'normal');
    return y + 4;
  };
  const tableStyle = {
    theme: 'grid' as const,
    styles: { fontSize: 8, cellPadding: 1.6, textColor: [30, 41, 59] as [number, number, number] },
    headStyles: { fillColor: [16, 185, 129] as [number, number, number], textColor: [3, 5, 8] as [number, number, number], fontStyle: 'bold' as const },
    alternateRowStyles: { fillColor: [248, 250, 252] as [number, number, number] },
    margin: { left: 10, right: 10, top: 24 },
  };

  // Page 1 – cover + KPIs + S-curve
  banner(`Project Report | ${fmt(x.today)}`);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text(clean(p.name), 10, 32);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(100, 116, 139);
  doc.text(clean(`${p.capacityMw} MW ${p.projectType} | ${[p.village, p.district, p.state].filter(Boolean).join(', ')} | Planned ${fmt(p.plannedStartDate)} to ${fmt(k.plannedFinish)}`), 10, 39);
  doc.setFillColor(...healthRgb);
  doc.roundedRect(W - 60, 25, 50, 14, 3, 3, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text(r.health.toUpperCase(), W - 35, 34, { align: 'center' });
  doc.setTextColor(30, 41, 59);

  const tiles: [string, string][] = [
    ['Overall progress', `${k.overallProgress}%`], ['Planned progress', `${k.plannedProgress}%`], ['Schedule variance', `${k.scheduleVariance}%`], ['SPI', fmtSpi(k)],
    ['Completed', `${k.completed}/${k.total}`], ['Delayed', String(k.delayed)], ['On hold', String(k.onHold)], ['Critical delays', String(k.criticalDelays)],
    ['Forecast finish', fmt(k.forecastFinish)], ['Project delay', `${k.projectDelay} wd`], ['Working days left', String(k.workingDaysRemaining)], ['In progress', String(k.inProgress)],
  ];
  const tw = (W - 20 - 5 * 3) / 6;
  tiles.forEach(([label, val], i) => {
    const cx = 10 + (i % 6) * (tw + 3);
    const cy = 45 + Math.floor(i / 6) * 19;
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(cx, cy, tw, 16, 2, 2, 'FD');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(label.toUpperCase(), cx + 3, cy + 5);
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text(val, cx + 3, cy + 12.5);
    doc.setFont('helvetica', 'normal');
  });
  const img = sCurvePng(x.curve, { title: 'Overall S-Curve (planned vs actual vs forecast)', today: x.today, light: true, width: 1400, height: 520 });
  doc.addImage(img, 'PNG', 10, 85, W - 20, ((W - 20) * 520) / 1400);

  // Page 2 – Executive summary + section table
  doc.addPage();
  banner('Executive Summary');
  let y = heading('Executive summary', 28);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text(doc.splitTextToSize(clean(r.headline), W - 20), 10, y + 2);
  doc.setFont('helvetica', 'normal');
  y += 9;
  for (const s of r.summary) {
    const lines = doc.splitTextToSize(clean(`• ${s}`), W - 24);
    doc.text(lines, 12, y);
    y += lines.length * 4.6 + 1;
  }
  y = heading('Section performance', y + 4);
  autoTable(doc, {
    ...tableStyle,
    startY: y,
    head: [['Section', 'Activities', 'Planned %', 'Actual %', 'SPI', 'Delayed', 'On hold', 'Planned finish', 'Forecast finish']],
    body: x.sections.map((s) => [clean(s.key), s.total, s.planned, s.actual, s.spi.toFixed(2), s.delayed, s.onHold, fmt(s.finish), fmt(s.forecastFinish)]),
    didParseCell: (d) => {
      if (d.section === 'body' && d.column.index === 4) {
        const v = Number(d.cell.raw);
        d.cell.styles.textColor = v >= 0.95 ? [5, 150, 105] : v >= 0.85 ? [5, 150, 105] : [225, 29, 72];
        d.cell.styles.fontStyle = 'bold';
      }
    },
  });

  // Page 3 – Department audit
  doc.addPage();
  banner('Department Performance Audit');
  autoTable(doc, {
    ...tableStyle,
    startY: heading('Department performance audit', 28),
    head: [['Dept', 'Department', 'Score', 'Rating', 'Planned %', 'Actual %', 'SPI', 'Done', 'Delayed', 'Finding']],
    body: r.deptAudit.map((d) => [d.dept, clean(d.name), d.score, d.rating, d.planned, d.actual, d.spi.toFixed(2), `${d.completed}/${d.total}`, d.delayed, clean(d.finding)]),
    columnStyles: { 9: { cellWidth: 90 } },
    didParseCell: (d) => {
      if (d.section === 'body' && d.column.index === 3) {
        const v = String(d.cell.raw);
        d.cell.styles.textColor = v === 'Excellent' || v === 'Good' ? [5, 150, 105] : v === 'Needs Attention' ? [5, 150, 105] : [225, 29, 72];
        d.cell.styles.fontStyle = 'bold';
      }
    },
  });
  y = heading('Recommendations', lastY() + 10);
  doc.setFontSize(10);
  r.recommendations.forEach((t, i) => {
    const lines = doc.splitTextToSize(clean(`${i + 1}. ${t}`), W - 24);
    doc.text(lines, 12, y + 2);
    y += lines.length * 4.6 + 1.5;
  });

  // Page 4+ – Delay risks & mitigation
  doc.addPage();
  banner('Delay Risk & Mitigation');
  autoTable(doc, {
    ...tableStyle,
    startY: heading(`Delay risk register (${r.risks.length} items)`, 28),
    head: [['ID', 'Activity', 'Dept', 'Severity', 'Status', 'Delay', 'Float', 'Finish impact', 'Mitigation protocol']],
    body: r.risks.slice(0, 60).map((q) => [q.activityId, clean(q.activityName), q.department, q.severity, q.status, `+${q.delayDays}d`, `${q.totalFloat}d`, `${q.finishImpact}d`, clean(q.mitigation.slice(0, 3).join('\n'))]),
    columnStyles: { 1: { cellWidth: 60 }, 8: { cellWidth: 95 } },
    didParseCell: (d) => {
      if (d.section === 'body' && d.column.index === 3) {
        const v = String(d.cell.raw);
        d.cell.styles.textColor = v === 'Critical' ? [225, 29, 72] : v === 'High' ? [5, 150, 105] : v === 'Medium' ? [5, 150, 105] : [8, 145, 178];
        d.cell.styles.fontStyle = 'bold';
      }
    },
  });
  if (!r.risks.length) doc.text('No delayed or held activities at the data date.', 10, 40);

  // Footer on every page
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(`SWELECT Energy Systems Limited | Confidential | Generated ${fmt(x.today)} by ${x.user}`, 10, H - 6);
    doc.text(`Page ${i} of ${pages}`, W - 10, H - 6, { align: 'right' });
  }
  doc.save(`SWELECT_${p.name.replace(/[^\w-]+/g, '_')}_Report_${x.today}.pdf`);
}
