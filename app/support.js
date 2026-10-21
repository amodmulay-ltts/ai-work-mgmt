/**
 * Supporters and asks for "RFQs I support" (PLAN.md §15). Pure functions: each returns a
 * new opportunity object and never touches the disk. The routes save the result in one commit.
 */
import { ASK_STATUSES } from './models.js';

const pad3 = (n) => String(n).padStart(3, '0');

/**
 * A new ask on an opportunity. `support_seq` is the last number used, so a removed ask's number is never reused.
 * @returns {{ deal: object, ask: object }}
 */
export function addAsk(deal, { text, assignee_id = null, due_on = null }, now) {
  const seq = deal.support_seq + 1;
  const ask = {
    id: `SR-${pad3(seq)}`,
    text,
    assignee_id,
    requested_by_id: null,
    due_on,
    status: 'Open',
    done_on: null,
    created_at: now,
    updated_at: now,
  };
  return { deal: { ...deal, support_seq: seq, support_requests: [...deal.support_requests, ask] }, ask };
}

/**
 * Changes some of an ask's fields. Only the keys given are changed. done_on is set when
 * the status becomes Done and cleared when it leaves Done (PLAN.md §4.3 rule).
 * @param {string} askId
 * @param {{ text?: string, assignee_id?: string | null, due_on?: string | null, status?: string }} changes
 * @param {{ today: string, now: string }} when
 */
export function changeAsk(deal, askId, changes, { today, now }) {
  const before = findAsk(deal, askId);
  if (changes.status !== undefined && !ASK_STATUSES.includes(changes.status)) {
    throw new Error(`Unknown status '${changes.status}'`);
  }
  const status = changes.status ?? before.status;
  let done_on = before.done_on;
  if (status === 'Done' && before.status !== 'Done') done_on = today;
  if (status !== 'Done') done_on = null;
  const after = { ...before, ...changes, status, done_on, updated_at: now };
  return { ...deal, support_requests: deal.support_requests.map((a) => (a.id === askId ? after : a)) };
}

/** Removes an ask. The seq counter is kept, so the number is not reused. */
export function removeAsk(deal, askId) {
  findAsk(deal, askId);
  return { ...deal, support_requests: deal.support_requests.filter((a) => a.id !== askId) };
}

export function findAsk(deal, askId) {
  const ask = deal.support_requests.find((a) => a.id === askId);
  if (!ask) throw new Error(`Ask ${askId} was not found`);
  return ask;
}

const FIELD_NAMES = { text: 'text', assignee_id: 'assignee', due_on: 'due date' };

/**
 * History entries for an ask change. `names` maps a person id to a name for the assignee text.
 * @param {object | null} before null when the ask is new
 * @param {object} after
 * @param {{ at: string, names?: (id: string) => string }} options
 * @returns {Array<{ at: string, kind: 'field', text: string, from_value: null, to_value: null }>}
 */
export function askEntries(before, after, { at, names = (id) => id }) {
  const entry = (text) => ({ at, kind: 'field', text, from_value: null, to_value: null });
  if (!before) return [entry(`Ask ${after.id} added: ${after.text}`)];
  const entries = [];
  if (before.status !== after.status) entries.push(entry(`Ask ${after.id}: ${before.status} → ${after.status}`));
  const changed = Object.keys(FIELD_NAMES).filter((k) => before[k] !== after[k]);
  if (changed.length) {
    const label = (k) => {
      if (k !== 'assignee_id') return FIELD_NAMES[k];
      return after.assignee_id ? `assignee → ${names(after.assignee_id)}` : 'assignee cleared';
    };
    entries.push(entry(`Ask ${after.id} updated: ${changed.map(label).join(', ')}`));
  }
  return entries;
}

/** Ask-less removal entry, for the timeline. */
export function removedEntry(ask, at) {
  return { at, kind: 'field', text: `Ask ${ask.id} removed: ${ask.text}`, from_value: null, to_value: null };
}

/**
 * Supporters change: adds or removes one person. Owners can not also be supporters.
 * @returns {{ deal: object, entry: object, error: string | null }}
 */
export function changeSupporters(deal, { action, person, owners, at, names }) {
  const none = { deal, entry: null };
  if (action === 'remove') {
    if (!deal.support_ids.includes(person.id)) return { ...none, error: `${person.name} is not a supporter.` };
    const support_ids = deal.support_ids.filter((id) => id !== person.id);
    return { deal: { ...deal, support_ids }, ...supporterEntry(deal, support_ids, at, names), error: null };
  }
  if (action !== 'add') return { ...none, error: 'Unknown action.' };
  if (owners.includes(person.id)) return { ...none, error: `${person.name} already owns this opportunity.` };
  if (deal.support_ids.includes(person.id)) return { ...none, error: `${person.name} is already a supporter.` };
  const support_ids = [...deal.support_ids, person.id];
  return { deal: { ...deal, support_ids }, ...supporterEntry(deal, support_ids, at, names), error: null };
}

function supporterEntry(before, after, at, names) {
  const list = (ids) => (ids.length ? ids.map(names).join(', ') : '—');
  const entry = {
    at,
    kind: 'field',
    text: `Supporters: ${list(before.support_ids)} → ${list(after)}`,
    from_value: null,
    to_value: null,
  };
  return { entry };
}
