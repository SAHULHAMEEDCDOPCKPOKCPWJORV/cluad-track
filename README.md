# SWELECT Project Control

Enterprise-Grade Solar EPC & Solar IPP Project Management, Scheduling, and Project Control Platform.

## Features
- **Department Authentication:** 7 specialized departmental login accounts (PLAN, LAND, ENG, PRO, SITE, TRN, COMM).
- **Project Storage & Setup:** Independent project management, capacity tracking (MW/MWp), and Indian location cascade (28 States, 8 UTs, Districts, Villages).
- **Project-Specific Excel Import:** Spreadsheet-style activity scheduling with parallel matching against the 165 Master Activity list.
- **Working Calendar Engine:** Automatic Sunday exclusion (0% working), Saturday working, and 13 Indian gazetted holidays excluded.
- **Interactive Gantt Chart:** 10-column table view, single-line date formatting (`DD-MM-YYYY`), weekly zoom timeline with start-to-end date ranges (`Wk · Start to End`), and inline bar badges.
- **Project Control Dashboard:** Overall S-curve, Activity Status distribution donut chart, 13 core project KPIs, and dedicated **Section-wise Individual S-Curves (All 9 Sections Grid)**.
- **Section-wise Delays & Hold Impact:** Critical path root-cause tracking, downstream successor ripple predictions, and hold status indicators.
- **AI-Powered Project Report:** Executive summaries, department performance audits, delay risk mitigation, and automated PDF exports.
- **Multi-Sheet Excel Export Suite:** Generates `Executive Overview & EVM`, `Master Gantt Schedule`, `Master Baseline Schedule`, `S-Curve Trajectory Suite`, `AI Duration Impact & Protocols`, and individual section worksheets.
- **Permanent Database Storage & Audit History:** Comprehensive audit trail tracking every field change, user email, department, timestamp, old value, and new value.

## Technology Stack
- **Framework:** Next.js 14 (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS, Lucide React Icons
- **Visualizations:** Recharts
- **Spreadsheets & Reports:** XLSX, jsPDF, html2canvas
- **Date Handling:** date-fns

## Getting Started

### Installation
```bash
npm install
```

### Development Server
```bash
npm run dev
```

### Production Build
```bash
npm run build
npm start
```

## Branding & Confidentiality
SWELECT Energy Systems Limited • Powering the world responsibly.
