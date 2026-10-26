/**
 * Form handling for deals, customers and people (PLAN.md §4.3–4.5, §10).
 *
 * Form text ("values") is parsed into typed fields. Owners, customers and contacts are
 * typed as names; resolveReferences turns names into ids, creating any that are missing.
 * Everything for one save goes into one commit.
 */
import { diff } from './history.js';
import { nowIso, validateRecord, ValidationError, DATE_FIELDS } from './models.js';
import { stageInfo } from './metrics.js';
import { resolveTags } from './lib/tags.js';
import { resolveBusinessUnit } from './lib/business-units.js';

const TEXT_FIELDS = [
  'title', 'type', 'source', 'description', 'customer', 'contacts', 'c4c_id', 'sales_owner', 'presales_owner',
  'delivery_owner', 'bu', 'practice', 'region', 'stage', 'priority', 'go_no_go', 'currency', 'pricing_model',
  'incumbent', 'competitors', 'outcome_reason', 'next_action', 'tags', 'links', 'probability',
  'est_value', 'effort_person_months', 'duration_months',
];
const NUMBER_FIELDS = ['est_value', 'effort_person_months', 'duration_months'];
const REQUIRED = { title: 'Title', type: 'Type', customer: 'Customer', stage: 'Stage', received_on: 'Received on' };

/** Trimmed text of one form field, '' when missing. */
const text = (values, key) => (typeof values[key] === 'string' ? values[key].trim() : '');
const unique = (items) => [...new Set(items)];
const lines = (value) => value.split('\n').map((l) => l.trim()).filter(Boolean);
const commaList = (value) => unique(value.split(',').map((x) => x.trim()).filter(Boolean));
/** The config with new tags and business units appended. Returns cfg itself when nothing is new. */
function withNewValues(cfg, { tags = [], business_units = [] }) {
  if (!tags.length && !business_units.length) return cfg;
  return { ...cfg, tags: [...cfg.tags, ...tags], business_units: [...cfg.business_units, ...business_units] };
}

/** 'Label | URL' per line; a line with only a URL uses the URL as the label. */
export function parseLinks(value) {
  return lines(value).map((line) => {
    if (!line.includes('|')) return { label: line, url: line };
    const [label, url] = line.split('|').map((x) => x.trim());
    return { label: label || url, url: url ?? '' };
  });
}

export function linksToText(links) {
  return links.map((l) => (l.label === l.url ? l.url : `${l.label} | ${l.url}`)).join('\n');
}

/**
 * Parses deal form values into typed fields.
 * @returns {{ typed: Record<string, any>, errors: Record<string, string> }}
 */
export function parseDealValues(values) {
  const errors = {};
  const typed = {};
  for (const key of TEXT_FIELDS) typed[key] = text(values, key);

  for (const key of Object.keys(REQUIRED)) {
    if (!typed[key] && key !== 'received_on') errors[key] = `${REQUIRED[key]} is required`;
  }
  for (const key of ['received_on', ...DATE_FIELDS.filter((f) => f !== 'received_on')]) {
    typed[key] = text(values, key) || null;
  }
  if (!typed.received_on) errors.received_on = 'Received on is required';

  for (const key of NUMBER_FIELDS) {
    const raw = typed[key];
    typed[key] = raw === '' ? null : Number(raw);
    if (raw !== '' && !Number.isFinite(typed[key])) errors[key] = 'Enter a number';
  }
  if (typed.probability === '') errors.probability = 'Probability is required';
  typed.probability = Number(typed.probability);
  if (typed.probability !== '' && !Number.isInteger(typed.probability)) errors.probability = 'Enter a whole number';

  typed.description = values.description?.trim() ?? '';
  typed.on_hold = values.on_hold === 'on';
  typed.contacts = lines(text(values, 'contacts'));
  typed.competitors = commaList(text(values, 'competitors'));
  typed.tags = commaList(text(values, 'tags'));
  typed.links = parseLinks(text(values, 'links'));
  for (const key of ['source', 'c4c_id', 'bu', 'practice', 'region', 'pricing_model', 'incumbent',
    'outcome_reason', 'next_action', 'delivery_owner', 'presales_owner', 'sales_owner', 'priority', 'go_no_go']) {
    typed[key] = typed[key] || null;
  }
  typed.priority = typed.priority || 'Medium';
  typed.go_no_go = typed.go_no_go || 'Pending';
  // Every value is in EUR.
  typed.currency = 'EUR';
  return { typed, errors };
}

/** Inverse of parseDealValues, used to pre-fill the edit form and to re-show user input. */
export function typedToValues(typed) {
  const out = {};
  for (const key of TEXT_FIELDS) out[key] = typed[key] == null ? '' : String(typed[key]);
  for (const key of DATE_FIELDS) out[key] = typed[key] ?? '';
  out.description = typed.description ?? '';
  out.contacts = (typed.contacts ?? []).join('\n');
  out.competitors = (typed.competitors ?? []).join(', ');
  out.tags = (typed.tags ?? []).join(', ');
  out.links = linksToText(typed.links ?? []);
  if (typed.on_hold) out.on_hold = 'on';
  return out;
}

/**
 * A stored deal, expressed in the typed form (names instead of ids), so it can
 * go through the same save path as a form submission.
 */
export function dealToTyped(deal, store) {
  const name = (id) => store.getPerson(id)?.name ?? '';
  return {
    title: deal.title,
    type: deal.type,
    source: deal.source,
    description: deal.description,
    customer: store.getCustomer(deal.customer_id)?.name ?? '',
    contacts: deal.contact_ids.map(name).filter(Boolean),
    c4c_id: deal.c4c_id,
    sales_owner: name(deal.sales_owner_id),
    presales_owner: name(deal.presales_owner_id),
    delivery_owner: name(deal.delivery_owner_id),
    bu: deal.bu,
    practice: deal.practice,
    region: deal.region,
    stage: deal.stage,
    on_hold: deal.on_hold,
    probability: deal.probability,
    priority: deal.priority,
    go_no_go: deal.go_no_go,
    go_no_go_on: deal.go_no_go_on,
    received_on: deal.received_on,
    qa_due: deal.qa_due,
    submission_due: deal.submission_due,
    submitted_on: deal.submitted_on,
    expected_decision_on: deal.expected_decision_on,
    expected_start_on: deal.expected_start_on,
    closed_on: deal.closed_on,
    currency: deal.currency,
    est_value: deal.est_value,
    effort_person_months: deal.effort_person_months,
    duration_months: deal.duration_months,
    pricing_model: deal.pricing_model,
    incumbent: deal.incumbent,
    competitors: deal.competitors,
    outcome_reason: deal.outcome_reason,
    next_action: deal.next_action,
    next_action_due: deal.next_action_due,
    tags: deal.tags,
    links: deal.links,
  };
}

/** Next id for a kind, skipping ids already claimed in this save. */
async function allocateId(store, kind, pending) {
  let id = await store.nextId(kind);
  while (pending.some((r) => r.id === id)) {
    const [, prefix, digits] = id.match(/^(.*-)(\d+)$/);
    id = `${prefix}${String(Number(digits) + 1).padStart(digits.length, '0')}`;
  }
  return id;
}

/**
 * Finds or creates a customer, person and so on, by name. Records created here are
 * pushed onto `pending` and saved in the same commit as the opportunity.
 */
export async function ensureCustomer(store, name, pending, created) {
  const existing = store.findCustomerByName(name);
  if (existing) return existing;
  const now = nowIso();
  const customer = {
    schema_version: 1,
    id: await allocateId(store, 'customer', pending),
    name,
    short_name: null,
    industry: null,
    region: null,
    country: null,
    bu: null,
    account_manager_id: null,
    c4c_account_id: null,
    website: null,
    tags: [],
    notes: '',
    created_at: now,
    updated_at: now,
  };
  pending.push(customer);
  created.push(`customer "${name}"`);
  return customer;
}

async function ensurePerson(store, name, role, customerId, pending, created) {
  const key = name.toLowerCase();
  const claimed = pending.find((p) => p.name.toLowerCase() === key && p.role === role && p.customer_id === (customerId ?? p.customer_id));
  if (claimed) return claimed;
  // Contacts only match people with the Customer role at this customer. Owners match any person by name.
  const existing =
    role === 'Customer'
      ? store.listPeople().find((p) => p.name.toLowerCase() === key && p.role === 'Customer' && p.customer_id === customerId)
      : store.findPersonByName(name, role) ?? store.findPersonByName(name);
  if (existing) return existing;
  const now = nowIso();
  const person = {
    schema_version: 1,
    id: await allocateId(store, 'person', pending),
    name,
    role,
    title: null,
    email: null,
    phone: null,
    customer_id: role === 'Customer' ? customerId : null,
    notes: '',
    active: true,
    created_at: now,
    updated_at: now,
  };
  pending.push(person);
  created.push(`person "${name}"`);
  return person;
}

/**
 * Turns names into ids, creating customers and people that do not exist yet.
 * @returns {Promise<{ customerId: string, refs: Record<string, string | null>, contactIds: string[],
 *   created: Array<Record<string, any>>, createdNames: string[] }>}
 */
export async function resolveReferences(store, typed) {
  const pending = [];
  const createdNames = [];
  const customer = await ensureCustomer(store, typed.customer, pending, createdNames);
  const owner = async (name, role) => (name ? (await ensurePerson(store, name, role, null, pending, createdNames)).id : null);
  const refs = {
    sales_owner_id: await owner(typed.sales_owner, 'Sales'),
    presales_owner_id: await owner(typed.presales_owner, 'Presales'),
    delivery_owner_id: await owner(typed.delivery_owner, 'Delivery'),
  };
  const contactIds = [];
  for (const name of typed.contacts) {
    const person = await ensurePerson(store, name, 'Customer', customer.id, pending, createdNames);
    contactIds.push(person.id);
  }
  return { customerId: customer.id, refs, contactIds: unique(contactIds), created: pending, createdNames };
}

/** Stage rules from PLAN.md §4.3, applied before an opportunity is saved. */
export function applyStageRules(deal, existing, cfg, { today, me }) {
  const stage = stageInfo(cfg, deal.stage);
  const oldStage = existing ? stageInfo(cfg, existing.stage) : null;
  const stageChanged = !existing || deal.stage !== existing.stage;

  if (!existing && !deal.presales_owner_id && me) deal.presales_owner_id = me;
  if (existing && stageChanged && stage && deal.probability === existing.probability) {
    deal.probability = stage.probability;
  }
  if (stageChanged && deal.stage === 'Proposal Submitted' && !deal.submitted_on) deal.submitted_on = today;
  if (stage?.terminal && !deal.closed_on) deal.closed_on = today;
  if (existing && stageChanged && oldStage?.terminal && !stage?.terminal) {
    deal.closed_on = null;
    deal.outcome_reason = null;
  }
  return deal;
}

/** C4C ids are not unique in practice; a duplicate is a warning, never an error. */
export function duplicateC4cWarning(store, c4cId, selfId) {
  if (!c4cId) return null;
  const key = c4cId.trim().toLowerCase();
  const other = store
    .listDeals()
    .find((d) => d.id !== selfId && d.c4c_id && d.c4c_id.trim().toLowerCase() === key);
  return other ? `Warning: C4C ID ${c4cId} is also used by ${other.id}` : null;
}

/**
 * Saves an opportunity from typed fields: resolves names, applies the stage rules, writes the
 * deal and any new customers or people in one commit.
 * @param {import('./store.js').Store} store
 * @param {Record<string, any>} typed
 * @param {{ existing?: object | null, today: string }} options
 * @returns {Promise<{ deal: object, createdNames: string[], warnings: string[] }>}
 * @throws {ValidationError} when the opportunity fails validation (nothing is written)
 */
export async function saveDeal(store, typed, { existing = null, today }) {
  const cfg = store.config();
  // Tags are free text. Known tags keep their spelling, and new ones are added to config.tags in the same commit.
  const tagged = resolveTags(typed.tags, cfg.tags);
  if (tagged.errors.length) throw new ValidationError(tagged.errors);
  // A new BU is added to config.business_units in the same commit, as new tags are.
  const unit = resolveBusinessUnit(typed.bu, cfg.business_units);
  if (unit.errors.length) throw new ValidationError(unit.errors);
  const cfgNext = withNewValues(cfg, { tags: tagged.added, business_units: unit.added ? [unit.added] : [] });
  const refs = await resolveReferences(store, typed);
  const now = nowIso();
  const id = existing ? existing.id : await store.nextId('deal');

  const deal = {
    ...(existing ?? {}),
    schema_version: 1,
    id,
    title: typed.title,
    type: typed.type,
    source: typed.source,
    description: typed.description,
    customer_id: refs.customerId,
    contact_ids: refs.contactIds,
    c4c_id: typed.c4c_id,
    sales_owner_id: refs.refs.sales_owner_id,
    presales_owner_id: refs.refs.presales_owner_id,
    delivery_owner_id: refs.refs.delivery_owner_id,
    // Supporters and asks are changed on the opportunity page, not in this form, so they carry over.
    support_ids: existing?.support_ids ?? [],
    support_requests: existing?.support_requests ?? [],
    support_seq: existing?.support_seq ?? 0,
    bu: unit.bu,
    practice: typed.practice,
    region: typed.region,
    stage: typed.stage,
    on_hold: typed.on_hold,
    probability: typed.probability,
    priority: typed.priority,
    go_no_go: typed.go_no_go,
    go_no_go_on: typed.go_no_go_on,
    received_on: typed.received_on,
    qa_due: typed.qa_due,
    submission_due: typed.submission_due,
    submitted_on: typed.submitted_on,
    expected_decision_on: typed.expected_decision_on,
    expected_start_on: typed.expected_start_on,
    closed_on: typed.closed_on,
    currency: typed.currency,
    est_value: typed.est_value,
    effort_person_months: typed.effort_person_months,
    duration_months: typed.duration_months,
    pricing_model: typed.pricing_model,
    incumbent: typed.incumbent,
    competitors: typed.competitors,
    outcome_reason: typed.outcome_reason,
    next_action: typed.next_action,
    next_action_due: typed.next_action_due,
    tags: tagged.tags,
    links: typed.links,
    history: existing ? [...existing.history] : [],
    created_at: existing ? existing.created_at : now,
    updated_at: now,
  };

  applyStageRules(deal, existing, cfg, { today, me: cfg.me_person_id });

  const lookup = { people: new Map(store.listPeople().map((p) => [p.id, p])), customers: new Map(store.listCustomers().map((c) => [c.id, c])), at: now };
  for (const record of refs.created) {
    if (record.role) lookup.people.set(record.id, record);
    else lookup.customers.set(record.id, record);
  }
  const { entries, summary } = diff(existing, deal, lookup);
  deal.history = [...deal.history, ...entries];

  const errors = validateRecord('deal', deal, cfgNext);
  if (errors.length) throw new ValidationError(errors);

  await store.save([...refs.created, deal], `${id}: ${summary}`, { config: cfgNext === cfg ? undefined : cfgNext });
  const warnings = [duplicateC4cWarning(store, deal.c4c_id, id)].filter(Boolean);
  return { deal, createdNames: refs.createdNames, warnings };
}

/** Customer form: values ↔ record. */
export function parseCustomerValues(values) {
  const errors = {};
  const name = text(values, 'name');
  if (!name) errors.name = 'Name is required';
  const opt = (k) => text(values, k) || null;
  const typed = {
    name,
    short_name: opt('short_name'),
    industry: opt('industry'),
    region: opt('region'),
    country: opt('country'),
    bu: opt('bu'),
    account_manager: text(values, 'account_manager'),
    c4c_account_id: opt('c4c_account_id'),
    website: opt('website'),
    tags: commaList(text(values, 'tags')),
    notes: values.notes?.trim() ?? '',
  };
  return { typed, errors };
}

export function customerToValues(customer, store) {
  return {
    name: customer.name,
    short_name: customer.short_name ?? '',
    industry: customer.industry ?? '',
    region: customer.region ?? '',
    country: customer.country ?? '',
    bu: customer.bu ?? '',
    account_manager: store.getPerson(customer.account_manager_id)?.name ?? '',
    c4c_account_id: customer.c4c_account_id ?? '',
    website: customer.website ?? '',
    tags: customer.tags.join(', '),
    notes: customer.notes,
  };
}

/**
 * Saves a customer (new or existing). The account manager is matched or created as a Sales person.
 * @returns {Promise<{ customer: object, createdNames: string[] }>}
 */
export async function saveCustomer(store, typed, { existing = null }) {
  const cfg = store.config();
  const unit = resolveBusinessUnit(typed.bu, cfg.business_units);
  if (unit.errors.length) throw new ValidationError(unit.errors);
  const cfgNext = withNewValues(cfg, { business_units: unit.added ? [unit.added] : [] });
  const pending = [];
  const createdNames = [];
  let accountManagerId = null;
  if (typed.account_manager) {
    const person = await ensurePerson(store, typed.account_manager, 'Sales', null, pending, createdNames);
    accountManagerId = person.id;
  }
  const now = nowIso();
  const id = existing ? existing.id : await allocateId(store, 'customer', pending);
  const customer = {
    ...(existing ?? {}),
    schema_version: 1,
    id,
    name: typed.name,
    short_name: typed.short_name,
    industry: typed.industry,
    region: typed.region,
    country: typed.country,
    bu: unit.bu,
    account_manager_id: accountManagerId,
    c4c_account_id: typed.c4c_account_id,
    website: typed.website,
    tags: typed.tags,
    notes: typed.notes,
    created_at: existing ? existing.created_at : now,
    updated_at: now,
  };
  const errors = validateRecord('customer', customer, cfgNext);
  if (errors.length) throw new ValidationError(errors);
  const message = existing ? `${id}: updated` : `${id}: created – ${typed.name}`;
  await store.save([...pending, customer], message, { config: cfgNext === cfg ? undefined : cfgNext });
  return { customer, createdNames };
}

/** Person form: values ↔ record. */
export function parsePersonValues(values) {
  const errors = {};
  const name = text(values, 'name');
  if (!name) errors.name = 'Name is required';
  const role = text(values, 'role');
  const customerId = text(values, 'customer_id') || null;
  if (role === 'Customer' && !customerId) errors.customer_id = 'Choose the customer for this contact';
  const opt = (k) => text(values, k) || null;
  return {
    typed: {
      name,
      role,
      title: opt('title'),
      email: opt('email'),
      phone: opt('phone'),
      customer_id: role === 'Customer' ? customerId : null,
      notes: values.notes?.trim() ?? '',
      active: values.active === 'on',
    },
    errors,
  };
}

export function personToValues(person) {
  return {
    name: person.name,
    role: person.role,
    title: person.title ?? '',
    email: person.email ?? '',
    phone: person.phone ?? '',
    customer_id: person.customer_id ?? '',
    notes: person.notes,
    active: person.active ? 'on' : '',
  };
}

/** @returns {Promise<{ person: object }>} */
export async function savePerson(store, typed, { existing = null }) {
  const now = nowIso();
  const id = existing ? existing.id : await store.nextId('person');
  const person = {
    ...(existing ?? {}),
    schema_version: 1,
    id,
    name: typed.name,
    role: typed.role,
    title: typed.title,
    email: typed.email,
    phone: typed.phone,
    customer_id: typed.customer_id,
    notes: typed.notes,
    active: typed.active,
    created_at: existing ? existing.created_at : now,
    updated_at: now,
  };
  const errors = validateRecord('person', person, store.config());
  if (errors.length) throw new ValidationError(errors);
  const message = existing ? `${id}: updated` : `${id}: created – ${typed.name}`;
  await store.save([person], message);
  return { person };
}


/**
 * Saves an internal activity (new or existing). The updates log is kept as it is: the form does not
 * change it, and each update is added by its own save (PLAN.md §17).
 * @returns {Promise<{ activity: object }>}
 */
export async function saveActivity(store, typed, { existing = null }) {
  const id = existing ? existing.id : await store.nextId('activity');
  const now = nowIso();
  const activity = {
    ...(existing ?? {}),
    schema_version: 1,
    id,
    ...typed,
    updates: existing ? existing.updates : [],
    created_at: existing ? existing.created_at : now,
    updated_at: now,
  };
  const errors = validateRecord('activity', activity, null);
  if (errors.length) throw new ValidationError(errors);
  const message = existing ? `${id}: updated` : `${id}: created – ${typed.title}`;
  await store.save([activity], message);
  return { activity };
}
