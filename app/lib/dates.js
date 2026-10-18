/**
 * Date arithmetic on 'YYYY-MM-DD' strings. Everything is done in UTC, so no timezone
 * can move a date by a day.
 */

/** @returns {string} the date `n` days after `iso` (negative goes back) */
export function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** @returns {string} the Monday of the week that contains `iso` */
export function mondayOf(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addDays(iso, -((weekday + 6) % 7));
}
