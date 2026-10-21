/**
 * Excel export of the deals list (PLAN.md §12.1). Uses exceljs.
 */
import ExcelJS from 'exceljs';
import { openAsks } from './metrics.js';

const DATE = 'dd-mmm-yyyy';
const MONEY = '#,##0';

/** Column definitions, in the order of §12.1. `date` and `money` set the cell format. */
const COLUMNS = [
  { header: 'ID', key: 'id' },
  { header: 'Title', key: 'title' },
  { header: 'Tags', key: 'tags' },
  { header: 'Customer', key: 'customer' },
  { header: 'C4C ID', key: 'c4c_id' },
  { header: 'Stage', key: 'stage' },
  { header: 'Status', key: 'status' },
  { header: 'Priority', key: 'priority' },
  { header: 'Health', key: 'health' },
  { header: 'Sales owner', key: 'sales' },
  { header: 'Presales owner', key: 'presales' },
  { header: 'Delivery owner', key: 'delivery' },
  { header: 'Supporters', key: 'supporters' },
  { header: 'Open asks', key: 'open_asks' },
  { header: 'BU', key: 'bu' },
  { header: 'Practice', key: 'practice' },
  { header: 'Region', key: 'region' },
  { header: 'Received', key: 'received_on', date: true },
  { header: 'Q&A due', key: 'qa_due', date: true },
  { header: 'Submission due', key: 'submission_due', date: true },
  { header: 'Submitted', key: 'submitted_on', date: true },
  { header: 'Expected decision', key: 'expected_decision_on', date: true },
  { header: 'Closed', key: 'closed_on', date: true },
  { header: 'Age (days)', key: 'age' },
  { header: 'Days in stage', key: 'inStage' },
  { header: 'Currency', key: 'currency' },
  { header: 'Est. value', key: 'est_value', money: true },
  { header: 'Probability %', key: 'probability' },
  { header: 'Weighted value', key: 'weighted', money: true },
  { header: 'Effort (PM)', key: 'effort_person_months' },
  { header: 'Duration (months)', key: 'duration_months' },
  { header: 'Pricing model', key: 'pricing_model' },
  { header: 'Incumbent', key: 'incumbent' },
  { header: 'Competitors', key: 'competitors' },
  { header: 'Next action', key: 'next_action' },
  { header: 'Next action due', key: 'next_action_due', date: true },
  { header: 'Outcome reason', key: 'outcome_reason' },
];

/** '2026-10-16' → a UTC Date, so Excel shows the same day everywhere. */
function toDate(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** The values for one row, keyed by column key. */
function rowValues(r, store) {
  const d = r.deal;
  const name = (id) => store.getPerson(id)?.name ?? '';
  return {
    id: d.id,
    title: d.title,
    customer: r.customerName,
    c4c_id: d.c4c_id ?? '',
    stage: d.stage,
    status: r.status,
    priority: d.priority,
    health: r.health.level,
    sales: name(d.sales_owner_id),
    presales: name(d.presales_owner_id),
    delivery: name(d.delivery_owner_id),
    supporters: d.support_ids.map(name).filter(Boolean).join(', '),
    open_asks: openAsks(d).length,
    bu: d.bu ?? '',
    practice: d.practice ?? '',
    region: d.region ?? '',
    received_on: toDate(d.received_on),
    qa_due: toDate(d.qa_due),
    submission_due: toDate(d.submission_due),
    submitted_on: toDate(d.submitted_on),
    expected_decision_on: toDate(d.expected_decision_on),
    closed_on: toDate(d.closed_on),
    age: r.age,
    inStage: r.inStage,
    currency: d.currency,
    est_value: d.est_value,
    probability: d.probability,
    weighted: r.weighted,
    effort_person_months: d.effort_person_months,
    duration_months: d.duration_months,
    pricing_model: d.pricing_model ?? '',
    incumbent: d.incumbent ?? '',
    competitors: d.competitors.join(', '),
    next_action: d.next_action ?? '',
    next_action_due: toDate(d.next_action_due),
    outcome_reason: d.outcome_reason ?? '',
    tags: d.tags.join(', '),
  };
}

/**
 * Builds the workbook: one 'Deals' sheet, bold header, frozen top row, autofilter.
 * @param {Array<object>} rows rows from the deals list (see routes.js dealRow)
 * @param {import('./store.js').Store} store
 * @returns {Promise<Buffer>}
 */
export async function dealsWorkbook(rows, store) {
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Deals');
  sheet.columns = COLUMNS.map((c) => ({ header: c.header, key: c.key }));

  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNS.length } };

  for (const r of rows) sheet.addRow(rowValues(r, store));

  COLUMNS.forEach((col, index) => {
    const colNumber = index + 1;
    if (col.date || col.money) {
      for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
        sheet.getCell(rowNumber, colNumber).numFmt = col.date ? DATE : MONEY;
      }
    }
    const longest = sheet.getColumn(colNumber).values.reduce((max, v) => {
      const text = v instanceof Date ? DATE : String(v ?? '');
      return Math.max(max, text.length);
    }, 0);
    sheet.getColumn(colNumber).width = Math.min(Math.max(longest, col.header.length) + 2, 50);
  });

  return workbook.xlsx.writeBuffer();
}
