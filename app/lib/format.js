/**
 * View helpers: dates, money and sync text. Exposed to every template through
 * app.locals (PLAN.md §11.6). Month names are fixed so output does not depend on the machine's locale.
 */
import { daysBetween } from '../metrics.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2026-10-16' → '16 Oct 2026'. Returns '—' when empty. */
export function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** '2026-10-16T10:43:00+05:30' → '16 Oct 2026, 10:43'. */
export function fmtDatetime(iso) {
  if (!iso) return '—';
  return `${fmtDate(iso.slice(0, 10))}, ${iso.slice(11, 16)}`;
}

/**
 * Text for a due date relative to today: 'today', 'in 3d' or '2d overdue'.
 * The template picks the colour.
 */
export function relDays(iso, today) {
  if (!iso) return '';
  const n = daysBetween(today, iso);
  if (n === 0) return 'today';
  if (n > 0) return `in ${n}d`;
  return `${-n}d overdue`;
}

/** 1250000, 'EUR' → 'EUR 1,250,000'. */
export function money(value, currency) {
  if (value == null) return '—';
  return `${currency} ${Math.round(value).toLocaleString('en-US')}`;
}

/** 1250000, 'EUR' → 'EUR 1.25M'; 850000 → 'EUR 850K'. Always shows the currency code. */
export function moneyCompact(value, currency) {
  if (value == null) return '—';
  const abs = Math.abs(value);
  let text;
  if (abs >= 1_000_000) text = `${trim(value / 1_000_000)}M`;
  else if (abs >= 1_000) text = `${trim(value / 1_000)}K`;
  else text = trim(value);
  return `${currency} ${text}`;
}

function trim(n) {
  return Number(n.toFixed(2)).toString();
}

/** Per-currency totals as text: 'EUR 1.2M · USD 3M'. '—' when empty. */
export function moneyTotalsText(totals) {
  const parts = Object.entries(totals).map(([currency, amount]) => moneyCompact(amount, currency));
  return parts.length ? parts.join(' · ') : '—';
}

/** 0.35 → '35%'. Input is already a percentage (35) in the data; this formats it. */
export function pct(value) {
  return value == null ? '—' : `${value}%`;
}

/**
 * Text for the header sync badge.
 * @param {{ state: string, unpushed: number }} sync
 */
export function syncLabel(sync) {
  switch (sync.state) {
    case 'synced':
      return 'Synced';
    case 'pending':
      return `${sync.unpushed} unpushed`;
    case 'error':
      return 'Sync error';
    case 'local':
      return 'Local only';
    case 'offline':
      return 'Offline';
    default:
      return sync.state;
  }
}
