/**
 * Connects with a customer: time spent with them on a Teams meeting or a visit (PLAN.md §16).
 * A customer keeps a list of dated entries in `connects`. Calls and emails are not connects.
 */
import { daysBetween } from '../metrics.js';

export const CONNECT_KINDS = ['Teams', 'Visit'];
export const CONNECT_WITH_MAX = 100;
export const CONNECT_NOTE_MAX = 500;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Older customer files have no `connects`. They load with an empty list, and nothing else changes. */
export function withConnectDefaults(customer) {
  return { ...customer, connects: Array.isArray(customer.connects) ? customer.connects : [] };
}

/** Checks the fields of one connect. Returns the errors (empty when it is valid). */
export function connectErrors(entry) {
  const errors = [];
  if (!DATE_RE.test(entry.on ?? '')) errors.push('Connect date is not valid');
  if (!CONNECT_KINDS.includes(entry.kind)) errors.push(`Connect kind: unknown value '${entry.kind}'`);
  return errors;
}

/**
 * Builds one connect from a form. `people` are the active people who may be picked as ours.
 * @returns {{ entry: object | null, errors: string[] }}
 */
export function newConnect(input, { id, people, today }) {
  const errors = [];
  const on = String(input.on ?? '').trim();
  if (!DATE_RE.test(on)) errors.push('Pick the date of the connect.');
  else if (on > today) errors.push('The date of a connect cannot be in the future.');
  const kind = String(input.kind ?? '').trim();
  if (!CONNECT_KINDS.includes(kind)) errors.push('Pick Teams or Visit.');
  const whoId = String(input.who_id ?? '').trim() || null;
  if (whoId && !people.some((p) => p.id === whoId)) errors.push('Pick a person from the list.');
  const withWho = String(input.with ?? '').trim();
  if (withWho.length > CONNECT_WITH_MAX) errors.push(`Who you met is longer than ${CONNECT_WITH_MAX} characters.`);
  const note = String(input.note ?? '').trim();
  if (note.length > CONNECT_NOTE_MAX) errors.push(`The note is longer than ${CONNECT_NOTE_MAX} characters.`);
  if (errors.length) return { entry: null, errors };
  return { entry: { id, on, kind, who_id: whoId, with: withWho, note, created_at: new Date().toISOString() }, errors: [] };
}

/** First and last connect dates, and how many there are. Dates are 'YYYY-MM-DD', so they sort as text. */
export function connectSummary(connects = []) {
  if (!connects.length) return { first: null, last: null, count: 0 };
  const dates = connects.map((c) => c.on).sort();
  return { first: dates[0], last: dates.at(-1), count: connects.length };
}

/**
 * Whether a customer needs a connect: never connected, or the last one is older than `afterDays`.
 * @returns {{ last: string | null, flagged: boolean, text: string }}
 */
export function connectState(customer, today, afterDays) {
  const { last } = connectSummary(customer.connects);
  if (last === null) return { last, flagged: true, text: 'Never connected' };
  const days = daysBetween(last, today);
  const flagged = days > afterDays;
  return { last, flagged, text: days === 0 ? 'Connected today' : `${days} days ago` };
}
