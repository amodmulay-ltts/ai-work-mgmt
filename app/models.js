/**
 * Record shapes and validation. Records are plain objects; keys are written in
 * the order of the typedefs so the JSON files stay stable.
 * Dates are 'YYYY-MM-DD' strings and timestamps are ISO-8601 strings with offset.
 * PLAN.md §5.1 is the reference for every field.
 */

/**
 * @typedef {{ label: string, url: string }} Link
 *
 * @typedef {{
 *   id: string, text: string, assignee_id: string | null, requested_by_id: string | null,
 *   due_on: string | null, status: 'Open' | 'In progress' | 'Done' | 'Cancelled',
 *   done_on: string | null, created_at: string, updated_at: string
 * }} SupportRequest
 *
 * @typedef {{
 *   at: string,
 *   kind: 'created' | 'stage' | 'hold' | 'field' | 'note',
 *   text: string,
 *   from_value: string | null,
 *   to_value: string | null
 * }} HistoryEntry
 *
 * @typedef {{
 *   schema_version: number, id: string, title: string, source: string | null,
 *   description: string, customer_id: string, contact_ids: string[], c4c_id: string | null,
 *   sales_owner_id: string | null, presales_owner_id: string | null, delivery_owner_id: string | null,
 *   support_ids: string[], support_requests: SupportRequest[], support_seq: number,
 *   bu: string | null, practice: string | null, region: string | null, stage: string, on_hold: boolean,
 *   probability: number, priority: 'High' | 'Medium' | 'Low', go_no_go: 'Pending' | 'Go' | 'No-Go',
 *   go_no_go_on: string | null, received_on: string, qa_due: string | null, submission_due: string | null,
 *   submitted_on: string | null, expected_decision_on: string | null, expected_start_on: string | null,
 *   closed_on: string | null, currency: string, est_value: number | null,
 *   effort_person_months: number | null, duration_months: number | null, pricing_model: string | null,
 *   incumbent: string | null, competitors: string[], outcome_reason: string | null,
 *   next_action: string | null, next_action_due: string | null, tags: string[], links: Link[],
 *   history: HistoryEntry[], created_at: string, updated_at: string
 * }} Deal
 *
 * @typedef {{
 *   schema_version: number, id: string, name: string, short_name: string | null, industry: string | null,
 *   region: string | null, country: string | null, bu: string | null, account_manager_id: string | null,
 *   c4c_account_id: string | null, website: string | null, tags: string[], notes: string,
 *   created_at: string, updated_at: string
 * }} Customer
 *
 * @typedef {'Sales' | 'Presales' | 'Delivery' | 'Leadership' | 'Customer' | 'Partner' | 'Other'} Role
 *
 * @typedef {{
 *   schema_version: number, id: string, name: string, role: Role, title: string | null,
 *   email: string | null, phone: string | null, customer_id: string | null, notes: string,
 *   active: boolean, created_at: string, updated_at: string
 * }} Person
 */

export const ROLES = ['Sales', 'Presales', 'Delivery', 'Leadership', 'Customer', 'Partner', 'Other'];
export const PRIORITIES = ['High', 'Medium', 'Low'];
export const GO_NO_GO = ['Pending', 'Go', 'No-Go'];
export const ASK_STATUSES = ['Open', 'In progress', 'Done', 'Cancelled'];
/** Deal fields added for "RFQs I support" (PLAN.md §15.1). Files written before them get these. */
const SUPPORT_DEFAULTS = { support_ids: [], support_requests: [], support_seq: 0 };

/**
 * Older deals had one fixed 'type' (RFQ, RFI, …). It is now a tag, so the type becomes the first tag.
 * Returns the opportunity without the type key.
 */
export function migrateDealType(deal) {
  if (!('type' in deal)) return deal;
  const { type, ...rest } = deal;
  const tags = Array.isArray(rest.tags) ? rest.tags : [];
  const merged = type && !tags.some((t) => t.toLowerCase() === String(type).toLowerCase()) ? [type, ...tags] : tags;
  return { ...rest, tags: merged };
}

/** Adds the support fields to an opportunity read from an older file. Returns the same object. */
export function withSupportDefaults(deal) {
  for (const [key, value] of Object.entries(SUPPORT_DEFAULTS)) {
    if (!(key in deal)) deal[key] = structuredClone(value);
  }
  return deal;
}
/** Deal fields that hold a 'YYYY-MM-DD' date. */
export const DATE_FIELDS = [
  'received_on', 'qa_due', 'submission_due', 'submitted_on', 'expected_decision_on',
  'expected_start_on', 'closed_on', 'go_no_go_on', 'next_action_due',
];

const PREFIX = { deal: 'DL', customer: 'CU', person: 'PE' };
const EMAIL_RE = /^[^@\s]+@[^@\s]+$/;
const URL_RE = /^https?:\/\/\S+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class ValidationError extends Error {
  /** @param {string[]} errors */
  constructor(errors) {
    super(errors.join('; '));
    this.errors = errors;
  }
}

/** @param {string} id @returns {'deal' | 'customer' | 'person'} */
export function kindOf(id) {
  const entry = Object.entries(PREFIX).find(([, prefix]) => id.startsWith(`${prefix}-`));
  if (!entry) throw new Error(`Unknown record id: ${id}`);
  return /** @type {'deal' | 'customer' | 'person'} */ (entry[0]);
}

export { PREFIX };

/** @returns {string} local time with seconds precision and offset, e.g. 2026-10-16T10:43:00+05:30 */
export function nowIso() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const offset = -d.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/** @returns {string} today's local date as YYYY-MM-DD */
export function todayIso() {
  return nowIso().slice(0, 10);
}

/** True for a real calendar date written as YYYY-MM-DD. */
export function isIsoDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

const isBlank = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

/**
 * Checks one record. Returns error messages; an empty array means valid.
 * Enum lists come from the config and are checked only when `cfg` is given. Files
 * loaded from disk are checked without `cfg`, so a later config edit cannot hide a record.
 * @param {'deal' | 'customer' | 'person'} kind
 * @param {Record<string, any>} obj
 * @param {Record<string, any> | null} [cfg]
 * @returns {string[]}
 */
export function validateRecord(kind, obj, cfg = null) {
  if (kind === 'person') return validatePerson(obj);
  if (kind === 'customer') return validateCustomer(obj, cfg);
  return validateDeal(obj, cfg);
}

function validatePerson(p) {
  const errors = [];
  if (!/^PE-\d{4}$/.test(p.id ?? '')) errors.push('id must look like PE-0001');
  if (isBlank(p.name)) errors.push('name is required');
  if (!ROLES.includes(p.role)) errors.push(`role: unknown value '${p.role}'`);
  if (p.role === 'Customer' && !p.customer_id) errors.push('customer_id is required for role Customer');
  if (p.email && !EMAIL_RE.test(p.email)) errors.push('email is not valid');
  if (typeof p.active !== 'boolean') errors.push('active must be true or false');
  return errors;
}

function validateCustomer(c, cfg) {
  const errors = [];
  if (!/^CU-\d{4}$/.test(c.id ?? '')) errors.push('id must look like CU-0001');
  if (isBlank(c.name)) errors.push('Name is required');
  if (c.website && !URL_RE.test(c.website)) errors.push('Website must start with http:// or https://');
  if (cfg) {
    if (c.region && !cfg.regions.includes(c.region)) errors.push(`Region: unknown value '${c.region}'`);
    if (c.bu && !cfg.business_units.includes(c.bu)) errors.push(`BU: unknown value '${c.bu}'`);
  }
  return errors;
}

/** Supporters and asks (PLAN.md §15.1). Existence of the people is checked by the routes, not here. */
function validateSupport(d) {
  const errors = [];
  if (!Array.isArray(d.support_ids) || d.support_ids.some((id) => !/^PE-\d{4}$/.test(id ?? ''))) {
    errors.push('support_ids must be a list of person ids');
  } else if (new Set(d.support_ids).size !== d.support_ids.length) {
    errors.push('support_ids has the same person twice');
  }
  if (!Number.isInteger(d.support_seq) || d.support_seq < 0) errors.push('support_seq must be a whole number');
  if (!Array.isArray(d.support_requests)) return [...errors, 'support_requests must be a list'];

  const seen = new Set();
  for (const ask of d.support_requests) {
    const label = ask?.id ?? '?';
    if (!/^SR-\d{3,}$/.test(label)) errors.push(`ask id '${label}' must look like SR-001`);
    if (seen.has(label)) errors.push(`ask ${label} appears twice`);
    seen.add(label);
    if (isBlank(ask?.text)) errors.push(`ask ${label}: text is required`);
    if (!ASK_STATUSES.includes(ask?.status)) errors.push(`ask ${label}: unknown status '${ask?.status}'`);
    if (ask?.due_on != null && !isIsoDate(ask.due_on)) errors.push(`ask ${label}: due date is not valid`);
    if (ask?.done_on != null && !isIsoDate(ask.done_on)) errors.push(`ask ${label}: done date is not valid`);
    if (ask?.assignee_id != null && !/^PE-\d{4}$/.test(ask.assignee_id)) errors.push(`ask ${label}: assignee is not a person`);
  }
  return errors;
}

function validateDeal(d, cfg) {
  const errors = [];
  const required = (field, label) => {
    if (isBlank(d[field])) errors.push(`${label} is required`);
  };
  if (!/^DL-\d{4}-\d{4}$/.test(d.id ?? '')) errors.push('id must look like DL-2026-0001');
  required('title', 'Title');
  required('customer_id', 'Customer');
  required('stage', 'Stage');
  required('received_on', 'Received on');

  for (const field of DATE_FIELDS) {
    if (d[field] != null && !isIsoDate(d[field])) errors.push(`${field}: not a valid date`);
  }
  if (d.submission_due && d.received_on && d.submission_due < d.received_on) {
    errors.push('Submission due must be on or after received on');
  }
  if (d.qa_due && d.received_on && d.qa_due < d.received_on) {
    errors.push('Q&A due must be on or after received on');
  }
  if (!Number.isInteger(d.probability) || d.probability < 0 || d.probability > 100) {
    errors.push('Probability must be a whole number from 0 to 100');
  }
  const amounts = { est_value: 'Estimated value', effort_person_months: 'Effort', duration_months: 'Duration' };
  for (const [field, label] of Object.entries(amounts)) {
    if (d[field] != null && (!Number.isFinite(d[field]) || d[field] < 0)) errors.push(`${label} must be 0 or more`);
  }
  if (typeof d.on_hold !== 'boolean') errors.push('on_hold must be true or false');
  if (!PRIORITIES.includes(d.priority)) errors.push(`priority: unknown value '${d.priority}'`);
  if (!GO_NO_GO.includes(d.go_no_go)) errors.push(`go_no_go: unknown value '${d.go_no_go}'`);
  for (const field of ['contact_ids', 'competitors', 'tags', 'links']) {
    if (!Array.isArray(d[field])) errors.push(`${field} must be a list`);
  }
  for (const link of Array.isArray(d.links) ? d.links : []) {
    if (!URL_RE.test(link.url ?? '')) errors.push(`Link '${link.label}' must start with http:// or https://`);
  }
  errors.push(...validateSupport(d));

  if (cfg) {
    const unknownTags = (Array.isArray(d.tags) ? d.tags : []).filter((t) => !cfg.tags.includes(t));
    for (const tag of unknownTags) errors.push(`Tag: unknown value '${tag}'`);
    const stage = cfg.stages.find((s) => s.name === d.stage);
    if (!stage && d.stage) errors.push(`Stage: unknown value '${d.stage}'`);
    if (stage && (stage.outcome === 'lost' || stage.outcome === 'dropped') && isBlank(d.outcome_reason)) {
      errors.push('An outcome reason is required for Lost and Dropped opportunities');
    }
    const checks = [
      ['source', cfg.sources, 'Source'],
      ['bu', cfg.business_units, 'BU'],
      ['region', cfg.regions, 'Region'],
      ['currency', cfg.currencies, 'Currency'],
      ['pricing_model', cfg.pricing_models, 'Pricing model'],
      ['outcome_reason', cfg.outcome_reasons, 'Outcome reason'],
    ];
    for (const [field, allowed, label] of checks) {
      if (d[field] != null && d[field] !== '' && !allowed.includes(d[field])) {
        errors.push(`${label}: unknown value '${d[field]}'`);
      }
    }
  }
  return errors;
}
