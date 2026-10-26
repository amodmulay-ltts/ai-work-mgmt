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
