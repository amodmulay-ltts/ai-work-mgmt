/**
 * Backlog: my own tasks and work to do (not customer opportunities). Each task moves through
 * Backlog, In progress, On hold and Done with Start, Put on hold, Finish and Reopen. A task keeps a
 * dated list of comments.
 */
import { randomUUID } from 'node:crypto';

export const TASK_STATUSES = ['Backlog', 'In progress', 'On hold', 'Done'];
export const OPEN_TASK_STATUSES = ['Backlog', 'In progress', 'On hold'];
export const TITLE_MAX = 120;
export const DESCRIPTION_MAX = 2000;
export const COMMENT_MAX = 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Each action, the statuses it works from, and the status it sets. */
export const TASK_ACTIONS = {
  start: { from: ['Backlog', 'On hold'], to: 'In progress', label: 'Start' },
  hold: { from: ['Backlog', 'In progress'], to: 'On hold', label: 'Put on hold' },
  finish: { from: ['Backlog', 'In progress', 'On hold'], to: 'Done', label: 'Finish' },
  reopen: { from: ['Done'], to: 'Backlog', label: 'Reopen' },
};

/**
 * Turns the task form into fields. The id and dates are set by the caller.
 * @returns {{ typed: object | null, errors: Record<string, string> }}
 */
export function parseTaskForm(values) {
  const errors = {};
  const text = (key) => String(values[key] ?? '').trim();
  const title = text('title');
  if (!title) errors.title = 'Title is required';
  else if (title.length > TITLE_MAX) errors.title = `Title is longer than ${TITLE_MAX} characters`;
  const dueOn = text('due_on') || null;
  if (dueOn && !DATE_RE.test(dueOn)) errors.due_on = 'Enter a valid date';
  const description = text('description');
  if (description.length > DESCRIPTION_MAX) errors.description = `Description is longer than ${DESCRIPTION_MAX} characters`;
  if (Object.keys(errors).length) return { typed: null, errors };
  return { typed: { title, description, due_on: dueOn }, errors };
}

/** A comment from the comment form. Returns an error message instead when the text is not usable. */
export function newTaskComment(input, { at, today }) {
  const text = String(input.text ?? '').trim();
  if (!text) return { comment: null, error: 'Write the comment first.' };
  if (text.length > COMMENT_MAX) return { comment: null, error: `The comment is longer than ${COMMENT_MAX} characters.` };
  return { comment: { id: randomUUID().slice(0, 8), on: today, text, created_at: at }, error: null };
}

/**
 * Applies an action to a task. Returns the changed task, or null when the action does not apply
 * to the task's current status.
 */
export function applyTaskAction(task, action, { at }) {
  const rule = TASK_ACTIONS[action];
  if (!rule || !rule.from.includes(task.status)) return null;
  return { ...task, status: rule.to, updated_at: at };
}

/** Checks the stored shape of a task. Returns error messages (empty when valid). */
export function taskErrors(t) {
  const errors = [];
  if (!/^TK-\d{4}$/.test(t.id ?? '')) errors.push('id must look like TK-0001');
  if (!t.title || !String(t.title).trim()) errors.push('Title is required');
  if (!TASK_STATUSES.includes(t.status)) errors.push(`Status: unknown value '${t.status}'`);
  if (t.due_on && !DATE_RE.test(t.due_on)) errors.push('Due date is not valid');
  for (const c of t.comments ?? []) {
    if (!DATE_RE.test(c.on ?? '') || !String(c.text ?? '').trim()) errors.push('A comment needs a date and text');
  }
  return errors;
}
