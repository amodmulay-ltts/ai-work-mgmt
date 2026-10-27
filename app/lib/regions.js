/**
 * Regions on an opportunity. The list lives in config.regions. A region typed into a form that is not in
 * the list is added to the list in the same save, as BUs are (see business-units.js).
 */
export const REGION_MAX = 60;

/**
 * Turns a typed region into the value to store. A region that matches a known one, ignoring case, takes
 * the known spelling.
 * @param {string | null | undefined} raw
 * @param {string[]} known the regions already in config
 * @returns {{ region: string | null, added: string | null, errors: string[] }} `added` is set when the region is new
 */
export function resolveRegion(raw, known) {
  const region = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!region) return { region: null, added: null, errors: [] };
  if (region.length > REGION_MAX) return { region: null, added: null, errors: [`Region '${region}' is longer than ${REGION_MAX} characters.`] };
  const match = known.find((k) => k.toLowerCase() === region.toLowerCase());
  if (match) return { region: match, added: null, errors: [] };
  return { region, added: region, errors: [] };
}
