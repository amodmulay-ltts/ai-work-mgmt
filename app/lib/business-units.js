/**
 * Business units (BU) on an opportunity or a customer. The list lives in config.business_units. A BU
 * typed into a form that is not in the list is added to the list in the same save (like tags, see tags.js).
 */
export const BU_MAX = 40;

/**
 * Turns a typed BU into the value to store. A BU that matches a known one, ignoring case, takes the
 * known spelling, so 'mobility' and 'Mobility' are the same BU.
 * @param {string | null | undefined} raw
 * @param {string[]} known the BUs already in config
 * @returns {{ bu: string | null, added: string | null, errors: string[] }} `added` is set when the BU is new
 */
export function resolveBusinessUnit(raw, known) {
  const bu = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!bu) return { bu: null, added: null, errors: [] };
  if (bu.length > BU_MAX) return { bu: null, added: null, errors: [`BU '${bu}' is longer than ${BU_MAX} characters.`] };
  const match = known.find((k) => k.toLowerCase() === bu.toLowerCase());
  if (match) return { bu: match, added: null, errors: [] };
  return { bu, added: bu, errors: [] };
}
