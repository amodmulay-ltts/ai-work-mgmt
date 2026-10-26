/**
 * Connects with a customer (PLAN.md §16, extended in §19): Teams meetings, and visits to the EI centre or to the
 * customer's premises. A customer keeps a list of dated entries in `connects`. A visit can be Planned (today or
 * later) or Done (today or earlier). Entries from before the status field have no status and count as Done.
 * Calls and emails are not connects.
 */
import { daysBetween } from '../metrics.js';

export const CONNECT_KINDS = ['Teams', 'EI center visit', 'Customer premises visit', 'Visit'];
export const VISIT_KINDS = ['EI center visit', 'Customer premises visit', 'Visit'];
export const CONNECT_STATUSES = ['Planned', 'Done'];
export const CONNECT_WITH_MAX = 100;
export const CONNECT_NOTE_MAX = 500;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Older customer files have no `connects`. They load with an empty list, and nothing else changes. */
export function withConnectDefaults(customer) {
  return { ...customer, connects: Array.isArray(customer.connects) ? customer.connects : [] };
}

/** An entry without a status is a past connect, so it is Done. */
export const isDone = (c) => (c.status ?? 'Done') === 'Done';
export const isVisit = (c) => VISIT_KINDS.includes(c.kind);

/** Checks the fields of one stored connect. Returns the errors (empty when it is valid). */
export function connectErrors(entry) {
  const errors = [];
  if (!DATE_RE.test(entry.on ?? '')) errors.push('Connect date is not valid');
  if (!CONNECT_KINDS.includes(entry.kind)) errors.push(`Connect kind: unknown value '${entry.kind}'`);
  if (entry.status !== undefined && !CONNECT_STATUSES.includes(entry.status)) {
    errors.push(`Connect status: unknown value '${entry.status}'`);
  }
  return errors;
}

/**
 * Builds one connect from a form. `people` are the active people who may be picked as ours.
 * A Done connect cannot be in the future; a Planned one cannot be in the past.
 * @returns {{ entry: object | null, errors: string[] }}
 */
export function newConnect(input, { id, people, today }) {
  const errors = [];
  const on = String(input.on ?? '').trim();
  if (!DATE_RE.test(on)) errors.push('Pick the date of the connect.');
  const kind = String(input.kind ?? '').trim();
  if (!CONNECT_KINDS.includes(kind)) errors.push('Pick the kind of connect.');
  const status = String(input.status ?? '').trim() || 'Done';
  if (!CONNECT_STATUSES.includes(status)) errors.push('Pick Planned or Done.');
  if (DATE_RE.test(on)) {
    if (status === 'Done' && on > today) errors.push('A completed connect cannot be in the future. Mark it Planned instead.');
    if (status === 'Planned' && on < today) errors.push('A planned visit must be today or later.');
  }
  const whoId = String(input.who_id ?? '').trim() || null;
  if (whoId && !people.some((p) => p.id === whoId)) errors.push('Pick a person from the list.');
  const withWho = String(input.with ?? '').trim();
  if (withWho.length > CONNECT_WITH_MAX) errors.push(`Who you met is longer than ${CONNECT_WITH_MAX} characters.`);
  const note = String(input.note ?? '').trim();
  if (note.length > CONNECT_NOTE_MAX) errors.push(`The note is longer than ${CONNECT_NOTE_MAX} characters.`);
  if (errors.length) return { entry: null, errors };
  return {
    entry: { id, on, kind, status, who_id: whoId, with: withWho, note, created_at: new Date().toISOString() },
    errors: [],
  };
}

/** First and last DONE connect dates, and how many there are. Dates are 'YYYY-MM-DD', so they sort as text. */
export function connectSummary(connects = []) {
  const dates = connects.filter(isDone).map((c) => c.on).sort();
  if (!dates.length) return { first: null, last: null, count: 0 };
  return { first: dates[0], last: dates.at(-1), count: dates.length };
}

/**
 * Whether a customer needs a connect: never connected, or the last Done one is older than `afterDays`.
 * @returns {{ last: string | null, flagged: boolean, text: string }}
 */
export function connectState(customer, today, afterDays) {
  const { last } = connectSummary(customer.connects);
  if (last === null) return { last, flagged: true, text: 'Never connected' };
  const days = daysBetween(last, today);
  const flagged = days > afterDays;
  return { last, flagged, text: days === 0 ? 'Connected today' : `${days} days ago` };
}

/** Planned connects on or after today, soonest first. */
export function plannedConnects(connects, today) {
  return connects.filter((c) => !isDone(c) && c.on >= today).sort((a, b) => a.on.localeCompare(b.on));
}

/**
 * Completed visits to the EI centre or a customer's premises, in total and in `year`.
 * @returns {{ total: number, inYear: number }}
 */
export function visitCounts(connects, year) {
  const done = connects.filter((c) => isDone(c) && isVisit(c));
  return { total: done.length, inYear: done.filter((c) => c.on.startsWith(String(year))).length };
}
