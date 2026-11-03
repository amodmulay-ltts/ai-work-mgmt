/**
 * Marks the opportunity's own next action as done (PLAN.md §15, next action).
 * The text and due date move into done_actions, so nothing entered is lost.
 * Returns null when there is no next action to mark.
 * @returns {{ deal: object, entry: object } | null}
 */
export function markNextActionDone(deal, { today, at }) {
  if (!deal.next_action) return null;
  const done = { text: deal.next_action, due: deal.next_action_due ?? null, done_on: today };
  const next = {
    ...deal,
    next_action: null,
    next_action_due: null,
    done_actions: [...(deal.done_actions ?? []), done],
    updated_at: at,
  };
  const entry = { at, kind: 'field', text: `Next action done: ${done.text}`, from_value: null, to_value: null };
  return { deal: next, entry };
}

/** Ways to close a next action without doing it. Done is the default and has no reason. */
export const CLOSE_STATUSES = ['cancelled', 'postponed'];

/**
 * Closes the opportunity's next action as cancelled or postponed, with a reason.
 * It moves into done_actions with its status, so nothing entered is lost.
 * Returns null when there is no next action to close.
 * @returns {{ deal: object, entry: object } | null}
 */
export function closeNextAction(deal, { status, reason, today, at }) {
  if (!deal.next_action) return null;
  const closed = { text: deal.next_action, due: deal.next_action_due ?? null, done_on: today, status, reason };
  const next = {
    ...deal,
    next_action: null,
    next_action_due: null,
    done_actions: [...(deal.done_actions ?? []), closed],
    updated_at: at,
  };
  const entry = { at, kind: 'field', text: `Next action ${status}: ${closed.text} (${reason})`, from_value: null, to_value: null };
  return { deal: next, entry };
}
