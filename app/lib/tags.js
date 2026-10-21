/**
 * Tags on an opportunity. Tags are free text that the user creates, and the known tags are kept
 * in config.tags so the form can suggest them (PLAN.md §5.4).
 */
export const TAG_MAX = 40;

/** Trims a tag and collapses inner spaces. */
export function cleanTag(raw) {
  return String(raw ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Turns typed tags into the tags to store. A tag that matches a known one, ignoring case, takes the
 * known spelling, so 'rfq' and 'RFQ' are the same tag. Duplicates are dropped.
 * @param {string[]} input
 * @param {string[]} known the tags already in config
 * @returns {{ tags: string[], added: string[], errors: string[] }} `added` are tags not in `known`
 */
export function resolveTags(input, known) {
  const tags = [];
  const added = [];
  const errors = [];
  const lookup = new Map(known.map((t) => [t.toLowerCase(), t]));
  for (const raw of input) {
    const tag = cleanTag(raw);
    if (!tag) continue;
    if (tag.length > TAG_MAX) {
      errors.push(`Tag '${tag}' is longer than ${TAG_MAX} characters.`);
      continue;
    }
    let name = lookup.get(tag.toLowerCase());
    if (!name) {
      name = tag;
      lookup.set(tag.toLowerCase(), tag);
      added.push(tag);
    }
    if (!tags.includes(name)) tags.push(name);
  }
  return { tags, added, errors };
}
