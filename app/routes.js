import { Router } from 'express';
import { ageDays, daysInStage, daysToSubmission, health, isOpen, moneyTotals, stageInfo, status, weightedValue } from './metrics.js';
import { ValidationError, nowIso, todayIso, ROLES } from './models.js';
import { noteEntry } from './history.js';
import {
  customerToValues, dealToTyped, parseCustomerValues, parseDealValues, parsePersonValues,
  personToValues, saveCustomer, saveDeal, savePerson, typedToValues,
} from './forms.js';
import { flash, renderPage } from './lib/render.js';
import { stageIndex } from './lib/ui.js';

const EMAIL_RE = /^[^@\s]+@[^@\s]+$/;
const ID_RE = { deal: /^DL-\d{4}-\d{4}$/, customer: /^CU-\d{4}$/, person: /^PE-\d{4}$/ };

/** Trimmed string from a form field, or '' when missing. */
const clean = (value) => (typeof value === 'string' ? value.trim() : '');

/** Removes the record id that validation messages start with, e.g. 'DL-2026-0001: '. */
const plain = (message) => message.replace(/^(DL|CU|PE)-\d{4}(-\d{4})?: /, '');

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

// ---------------------------------------------------------------- deals

/** One row of the deals list, with every value the views need. */
function dealRow(deal, store, cfg, today) {
  return {
    deal,
    customerName: store.getCustomer(deal.customer_id)?.name ?? '—',
    salesName: store.getPerson(deal.sales_owner_id)?.name ?? '—',
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
 * Filters and sorts the deals list from the query string (PLAN.md §10).
 * @returns {{ rows: object[], query: Record<string, string> }}
 */
function listDeals(store, cfg, today, query) {
  const q = clean(query.q).toLowerCase();
  const filter = {
    status: query.status || 'open',
    stage: query.stage || '',
    customer: query.customer || '',
    owner: query.owner || '',
    bu: query.bu || '',
    priority: query.priority || '',
    health: query.health || '',
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
  if (filter.bu) rows = rows.filter((r) => r.deal.bu === filter.bu);
  if (filter.priority) rows = rows.filter((r) => r.deal.priority === filter.priority);
  if (filter.health) rows = rows.filter((r) => r.health.level === filter.health);
  if (q) {
    rows = rows.filter((r) => {
      const d = r.deal;
      const haystack = [d.id, d.title, r.customerName, d.c4c_id, d.practice, d.description, ...d.tags].join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }
  rows.sort(SORTS[sortKey](dir));
  return { rows, filter: { ...filter, q: query.q || '' }, sort: sortKey, dir: dir === 1 ? 'asc' : 'desc' };
}

/** Values for the new-deal form, pre-filled with the defaults from §4.3. */
function newDealValues(store, cfg, customerId) {
  const customer = customerId ? store.getCustomer(customerId) : null;
  const me = cfg.me_person_id ? store.getPerson(cfg.me_person_id) : null;
  return typedToValues({
    title: '',
    type: '',
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
    currency: cfg.currencies[0],
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
  await renderPage(req, res, 'deals/form', {
    title: existing ? `Edit ${existing.id}` : 'New deal',
    active: 'deals',
    existing,
    values,
    errors,
    formErrors,
    action: existing ? `/deals/${existing.id}` : '/deals',
    customerNames: store.listCustomers().map((c) => c.name),
    personNames: store.listPeople().filter((p) => p.active).map((p) => p.name),
  }, code);
}

/** Shared by create and update: parse, pull (on create), save, then redirect to the deal. */
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
    return res.redirect(303, `/deals/${deal.id}`);
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    return renderDealForm(req, res, { existing, values, formErrors: err.errors.map(plain), status: 422 });
  }
}

/** Applies a single change to an existing deal (stage, hold, next action) through the normal save path. */
async function changeDeal(req, res, id, change, successText) {
  const { store } = req.app.locals;
  const existing = store.getDeal(id);
  if (!existing) return notFound(req, res, 'This deal');
  const typed = { ...dealToTyped(existing, store), ...change };
  try {
    await saveDeal(store, typed, { existing, today: todayIso() });
    flash(res, 'success', successText);
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    flash(res, 'error', err.errors.map(plain).join('; '));
  }
  return res.redirect(303, `/deals/${id}`);
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

  // ------------------------------------------------ dashboard, first run, sync
  router.get('/', async (req, res) => {
    const { store } = req.app.locals;
    await renderPage(req, res, 'dashboard', dashboardData(store));
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
  router.get('/deals', async (req, res) => {
    const { store } = req.app.locals;
    const cfg = store.config();
    const today = todayIso();
    const listing = listDeals(store, cfg, today, req.query);
    await renderPage(req, res, 'deals/list', {
      title: 'Deals',
      active: 'deals',
      ...listing,
      today,
      customers: store.listCustomers(),
      people: store.listPeople(),
      healthLevels: ['red', 'amber', 'green', 'hold', 'closed'],
    });
  });

  router.get('/deals/new', async (req, res) => {
    const { store } = req.app.locals;
    const cfg = store.config();
    const values = newDealValues(store, cfg, clean(req.query.customer));
    await renderDealForm(req, res, { existing: null, values });
  });

  router.post('/deals', (req, res) => saveDealFromForm(req, res, { existing: null }));

  router.get('/deals/:id', async (req, res) => {
    const { store } = req.app.locals;
    const deal = ID_RE.deal.test(req.params.id) ? store.getDeal(req.params.id) : null;
    if (!deal) return notFound(req, res, 'This deal');
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
      today,
    });
  });

  router.get('/deals/:id/edit', async (req, res) => {
    const { store } = req.app.locals;
    const deal = store.getDeal(req.params.id);
    if (!deal) return notFound(req, res, 'This deal');
    await renderDealForm(req, res, { existing: deal, values: typedToValues(dealToTyped(deal, store)) });
  });

  router.post('/deals/:id', async (req, res) => {
    const { store } = req.app.locals;
    const deal = store.getDeal(req.params.id);
    if (!deal) return notFound(req, res, 'This deal');
    return saveDealFromForm(req, res, { existing: deal });
  });

  router.post('/deals/:id/stage', async (req, res) => {
    const { store } = req.app.locals;
    const stage = clean(req.body.stage);
    const info = stageInfo(store.config(), stage);
    if (!info) {
      flash(res, 'error', 'Unknown stage.');
      return res.redirect(303, `/deals/${req.params.id}`);
    }
    const reason = clean(req.body.outcome_reason) || null;
    const outcome = info.outcome;
    if ((outcome === 'lost' || outcome === 'dropped') && !reason) {
      flash(res, 'error', `Choose a reason before marking the deal ${info.name}.`);
      return res.redirect(303, `/deals/${req.params.id}`);
    }
    return changeDeal(req, res, req.params.id, { stage, outcome_reason: reason ?? null }, `Stage: ${stage}`);
  });

  router.post('/deals/:id/hold', async (req, res) => {
    const { store } = req.app.locals;
    const deal = store.getDeal(req.params.id);
    if (!deal) return notFound(req, res, 'This deal');
    return changeDeal(req, res, req.params.id, { on_hold: !deal.on_hold }, deal.on_hold ? 'Resumed' : 'Put on hold');
  });

  router.post('/deals/:id/next-action', async (req, res) => {
    const change = {
      next_action: clean(req.body.next_action) || null,
      next_action_due: clean(req.body.next_action_due) || null,
    };
    return changeDeal(req, res, req.params.id, change, 'Next action updated');
  });

  router.post('/deals/:id/notes', async (req, res) => {
    const { store } = req.app.locals;
    const deal = store.getDeal(req.params.id);
    if (!deal) return notFound(req, res, 'This deal');
    const text = clean(req.body.note);
    if (!text) {
      flash(res, 'error', 'Write a note first.');
      return res.redirect(303, `/deals/${deal.id}`);
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
    return res.redirect(303, `/deals/${deal.id}`);
  });

  router.post('/deals/:id/delete', async (req, res) => {
    const { store } = req.app.locals;
    const deal = store.getDeal(req.params.id);
    if (!deal) return notFound(req, res, 'This deal');
    await store.delete(deal, `${deal.id}: deleted`);
    flash(res, 'success', `Deleted ${deal.id}.`);
    return res.redirect(303, '/deals');
  });

  // ------------------------------------------------ customers
  router.get('/customers', async (req, res) => {
    const { store } = req.app.locals;
    const cfg = store.config();
    const rows = customerRows(store, cfg, todayIso());
    await renderPage(req, res, 'customers/list', { title: 'Customers', active: 'customers', rows });
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
      today,
    });
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
    try {
      await store.delete(customer, `${customer.id}: deleted`);
      flash(res, 'success', `Deleted ${customer.name}.`);
      return res.redirect(303, '/customers');
    } catch (err) {
      flash(res, 'error', err.message);
      return res.redirect(303, `/customers/${customer.id}`);
    }
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
    try {
      await store.delete(person, `${person.id}: deleted`);
      flash(res, 'success', `Deleted ${person.name}.`);
    } catch (err) {
      flash(res, 'error', err.message);
    }
    return res.redirect(303, '/people');
  });

  return router;
}

