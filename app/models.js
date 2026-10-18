/**
 * Record shapes and validation. Records are plain objects; keys are written in
 * the order of the typedefs so the JSON files stay stable.
 * Dates are 'YYYY-MM-DD' strings and timestamps are ISO-8601 strings with offset.
 * Phase 0 defines Person only. Phase 1 adds Customer and Deal (PLAN.md §5.1).
 */

/**
 * @typedef {'Sales' | 'Presales' | 'Delivery' | 'Leadership' | 'Customer' | 'Partner' | 'Other'} Role
 *
 * @typedef {{
 *   schema_version: number,
 *   id: string,
 *   name: string,
 *   role: Role,
 *   title: string | null,
 *   email: string | null,
 *   phone: string | null,
 *   customer_id: string | null,
 *   notes: string,
 *   active: boolean,
 *   created_at: string,
 *   updated_at: string
 * }} Person
 */

export const ROLES = ['Sales', 'Presales', 'Delivery', 'Leadership', 'Customer', 'Partner', 'Other'];

const PREFIX = { deal: 'DL', customer: 'CU', person: 'PE' };
const EMAIL_RE = /^[^@\s]+@[^@\s]+$/;

export class ValidationError extends Error {
  /** @param {string[]} errors */
  constructor(errors) {
    super(errors.join('; '));
    this.errors = errors;
  }
}

/** @param {string} id @returns {'deal' | 'customer' | 'person'} */
export function kindOf(id) {
  const entry = Object.entries(PREFIX).find(([, prefix]) => id.startsWith(`${prefix}-`));
  if (!entry) throw new Error(`Unknown record id: ${id}`);
  return /** @type {'deal' | 'customer' | 'person'} */ (entry[0]);
}

export { PREFIX };

/** @returns {string} local time with seconds precision and offset, e.g. 2026-10-16T10:43:00+05:30 */
export function nowIso() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const offset = -d.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/**
 * Checks one record. Returns error messages; an empty array means valid.
 * @param {'deal' | 'customer' | 'person'} kind
 * @param {Record<string, any>} obj
 * @param {Record<string, any>} _config merged config, used for enum lists from Phase 1 on
 * @returns {string[]}
 */
export function validateRecord(kind, obj, _config) {
  if (kind !== 'person') throw new Error(`Validation for ${kind} is added in Phase 1`);
  const errors = [];
  if (!/^PE-\d{4}$/.test(obj.id ?? '')) errors.push('id must look like PE-0001');
  if (typeof obj.name !== 'string' || obj.name.trim() === '') errors.push('name is required');
  if (!ROLES.includes(obj.role)) errors.push(`role: unknown value '${obj.role}'`);
  if (obj.role === 'Customer' && !obj.customer_id) errors.push('customer_id is required for role Customer');
  if (obj.email && !EMAIL_RE.test(obj.email)) errors.push('email is not valid');
  if (typeof obj.active !== 'boolean') errors.push('active must be true or false');
  return errors;
}
