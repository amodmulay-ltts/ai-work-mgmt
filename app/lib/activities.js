/**
 * Internal activities: prototypes, concepts and AI solutions that are not customer opportunities
 * (PLAN.md §17). They have no customer and no pipeline stage. Each keeps a dated list of updates.
 */
import { randomUUID } from 'node:crypto';
import { daysBetween } from '../metrics.js';

export const ACTIVITY_KINDS = ['Prototype', 'Concept', 'AI solution', 'Other'];
export const ACTIVITY_STATUSES = ['Idea', 'In progress', 'On hold', 'Done', 'Stopped'];
export const OPEN_ACTIVITY_STATUSES = ['Idea', 'In progress', 'On hold'];
export const TITLE_MAX = 120;
export const DESCRIPTION_MAX = 2000;
export const UPDATE_MAX = 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const URL_RE = /^https?:\/\/\S+$/;

/**
 * Turns a form into an activity's fields. The id and dates of the record are set by the caller.
 * @returns {{ typed: object | null, errors: Record<string, string> }}
 */
export function parseActivityForm(values) {
  const errors = {};
  const text = (key) => String(values[key] ?? '').trim();
  const title = text('title');
  if (!title) errors.title = 'Title is required';
  else if (title.length > TITLE_MAX) errors.title = `Title is longer than ${TITLE_MAX} characters`;
  const kind = text('kind');
  if (!ACTIVITY_KINDS.includes(kind)) errors.kind = 'Pick a kind';
  const status = text('status') || 'Idea';
  if (!ACTIVITY_STATUSES.includes(status)) errors.status = 'Pick a status';
  const startOn = text('start_on') || null;
  const targetOn = text('target_on') || null;
  if (startOn && !DATE_RE.test(startOn)) errors.start_on = 'Enter a valid date';
  if (targetOn && !DATE_RE.test(targetOn)) errors.target_on = 'Enter a valid date';
  if (startOn && targetOn && DATE_RE.test(startOn) && DATE_RE.test(targetOn) && targetOn < startOn) {
    errors.target_on = 'The target date is before the start date';
  }
  const description = text('description');
  if (description.length > DESCRIPTION_MAX) errors.description = `Description is longer than ${DESCRIPTION_MAX} characters`;
  const links = text('links').split('\n').map((l) => l.trim()).filter(Boolean);
  if (links.some((l) => !URL_RE.test(l))) errors.links = 'Each link must start with http:// or https://';
  const tags = [...new Set(text('tags').split(',').map((t) => t.trim()).filter(Boolean))];
  if (Object.keys(errors).length) return { typed: null, errors };
  return {
    typed: {
      title,
      kind,
      status,
      owner_id: text('owner_id') || null,
      start_on: startOn,
      target_on: targetOn,
      description,
      links,
      tags,
    },
    errors,
  };
}

/** A dated update, from the update form. Returns an error message instead when the text is not usable. */
export function newActivityUpdate(input, { at, today }) {
  const text = String(input.text ?? '').trim();
  if (!text) return { update: null, error: 'Write what happened before adding the update.' };
  if (text.length > UPDATE_MAX) return { update: null, error: `The update is longer than ${UPDATE_MAX} characters.` };
  const date = String(input.on ?? '').trim() || today;
  if (!DATE_RE.test(date)) return { update: null, error: 'Pick a valid date for the update.' };
  if (date > today) return { update: null, error: 'An update cannot be dated in the future.' };
  return { update: { id: randomUUID().slice(0, 8), on: date, text, created_at: at }, error: null };
}

/** Checks the stored shape of an activity. Returns error messages (empty when valid). */
export function activityErrors(a) {
  const errors = [];
  if (!/^AC-\d{4}$/.test(a.id ?? '')) errors.push('id must look like AC-0001');
  if (!a.title || !String(a.title).trim()) errors.push('Title is required');
  if (!ACTIVITY_KINDS.includes(a.kind)) errors.push(`Kind: unknown value '${a.kind}'`);
  if (!ACTIVITY_STATUSES.includes(a.status)) errors.push(`Status: unknown value '${a.status}'`);
  for (const u of a.updates ?? []) {
    if (!DATE_RE.test(u.on ?? '') || !String(u.text ?? '').trim()) errors.push('An update needs a date and text');
  }
  return errors;
}

/**
 * The date of the latest update, or the day the activity was created when it has none.
 * @returns {string} 'YYYY-MM-DD'
 */
export function lastTouched(activity) {
  const dates = [activity.created_at.slice(0, 10), ...(activity.updates ?? []).map((u) => u.on)].sort();
  return dates.at(-1);
}

/**
 * Whether an in-progress activity has gone quiet: no update for longer than `staleDays`.
 * Activities that are not in progress are never flagged.
 * @returns {{ last: string, days: number, quiet: boolean }}
 */
export function activityQuiet(activity, today, staleDays) {
  const last = lastTouched(activity);
  const days = daysBetween(last, today);
  return { last, days, quiet: activity.status === 'In progress' && days > staleDays };
}
