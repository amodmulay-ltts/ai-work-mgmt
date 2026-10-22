/**
 * Excel export of the opportunities list (PLAN.md §12.1). Uses exceljs.
 */
import ExcelJS from 'exceljs';
import { openAsks } from './metrics.js';

const DATE = 'dd-mmm-yyyy';
const MONEY = '#,##0';

/** Column definitions, in the order of §12.1. `date` and `money` set the cell format. */
const COLUMNS = [
  { header: 'ID', key: 'id' },
  { header: 'Title', key: 'title' },
  { header: 'Type', key: 'type' },
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
  { header: 'Tags', key: 'tags' },
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
    type: d.type,
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
 * Builds the workbook: one 'Opportunities' sheet, bold header, frozen top row, autofilter.
 * @param {Array<object>} rows rows from the opportunities list (see routes.js dealRow)
 * @param {import('./store.js').Store} store
 * @returns {Promise<Buffer>}
 */
export async function dealsWorkbook(rows, store) {
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Opportunities');
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

/** The pipeline share sheet, with the headers the sales team asked for, in that order. */
const PIPELINE_COLUMNS = [
  { header: 'Region', key: 'region' },
  { header: 'Vertical', key: 'vertical' },
  { header: 'Sales/ ARM', key: 'sales' },
  { header: 'Account', key: 'account' },
  { header: 'Opportunity Name (schedule)', key: 'title' },
  { header: 'C4C Id', key: 'c4c_id' },
  { header: 'Sales Phase', key: 'stage' },
  { header: 'Close Month', key: 'close_month', month: true },
  { header: 'TCV ($Mn)', key: 'tcv', decimal: '0.00' },
  { header: 'Tenure (Y)', key: 'tenure', decimal: '0.0' },
  { header: 'Status', key: 'status' },
  { header: 'Remarks', key: 'remarks' },
];

/** One pipeline row. TCV is the estimated value in millions of the opportunity's currency (no conversion). */
function pipelineValues(r, store) {
  const d = r.deal;
  const customer = store.getCustomer(d.customer_id);
  const closeDate = d.closed_on ?? d.expected_decision_on;
  return {
    region: d.region ?? '',
    vertical: customer?.industry ?? '',
    sales: store.getPerson(d.sales_owner_id)?.name ?? '',
    account: r.customerName,
    title: d.title,
    c4c_id: d.c4c_id ?? '',
    stage: d.stage,
    close_month: toDate(closeDate),
    tcv: d.est_value == null ? null : d.est_value / 1_000_000,
    tenure: d.duration_months == null ? null : d.duration_months / 12,
    status: r.status,
    remarks: d.next_action ?? '',
  };
}

/**
 * The pipeline sheet for sharing: one 'Pipeline' sheet, with the columns in PIPELINE_COLUMNS order.
 * @param {Array<object>} rows rows from the opportunities list (see routes.js dealRow)
 * @returns {Promise<Buffer>}
 */
export async function pipelineWorkbook(rows, store) {
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Pipeline');
  sheet.columns = PIPELINE_COLUMNS.map((c) => ({ header: c.header, key: c.key }));

  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: PIPELINE_COLUMNS.length } };

  for (const r of rows) sheet.addRow(pipelineValues(r, store));

  PIPELINE_COLUMNS.forEach((col, index) => {
    const colNumber = index + 1;
    if (col.month || col.decimal) {
      for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
        sheet.getCell(rowNumber, colNumber).numFmt = col.month ? 'mmm-yyyy' : col.decimal;
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
