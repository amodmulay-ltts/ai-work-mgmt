/**
 * Weekly status report as plain Markdown (PLAN.md §12.2).
 * The week runs Monday to Sunday. Pure functions: the caller passes `today`.
 */
import { health, isOpen, moneyTotals, openAsks, stageInfo, weightedValue } from './metrics.js';
import { fmtDate, moneyCompact, moneyTotalsText } from './lib/format.js';
import { addDays, mondayOf } from './lib/dates.js';

/** An opportunity line, as §12.2 gives it: id · customer · title · stage · due · value. */
function line(deal, store) {
  const customer = store.getCustomer(deal.customer_id)?.name ?? '—';
  const due = deal.submission_due ? `due ${fmtDate(deal.submission_due)}` : 'no due date';
  const value = deal.est_value == null ? '' : ` · ${moneyCompact(deal.est_value, deal.currency)}`;
  return `- ${deal.id} · ${customer} · ${deal.title} · ${deal.stage} · ${due}${value}`;
}

const inRange = (iso, start, end) => Boolean(iso) && iso >= start && iso <= end;

/**
 * The report for one week.
 * @param {import('./store.js').Store} store
 * @param {string} weekStart a Monday, 'YYYY-MM-DD'
 * @returns {string} Markdown
 */
export function weeklyReport(store, weekStart) {
  const cfg = store.config();
  const start = mondayOf(weekStart);
  const end = addDays(start, 6);
  const next = [addDays(start, 7), addDays(start, 13)];
  const deals = store.listDeals();
  const byLine = (list) => (list.length ? list.map((d) => line(d, store)).join('\n') : '- None');

  const submitted = deals.filter((d) => inRange(d.submitted_on, start, end));
  const closed = deals.filter((d) => inRange(d.closed_on, start, end) && !isOpen(d, cfg));
  const outcome = (name) => closed.filter((d) => stageInfo(cfg, d.stage)?.outcome === name);
  const dueNext = deals.filter((d) => isOpen(d, cfg) && !d.submitted_on && inRange(d.submission_due, next[0], next[1]));
  const atRisk = deals.filter((d) => isOpen(d, cfg) && health(d, cfg, end).level === 'red');
  const created = deals.filter((d) => inRange(d.received_on, start, end));

  const open = deals.filter((d) => isOpen(d, cfg));
  const stages = cfg.stages.filter((s) => !s.terminal);
  const pipeline = stages
    .map((s) => {
      const inStage = open.filter((d) => d.stage === s.name);
      const weighted = moneyTotals(inStage.map((d) => [d.currency, weightedValue(d)]), cfg);
      return inStage.length ? `- ${s.name}: ${inStage.length} · weighted ${moneyTotalsText(weighted)}` : null;
    })
    .filter(Boolean);

  // Open asks due by the end of next week. Ones due before next week starts are overdue by then.
  const askRows = open
    .flatMap((d) => openAsks(d).filter((a) => a.due_on && a.due_on <= next[1]).map((ask) => ({ deal: d, ask })))
    .sort((x, y) => x.ask.due_on.localeCompare(y.ask.due_on) || x.deal.id.localeCompare(y.deal.id));
  const askLine = ({ deal, ask }) => {
    const customer = store.getCustomer(deal.customer_id)?.name ?? '—';
    const assignee = store.getPerson(ask.assignee_id)?.name ?? 'unassigned';
    const overdue = ask.due_on < next[0] ? ' (overdue)' : '';
    return `- ${deal.id} · ${customer} · ${deal.title} · ${ask.text} · ${assignee} · due ${fmtDate(ask.due_on)}${overdue}`;
  };

  const lostLines = outcome('lost').map((d) => `${line(d, store)} · reason: ${d.outcome_reason ?? '—'}`);
  const droppedLines = outcome('dropped').map((d) => `${line(d, store)} · reason: ${d.outcome_reason ?? '—'}`);

  return [
    `# Weekly status — ${fmtDate(start)} to ${fmtDate(end)}`,
    '',
    '## Submitted this week',
    byLine(submitted),
    '',
    '## Won this week',
    byLine(outcome('won')),
    '',
    '## Lost this week',
    lostLines.length ? lostLines.join('\n') : '- None',
    '',
    '## Dropped this week',
    droppedLines.length ? droppedLines.join('\n') : '- None',
    '',
    '## Due next week',
    byLine(dueNext),
    '',
    '## Asks due next week',
    askRows.length ? askRows.map(askLine).join('\n') : '- None',
    '',
    '## At risk',
    byLine(atRisk),
    '',
    '## New this week',
    byLine(created),
    '',
    '## Pipeline summary',
    pipeline.length ? pipeline.join('\n') : '- No open opportunities',
    '',
  ].join('\n');
}
