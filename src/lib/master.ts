// SWELECT master work-breakdown: 9 sections, 165 activities with logic links.
// Line format: "Activity name|working-day duration|predecessors"
//   - predecessors: comma list of local indices (1-based) or CODE:n cross-section refs.
//   - empty predecessors = previous activity (first activity uses the section's `after`).
//   - a name ending with * is a milestone (duration 0).
import type { Department } from './types';

export interface MasterActivity {
  sNo: number;
  activityId: string;
  name: string;
  section: string;
  sectionCode: string;
  department: Department;
  duration: number;
  isMilestone: boolean;
  predecessors: string[];
}

interface SectionDef {
  code: string;
  name: string;
  dept: Department;
  after: string[];
  items: string[];
}

const SECTION_DEFS: SectionDef[] = [
  {
    code: 'PLN', name: 'Project Initiation & Planning', dept: 'PLAN', after: [],
    items: [
      'Project kick-off & charter approval|3',
      'Project team mobilisation & RACI matrix|4',
      'Master schedule (L1/L2) baseline preparation|7',
      'Budget & cost baseline approval|5|2',
      'Risk register & HSE plan|5|3',
      'Quality assurance plan (QAP) approval|5|3',
      'Procurement strategy & vendor long-list|6|4',
      'Contract packaging & tender strategy|5',
      'Statutory compliance matrix|4|3',
      'Financial closure documentation|10|4',
      'PMIS & document control setup|4|2',
      'Stakeholder & community engagement plan|4|9',
      'Progress reporting & MIS framework|3|11',
      'Planning baseline sign-off*|0|5,6,8,10,12,13',
    ],
  },
  {
    code: 'LND', name: 'Land & Statutory Approvals', dept: 'LAND', after: ['PLN:1'],
    items: [
      'Site identification & reconnaissance survey|10',
      'Land title due diligence|12',
      'Land lease / sale agreement negotiation|15',
      'Land registration & mutation|10',
      'Land conversion (change of land use)|20|4',
      'Topographical survey|8|1',
      'Geotechnical investigation|12|6',
      'Hydrology & drainage study|6|6',
      'Environmental screening & clearance|8|2',
      'Forest / wildlife NOC verification|10|9',
      'Panchayat / local body NOC|8|3',
      'State nodal agency (SNA) registration|7|PLN:3',
      'Discom feasibility & connectivity approval|20|12',
      'Grid connectivity / LTA application|15|12',
      'Electrical inspectorate approval (CEIG drawings)|12|13',
      'Aviation / defence NOC (where applicable)|10|9',
      'Construction water source approval|6|11',
      'Access road right-of-way|8|4',
      'Land possession handover|3|5,18',
      'Land & approvals clearance*|0|7,8,10,14,15,16,17,19',
    ],
  },
  {
    code: 'ENG', name: 'Engineering & Design', dept: 'ENG', after: ['PLN:3'],
    items: [
      'Design basis report & technical specifications|7',
      'Solar resource assessment & PVsyst energy yield|8|1',
      'Plant layout & block design|10|LND:6,2',
      'DC string & array sizing|6',
      'Single line diagram (SLD)|8|3',
      'Inverter & transformer sizing|5|4,5',
      'MMS structural design & wind-load analysis|12|3',
      'Civil foundation design (piles / RCC)|10|7,LND:7',
      'DC & AC cable sizing and routing|8|6',
      'Earthing & lightning protection design|7|3',
      'SCADA & communication architecture|8|5',
      'Control room / ICR building design|8|3',
      'Substation / switchyard design|12|5',
      'Drainage & internal road design|6|LND:8,3',
      'Fire-fighting & security system design|6|12',
      'Bill of quantities (BoQ) finalisation|5|8,9,10,13',
      'Vendor drawing review & approval|15|PRC:4',
      "Design review with client / owner's engineer|5|17,11,14,15",
      'Issue of GFC drawings|4',
      'Engineering freeze*|0',
    ],
  },
  {
    code: 'PRC', name: 'Procurement & Logistics', dept: 'PRO', after: ['ENG:6'],
    items: [
      'Vendor pre-qualification|8',
      'RFQ issue for major packages|5|1,ENG:16',
      'Technical & commercial bid evaluation|10',
      'Negotiation & vendor finalisation|7',
      'PO – Solar PV modules|3',
      'PO – String / central inverters|3|4',
      'PO – Module mounting structures|3|4',
      'PO – DC & AC cables|3|4',
      'PO – Inverter / power transformers|3|4',
      'PO – HT switchgear & protection panels|3|4',
      'PO – SCADA, weather station & CCTV|3|4',
      'PO – Earthing & lightning protection material|2|4',
      'Advance payment & LC opening|7|5,6,7,8,9,10',
      'Pre-dispatch inspection plan & FAT schedule|5',
      'Module manufacturing, FAT & dispatch|45|14',
      'MMS fabrication & galvanising|35|14,ENG:7',
      'Inverter manufacturing & dispatch|40|14',
      'Transformer manufacturing & type testing|60|14',
      'Cable & BoS material dispatch|25|14,11,12',
      'Logistics, transit insurance & e-way bills|15|15,17',
      'Material receipt, inspection & storage at site|20|20,16,18,19',
      'Procurement complete*|0',
    ],
  },
  {
    code: 'CIV', name: 'Civil & Infrastructure Works', dept: 'SITE', after: ['LND:19', 'ENG:8'],
    items: [
      'Site mobilisation & temporary facilities|8',
      'Site clearing, grubbing & levelling|20',
      'Boundary fencing & main gate|15|1',
      'Internal & access road construction|25|2,ENG:14',
      'Survey layout & pile marking|8|2',
      'Pile load testing (initial)|10',
      'Pile / foundation installation|45|6,ENG:19',
      'Foundation curing & inspection|7',
      'Foundation completion*|0',
      'Cable trench excavation & PCC|20|5',
      'Drainage & storm-water works|18|2',
      'Control room / ICR building construction|40|1,ENG:12',
      'Transformer & switchgear plinths|12|5',
      'Switchyard civil works|30|5,ENG:13',
      'Water supply & storage tank|8|1',
      'Security cabin & watch towers|10|3',
      'Module cleaning system pipeline|12|10',
      'Area lighting pole foundations|8|10',
      'Final civil snag clearance|6|9,11,12,13,14,15,16,17,18,4',
      'Civil works complete*|0',
    ],
  },
  {
    code: 'MEC', name: 'Mechanical Installation', dept: 'SITE', after: ['CIV:6'],
    items: [
      'MMS material sorting & block-wise issue|5|PRC:16,CIV:6',
      'MMS erection – Phase 1|25|1,CIV:7',
      'MMS erection – Phase 2|25',
      'MMS alignment, torque & QA check|8',
      'Module receipt & pre-installation inspection|5|PRC:21',
      'Module installation – Phase 1|20|5,2',
      'Module installation – Phase 2|20|6,3',
      'Module clamp torque & alignment check|6|7,4',
      'String / combiner box mounting|10|6',
      'Inverter skid / station placement|8|PRC:21,CIV:13',
      'Transformer placement & oil filtration|10|10',
      'HT panel / RMU erection|6|10',
      'Module cleaning system installation|10|CIV:17,7',
      'Weather monitoring station installation|4|CIV:18',
      'Mechanical punch list closure|6|8,9,11,12,13,14',
      'Mechanical completion*|0',
    ],
  },
  {
    code: 'ELE', name: 'Electrical Installation', dept: 'SITE', after: ['MEC:6'],
    items: [
      'DC cable laying (string to inverter)|25|MEC:9,CIV:10',
      'MC4 crimping & string interconnection|20|MEC:6',
      'String polarity & IV curve testing|10|1,2,MEC:7',
      'AC LT cable laying (inverter to transformer)|15|MEC:10,MEC:11',
      'HT cable laying & termination|15|MEC:11,MEC:12',
      'Earthing grid installation|20|CIV:10',
      'Lightning arrester installation|8|6',
      'Earth pit resistance testing|4|7',
      'Inverter cabling & termination|10|4,1',
      'Transformer & HT panel termination|8|5',
      'Auxiliary power & UPS installation|6|CIV:12',
      'SCADA panel & communication cabling|15|11,MEC:14',
      'CCTV & security system installation|10|11,CIV:16',
      'Fire alarm & fire-fighting system|8|CIV:12',
      'Area & control room lighting|10|CIV:18,11',
      'Insulation resistance (IR) testing|6|9,10',
      'Protection relay setting & testing|8|10,12',
      'Electrical QA & punch list closure|8|3,8,13,14,15,16,17',
      'CEIG inspection & approval|10|18,LND:15',
      'Electrical completion*|0',
    ],
  },
  {
    code: 'TRN', name: 'Transmission & Evacuation', dept: 'TRN', after: ['ENG:13', 'LND:14'],
    items: [
      'Route survey for transmission line|10',
      'Tower spotting & profile approval|8',
      'Right-of-way & tree-cutting compensation|20',
      'Transmission line material procurement|40|2',
      'Tower foundation works|30|3',
      'Tower erection|25|5,4',
      'Conductor stringing & sagging|20',
      'Line testing & patrolling|6',
      'Grid substation bay extension design|10|1',
      'Bay equipment supply (CT/PT/CB/isolators)|45|9',
      'Bay civil & structure works|20|9',
      'Bay equipment erection & cabling|15|10,11',
      'ABT / SEM metering installation & sealing|6|12',
      'Protection coordination with Discom / STU|8|12,ELE:17',
      'Switchyard energisation at plant end|5|ELE:20,13',
      'Line charging approval from Discom / SLDC|10|8,14,15',
      'Transmission line charging|2',
      'Evacuation ready*|0',
    ],
  },
  {
    code: 'COM', name: 'Testing & Commissioning', dept: 'COMM', after: ['ELE:20'],
    items: [
      'Pre-commissioning checklist & documentation|6',
      'Cold commissioning (no-load tests)|8',
      'Inverter commissioning & parameter setting|8|2,TRN:17',
      'Hot commissioning & grid synchronisation|5',
      'SCADA integration & remote data validation|6|4,ELE:12',
      'Commissioning certificate from SNA / Discom|10|4',
      'Commercial operation date (COD) declaration*|0|6,5',
      'Performance ratio (PR) test|15|7',
      'Reliability / trial run|10|7',
      'As-built drawings submission|10|7',
      'O&M manuals & spares handover|6|7',
      'O&M team training|5|11',
      'Punch list closure & final inspection|8|8,9',
      'Project closure report|5|10,12,13',
      'Project handover to O&M*|0',
    ],
  },
];

const pad = (n: number) => String(n).padStart(2, '0');

function build(): { sections: { code: string; name: string; department: Department }[]; activities: MasterActivity[] } {
  const activities: MasterActivity[] = [];
  let sNo = 0;
  for (const s of SECTION_DEFS) {
    s.items.forEach((line, i) => {
      const [rawName, rawDur, rawPreds] = line.split('|');
      const isMilestone = rawName.trim().endsWith('*');
      const name = rawName.trim().replace(/\*$/, '');
      let preds: string[];
      if (rawPreds && rawPreds.trim()) {
        preds = rawPreds.split(',').map((p) => {
          p = p.trim();
          if (p.includes(':')) {
            const [c, n] = p.split(':');
            return `${c}-${pad(+n)}`;
          }
          return `${s.code}-${pad(+p)}`;
        });
      } else if (i === 0) {
        preds = s.after.map((p) => {
          const [c, n] = p.split(':');
          return `${c}-${pad(+n)}`;
        });
      } else {
        preds = [`${s.code}-${pad(i)}`];
      }
      activities.push({
        sNo: ++sNo,
        activityId: `${s.code}-${pad(i + 1)}`,
        name,
        section: s.name,
        sectionCode: s.code,
        department: s.dept,
        duration: isMilestone ? 0 : Number(rawDur),
        isMilestone,
        predecessors: preds,
      });
    });
  }
  return { sections: SECTION_DEFS.map((s) => ({ code: s.code, name: s.name, department: s.dept })), activities };
}

const BUILT = build();
export const SECTIONS = BUILT.sections;
export const SECTION_NAMES = SECTIONS.map((s) => s.name);
export const MASTER_ACTIVITIES = BUILT.activities;
export const MASTER_BY_ID = new Map(MASTER_ACTIVITIES.map((a) => [a.activityId, a]));
export const CUSTOM_SECTION = 'Custom / Project-Specific';
