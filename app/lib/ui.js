/**
 * Small HTML builders for the views (PLAN.md §11.4). Every value is escaped here, so views
 * only need to call these helpers. Each function returns an HTML string.
 */
import { fmtDate, relDays } from './format.js';

/** Escapes text for HTML. */
export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Stage badge. The colour comes from the stage's position: stage-1 … stage-10 (PLAN.md §11.3). */
export function stageBadge(name, cfg) {
  const index = cfg.stages.findIndex((s) => s.name === name);
  const cls = index === -1 ? 'stage-1' : `stage-${index + 1}`;
  return `<span class="badge ${cls}">${esc(name)}</span>`;
}

const PRIORITY_CLASS = { High: 'prio-high', Medium: 'prio-medium', Low: 'prio-low' };
export function priorityBadge(priority) {
  return `<span class="badge ${PRIORITY_CLASS[priority] ?? 'prio-low'}">${esc(priority)}</span>`;
}

/** Coloured dot for the health level. The reasons go in the tooltip and the text for screen readers. */
export function healthDot({ level, reasons }) {
  const label = level === 'closed' ? 'Closed' : level === 'hold' ? 'On hold' : level.charAt(0).toUpperCase() + level.slice(1);
  const title = reasons.length ? reasons.join(' · ') : label;
  return `<span class="health health-${esc(level)}" title="${esc(title)}"><span class="sr-only">${esc(label)}: ${esc(title)}</span></span>`;
}

/** Due date with the relative text under it. Overdue dates are red, today is amber (§11.4). */
export function dueCell(iso, today, { done = null } = {}) {
  if (done) return `<div class="due">${esc(fmtDate(done))}</div><div class="rel rel-done">submitted ${esc(fmtDate(done))}</div>`;
  if (!iso) return '<span class="subtle">—</span>';
  const rel = relDays(iso, today);
  const cls = rel.endsWith('overdue') ? 'rel-overdue' : rel === 'today' ? 'rel-today' : 'rel';
  return `<div class="due">${esc(fmtDate(iso))}</div><div class="${cls}">${esc(rel)}</div>`;
}

/** Form field: label, input, error and help text. Keeps what the user typed. */
export function field({ name, label, type = 'text', value = '', required = false, error = '', help = '', options = null, list = null, rows = 0, span = false, placeholder = '' }) {
  const id = `f-${name}`;
  const describedBy = [error ? `${id}-error` : '', help ? `${id}-help` : ''].filter(Boolean).join(' ');
  const attrs = [
    `id="${id}"`,
    `name="${esc(name)}"`,
    required ? 'required' : '',
    error ? 'aria-invalid="true"' : '',
    describedBy ? `aria-describedby="${describedBy}"` : '',
    list ? `list="${esc(list)}"` : '',
    placeholder ? `placeholder="${esc(placeholder)}"` : '',
  ].filter(Boolean).join(' ');

  let input;
  if (type === 'checkbox') {
    input = `<input type="checkbox" id="${id}" name="${esc(name)}"${value === 'on' || value === true ? ' checked' : ''}>`;
  } else if (type === 'select') {
    const opts = (options ?? [])
      .map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(value) ? ' selected' : ''}>${esc(l ?? v)}</option>`)
      .join('');
    input = `<select ${attrs}>${placeholder ? `<option value="">${esc(placeholder)}</option>` : ''}${opts}</select>`;
  } else if (type === 'textarea') {
    input = `<textarea ${attrs} rows="${rows || 4}">${esc(value)}</textarea>`;
  } else {
    input = `<input type="${type}" ${attrs} value="${esc(value)}">`;
  }

  const requiredMark = required ? ' <span class="req" aria-hidden="true">*</span>' : '';
  return `<div class="field${span ? ' span-all' : ''}${type === 'checkbox' ? ' field-check' : ''}">
  <label for="${id}">${esc(label)}${requiredMark}</label>
  ${input}
  ${error ? `<p class="error" id="${id}-error">${esc(error)}</p>` : ''}
  ${help ? `<p class="help" id="${id}-help">${esc(help)}</p>` : ''}
</div>`;
}

/** Options for a select: [value, label] pairs from a list of strings. */
export function optionsOf(list) {
  return list.map((v) => [v, v]);
}

/** Datalist of names, used by text fields that auto-create records on save. */
export function datalist(id, names) {
  return `<datalist id="${esc(id)}">${names.map((n) => `<option value="${esc(n)}"></option>`).join('')}</datalist>`;
}

/** Stage name and index, for steppers and the stage colours. */
export function stageIndex(cfg, name) {
  return cfg.stages.findIndex((s) => s.name === name);
}

/** A bare select for filter bars (no label). Options are [value, label] pairs. */
export function selectControl({ name, value = '', options, placeholder = '', ariaLabel = '' }) {
  const opts = options
    .map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(value) ? ' selected' : ''}>${esc(l ?? v)}</option>`)
    .join('');
  const blank = `<option value="">${esc(placeholder)}</option>`;
  return `<select name="${esc(name)}" data-autosubmit aria-label="${esc(ariaLabel || placeholder)}">${blank}${opts}</select>`;
}
