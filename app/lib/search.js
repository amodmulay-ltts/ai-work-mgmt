/**
 * Free-text search for the customers and opportunities lists. The query is split into words. A record
 * matches when every word appears somewhere in its text, ignoring case. An empty query matches everything.
 */

/** Lower-case words of a query. */
export function searchWords(query) {
  return String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * @param {Array<unknown>} fields text values; arrays are flattened and empty values are skipped
 * @param {string[]} words from searchWords
 */
export function matchesSearch(fields, words) {
  if (words.length === 0) return true;
  const text = fields.flat().filter((v) => v !== null && v !== undefined && v !== '').join(' ').toLowerCase();
  return words.every((w) => text.includes(w));
}
