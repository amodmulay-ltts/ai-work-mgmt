/**
 * Turns a change to an opportunity into history entries and a commit message (PLAN.md §9).
 */
import { DATE_FIELDS } from './models.js';
import { fmtDate } from './lib/format.js';

/** Labels for the timeline, the commit messages and the form fields. */
export const FIELD_LABELS = {
  title: 'Title',
  type: 'Type',
  source: 'Source',
  description: 'Description',
  customer_id: 'Customer',
  contact_ids: 'Contacts',
  c4c_id: 'C4C ID',
  sales_owner_id: 'Sales owner',
  presales_owner_id: 'Presales owner',
  delivery_owner_id: 'Delivery owner',
  bu: 'BU',
  practice: 'Practice',
  region: 'Region',
  priority: 'Priority',
  go_no_go: 'Go / No-Go',
  go_no_go_on: 'Go / No-Go date',
  received_on: 'Received on',
  qa_due: 'Q&A due',
  submission_due: 'Submission due',
  submitted_on: 'Submitted on',
  expected_decision_on: 'Expected decision',
  expected_start_on: 'Expected start',
  closed_on: 'Closed on',
  currency: 'Currency',
  est_value: 'Estimated value',
  effort_person_months: 'Effort (person-months)',
  duration_months: 'Duration (months)',
  pricing_model: 'Pricing model',
  incumbent: 'Incumbent',
  competitors: 'Competitors',
  outcome_reason: 'Outcome reason',
  next_action: 'Next action',
  next_action_due: 'Next action due',
  tags: 'Tags',
  links: 'Links',
  probability: 'Probability',
};

/** Fields that are never logged. */
// Supporter and ask changes write their own history entries (support.js), so they are not diffed here.
const SKIPPED = new Set([
  'history', 'created_at', 'updated_at', 'schema_version', 'id', 'support_ids', 'support_requests', 'support_seq',
]);
const PERSON_FIELDS = new Set(['sales_owner_id', 'presales_owner_id', 'delivery_owner_id']);

/** How a value is shown in the timeline and in the commit message. */
function show(field, value, lookup, { raw = false } = {}) {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value) && value.length === 0) return '—';
  if (field === 'links') return value.map((l) => l.label).join(', ');
  if (field === 'contact_ids') return value.map((id) => lookup.people.get(id)?.name ?? id).join(', ');
  if (PERSON_FIELDS.has(field) || field === 'account_manager_id') {
    return lookup.people.get(value)?.name ?? value;
  }
  if (field === 'customer_id') return lookup.customers.get(value)?.name ?? value;
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (DATE_FIELDS.includes(field)) return raw ? value : fmtDate(value);
  return String(value);
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Changed field names between two deals. Probability is left out when the stage changed,
 * because it follows the stage automatically.
 */
function changedFields(oldDeal, newDeal) {
  const keys = new Set([...Object.keys(oldDeal), ...Object.keys(newDeal)]);
  const changed = [...keys].filter((k) => !SKIPPED.has(k) && !same(oldDeal[k], newDeal[k]));
  if (changed.includes('stage')) return changed.filter((k) => k !== 'probability');
  return changed;
}

/**
 * Entries for a change, and the commit summary.
 * @param {object | null} oldDeal  null for a new opportunity
 * @param {object} newDeal
 * @param {{ people: Map<string, object>, customers: Map<string, object>, at?: string }} lookup
 * @returns {{ entries: object[], summary: string }}
 */
export function diff(oldDeal, newDeal, lookup) {
  const at = lookup.at ?? newDeal.updated_at;
  if (!oldDeal) {
    return {
      entries: [{ at, kind: 'created', text: 'Opportunity created', from_value: null, to_value: null }],
      summary: `created – ${newDeal.title}`,
    };
  }

  const entries = [];
  const fields = changedFields(oldDeal, newDeal);
  for (const field of fields) {
    if (field === 'stage') {
      entries.push({
        at,
        kind: 'stage',
        text: `Stage: ${oldDeal.stage} → ${newDeal.stage}`,
        from_value: oldDeal.stage,
        to_value: newDeal.stage,
      });
    } else if (field === 'on_hold') {
      entries.push({
        at,
        kind: 'hold',
        text: newDeal.on_hold ? 'Put on hold' : 'Resumed',
        from_value: String(oldDeal.on_hold),
        to_value: String(newDeal.on_hold),
      });
    } else if (field === 'description') {
      entries.push({ at, kind: 'field', text: 'Description updated', from_value: null, to_value: null });
    } else {
      const label = FIELD_LABELS[field] ?? field;
      const from = show(field, oldDeal[field], lookup);
      const to = show(field, newDeal[field], lookup);
      entries.push({
        at,
        kind: 'field',
        text: `${label}: ${from} → ${to}`,
        from_value: from,
        to_value: to,
      });
    }
  }

  return { entries, summary: summarise(oldDeal, newDeal, fields, lookup) };
}

function summarise(oldDeal, newDeal, fields, lookup) {
  if (fields.length === 0) return 'no changes';
  if (fields.length === 1 && fields[0] === 'stage') {
    return `stage ${oldDeal.stage} → ${newDeal.stage}`;
  }
  if (fields.length === 1) {
    const field = fields[0];
    const label = (FIELD_LABELS[field] ?? field).toLowerCase();
    const from = show(field, oldDeal[field], lookup, { raw: true });
    const to = show(field, newDeal[field], lookup, { raw: true });
    return `${label} ${from} → ${to}`;
  }
  return `updated ${fields.length} fields`;
}

/** A note entry for the timeline. */
export function noteEntry(text, at) {
  return { at, kind: 'note', text, from_value: null, to_value: null };
}
