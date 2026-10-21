/**
 * Calculated values for deals (PLAN.md §8). Pure functions: nothing here reads the
 * clock or the disk. Callers pass `today` as a 'YYYY-MM-DD' string.
 */

const DAY_MS = 86_400_000;

/** Whole days from date `a` to date `b` (b - a). Uses UTC so timezones cannot shift the result. */
export function daysBetween(a, b) {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / DAY_MS);
}

/** @returns {object | null} the stage object from config, or null when unknown */
export function stageInfo(cfg, name) {
  return cfg.stages.find((s) => s.name === name) ?? null;
}

export function isTerminal(cfg, stageName) {
  return stageInfo(cfg, stageName)?.terminal ?? false;
}

/** §4.2: Won / Lost / Dropped for terminal stages, On Hold, or Open. */
export function status(deal, cfg) {
  const stage = stageInfo(cfg, deal.stage);
  if (stage?.terminal) return stage.outcome.charAt(0).toUpperCase() + stage.outcome.slice(1);
  return deal.on_hold ? 'On Hold' : 'Open';
}

/** Not in a terminal stage. On-hold deals count as open. */
export function isOpen(deal, cfg) {
  return !isTerminal(cfg, deal.stage);
}

/** Days from received to closed (or to today while open). */
export function ageDays(deal, today) {
  return daysBetween(deal.received_on, deal.closed_on ?? today);
}

/** Days since the last stage change, or since creation when the opportunity has none. */
export function daysInStage(deal, today) {
  const stages = deal.history.filter((h) => h.kind === 'stage');
  const since = stages.length ? stages[stages.length - 1].at.slice(0, 10) : deal.created_at.slice(0, 10);
  return daysBetween(since, today);
}

/** Days until the submission is due. Negative means overdue. Null when not applicable. */
export function daysToSubmission(deal, today) {
  if (!deal.submission_due || deal.submitted_on) return null;
  return daysBetween(today, deal.submission_due);
}

/** Open, not on hold, and no update for more than stale_after_days. */
export function isStale(deal, cfg, today) {
  if (!isOpen(deal, cfg) || deal.on_hold) return false;
  return daysBetween(deal.updated_at.slice(0, 10), today) > cfg.stale_after_days;
}

/** est_value × probability, in the opportunity's own currency. Null when there is no value. */
export function weightedValue(deal) {
  if (deal.est_value == null) return null;
  return (deal.est_value * deal.probability) / 100;
}

/** @returns {'0–30' | '31–60' | '61–90' | '90+'} */
export function agingBucket(deal, today) {
  const age = ageDays(deal, today);
  if (age <= 30) return '0–30';
  if (age <= 60) return '31–60';
  if (age <= 90) return '61–90';
  return '90+';
}

/**
 * Health level and every reason that applies (§8). The level is the most severe one.
 * @returns {{ level: 'red' | 'amber' | 'green' | 'hold' | 'closed', reasons: string[] }}
 */
export function health(deal, cfg, today) {
  if (!isOpen(deal, cfg)) return { level: 'closed', reasons: [] };
  if (deal.on_hold) return { level: 'hold', reasons: ['On hold'] };

  const red = [];
  const amber = [];
  const toSubmit = daysToSubmission(deal, today);
  if (toSubmit !== null && toSubmit < 0) red.push(`Submission overdue by ${-toSubmit}d`);
  if (toSubmit !== null && toSubmit >= 0 && toSubmit <= 3) {
    amber.push(toSubmit === 0 ? 'Submission due today' : `Submission due in ${toSubmit}d`);
  }

  if (deal.next_action_due) {
    const late = daysBetween(deal.next_action_due, today);
    if (late > 3) red.push(`Next action overdue by ${late}d`);
    else if (late >= 0) amber.push('Next action due');
  }
  if (!deal.next_action) amber.push('No next action');

  if (isStale(deal, cfg, today)) {
    red.push(`No activity for ${daysBetween(deal.updated_at.slice(0, 10), today)}d`);
  }

  if (red.length) return { level: 'red', reasons: [...red, ...amber] };
  if (amber.length) return { level: 'amber', reasons: amber };
  return { level: 'green', reasons: [] };
}

/**
 * Sums amounts per currency. Skips null amounts. Keys follow config.currencies;
 * unknown currencies come last, alphabetically. Never converts between currencies.
 * @param {Array<[string, number | null]>} pairs
 * @param {{ currencies: string[] }} cfg
 * @returns {Record<string, number>}
 */
export function moneyTotals(pairs, cfg) {
  const sums = new Map();
  for (const [currency, amount] of pairs) {
    if (amount == null) continue;
    sums.set(currency, (sums.get(currency) ?? 0) + amount);
  }
  const rank = (c) => {
    const i = cfg.currencies.indexOf(c);
    return i === -1 ? Infinity : i;
  };
  const keys = [...sums.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  return Object.fromEntries(keys.map((k) => [k, sums.get(k)]));
}

/**
 * Open opportunities per non-terminal stage, with the count and the totals per currency.
 * @returns {Array<{ stage: string, count: number, totals: Record<string, number> }>}
 */
export function pipelineByStage(deals, cfg) {
  return cfg.stages
    .filter((s) => !s.terminal)
    .map((s) => {
      const inStage = deals.filter((d) => d.stage === s.name);
      return {
        stage: s.name,
        count: inStage.length,
        totals: moneyTotals(inStage.map((d) => [d.currency, d.est_value]), cfg),
      };
    });
}

/** Open opportunities per aging bucket. */
export function agingCounts(deals, cfg, today) {
  const counts = { '0–30': 0, '31–60': 0, '61–90': 0, '90+': 0 };
  for (const d of deals) {
    if (isOpen(d, cfg)) counts[agingBucket(d, today)] += 1;
  }
  return counts;
}

/**
 * Won and lost counts among deals closed in the last `days` days.
 * @returns {{ won: number, lost: number, rate: number | null }}
 */
export function winStats(deals, cfg, today, days = 90) {
  let won = 0;
  let lost = 0;
  for (const d of deals) {
    if (!d.closed_on || daysBetween(d.closed_on, today) > days) continue;
    const outcome = stageInfo(cfg, d.stage)?.outcome;
    if (outcome === 'won') won += 1;
    if (outcome === 'lost') lost += 1;
  }
  return { won, lost, rate: won + lost === 0 ? null : won / (won + lost) };
}

// ---------------------------------------------------------------- supporters and asks (PLAN.md §15.2)

/** True when the opportunity has every tag in `tags`. An empty list matches every deal. */
export const hasAllTags = (deal, tags) => tags.every((t) => (deal.tags ?? []).includes(t));

/** Open asks are still to do. Done and Cancelled asks do not count. */
export const isOpenAsk = (ask) => ask.status === 'Open' || ask.status === 'In progress';

/** @returns {object[]} the open asks on one deal */
export function openAsks(deal) {
  return (deal.support_requests ?? []).filter(isOpenAsk);
}

/** Dates sort ascending with empty dates last. */
const dueCompare = (a, b) => {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
};

/**
 * Open asks assigned to one person, across the opportunities: [{ deal, ask }], earliest due first.
 * Overdue asks therefore come first.
 */
export function asksFor(deals, personId) {
  const rows = [];
  for (const deal of deals) {
    for (const ask of openAsks(deal)) {
      if (ask.assignee_id === personId) rows.push({ deal, ask });
    }
  }
  return rows.sort((x, y) => dueCompare(x.ask.due_on ?? null, y.ask.due_on ?? null) || x.deal.id.localeCompare(y.deal.id));
}

/** True when the person is a supporter, or has an open ask on the opportunity. */
export function isSupportedBy(deal, personId) {
  return (deal.support_ids ?? []).includes(personId) || openAsks(deal).some((a) => a.assignee_id === personId);
}

/** The earliest due date among the open asks, or null. */
export function nextAskDue(deal) {
  const dates = openAsks(deal).map((a) => a.due_on).filter(Boolean).sort();
  return dates[0] ?? null;
}

/** An open ask whose due date is before today. */
export function askOverdue(ask, today) {
  return isOpenAsk(ask) && Boolean(ask.due_on) && ask.due_on < today;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * How many open opportunities are at each health level (dashboard status bar).
 * @param {Array<{ health: { level: string } }>} rows open dashboard rows
 * @returns {{ red: number, amber: number, green: number, hold: number }}
 */
export function healthMix(rows) {
  const mix = { red: 0, amber: 0, green: 0, hold: 0 };
  for (const r of rows) {
    if (r.health.level in mix) mix[r.health.level] += 1;
  }
  return mix;
}

/**
 * Open opportunities whose submission is due in each of the next `months` calendar months, counted
 * from the month of `today`. Overdue submissions (before today) and later ones are counted apart.
 * @returns {{ months: Array<{ key: string, label: string, count: number }>, overdue: number, later: number }}
 */
export function submissionsByMonth(deals, cfg, today, months = 6) {
  let [year, month] = today.slice(0, 7).split('-').map(Number);
  const keys = [];
  for (let i = 0; i < months; i += 1) {
    keys.push({ key: `${year}-${String(month).padStart(2, '0')}`, label: MONTH_NAMES[month - 1], count: 0 });
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  const byKey = new Map(keys.map((m) => [m.key, m]));
  let overdue = 0;
  let later = 0;
  for (const d of deals) {
    if (!isOpen(d, cfg) || !d.submission_due || d.submitted_on) continue;
    if (d.submission_due < today) {
      overdue += 1;
      continue;
    }
    const slot = byKey.get(d.submission_due.slice(0, 7));
    if (slot) slot.count += 1;
    else later += 1;
  }
  return { months: keys, overdue, later };
}

/**
 * Open opportunities per business unit, with the count and the estimated value per currency.
 * Opportunities without a BU are listed last under 'No BU'.
 * @returns {Array<{ bu: string, count: number, totals: Record<string, number> }>}
 */
export function byBusinessUnit(deals, cfg) {
  const groups = new Map();
  for (const d of deals) {
    const name = d.bu || 'No BU';
    if (!groups.has(name)) groups.set(name, { bu: name, count: 0, pairs: [] });
    const group = groups.get(name);
    group.count += 1;
    group.pairs.push([d.currency, d.est_value]);
  }
  const rank = (g) => (g.bu === 'No BU' ? 1 : 0);
  return [...groups.values()]
    .sort((a, b) => rank(a) - rank(b) || b.count - a.count || a.bu.localeCompare(b.bu))
    .map((g) => ({ bu: g.bu, count: g.count, totals: moneyTotals(g.pairs, cfg) }));
}

/**
 * Won and lost opportunities per closing year, from the first year with a closed deal up to this year,
 * so a year with no wins still shows. Dropped ones are left out of the win rate, as in winStats.
 * Terminal opportunities with no closing date are counted apart, not guessed.
 * @returns {{ years: Array<{ year: number, won: number, lost: number, rate: number | null, wonTotals: Record<string, number> }>, undated: { won: number, lost: number } }}
 */
export function winsByYear(deals, cfg, today) {
  const byYear = new Map();
  const undated = { won: 0, lost: 0 };
  for (const d of deals) {
    const outcome = stageInfo(cfg, d.stage)?.outcome;
    if (outcome !== 'won' && outcome !== 'lost') continue;
    if (!d.closed_on) {
      undated[outcome] += 1;
      continue;
    }
    const year = Number(d.closed_on.slice(0, 4));
    if (!byYear.has(year)) byYear.set(year, { year, won: 0, lost: 0, pairs: [] });
    const row = byYear.get(year);
    row[outcome] += 1;
    if (outcome === 'won') row.pairs.push([d.currency, d.est_value]);
  }
  if (byYear.size === 0) return { years: [], undated };
  const first = Math.min(...byYear.keys());
  const last = Math.max(Number(today.slice(0, 4)), ...byYear.keys());
  const years = [];
  for (let year = first; year <= last; year += 1) {
    const row = byYear.get(year) ?? { year, won: 0, lost: 0, pairs: [] };
    years.push({
      year,
      won: row.won,
      lost: row.lost,
      rate: row.won + row.lost === 0 ? null : row.won / (row.won + row.lost),
      wonTotals: moneyTotals(row.pairs, cfg),
    });
  }
  return { years, undated };
}

/**
 * Open opportunities per customer: the count and the estimated value per currency. Sorted by count,
 * then by name. `nameOf` turns a customer id into a name.
 * @returns {Array<{ customer: string, count: number, totals: Record<string, number> }>}
 */
export function byCustomer(deals, cfg, nameOf) {
  const groups = new Map();
  for (const d of deals) {
    const name = nameOf(d.customer_id);
    if (!groups.has(name)) groups.set(name, { customer: name, count: 0, pairs: [] });
    const group = groups.get(name);
    group.count += 1;
    group.pairs.push([d.currency, d.est_value]);
  }
  return [...groups.values()]
    .sort((a, b) => b.count - a.count || a.customer.localeCompare(b.customer))
    .map((g) => ({ customer: g.customer, count: g.count, totals: moneyTotals(g.pairs, cfg) }));
}
