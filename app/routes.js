import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import {
  agingCounts, ageDays, askOverdue, asksFor, byBusinessUnit, byCustomer, daysInStage, daysToSubmission, hasAllTags, health, healthMix, isOpen, isOpenAsk, isSupportedBy,
  moneyTotals, submissionsByMonth, winsByYear, openAsks, pipelineByStage, stageInfo, status, weightedValue,
} from './metrics.js';
import { ASK_STATUSES, ValidationError, isIsoDate, nowIso, showField, todayIso, ROLES } from './models.js';
import { addAsk, askEntries, changeAsk, changeSupporters, findAsk, removeAsk, removedEntry } from './support.js';
import { resolveTags } from './lib/tags.js';
import { connectState, connectSummary, isDone, newConnect, plannedConnects, visitCounts, isVisit } from './lib/connects.js';
import { ACTIVITY_KINDS, ACTIVITY_STATUSES, OPEN_ACTIVITY_STATUSES, activityQuiet, newActivityUpdate, parseActivityForm } from './lib/activities.js';
import { noteEntry } from './history.js';
import { markNextActionDone } from './lib/next-action.js';
import { moveReferences, personUsage } from './lib/merge.js';
import { matchesSearch, searchWords } from './lib/search.js';
import {
  customerToValues, dealToTyped, ensureCustomer, ensurePerson, parseCustomerValues, parseDealValues, parsePersonValues,
  personToValues, saveActivity, saveCustomer, saveDeal, savePerson, typedToValues,
} from './forms.js';
import { flash, renderPage } from './lib/render.js';
import { stageIndex } from './lib/ui.js';
import { fmtDate, moneyCompact } from './lib/format.js';
import { dealsWorkbook, pipelineRecords, pipelineWorkbook } from './export.js';
import { weeklyReport } from './report.js';
import { addDays, mondayOf } from './lib/dates.js';

const EMAIL_RE = /^[^@\s]+@[^@\s]+$/;
const ID_RE = { deal: /^DL-\d{4}-\d{4}$/, customer: /^CU-\d{4}$/, person: /^PE-\d{4}$/ };

/** Trimmed string from a form field, or '' when missing. */
const clean = (value) => (typeof value === 'string' ? value.trim() : '');

/** Removes the record id that validation messages start with, e.g. 'DL-2026-0001: '. */
/** The delete challenge: the typed text must equal the record's ID or name exactly. Nothing is deleted otherwise. */
const typedRight = (req, expected) => String(req.body.confirm ?? '').trim() === expected;

const plain = (message) => message.replace(/^(DL|CU|PE)-\d{4}(-\d{4})?: /, '');

/** Tags chosen in a filter, from ?tag=…&tag=…. Unknown tags are dropped. */
function tagsFrom(query, cfg) {
  const picked = [...new Set([query.tag ?? []].flat().map(clean))];
  return picked.filter((t) => cfg.tags.includes(t));
}

/** The query string without the tag filter, so tag links can keep the other filters. */
function otherQuery(query) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (key !== 'tag' && typeof value === 'string') params.set(key, value);
  }
  return params.toString();
}

/** Local path from the Referer header, so redirects cannot leave this site. */
function safeBackPath(req, fallback = '/') {
  try {
    const url = new URL(req.get('referer') ?? '');
    if (url.host === req.get('host')) return url.pathname + url.search;
  } catch {
    // no usable Referer: use the fallback
  }
  return fallback;
}

/** Pulls from the remote before a record is created, so ids do not clash with another computer (§4.6). */
async function pullBeforeCreate(req) {
  const { git, store } = req.app.locals;
  const pulled = await git.pull();
  if (pulled.changed) await store.loadAll();
}

async function notFound(req, res, what) {
  await renderPage(req, res, 'error', { title: 'Not found', message: `${what} was not found.` }, 404);
}

/** Dashboard data: the current user, when set. */
function dashboardData(store, extra = {}) {
  const meId = store.config().me_person_id;
  return { title: 'Dashboard', active: 'dashboard', me: meId ? store.getPerson(meId) : null, ...extra };
}

/** 'Good morning' / 'afternoon' / 'evening', by local time. */
function greeting(now = new Date()) {
  const h = now.getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

/** Numbers, lists and bars for the dashboard (PLAN.md §11.5). */
function dashboardView(store, cfg, today, me, tags) {
  const deals = store.listDeals().filter((d) => hasAllTags(d, tags));
  const rows = deals.map((d) => dealRow(d, store, cfg, today));
  const open = rows.filter((r) => r.open);
  const rank = { red: 0, amber: 1 };
  const attention = open
    .filter((r) => r.health.level === 'red' || r.health.level === 'amber')
    .sort((a, b) => rank[a.health.level] - rank[b.health.level] || dueOrder(a.toSubmit, b.toSubmit))
    .slice(0, 10);
  const actions = me
    ? open
        .filter((r) => r.deal.presales_owner_id === me.id)
        .sort((a, b) => dueText(a.deal.next_action_due).localeCompare(dueText(b.deal.next_action_due)))
    : [];
  const myAsks = me ? asksFor(deals, me.id) : [];
  // Customers with open work whose last connect is too old, or missing. Never-connected first, then oldest.
  const connectFlags = [...new Set(open.map((r) => r.deal.customer_id))]
    .map((id) => store.getCustomer(id))
    .filter(Boolean)
    .map((c) => ({ customer: c, openCount: open.filter((r) => r.deal.customer_id === c.id).length, connect: connectState(c, today, cfg.connect_after_days) }))
    .filter((r) => r.connect.flagged)
    .sort((a, b) => (a.connect.last ?? '').localeCompare(b.connect.last ?? ''))
    .slice(0, 10);
  // Internal activities are not opportunities: they are not filtered by tag and not in the pipeline.
  const activities = store.listActivities();
  const activityView = {
    counts: Object.fromEntries(ACTIVITY_STATUSES.map((s) => [s, activities.filter((a) => a.status === s).length])),
    inProgress: activities
      .filter((a) => a.status === 'In progress')
      .map((a) => ({ activity: a, owner: store.getPerson(a.owner_id)?.name ?? '—', ...activityQuiet(a, today, cfg.stale_after_days) }))
      .sort((x, y) => x.last.localeCompare(y.last))
      .slice(0, 8),
  };
  // Customer visits (EI centre and customer premises; not Teams). Completed counts, and the next planned ones.
  const customers = store.listCustomers();
  const visits = {
    completed: visitCounts(customers.flatMap((c) => c.connects), today.slice(0, 4)),
    upcoming: customers
      .flatMap((c) => plannedConnects(c.connects, today).filter(isVisit).map((x) => ({ ...x, customer: c.name, customerId: c.id, whoName: store.getPerson(x.who_id)?.name ?? '—' })))
      .sort((a, b) => a.on.localeCompare(b.on))
      .slice(0, 10),
  };
  return {
    connectFlags,
    visits,
    activities: activityView,
    kpi: {
      open: open.length,
      onHold: open.filter((r) => r.deal.on_hold).length,
      weighted: moneyTotals(open.map((r) => [r.deal.currency, r.weighted]), cfg),
      // Won to date: every opportunity in a won stage, counted and valued by its own currency.
      won: wonToDate(deals, cfg),
    },
    // Asks for me: the 5 earliest open asks, and how many are due within a week (overdue included).
    myAsks: {
      rows: myAsks.slice(0, 5).map((r) => ({ ...r, overdue: askOverdue(r.ask, today) })),
      total: myAsks.length,
      dueWeek: myAsks.filter((r) => r.ask.due_on && r.ask.due_on <= addDays(today, 7)).length,
    },
    attention,
    actions,
    recent: [...rows]
      .sort((a, b) => b.deal.updated_at.localeCompare(a.deal.updated_at))
      .slice(0, 8)
      .map((r) => ({ ...r, summary: dealSummary(r, store, cfg) })),
    pipeline: pipelineByStage(deals, cfg),
    aging: agingCounts(deals, cfg, today),
    health: healthMix(open),
    submissions: submissionsByMonth(deals, cfg, today),
    byBu: byBusinessUnit(open.map((r) => r.deal), cfg),
    byCustomer: byCustomer(open.map((r) => r.deal), cfg, (id) => store.getCustomer(id)?.name ?? '—'),
    today,
  };
}

/**
 * The strip above the opportunities list: Won, Submitted (open and submitted), Lost, and everything else.
 * The groups do not overlap, so they add up to the total. Tags apply, as on the list; status does not.
 */
function opportunitySummary(store, cfg, today, tags) {
  const rows = store.listDeals().filter((d) => hasAllTags(d, tags)).map((d) => dealRow(d, store, cfg, today));
  const won = rows.filter((r) => r.status === 'Won').length;
  const lost = rows.filter((r) => r.status === 'Lost').length;
  const submitted = rows.filter((r) => r.open && !!r.deal.submitted_on).length;
  // The EUR value of each group: the sum of the estimated values, or null when none of them has a value.
  const sumOf = (list) => {
    const values = list.map((r) => r.deal.est_value).filter((v) => v != null);
    return values.length ? values.reduce((a, b) => a + b, 0) : null;
  };
  const wonRows = rows.filter((r) => r.status === 'Won');
  const lostRows = rows.filter((r) => r.status === 'Lost');
  const submittedRows = rows.filter((r) => r.open && !!r.deal.submitted_on);
  const otherRows = rows.filter((r) => !wonRows.includes(r) && !lostRows.includes(r) && !submittedRows.includes(r));
  return {
    total: rows.length,
    won,
    submitted,
    lost,
    other: rows.length - won - lost - submitted,
    values: { won: sumOf(wonRows), submitted: sumOf(submittedRows), lost: sumOf(lostRows), other: sumOf(otherRows) },
  };
}

/** Won opportunities: how many, and their estimated value per currency. */
function wonToDate(deals, cfg) {
  const won = deals.filter((d) => stageInfo(cfg, d.stage)?.outcome === 'won');
  return { count: won.length, totals: moneyTotals(won.map((d) => [d.currency, d.est_value]), cfg) };
}

/**
 * The hover text for an opportunity on the dashboard: what it is, who owns it, where it stands, and the next step.
 * Lines are separated by newlines, which browsers show in a tooltip.
 */
function dealSummary(r, store, cfg) {
  const d = r.deal;
  const lines = [`${d.id} · ${d.title}`, `${r.customerName} · ${d.stage} (${r.status})`];
  const sales = store.getPerson(d.sales_owner_id)?.name;
  const presales = store.getPerson(d.presales_owner_id)?.name;
  if (sales) lines.push(`Sales: ${sales}`);
  if (presales) lines.push(`Presales: ${presales}`);
  lines.push(`Value: ${moneyCompact(d.est_value, d.currency)} · probability ${d.probability}%`);
  lines.push(`Next step: ${d.next_action || 'not set'}${d.next_action_due ? ` (due ${fmtDate(d.next_action_due)})` : ''}`);
  if (d.submission_due && !d.submitted_on) lines.push(`Submission due: ${fmtDate(d.submission_due)}`);
  if (r.health.reasons.length) lines.push(`Health: ${r.health.reasons.join('; ')}`);
  if (d.description) lines.push(d.description.length > 200 ? `${d.description.slice(0, 200)}…` : d.description);
  return lines.join('\n');
}

/** Nulls last when sorting by a number of days. */
function dueOrder(a, b) {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

/** Empty dates sort last: '\uffff' sorts after every date. */
const dueText = (iso) => iso ?? '\uffff';

// ---------------------------------------------------------------- settings

const LIST_KEYS = ['business_units', 'regions', 'pricing_models', 'sources', 'outcome_reasons', 'tags'];

/** Non-empty lines, trimmed. */
const lines = (value) => String(value ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
const unique = (items) => [...new Set(items)];

/** Form values as strings, for the settings page. */
function settingsValues(body) {
  const out = { name: clean(body.name), email: clean(body.email), stale_after_days: clean(body.stale_after_days), connect_after_days: clean(body.connect_after_days) };
  for (const key of LIST_KEYS) out[key] = String(body[key] ?? '');
  return out;
}

async function renderSettings(req, res, { values, errors = {}, formErrors = [], status: code = 200 }) {
  const { store } = req.app.locals;
  const cfg = store.config();
  const me = cfg.me_person_id ? store.getPerson(cfg.me_person_id) : null;
  const defaults = {
    name: me?.name ?? '',
    email: me?.email ?? '',
    stale_after_days: String(cfg.stale_after_days),
    connect_after_days: String(cfg.connect_after_days),
    ...Object.fromEntries(LIST_KEYS.map((key) => [key, cfg[key].join('\n')])),
  };
  await renderPage(req, res, 'settings', {
    title: 'Settings',
    active: 'settings',
    me,
    values: values ?? defaults,
    errors,
    formErrors,
    stages: cfg.stages,
    problems: store.problems,
  }, code);
}

// ---------------------------------------------------------------- deals

/** One row of the opportunities list, with every value the views need. */
function dealRow(deal, store, cfg, today) {
  return {
    deal,
    customerName: store.getCustomer(deal.customer_id)?.name ?? '—',
    salesName: store.getPerson(deal.sales_owner_id)?.name ?? '—',
    supporters: deal.support_ids.map((id) => store.getPerson(id)?.name).filter(Boolean),
    status: status(deal, cfg),
    health: health(deal, cfg, today),
    age: ageDays(deal, today),
    inStage: daysInStage(deal, today),
    toSubmit: daysToSubmission(deal, today),
    weighted: weightedValue(deal),
    stageIdx: stageIndex(cfg, deal.stage),
    open: isOpen(deal, cfg),
  };
}

const STATUS_FILTERS = {
  open: (r) => r.open,
  hold: (r) => r.open && r.deal.on_hold,
  won: (r) => r.status === 'Won',
  lost: (r) => r.status === 'Lost',
  dropped: (r) => r.status === 'Dropped',
  closed: (r) => !r.open,
  all: () => true,
};

/** Empty values always sort last, whatever the direction. */
function byDate(field, dir) {
  return (a, b) => {
    const x = a.deal[field];
    const y = b.deal[field];
    if (!x && !y) return 0;
    if (!x) return 1;
    if (!y) return -1;
    return dir * (x < y ? -1 : x > y ? 1 : 0);
  };
}

const SORTS = {
  id: (dir) => (a, b) => dir * a.deal.id.localeCompare(b.deal.id),
  title: (dir) => (a, b) => dir * a.deal.title.localeCompare(b.deal.title),
  customer: (dir) => (a, b) => dir * a.customerName.localeCompare(b.customerName),
  stage: (dir) => (a, b) => dir * (a.stageIdx - b.stageIdx),
  submission_due: (dir) => byDate('submission_due', dir),
  next_action_due: (dir) => byDate('next_action_due', dir),
  age: (dir) => (a, b) => dir * (a.age - b.age),
  value: (dir) => (a, b) => {
    if (a.deal.est_value == null && b.deal.est_value == null) return 0;
    if (a.deal.est_value == null) return 1;
    if (b.deal.est_value == null) return -1;
    if (a.deal.currency !== b.deal.currency) return dir * a.deal.currency.localeCompare(b.deal.currency);
    return dir * (a.deal.est_value - b.deal.est_value);
  },
  updated: (dir) => (a, b) => dir * a.deal.updated_at.localeCompare(b.deal.updated_at),
};

/**
 * Filters and sorts the opportunities list from the query string (PLAN.md §10).
 * @returns {{ rows: object[], query: Record<string, string> }}
 */
function listDeals(store, cfg, today, query) {
  const words = searchWords(query.q);
  const tags = tagsFrom(query, cfg);
  const filter = {
    status: query.status || 'open',
    stage: query.stage || '',
    customer: query.customer || '',
    owner: query.owner || '',
    support: query.support || '',
    bu: query.bu || '',
    priority: query.priority || '',
    health: query.health || '',
    submitted: query.submitted === '1' ? '1' : '',
    from: isIsoDate(query.from ?? '') ? query.from : '',
    to: isIsoDate(query.to ?? '') ? query.to : '',
    // Chart links (dashboard and wins page): open deals due in a month, and won or lost deals closed in a year.
    submit_month: /^\d{4}-\d{2}$/.test(query.submit_month ?? '') ? query.submit_month : '',
    closed_year: /^\d{4}$/.test(query.closed_year ?? '') ? query.closed_year : '',
  };
  const sortKey = SORTS[query.sort] ? query.sort : 'submission_due';
  const dir = query.dir === 'desc' ? -1 : 1;

  let rows = store.listDeals().map((d) => dealRow(d, store, cfg, today));
  rows = rows.filter((r) => (STATUS_FILTERS[filter.status] ?? STATUS_FILTERS.open)(r));
  if (filter.stage) rows = rows.filter((r) => r.deal.stage === filter.stage);
  if (filter.customer) rows = rows.filter((r) => r.deal.customer_id === filter.customer);
  if (filter.owner) {
    rows = rows.filter((r) => [r.deal.sales_owner_id, r.deal.presales_owner_id, r.deal.delivery_owner_id].includes(filter.owner));
  }
  // support=me means the current user; any other value is a person id (used by /support?who=).
  const supporterId = filter.support === 'me' ? cfg.me_person_id : filter.support;
  if (supporterId) rows = rows.filter((r) => isSupportedBy(r.deal, supporterId));
  if (tags.length) rows = rows.filter((r) => hasAllTags(r.deal, tags));
  if (filter.bu === 'none') rows = rows.filter((r) => !r.deal.bu);
  else if (filter.bu) rows = rows.filter((r) => r.deal.bu === filter.bu);
  if (filter.submit_month) {
    rows = rows.filter((r) => r.open && r.deal.submission_due && !r.deal.submitted_on && r.deal.submission_due.slice(0, 7) === filter.submit_month);
  }
  if (filter.closed_year) rows = rows.filter((r) => r.deal.closed_on?.slice(0, 4) === filter.closed_year);
  if (filter.priority) rows = rows.filter((r) => r.deal.priority === filter.priority);
  if (filter.health) rows = rows.filter((r) => r.health.level === filter.health);
  if (filter.submitted) rows = rows.filter((r) => r.open && !!r.deal.submitted_on);
  // Received between two dates, both included. Either end can be left open.
  if (filter.from) rows = rows.filter((r) => r.deal.received_on >= filter.from);
  if (filter.to) rows = rows.filter((r) => r.deal.received_on <= filter.to);
  // Search covers the id, title, customer, contacts, owners, supporters, stage, BU, region, practice, C4C id, description, tags, next action and asks.
  const personName = (id) => store.getPerson(id)?.name ?? null;
  rows = rows.filter((r) => {
    const d = r.deal;
    return matchesSearch([
      d.id, d.title, r.customerName, d.c4c_id, d.practice, d.description, d.stage, d.bu, d.region,
      d.next_action, d.outcome_reason, d.tags,
      d.contact_ids.map(personName),
      [d.sales_owner_id, d.presales_owner_id, d.delivery_owner_id, ...d.support_ids].map(personName),
      d.support_requests.map((a) => a.text),
    ], words);
  });
  rows.sort(SORTS[sortKey](dir));
  return { rows, filter: { ...filter, q: query.q || '' }, tags, sort: sortKey, dir: dir === 1 ? 'asc' : 'desc' };
}

/** Values for the new-deal form, pre-filled with the defaults from §4.3. */
function newDealValues(store, cfg, customerId) {
  const customer = customerId ? store.getCustomer(customerId) : null;
  const me = cfg.me_person_id ? store.getPerson(cfg.me_person_id) : null;
  return typedToValues({
    title: '',
    type: 'Lead',
    source: null,
    description: '',
    customer: customer?.name ?? '',
    contacts: [],
    c4c_id: null,
    sales_owner: '',
    presales_owner: me?.name ?? '',
    delivery_owner: '',
    bu: null,
    practice: null,
    region: null,
    stage: 'Lead',
    on_hold: false,
    probability: stageInfo(cfg, 'Lead').probability,
    priority: 'Medium',
    go_no_go: 'Pending',
    go_no_go_on: null,
    received_on: todayIso(),
    qa_due: null,
    submission_due: null,
    submitted_on: null,
    expected_decision_on: null,
    expected_start_on: null,
    closed_on: null,
    currency: 'EUR',
    est_value: null,
    effort_person_months: null,
    duration_months: null,
    pricing_model: null,
    incumbent: null,
    competitors: [],
    outcome_reason: null,
    next_action: null,
    next_action_due: null,
    tags: [],
    links: [],
  });
}

async function renderDealForm(req, res, { existing, values, errors = {}, formErrors = [], status: code = 200 }) {
  const { store } = req.app.locals;
  const cfg = store.config();
  await renderPage(req, res, 'deals/form', {
    // Whether a field is shown for a type, given its current value (see showField in models.js).
    shows: (key, type, value) => showField(cfg, { type, [key]: value }, key),
    title: existing ? `Edit ${existing.id}` : 'New opportunity',
    active: 'deals',
    existing,
    values,
    errors,
    formErrors,
    action: existing ? `/opportunities/${existing.id}` : '/opportunities',
    customerNames: store.listCustomers().map((c) => c.name),
    personNames: store.listPeople().filter((p) => p.active).map((p) => p.name),
  }, code);
}

/** Where a row action returns: the Visits page when the row came from there, otherwise the customer page. */
const backTo = (req, customer) => (req.body.next === '/visits' ? '/visits' : `/customers/${customer.id}`);

/** Shared by create and update: parse, pull (on create), save, then redirect to the opportunity. */
async function saveDealFromForm(req, res, { existing }) {
  const { store } = req.app.locals;
  const values = req.body;
  const { typed, errors } = parseDealValues(values);
  if (Object.keys(errors).length) return renderDealForm(req, res, { existing, values, errors, status: 422 });

  if (!existing) await pullBeforeCreate(req);
  try {
    const { deal, createdNames, warnings } = await saveDeal(store, typed, { existing, today: todayIso() });
    const parts = [existing ? 'Saved' : 'Created'];
    if (createdNames.length) parts.push(`created ${createdNames.join(', ')}`);
    flash(res, warnings.length ? 'warning' : 'success', [parts.join(' · '), ...warnings].join(' · '));
    return res.redirect(303, `/opportunities/${deal.id}`);
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    return renderDealForm(req, res, { existing, values, formErrors: err.errors.map(plain), status: 422 });
  }
}

/**
 * Ask fields from a form. Only the keys present in `body` are returned, so a status-only
 * change does not clear the text. Returns { values } or { error }.
 */
function askFields(store, body) {
  const values = {};
  if ('text' in body) {
    const text = clean(body.text);
    if (!text) return { error: 'Write what is being asked.' };
    values.text = text;
  }
  if ('assignee_id' in body) {
    const id = clean(body.assignee_id);
    if (id && !store.getPerson(id)) return { error: 'Choose the assignee from the list.' };
    values.assignee_id = id || null;
  }
  if ('due_on' in body) {
    const due = clean(body.due_on);
    if (due && !isIsoDate(due)) return { error: 'Enter a real date for the due date.' };
    values.due_on = due || null;
  }
  if ('status' in body) {
    const status = clean(body.status);
    if (!ASK_STATUSES.includes(status)) return { error: 'Choose a status from the list.' };
    values.status = status;
  }
  return { values };
}

/** Saves a supporter or ask change made on the opportunity page: one commit, then back to the opportunity. */
async function saveSupportChange(req, res, deal, next, { entries, message, success }) {
  const { store } = req.app.locals;
  const updated = { ...next, history: [...deal.history, ...entries] };
  try {
    await store.save([updated], `${deal.id}: ${message}`);
    flash(res, 'success', success);
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    flash(res, 'error', err.errors.map(plain).join('; '));
  }
  return res.redirect(303, `/opportunities/${deal.id}`);
}

/** Shows a message on the opportunity page and changes nothing. */
function supportError(res, deal, text) {
  flash(res, 'error', text);
  return res.redirect(303, `/opportunities/${deal.id}`);
}

/** Applies a single change to an existing deal (stage, hold, next action) through the normal save path. */
async function changeDeal(req, res, id, change, successText) {
  const { store } = req.app.locals;
  const existing = store.getDeal(id);
  if (!existing) return notFound(req, res, 'This opportunity');
  const typed = { ...dealToTyped(existing, store), ...change };
  try {
    await saveDeal(store, typed, { existing, today: todayIso() });
    flash(res, 'success', successText);
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    flash(res, 'error', err.errors.map(plain).join('; '));
  }
  return res.redirect(303, safeBackPath(req, `/opportunities/${id}`));
}

// ---------------------------------------------------------------- customers and people

function customerRows(store, cfg, today) {
  return store.listCustomers().map((c) => {
    const deals = store.listDeals().filter((d) => d.customer_id === c.id);
    const open = deals.filter((d) => isOpen(d, cfg));
    const last = [c.updated_at, ...deals.map((d) => d.updated_at)].sort().at(-1);
    return {
      customer: c,
      accountManager: store.getPerson(c.account_manager_id)?.name ?? '—',
      openCount: open.length,
      openTotals: moneyTotals(open.map((d) => [d.currency, d.est_value]), cfg),
      lastActivity: last,
      connects: connectSummary(c.connects),
      connect: connectState(c, today, cfg.connect_after_days),
      today,
    };
  });
}

function personRows(store, cfg, role) {
  return store
    .listPeople()
    .filter((p) => !role || p.role === role)
    .map((p) => {
      const involved = store.listDeals().filter(
        (d) => isOpen(d, cfg) && [d.sales_owner_id, d.presales_owner_id, d.delivery_owner_id, ...d.contact_ids].includes(p.id),
      );
      return {
        person: p,
        customerName: store.getCustomer(p.customer_id)?.name ?? '',
        openDeals: involved.length,
      };
    });
}

async function renderCustomerForm(req, res, { existing, values, errors = {}, status: code = 200 }) {
  const { store } = req.app.locals;
  await renderPage(req, res, 'customers/form', {
    title: existing ? `Edit ${existing.name}` : 'New customer',
    active: 'customers',
    existing,
    values,
    errors,
    action: existing ? `/customers/${existing.id}` : '/customers',
    personNames: store.listPeople().filter((p) => p.active).map((p) => p.name),
  }, code);
}

/** New and edit form for an internal activity. Owners are the active people. */
async function renderActivityForm(req, res, { existing, values, errors = {}, status: code = 200 }) {
  const { store } = req.app.locals;
  await renderPage(req, res, 'activities/form', {
    title: existing ? `Edit ${existing.id}` : 'New activity',
    active: 'activities',
    existing,
    values,
    errors,
    kinds: ACTIVITY_KINDS,
    statuses: ACTIVITY_STATUSES,
    people: store.listPeople().filter((p) => p.active),
    action: existing ? `/activities/${existing.id}` : '/activities',
  }, code);
}

async function renderPersonForm(req, res, { existing, values, errors = {}, status: code = 200 }) {
  const { store } = req.app.locals;
  await renderPage(req, res, 'people/form', {
    title: existing ? `Edit ${existing.name}` : 'New person',
    active: 'people',
    existing,
    values,
    errors,
    roles: ROLES,
    customers: store.listCustomers(),
    action: existing ? `/people/${existing.id}` : '/people',
  }, code);
}

// ---------------------------------------------------------------- routes

export function createRouter() {
  const router = Router();

  // Old links and bookmarks: /deals… is now /opportunities….
  router.use('/deals', (req, res) => res.redirect(308, req.originalUrl.replace(/^\/deals/, '/opportunities')));
  router.get('/export/deals.xlsx', (req, res) => res.redirect(308, req.originalUrl.replace('/export/deals.xlsx', '/export/opportunities.xlsx')));

  // ------------------------------------------------ dashboard, first run, sync
  router.get('/', async (req, res) => {
    const { store } = req.app.locals;
    const cfg = store.config();
    const today = todayIso();
    const me = cfg.me_person_id ? store.getPerson(cfg.me_person_id) : null;
    const tags = tagsFrom(req.query, cfg);
    const view = me ? dashboardView(store, cfg, today, me, tags) : null;
    await renderPage(req, res, 'dashboard', dashboardData(store, {
      view,
      greeting: greeting(),
      firstName: me ? me.name.split(' ')[0] : '',
      tags,
      tagQuery: otherQuery(req.query),
    }));
  });

  // First-run form: who is using this tracker. Creates a Presales person and sets me_person_id.
  router.post('/setup', async (req, res) => {
    const { store } = req.app.locals;
    const values = { name: clean(req.body.name), email: clean(req.body.email) };
    const errors = {};
    if (!values.name) errors.name = 'Enter your name.';
    if (values.email && !EMAIL_RE.test(values.email)) errors.email = 'Enter a valid email address.';
    if (Object.keys(errors).length) {
      return renderPage(req, res, 'dashboard', dashboardData(store, { values, errors }), 422);
    }

    const id = await store.nextId('person');
    const now = nowIso();
    const person = {
      schema_version: 1,
      id,
      name: values.name,
      role: 'Presales',
      title: null,
      email: values.email || null,
      phone: null,
      customer_id: null,
      notes: '',
      active: true,
      created_at: now,
      updated_at: now,
    };
    const config = { ...store.config(), me_person_id: id };
    await store.save([person], `${id}: created – ${values.name}`, { config });
    flash(res, 'success', `Saved. Welcome, ${values.name}.`);
    res.redirect(303, '/');
  });

  router.get('/api/sync/status', async (req, res) => {
    const { git } = req.app.locals;
    res.json(await git.status());
  });

  // Pull, reload if anything changed, then push. Returns to the page the user came from.
  router.post('/sync', async (req, res) => {
    const { git, store } = req.app.locals;
    const pull = await git.pull();
    if (pull.changed) await store.loadAll();

    const pushed = pull.ok && (await git.pushNow());
    if (!pull.ok) {
      flash(res, 'error', `Sync failed: ${pull.error}`);
    } else if (pushed) {
      flash(res, 'success', 'Synced with remote.');
    } else {
      const state = await git.status();
      if (state.state === 'local') {
        flash(res, 'warning', 'No git remote is configured, so changes stay on this computer.');
      } else {
        flash(res, 'error', `Not pushed: ${state.lastError ?? 'nothing to push'}`);
      }
    }
    res.redirect(303, safeBackPath(req));
  });

  // ------------------------------------------------ deals
  router.get('/opportunities', async (req, res) => {
    const { store } = req.app.locals;
    const cfg = store.config();
    const today = todayIso();
    const listing = listDeals(store, cfg, today, req.query);
    await renderPage(req, res, 'deals/list', {
      title: 'Opportunities',
      active: 'deals',
      ...listing,
      summary: opportunitySummary(store, cfg, today, tagsFrom(req.query, cfg)),
      tagQuery: otherQuery(req.query),
      today,
      customers: store.listCustomers(),
      people: store.listPeople(),
      healthLevels: ['red', 'amber', 'green', 'hold', 'closed'],
    });
  });

  router.get('/opportunities/new', async (req, res) => {
    const { store } = req.app.locals;
    const cfg = store.config();
    const values = newDealValues(store, cfg, clean(req.query.customer));
    await renderDealForm(req, res, { existing: null, values });
  });

  router.post('/opportunities', (req, res) => saveDealFromForm(req, res, { existing: null }));

  router.get('/opportunities/:id', async (req, res) => {
    const { store } = req.app.locals;
    const deal = ID_RE.deal.test(req.params.id) ? store.getDeal(req.params.id) : null;
    if (!deal) return notFound(req, res, 'This opportunity');
    const cfg = store.config();
    const today = todayIso();
    const openStages = cfg.stages.filter((s) => !s.terminal);
    const terminal = stageInfo(cfg, deal.stage)?.terminal ?? false;
    const currentOpen = openStages.findIndex((s) => s.name === deal.stage);
    const stepper = openStages.map((s, i) => ({
      name: s.name,
      state: terminal || i < currentOpen ? 'past' : i === currentOpen ? 'current' : 'future',
    }));
    const person = (id) => store.getPerson(id);
    await renderPage(req, res, 'deals/detail', {
      title: deal.id,
      active: 'deals',
      deal,
      row: dealRow(deal, store, cfg, today),
      customer: store.getCustomer(deal.customer_id),
      owners: {
        sales: person(deal.sales_owner_id)?.name ?? null,
        presales: person(deal.presales_owner_id)?.name ?? null,
        delivery: person(deal.delivery_owner_id)?.name ?? null,
      },
      contacts: deal.contact_ids.map((id) => person(id)).filter(Boolean),
      stepper,
      outcomeState: terminal ? 'current' : 'future',
      outcomeName: terminal ? deal.stage : null,
      timeline: [...deal.history].reverse(),
      visible: (key) => showField(cfg, deal, key),
      supporters: deal.support_ids.map((id) => person(id)).filter(Boolean),
      asks: deal.support_requests.map((ask) => ({
        ask,
        assigneeName: person(ask.assignee_id)?.name ?? '',
        open: isOpenAsk(ask),
        overdue: askOverdue(ask, today),
      })),
      activePeople: store.listPeople().filter((p) => p.active),
      addablePeople: store.listPeople().filter(
        (p) => p.active && !deal.support_ids.includes(p.id) && ![deal.sales_owner_id, deal.presales_owner_id, deal.delivery_owner_id].includes(p.id),
      ),
      askStatuses: ASK_STATUSES,
      today,
    });
  });

  router.get('/opportunities/:id/edit', async (req, res) => {
    const { store } = req.app.locals;
    const deal = store.getDeal(req.params.id);
    if (!deal) return notFound(req, res, 'This opportunity');
    await renderDealForm(req, res, { existing: deal, values: typedToValues(dealToTyped(deal, store)) });
  });

  router.post('/opportunities/:id', async (req, res) => {
    const { store } = req.app.locals;
    const deal = store.getDeal(req.params.id);
    if (!deal) return notFound(req, res, 'This opportunity');
    return saveDealFromForm(req, res, { existing: deal });
  });

  router.post('/opportunities/:id/stage', async (req, res) => {
    const { store } = req.app.locals;
    const stage = clean(req.body.stage);
    const info = stageInfo(store.config(), stage);
    if (!info) {
      flash(res, 'error', 'Unknown stage.');
      return res.redirect(303, `/opportunities/${req.params.id}`);
    }
    const reason = clean(req.body.outcome_reason) || null;
    const outcome = info.outcome;
    if ((outcome === 'lost' || outcome === 'dropped') && !reason) {
      flash(res, 'error', `Choose a reason before marking the opportunity ${info.name}.`);
      return res.redirect(303, `/opportunities/${req.params.id}`);
    }
    return changeDeal(req, res, req.params.id, { stage, outcome_reason: reason ?? null }, `Stage: ${stage}`);
  });

  router.post('/opportunities/:id/hold', async (req, res) => {
    const { store } = req.app.locals;
    const deal = store.getDeal(req.params.id);
    if (!deal) return notFound(req, res, 'This opportunity');
    return changeDeal(req, res, req.params.id, { on_hold: !deal.on_hold }, deal.on_hold ? 'Resumed' : 'Put on hold');
  });

  router.post('/opportunities/:id/next-action', async (req, res) => {
    const change = {
      next_action: clean(req.body.next_action) || null,
      next_action_due: clean(req.body.next_action_due) || null,
    };
    return changeDeal(req, res, req.params.id, change, 'Next action updated');
  });

  router.post('/opportunities/:id/next-action/done', async (req, res) => {
    const { store } = req.app.locals;
    const deal = store.getDeal(req.params.id);
    if (!deal) return notFound(req, res, 'This opportunity');
    const done = markNextActionDone(deal, { today: todayIso(), at: nowIso() });
    if (!done) return supportError(res, deal, 'There is no next action to mark done.');
    return saveSupportChange(req, res, deal, done.deal, { entries: [done.entry], message: 'next action done', success: 'Next action marked done.' });
  });

  router.post('/opportunities/:id/notes', async (req, res) => {
    const { store } = req.app.locals;
    const deal = store.getDeal(req.params.id);
    if (!deal) return notFound(req, res, 'This opportunity');
    const text = clean(req.body.note);
    if (!text) {
      flash(res, 'error', 'Write a note first.');
      return res.redirect(303, `/opportunities/${deal.id}`);
    }
    const now = nowIso();
    const updated = { ...deal, history: [...deal.history, noteEntry(text, now)] };
    try {
      await store.save([updated], `${deal.id}: note added`);
      flash(res, 'success', 'Note added.');
    } catch (err) {
      if (!(err instanceof ValidationError)) throw err;
      flash(res, 'error', err.errors.map(plain).join('; '));
    }
    return res.redirect(303, `/opportunities/${deal.id}`);
  });

  router.post('/opportunities/:id/delete', async (req, res) => {
    const { store } = req.app.locals;
    const deal = store.getDeal(req.params.id);
    if (!deal) return notFound(req, res, 'This opportunity');
    if (!typedRight(req, deal.id)) {
      flash(res, 'error', `Nothing was deleted. Type ${deal.id} exactly to delete it.`);
      return res.redirect(303, `/opportunities/${deal.id}`);
    }
    await store.delete(deal, `${deal.id}: deleted`);
    flash(res, 'success', `Deleted ${deal.id}.`);
    return res.redirect(303, '/opportunities');
  });

  // ------------------------------------------------ RFQs I support and my asks (PLAN.md §15.3)
  // The support page shows the current user's RFQs by default. ?who=<person id> shows a colleague's.
  // Wins by year has its own page, so the dashboard stays about the open work.
  router.get('/wins', async (req, res) => {
    const { store } = req.app.locals;
    const cfg = store.config();
    await renderPage(req, res, 'wins', { title: 'Wins', active: 'wins', wins: winsByYear(store.listDeals(), cfg, todayIso()) });
  });

  router.get('/support', async (req, res) => {
    const { store } = req.app.locals;
    const cfg = store.config();
    const today = todayIso();
    const me = cfg.me_person_id ? store.getPerson(cfg.me_person_id) : null;
    const whoParam = clean(req.query.who);
    const who = whoParam && whoParam !== 'me' ? store.getPerson(whoParam) : me;
    // Without a person, no deal matches: the id 'nobody' is never a real person.
    const listing = listDeals(store, cfg, today, { ...req.query, support: who?.id ?? 'nobody' });
    const rows = listing.rows.map((r) => {
      const mine = openAsks(r.deal).filter((a) => a.assignee_id === who?.id);
      const dates = mine.map((a) => a.due_on).filter(Boolean).sort();
      return { ...r, myOpenAsks: mine.length, myNextDue: dates[0] ?? null };
    });
    await renderPage(req, res, 'support/list', {
      title: 'RFQs I support',
      active: 'support',
      rows,
      filter: listing.filter,
      who,
      noUser: !who,
      people: store.listPeople().filter((p) => p.active),
      selfId: me?.id ?? null,
    });
  });

  router.get('/support/asks', async (req, res) => {
    const { store } = req.app.locals;
    const today = todayIso();
    const me = store.config().me_person_id ? store.getPerson(store.config().me_person_id) : null;
    const rows = me
      ? asksFor(store.listDeals(), me.id).map(({ deal, ask }) => ({
        deal,
        ask,
        customerName: store.getCustomer(deal.customer_id)?.name ?? '—',
        overdue: askOverdue(ask, today),
      }))
      : [];
    await renderPage(req, res, 'support/asks', { title: 'My asks', active: 'asks', rows, noUser: !me });
  });

  // ------------------------------------------------ supporters and asks (PLAN.md §15)
  // Supporters: action 'add' or 'remove' with person_id.
  router.post('/opportunities/:id/support', async (req, res) => {
    const { store } = req.app.locals;
    const deal = store.getDeal(req.params.id);
    if (!deal) return notFound(req, res, 'This opportunity');
    const person = store.getPerson(clean(req.body.person_id));
    if (!person) return supportError(res, deal, 'Choose a person first.');
    const owners = [deal.sales_owner_id, deal.presales_owner_id, deal.delivery_owner_id];
    const action = clean(req.body.action);
    const result = changeSupporters(deal, {
      action,
      person,
      owners,
      at: nowIso(),
      names: (id) => store.getPerson(id)?.name ?? id,
    });
    if (result.error) return supportError(res, deal, result.error);
    const success = action === 'add' ? `${person.name} added as a supporter.` : `${person.name} removed as a supporter.`;
    return saveSupportChange(req, res, deal, result.deal, { entries: [result.entry], message: 'supporters updated', success });
  });

  router.post('/opportunities/:id/asks', async (req, res) => {
    const { store } = req.app.locals;
    const deal = store.getDeal(req.params.id);
    if (!deal) return notFound(req, res, 'This opportunity');
    const form = askFields(store, { assignee_id: '', due_on: '', ...req.body, text: req.body.text ?? '' });
    if (form.error) return supportError(res, deal, form.error);
    const now = nowIso();
    const { deal: next, ask } = addAsk(deal, { text: form.values.text, assignee_id: form.values.assignee_id ?? null, due_on: form.values.due_on ?? null }, now);
    return saveSupportChange(req, res, deal, next, {
      entries: askEntries(null, ask, { at: now }),
      message: `ask ${ask.id} added`,
      success: `Ask ${ask.id} added.`,
    });
  });

  router.post('/opportunities/:id/asks/:askId', async (req, res) => {
    const { store } = req.app.locals;
    const deal = store.getDeal(req.params.id);
    if (!deal) return notFound(req, res, 'This opportunity');
    const before = deal.support_requests.find((a) => a.id === req.params.askId);
    if (!before) return supportError(res, deal, 'That ask no longer exists.');
    const form = askFields(store, req.body);
    if (form.error) return supportError(res, deal, form.error);
    const now = nowIso();
    const next = changeAsk(deal, before.id, form.values, { today: todayIso(), now });
    const after = findAsk(next, before.id);
    const names = (id) => store.getPerson(id)?.name ?? id;
    return saveSupportChange(req, res, deal, next, {
      entries: askEntries(before, after, { at: now, names }),
      message: `ask ${before.id} updated`,
      success: `Ask ${before.id} saved.`,
    });
  });

  router.post('/opportunities/:id/asks/:askId/delete', async (req, res) => {
    const { store } = req.app.locals;
    const deal = store.getDeal(req.params.id);
    if (!deal) return notFound(req, res, 'This opportunity');
    const before = deal.support_requests.find((a) => a.id === req.params.askId);
    if (!before) return supportError(res, deal, 'That ask no longer exists.');
    return saveSupportChange(req, res, deal, removeAsk(deal, before.id), {
      entries: [removedEntry(before, nowIso())],
      message: `ask ${before.id} removed`,
      success: `Ask ${before.id} removed.`,
    });
  });

  // ------------------------------------------------ customers
  router.get('/customers', async (req, res) => {
    const { store } = req.app.locals;
    const cfg = store.config();
    const words = searchWords(req.query.q);
    // Search covers the name, short name, industry, region, country, BU, tags, C4C id, website, notes and account manager.
    const rows = customerRows(store, cfg, todayIso()).filter((r) => {
      const c = r.customer;
      return matchesSearch([c.name, c.short_name, c.industry, c.region, c.country, c.bu, c.tags, c.c4c_account_id, c.website, c.notes, r.accountManager], words);
    });
    const q = clean(req.query.q);
    await renderPage(req, res, 'customers/list', { title: 'Customers', active: 'customers', rows, q, searching: q !== '' });
  });

  router.get('/customers/new', async (req, res) => {
    await renderCustomerForm(req, res, { existing: null, values: { name: '', short_name: '', industry: '', region: '', country: '', bu: '', account_manager: '', c4c_account_id: '', website: '', tags: '', notes: '' } });
  });

  router.post('/customers', async (req, res) => {
    const { store } = req.app.locals;
    const { typed, errors } = parseCustomerValues(req.body);
    if (Object.keys(errors).length) return renderCustomerForm(req, res, { existing: null, values: req.body, errors, status: 422 });
    await pullBeforeCreate(req);
    try {
      const { customer, createdNames } = await saveCustomer(store, typed, { existing: null });
      const extra = createdNames.length ? ` · created ${createdNames.join(', ')}` : '';
      flash(res, 'success', `Created ${customer.name}${extra}`);
      return res.redirect(303, `/customers/${customer.id}`);
    } catch (err) {
      if (!(err instanceof ValidationError)) throw err;
      return renderCustomerForm(req, res, { existing: null, values: req.body, errors: { name: plain(err.errors[0]) }, status: 422 });
    }
  });

  router.get('/customers/:id', async (req, res) => {
    const { store } = req.app.locals;
    const customer = ID_RE.customer.test(req.params.id) ? store.getCustomer(req.params.id) : null;
    if (!customer) return notFound(req, res, 'This customer');
    const cfg = store.config();
    const today = todayIso();
    const deals = store.listDeals().filter((d) => d.customer_id === customer.id);
    const rows = deals.map((d) => dealRow(d, store, cfg, today));
    await renderPage(req, res, 'customers/detail', {
      title: customer.name,
      active: 'customers',
      customer,
      accountManager: store.getPerson(customer.account_manager_id)?.name ?? null,
      contacts: store.listPeople().filter((p) => p.customer_id === customer.id),
      openRows: rows.filter((r) => r.open),
      closedRows: rows.filter((r) => !r.open),
      connects: [...customer.connects]
        .sort((a, b) => b.on.localeCompare(a.on))
        .map((c) => ({ ...c, whoName: store.getPerson(c.who_id)?.name ?? '—' })),
      connect: connectState(customer, today, cfg.connect_after_days),
      planned: plannedConnects(customer.connects, today).map((c) => ({ ...c, whoName: store.getPerson(c.who_id)?.name ?? '—' })),
      visits: visitCounts(customer.connects, today.slice(0, 4)),
      people: store.listPeople().filter((p) => p.active),
      today,
    });
  });

  // ------------------------------------------------ customer visits page (data entry) (PLAN.md §20)
  // Every visit to the EI centre or a customer's premises, across all customers, with a form to log one.
  const VISIT_ENTRY_KINDS = ['EI center visit', 'Customer premises visit'];

  function visitRowsFor(store, today) {
    return store
      .listCustomers()
      .flatMap((c) => c.connects.filter(isVisit).map((x) => ({
        ...x,
        status: x.status ?? 'Done',
        customerId: c.id,
        customer: c.name,
        whoName: store.getPerson(x.who_id)?.name ?? '—',
      })))
      .sort((a, b) => b.on.localeCompare(a.on) || a.customer.localeCompare(b.customer));
  }

  async function renderVisits(req, res, { values = {}, errors = {}, status: code = 200, filter = '' }) {
    const { store } = req.app.locals;
    const today = todayIso();
    const rows = visitRowsFor(store, today).filter((v) => !filter || v.status === filter);
    await renderPage(req, res, 'visits', {
      title: 'Customer visits',
      active: 'visits',
      rows,
      filter,
      values: { on: today, kind: VISIT_ENTRY_KINDS[0], status: 'Done', customer: '', sales_lead: '', with: '', note: '', ...values },
      errors,
      kinds: VISIT_ENTRY_KINDS,
      customers: store.listCustomers(),
      people: store.listPeople().filter((p) => p.active),
      today,
    }, code);
  }

  router.get('/visits', async (req, res) => {
    const filter = ['Planned', 'Done'].includes(req.query.status) ? req.query.status : '';
    const values = req.query.customer ? { customer: req.app.locals.store.getCustomer(String(req.query.customer))?.name ?? '' } : {};
    await renderVisits(req, res, { filter, values });
  });

  router.post('/visits', async (req, res) => {
    const { store } = req.app.locals;
    const name = String(req.body.customer ?? '').trim();
    const errors = {};
    if (!name) errors.customer = 'Type the customer name.';
    // The visit is checked before anything is created, so a refused form leaves no new customer behind.
    // The sales lead is typed as a name, so the visit is checked without a person id; the id is set below.
    const { entry, errors: formErrors } = newConnect({ ...req.body, who_id: '' }, { id: randomUUID().slice(0, 8), people: [], today: todayIso() });
    if (entry && !VISIT_ENTRY_KINDS.includes(entry.kind)) formErrors.push('Pick a visit: to the EI centre or to customer premises.');
    if (Object.keys(errors).length || formErrors.length) {
      return renderVisits(req, res, { values: req.body, errors: { ...errors, form: formErrors.join(' ') }, status: 422 });
    }
    try {
      // A new customer or a new sales lead is created in the same commit as the visit (as opportunities do).
      const pending = [];
      const createdNames = [];
      const leadName = String(req.body.sales_lead ?? '').trim();
      const lead = leadName ? await ensurePerson(store, leadName, 'Sales', null, pending, createdNames) : null;
      const found = await ensureCustomer(store, name, pending, createdNames);
      const base = pending.find((c) => c.id === found.id) ?? found;
      const saved = { ...base, connects: [...(base.connects ?? []), { ...entry, who_id: lead?.id ?? null }] };
      const others = pending.filter((c) => c.id !== base.id);
      const extra = createdNames.length ? ` · created ${createdNames.join(', ')}` : '';
      await store.save([...others, saved], `${base.id}: visit ${entry.kind} on ${entry.on} (${entry.status})${extra}`);
      flash(res, 'success', `${entry.status === 'Planned' ? 'Planned' : 'Logged'} visit to ${base.name} on ${entry.on}.${extra}`);
      return res.redirect(303, '/visits');
    } catch (err) {
      if (!(err instanceof ValidationError)) throw err;
      return renderVisits(req, res, { values: req.body, errors: { form: err.errors.map(plain).join('; ') }, status: 422 });
    }
  });

  // Connects (Teams meetings and visits) are logged on the customer. Each one is saved as its own change.
  router.post('/customers/:id/connects', async (req, res) => {
    const { store } = req.app.locals;
    const customer = store.getCustomer(req.params.id);
    if (!customer) return notFound(req, res, 'This customer');
    const today = todayIso();
    const { entry, errors } = newConnect(req.body, { id: randomUUID().slice(0, 8), people: store.listPeople().filter((p) => p.active), today });
    if (errors.length) {
      flash(res, 'error', errors.join(' '));
      return res.redirect(303, `/customers/${customer.id}`);
    }
    try {
      await store.save([{ ...customer, connects: [...customer.connects, entry] }], `${customer.id}: connect ${entry.kind} on ${entry.on}`);
      flash(res, 'success', `Connect logged for ${entry.on}.`);
    } catch (err) {
      if (!(err instanceof ValidationError)) throw err;
      flash(res, 'error', err.errors.map(plain).join('; '));
    }
    return res.redirect(303, `/customers/${customer.id}`);
  });

  // A planned visit that has happened is marked Done. It cannot be done before its date.
  router.post('/customers/:id/connects/:connectId/done', async (req, res) => {
    const { store } = req.app.locals;
    const customer = store.getCustomer(req.params.id);
    if (!customer) return notFound(req, res, 'This customer');
    const today = todayIso();
    const planned = customer.connects.find((c) => c.id === req.params.connectId && !isDone(c));
    if (!planned) {
      flash(res, 'error', 'That planned visit no longer exists.');
    } else if (planned.on > today) {
      flash(res, 'error', `It is on ${planned.on}, so it can be marked done from that day.`);
    } else {
      const connects = customer.connects.map((c) => (c.id === planned.id ? { ...c, status: 'Done' } : c));
      await store.save([{ ...customer, connects }], `${customer.id}: ${planned.kind} on ${planned.on} done`);
      flash(res, 'success', 'Marked as done.');
    }
    return res.redirect(303, backTo(req, customer));
  });

  router.post('/customers/:id/connects/:connectId/delete', async (req, res) => {
    const { store } = req.app.locals;
    const customer = store.getCustomer(req.params.id);
    if (!customer) return notFound(req, res, 'This customer');
    const gone = customer.connects.find((c) => c.id === req.params.connectId);
    if (!gone) {
      flash(res, 'error', 'That connect no longer exists.');
      return res.redirect(303, backTo(req, customer));
    }
    await store.save([{ ...customer, connects: customer.connects.filter((c) => c.id !== gone.id) }], `${customer.id}: connect on ${gone.on} removed`);
    flash(res, 'success', 'Connect removed.');
    return res.redirect(303, backTo(req, customer));
  });

  router.get('/customers/:id/edit', async (req, res) => {
    const { store } = req.app.locals;
    const customer = store.getCustomer(req.params.id);
    if (!customer) return notFound(req, res, 'This customer');
    await renderCustomerForm(req, res, { existing: customer, values: customerToValues(customer, store) });
  });

  router.post('/customers/:id', async (req, res) => {
    const { store } = req.app.locals;
    const customer = store.getCustomer(req.params.id);
    if (!customer) return notFound(req, res, 'This customer');
    const { typed, errors } = parseCustomerValues(req.body);
    if (Object.keys(errors).length) return renderCustomerForm(req, res, { existing: customer, values: req.body, errors, status: 422 });
    try {
      await saveCustomer(store, typed, { existing: customer });
      flash(res, 'success', 'Customer saved.');
      return res.redirect(303, `/customers/${customer.id}`);
    } catch (err) {
      if (!(err instanceof ValidationError)) throw err;
      return renderCustomerForm(req, res, { existing: customer, values: req.body, errors: { name: plain(err.errors[0]) }, status: 422 });
    }
  });

  router.post('/customers/:id/delete', async (req, res) => {
    const { store } = req.app.locals;
    const customer = store.getCustomer(req.params.id);
    if (!customer) return notFound(req, res, 'This customer');
    if (!typedRight(req, customer.name)) {
      flash(res, 'error', `Nothing was deleted. Type ${customer.name} exactly to delete it.`);
      return res.redirect(303, `/customers/${customer.id}`);
    }
    try {
      await store.delete(customer, `${customer.id}: deleted`);
      flash(res, 'success', `Deleted ${customer.name}.`);
      return res.redirect(303, '/customers');
    } catch (err) {
      flash(res, 'error', err.message);
      return res.redirect(303, `/customers/${customer.id}`);
    }
  });

  // ------------------------------------------------ export
  router.get('/export/opportunities.xlsx', async (req, res) => {
    const { store } = req.app.locals;
    const today = todayIso();
    const { rows } = listDeals(store, store.config(), today, req.query);
    const buffer = await dealsWorkbook(rows, store);
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition', `attachment; filename="opportunities-${today.replaceAll('-', '')}.xlsx"`);
    res.send(Buffer.from(buffer));
  });

  // The pipeline as JSON, on a page with a Copy button (like the weekly report). Same list filters.
  router.get('/export/pipeline', async (req, res) => {
    const { store } = req.app.locals;
    const today = todayIso();
    const { rows } = listDeals(store, store.config(), today, req.query);
    const records = pipelineRecords(rows, store);
    const query = new URLSearchParams(req.query).toString();
    await renderPage(req, res, 'export-pipeline', {
      title: 'Pipeline export',
      active: 'deals',
      json: JSON.stringify(records, null, 2),
      count: records.length,
      excelHref: `/export/pipeline.xlsx${query ? '?' + query : ''}`,
    });
  });

  // The pipeline share sheet: the same list filters as the opportunities list (open by default).
  router.get('/export/pipeline.xlsx', async (req, res) => {
    const { store } = req.app.locals;
    const today = todayIso();
    const { rows } = listDeals(store, store.config(), today, req.query);
    const buffer = await pipelineWorkbook(rows, store);
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition', `attachment; filename="pipeline-${today.replaceAll('-', '')}.xlsx"`);
    res.send(Buffer.from(buffer));
  });

  // ------------------------------------------------ weekly report
  router.get('/report/weekly', async (req, res) => {
    const { store } = req.app.locals;
    const week = isIsoDate(req.query.week) ? req.query.week : todayIso();
    const start = mondayOf(week);
    await renderPage(req, res, 'report-weekly', {
      title: 'Weekly report',
      active: '',
      markdown: weeklyReport(store, start),
      start,
      prev: addDays(start, -7),
      next: addDays(start, 7),
    });
  });

  // ------------------------------------------------ settings
  router.get('/settings', async (req, res) => renderSettings(req, res, {}));

  router.post('/settings', async (req, res) => {
    const { store } = req.app.locals;
    const cfg = store.config();
    const body = req.body;
    const me = cfg.me_person_id ? store.getPerson(cfg.me_person_id) : null;
    const values = settingsValues(body);
    const errors = {};
    const list = (key) => unique(lines(values[key]));

    if (me) {
      if (!values.name) errors.name = 'Enter your name.';
      if (values.email && !EMAIL_RE.test(values.email)) errors.email = 'Enter a valid email address.';
    }
    const stale = Number(values.stale_after_days);
    if (!Number.isInteger(stale) || stale < 1) errors.stale_after_days = 'Enter a whole number of days, 1 or more.';
    // A form that does not send the connect setting leaves it as it is.
    const connectSent = body.connect_after_days !== undefined;
    const connectAfter = connectSent ? Number(values.connect_after_days) : cfg.connect_after_days;
    if (connectSent && (!Number.isInteger(connectAfter) || connectAfter < 1)) errors.connect_after_days = 'Enter a whole number of days, 1 or more.';
    for (const key of LIST_KEYS) {
      // Tags are optional: an empty tag list is allowed.
      if (key !== 'tags' && list(key).length === 0) errors[key] = 'Keep at least one item.';
    }
    // A tag can be removed only when no deal uses it. A form that does not send tags leaves them as they are.
    const tagsSent = body.tags !== undefined;
    const tags = tagsSent ? resolveTags(lines(values.tags), []).tags : cfg.tags;
    if (tagsSent) {
      for (const tag of cfg.tags.filter((t) => !tags.includes(t))) {
        const used = store.listDeals().filter((d) => d.tags.includes(tag)).length;
        if (used) {
          errors.tags = `'${tag}' is used by ${used} ${used === 1 ? 'opportunity' : 'opportunities'}. Remove it from them first.`;
          break;
        }
      }
    }

    if (Object.keys(errors).length) return renderSettings(req, res, { values, errors, status: 422 });

    const newCfg = {
      ...cfg,
      stale_after_days: stale,
      connect_after_days: connectAfter,
      business_units: list('business_units'),
      regions: list('regions'),
      pricing_models: list('pricing_models'),
      sources: list('sources'),
      outcome_reasons: list('outcome_reasons'),
      tags,
    };
    try {
      if (me) {
        const updated = { ...me, name: values.name, email: values.email || null };
        await store.save([updated], `${me.id}: updated`, { config: newCfg });
      } else {
        await store.saveConfig(newCfg);
      }
      flash(res, 'success', 'Settings saved.');
      return res.redirect(303, '/settings');
    } catch (err) {
      if (!(err instanceof ValidationError)) throw err;
      return renderSettings(req, res, { values, formErrors: err.errors.map(plain), status: 422 });
    }
  });

  // ------------------------------------------------ conflicts
  router.get('/conflicts', async (req, res) => {
    const { store } = req.app.locals;
    const entries = await store.conflictEntries();
    await renderPage(req, res, 'conflicts', { title: 'Sync conflicts', active: '', entries });
  });

  router.post('/conflicts/:file/resolve', async (req, res) => {
    const { store } = req.app.locals;
    try {
      await store.resolveConflict(req.params.file, clean(req.body.action));
      flash(res, 'success', req.body.action === 'use_theirs' ? 'Used the other version.' : 'Kept this version.');
    } catch (err) {
      flash(res, 'error', plain(err.message));
    }
    return res.redirect(303, '/conflicts');
  });

  // ------------------------------------------------ people
  router.get('/people', async (req, res) => {
    const { store } = req.app.locals;
    const role = ROLES.includes(req.query.role) ? req.query.role : '';
    const rows = personRows(store, store.config(), role);
    await renderPage(req, res, 'people/list', { title: 'People', active: 'people', rows, role, roles: ROLES });
  });

  router.get('/people/new', async (req, res) => {
    await renderPersonForm(req, res, { existing: null, values: { name: '', role: 'Sales', title: '', email: '', phone: '', customer_id: '', notes: '', active: 'on' } });
  });

  router.post('/people', async (req, res) => {
    const { store } = req.app.locals;
    const { typed, errors } = parsePersonValues(req.body);
    if (Object.keys(errors).length) return renderPersonForm(req, res, { existing: null, values: req.body, errors, status: 422 });
    await pullBeforeCreate(req);
    try {
      const { person } = await savePerson(store, typed, { existing: null });
      flash(res, 'success', `Created ${person.name}.`);
      return res.redirect(303, '/people');
    } catch (err) {
      if (!(err instanceof ValidationError)) throw err;
      return renderPersonForm(req, res, { existing: null, values: req.body, errors: { name: plain(err.errors[0]) }, status: 422 });
    }
  });

  router.get('/people/:id/edit', async (req, res) => {
    const { store } = req.app.locals;
    const person = store.getPerson(req.params.id);
    if (!person) return notFound(req, res, 'This person');
    await renderPersonForm(req, res, { existing: person, values: personToValues(person) });
  });

  router.post('/people/:id', async (req, res) => {
    const { store } = req.app.locals;
    const person = store.getPerson(req.params.id);
    if (!person) return notFound(req, res, 'This person');
    const { typed, errors } = parsePersonValues(req.body);
    if (Object.keys(errors).length) return renderPersonForm(req, res, { existing: person, values: req.body, errors, status: 422 });
    try {
      await savePerson(store, typed, { existing: person });
      flash(res, 'success', 'Person saved.');
      return res.redirect(303, '/people');
    } catch (err) {
      if (!(err instanceof ValidationError)) throw err;
      return renderPersonForm(req, res, { existing: person, values: req.body, errors: { name: plain(err.errors[0]) }, status: 422 });
    }
  });

  router.post('/people/:id/deactivate', async (req, res) => {
    const { store } = req.app.locals;
    const person = store.getPerson(req.params.id);
    if (!person) return notFound(req, res, 'This person');
    await savePerson(
      store,
      {
        name: person.name,
        role: person.role,
        title: person.title,
        email: person.email,
        phone: person.phone,
        customer_id: person.customer_id,
        notes: person.notes,
        active: false,
      },
      { existing: person },
    );
    flash(res, 'success', `${person.name} is now inactive.`);
    return res.redirect(303, '/people');
  });

  router.post('/people/:id/delete', async (req, res) => {
    const { store } = req.app.locals;
    const person = store.getPerson(req.params.id);
    if (!person) return notFound(req, res, 'This person');
    if (!typedRight(req, person.name)) {
      flash(res, 'error', `Nothing was deleted. Type ${person.name} exactly to delete it.`);
      return res.redirect(303, '/people');
    }
    try {
      await store.delete(person, `${person.id}: deleted`);
      flash(res, 'success', `Deleted ${person.name}.`);
    } catch (err) {
      flash(res, 'error', err.message);
    }
    return res.redirect(303, '/people');
  });

  // ------------------------------------------------ internal activities (PLAN.md §17)
  router.get('/activities', async (req, res) => {
    const { store } = req.app.locals;
    const cfg = store.config();
    const today = todayIso();
    const q = req.query.status ?? '';
    const kind = ACTIVITY_KINDS.includes(req.query.kind) ? req.query.kind : '';
    const statusFilter = ACTIVITY_STATUSES.includes(q) ? q : '';
    const rows = store
      .listActivities()
      .filter((a) => {
        if (statusFilter) return a.status === statusFilter;
        if (q === 'all') return true;
        return OPEN_ACTIVITY_STATUSES.includes(a.status);
      })
      .filter((a) => !kind || a.kind === kind)
      .map((a) => ({
        activity: a,
        owner: store.getPerson(a.owner_id)?.name ?? '—',
        ...activityQuiet(a, today, cfg.stale_after_days),
      }))
      .sort((a, b) => b.last.localeCompare(a.last));
    await renderPage(req, res, 'activities/list', {
      title: 'Activities',
      active: 'activities',
      rows,
      filter: { status: q, kind },
      kinds: ACTIVITY_KINDS,
      statuses: ACTIVITY_STATUSES,
    });
  });

  router.get('/activities/new', async (req, res) => {
    await renderActivityForm(req, res, {
      existing: null,
      values: { title: '', kind: 'Prototype', status: 'Idea', owner_id: '', start_on: '', target_on: '', description: '', links: '', tags: '' },
    });
  });

  router.post('/activities', async (req, res) => {
    const { store } = req.app.locals;
    const { typed, errors } = parseActivityForm(req.body);
    if (typed && typed.owner_id && !store.getPerson(typed.owner_id)) errors.owner_id = 'Pick a person from the list.';
    if (Object.keys(errors).length) return renderActivityForm(req, res, { existing: null, values: req.body, errors, status: 422 });
    try {
      const { activity } = await saveActivity(store, typed, { existing: null });
      flash(res, 'success', `Created ${activity.id}`);
      return res.redirect(303, `/activities/${activity.id}`);
    } catch (err) {
      if (!(err instanceof ValidationError)) throw err;
      return renderActivityForm(req, res, { existing: null, values: req.body, errors: { title: plain(err.errors[0]) }, status: 422 });
    }
  });

  router.get('/activities/:id', async (req, res) => {
    const { store } = req.app.locals;
    const activity = store.getActivity(req.params.id);
    if (!activity) return notFound(req, res, 'This activity');
    const cfg = store.config();
    const today = todayIso();
    await renderPage(req, res, 'activities/detail', {
      title: `${activity.id} · ${activity.title}`,
      active: 'activities',
      activity,
      owner: store.getPerson(activity.owner_id)?.name ?? null,
      updates: [...activity.updates].sort((a, b) => b.on.localeCompare(a.on) || b.created_at.localeCompare(a.created_at)),
      quiet: activityQuiet(activity, today, cfg.stale_after_days),
      staleDays: cfg.stale_after_days,
      statuses: ACTIVITY_STATUSES,
      today,
    });
  });

  router.get('/activities/:id/edit', async (req, res) => {
    const { store } = req.app.locals;
    const activity = store.getActivity(req.params.id);
    if (!activity) return notFound(req, res, 'This activity');
    await renderActivityForm(req, res, {
      existing: activity,
      values: { ...activity, links: activity.links.join('\n'), tags: activity.tags.join(', '), owner_id: activity.owner_id ?? '' },
    });
  });

  router.post('/activities/:id', async (req, res) => {
    const { store } = req.app.locals;
    const activity = store.getActivity(req.params.id);
    if (!activity) return notFound(req, res, 'This activity');
    const { typed, errors } = parseActivityForm(req.body);
    if (typed && typed.owner_id && !store.getPerson(typed.owner_id)) errors.owner_id = 'Pick a person from the list.';
    if (Object.keys(errors).length) return renderActivityForm(req, res, { existing: activity, values: req.body, errors, status: 422 });
    try {
      await saveActivity(store, typed, { existing: activity });
      flash(res, 'success', 'Activity saved.');
      return res.redirect(303, `/activities/${activity.id}`);
    } catch (err) {
      if (!(err instanceof ValidationError)) throw err;
      return renderActivityForm(req, res, { existing: activity, values: req.body, errors: { title: plain(err.errors[0]) }, status: 422 });
    }
  });

  // A status change is its own save, so it shows up as its own commit.
  router.post('/activities/:id/status', async (req, res) => {
    const { store } = req.app.locals;
    const activity = store.getActivity(req.params.id);
    if (!activity) return notFound(req, res, 'This activity');
    const status = String(req.body.status ?? '');
    if (!ACTIVITY_STATUSES.includes(status)) {
      flash(res, 'error', 'Pick a status from the list.');
    } else if (status !== activity.status) {
      await store.save([{ ...activity, status }], `${activity.id}: status ${activity.status} → ${status}`);
      flash(res, 'success', `Status set to ${status}.`);
    }
    return res.redirect(303, `/activities/${activity.id}`);
  });

  router.post('/activities/:id/updates', async (req, res) => {
    const { store } = req.app.locals;
    const activity = store.getActivity(req.params.id);
    if (!activity) return notFound(req, res, 'This activity');
    const { update, error } = newActivityUpdate(req.body, { at: nowIso(), today: todayIso() });
    if (error) {
      flash(res, 'error', error);
      return res.redirect(303, `/activities/${activity.id}`);
    }
    await store.save([{ ...activity, updates: [...activity.updates, update] }], `${activity.id}: update on ${update.on}`);
    flash(res, 'success', 'Update added.');
    return res.redirect(303, `/activities/${activity.id}`);
  });

  router.post('/activities/:id/delete', async (req, res) => {
    const { store } = req.app.locals;
    const activity = store.getActivity(req.params.id);
    if (!activity) return notFound(req, res, 'This activity');
    if (!typedRight(req, activity.id)) {
      flash(res, 'error', `Nothing was deleted. Type ${activity.id} exactly to delete it.`);
      return res.redirect(303, `/activities/${activity.id}`);
    }
    await store.delete(activity, `${activity.id}: deleted`);
    flash(res, 'success', `Deleted ${activity.id}.`);
    return res.redirect(303, '/activities');
  });

  // ------------------------------------------------ merge two people (lib/merge.js)
  // Used for a person entered by mistake, or entered twice. Their references move to the right person,
  // and the wrong one is removed, in one commit.
  router.get('/people/:id/merge', async (req, res) => {
    const { store } = req.app.locals;
    const person = store.getPerson(req.params.id);
    if (!person) return notFound(req, res, 'This person');
    const usage = personUsage({ deals: store.listDeals(), customers: store.listCustomers(), activities: store.listActivities() }, person.id);
    await renderPage(req, res, 'people/merge', {
      title: `Merge ${person.name}`,
      active: 'people',
      person,
      usage,
      people: store.listPeople().filter((p) => p.active && p.id !== person.id),
    });
  });

  router.post('/people/:id/merge', async (req, res) => {
    const { store } = req.app.locals;
    const person = store.getPerson(req.params.id);
    if (!person) return notFound(req, res, 'This person');
    const target = store.getPerson(String(req.body.target_id ?? ''));
    if (!target || !target.active || target.id === person.id) {
      flash(res, 'error', 'Pick an active person to merge into.');
      return res.redirect(303, `/people/${person.id}/merge`);
    }
    if (!typedRight(req, person.name)) {
      flash(res, 'error', `Nothing was merged. Type ${person.name} exactly to merge and remove this person.`);
      return res.redirect(303, `/people/${person.id}/merge`);
    }
    const at = nowIso();
    const moved = [];
    for (const record of [...store.listDeals(), ...store.listCustomers(), ...store.listActivities()]) {
      const next = moveReferences(record, person.id, target.id, at);
      if (next !== record) moved.push(next);
    }
    try {
      await store.saveAndDelete(moved, person, `${person.id}: merged into ${target.id}`);
      flash(res, 'success', `Merged ${person.name} into ${target.name}. ${moved.length} ${moved.length === 1 ? 'record' : 'records'} updated.`);
    } catch (err) {
      if (!(err instanceof ValidationError)) throw err;
      flash(res, 'error', err.errors.map(plain).join('; '));
      return res.redirect(303, `/people/${person.id}/merge`);
    }
    return res.redirect(303, '/people');
  });

  return router;
}

