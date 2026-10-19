import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { DEFAULT_CONFIG } from '../app/config-defaults.js';
import { askOverdue, asksFor, isSupportedBy, nextAskDue, openAsks } from '../app/metrics.js';
import { validateRecord, withSupportDefaults } from '../app/models.js';
import { addAsk, askEntries, changeAsk, changeSupporters, removeAsk } from '../app/support.js';
import { createApp } from '../app/server.js';
import { cleanup, git, makeClone, makeRemote } from './helpers.js';

const NOW = '2026-10-19T09:00:00+01:00';
const TODAY = '2026-10-19';

/** A deal in the shape saveDeal writes, with no asks yet. */
const baseDeal = (overrides = {}) => ({
  schema_version: 1,
  id: 'DL-2026-0001',
  title: 'ADAS validation',
  type: 'RFQ',
  customer_id: 'CU-0001',
  contact_ids: [],
  sales_owner_id: 'PE-0001',
  presales_owner_id: 'PE-0002',
  delivery_owner_id: null,
  support_ids: [],
  support_requests: [],
  support_seq: 0,
  stage: 'RFQ Received',
  on_hold: false,
  probability: 25,
  priority: 'Medium',
  go_no_go: 'Pending',
  received_on: '2026-10-01',
  currency: 'EUR',
  est_value: null,
  competitors: [],
  tags: [],
  links: [],
  history: [],
  created_at: NOW,
  updated_at: NOW,
  ...overrides,
});

describe('supporters and asks: pure model', () => {
  test('asks are numbered SR-001, SR-002 in order', () => {
    let deal = baseDeal();
    ({ deal } = addAsk(deal, { text: 'Effort estimate' }, NOW));
    const second = addAsk(deal, { text: 'Architecture slide' }, NOW);
    assert.deepEqual(second.deal.support_requests.map((a) => a.id), ['SR-001', 'SR-002']);
    assert.equal(second.deal.support_seq, 2);
  });

  test('a removed ask number is never reused', () => {
    let deal = baseDeal();
    ({ deal } = addAsk(deal, { text: 'one' }, NOW));
    ({ deal } = addAsk(deal, { text: 'two' }, NOW));
    ({ deal } = addAsk(deal, { text: 'three' }, NOW));
    deal = removeAsk(deal, 'SR-003');
    const next = addAsk(deal, { text: 'four' }, NOW);
    assert.equal(next.ask.id, 'SR-004', 'SR-003 was removed, so it must not come back');
  });

  test('marking an ask Done sets done_on today and reopening clears it', () => {
    let deal = baseDeal();
    ({ deal } = addAsk(deal, { text: 'Q&A answers' }, NOW));
    deal = changeAsk(deal, 'SR-001', { status: 'Done' }, { today: TODAY, now: NOW });
    assert.equal(deal.support_requests[0].done_on, TODAY);
    deal = changeAsk(deal, 'SR-001', { status: 'In progress' }, { today: '2026-10-20', now: NOW });
    assert.equal(deal.support_requests[0].done_on, null);
  });

  test('changeAsk only changes the keys it is given', () => {
    let deal = baseDeal();
    ({ deal } = addAsk(deal, { text: 'Pricing input', assignee_id: 'PE-0003', due_on: '2026-10-25' }, NOW));
    deal = changeAsk(deal, 'SR-001', { status: 'In progress' }, { today: TODAY, now: NOW });
    const ask = deal.support_requests[0];
    assert.equal(ask.text, 'Pricing input');
    assert.equal(ask.assignee_id, 'PE-0003');
    assert.equal(ask.due_on, '2026-10-25');
  });

  test('changeAsk refuses an unknown status and an unknown ask', () => {
    let deal = baseDeal();
    ({ deal } = addAsk(deal, { text: 'x' }, NOW));
    assert.throws(() => changeAsk(deal, 'SR-001', { status: 'Maybe' }, { today: TODAY, now: NOW }), /Unknown status/);
    assert.throws(() => changeAsk(deal, 'SR-009', { status: 'Done' }, { today: TODAY, now: NOW }), /not found/);
  });

  test('ask history says what changed', () => {
    const before = addAsk(baseDeal(), { text: 'Demo', due_on: '2026-10-25' }, NOW).ask;
    assert.deepEqual(
      askEntries(null, before, { at: NOW }).map((e) => e.text),
      ['Ask SR-001 added: Demo'],
    );
    const after = { ...before, status: 'Done', assignee_id: 'PE-0003' };
    assert.deepEqual(
      askEntries(before, after, { at: NOW, names: () => 'Ravi K' }).map((e) => e.text),
      ['Ask SR-001: Open → Done', 'Ask SR-001 updated: assignee → Ravi K'],
    );
  });

  test('supporters: add, remove, and refuse duplicates and owners', () => {
    const deal = baseDeal();
    const ravi = { id: 'PE-0003', name: 'Ravi K' };
    const names = (id) => (id === 'PE-0003' ? 'Ravi K' : id);
    const owners = ['PE-0001', 'PE-0002'];

    const added = changeSupporters(deal, { action: 'add', person: ravi, owners, at: NOW, names });
    assert.equal(added.error, null);
    assert.deepEqual(added.deal.support_ids, ['PE-0003']);
    assert.match(added.entry.text, /Supporters: — → Ravi K/);

    const again = changeSupporters(added.deal, { action: 'add', person: ravi, owners, at: NOW, names });
    assert.match(again.error, /already a supporter/);

    const owner = changeSupporters(deal, { action: 'add', person: { id: 'PE-0002', name: 'Amod M' }, owners, at: NOW, names });
    assert.match(owner.error, /already owns this deal/);

    const removed = changeSupporters(added.deal, { action: 'remove', person: ravi, owners, at: NOW, names });
    assert.deepEqual(removed.deal.support_ids, []);
  });

  test('openAsks leaves out Done and Cancelled asks', () => {
    let deal = baseDeal();
    ({ deal } = addAsk(deal, { text: 'a' }, NOW));
    ({ deal } = addAsk(deal, { text: 'b' }, NOW));
    ({ deal } = addAsk(deal, { text: 'c' }, NOW));
    deal = changeAsk(deal, 'SR-001', { status: 'Done' }, { today: TODAY, now: NOW });
    deal = changeAsk(deal, 'SR-002', { status: 'Cancelled' }, { today: TODAY, now: NOW });
    assert.deepEqual(openAsks(deal).map((a) => a.id), ['SR-003']);
  });

  test('asksFor lists one person’s open asks, earliest due first, with no date last', () => {
    let a = baseDeal({ id: 'DL-2026-0001' });
    ({ deal: a } = addAsk(a, { text: 'late', assignee_id: 'PE-0003', due_on: '2026-11-05' }, NOW));
    ({ deal: a } = addAsk(a, { text: 'undated', assignee_id: 'PE-0003' }, NOW));
    let b = baseDeal({ id: 'DL-2026-0002' });
    ({ deal: b } = addAsk(b, { text: 'overdue', assignee_id: 'PE-0003', due_on: '2026-10-10' }, NOW));
    ({ deal: b } = addAsk(b, { text: 'someone else', assignee_id: 'PE-0009', due_on: '2026-10-01' }, NOW));

    const rows = asksFor([a, b], 'PE-0003');
    assert.deepEqual(rows.map((r) => r.ask.text), ['overdue', 'late', 'undated']);
    assert.equal(askOverdue(rows[0].ask, TODAY), true);
    assert.equal(askOverdue(rows[1].ask, TODAY), false);
  });

  test('isSupportedBy is true for a supporter or an assignee only', () => {
    let deal = baseDeal({ support_ids: ['PE-0003'] });
    ({ deal } = addAsk(deal, { text: 'x', assignee_id: 'PE-0004' }, NOW));
    assert.equal(isSupportedBy(deal, 'PE-0003'), true);
    assert.equal(isSupportedBy(deal, 'PE-0004'), true);
    assert.equal(isSupportedBy(deal, 'PE-0005'), false);
    assert.equal(isSupportedBy(baseDeal(), 'PE-0003'), false);
  });

  test('nextAskDue is the earliest open date, or null', () => {
    let deal = baseDeal();
    ({ deal } = addAsk(deal, { text: 'x', due_on: '2026-10-30' }, NOW));
    ({ deal } = addAsk(deal, { text: 'y', due_on: '2026-10-22' }, NOW));
    assert.equal(nextAskDue(deal), '2026-10-22');
    assert.equal(nextAskDue(baseDeal()), null);
  });

  test('validateRecord rejects a bad ask and a duplicate supporter', () => {
    const deal = baseDeal({
      support_ids: ['PE-0003', 'PE-0003'],
      support_requests: [{ id: 'SR-001', text: '', assignee_id: null, due_on: '2026-02-30', status: 'Later' }],
      support_seq: 1,
    });
    const errors = validateRecord('deal', deal, DEFAULT_CONFIG);
    assert.ok(errors.includes('support_ids has the same person twice'));
    assert.ok(errors.includes('ask SR-001: text is required'));
    assert.ok(errors.includes("ask SR-001: unknown status 'Later'"));
    assert.ok(errors.includes('ask SR-001: due date is not valid'));
    assert.deepEqual(validateRecord('deal', baseDeal({ support_seq: 0 }), DEFAULT_CONFIG), []);
  });

  test('a deal file from before supporters existed gets empty support fields', () => {
    const old = baseDeal();
    for (const key of ['support_ids', 'support_requests', 'support_seq']) delete old[key];
    const fixed = withSupportDefaults(old);
    assert.deepEqual(fixed.support_ids, []);
    assert.deepEqual(fixed.support_requests, []);
    assert.equal(fixed.support_seq, 0);
    assert.deepEqual(validateRecord('deal', fixed, null), []);
  });
});

// ---------------------------------------------------------------- over HTTP, on a real store

async function startApp() {
  const { dir } = await makeRemote();
  const root = await makeClone(dir, 'app', null);
  const { app, store } = await createApp({ root, syncEnabled: false });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    root,
    store,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      await cleanup(dir);
    },
  };
}

const post = (base, url, fields) =>
  fetch(base + url, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
  });

const get = async (base, url) => {
  const res = await fetch(base + url, { redirect: 'manual' });
  return { status: res.status, html: await res.text() };
};

/** The flash text from the last response, decoded from its cookie. */
function flashOf(res) {
  const match = (res.headers.get('set-cookie') ?? '').match(/flash=([^;]+)/);
  return match ? JSON.parse(decodeURIComponent(match[1])).text : null;
}

const commits = (root) => Number(git(root, 'rev-list', '--count', 'HEAD'));
const YEAR = new Date().getFullYear();
const DEAL = `DL-${YEAR}-0001`;

describe('supporters and asks: deal page', () => {
  let app;
  let ravi;

  before(async () => {
    app = await startApp();
    await post(app.base, '/setup', { name: 'Amod Mulay', email: '' });
    await post(app.base, '/deals', {
      title: 'ADAS validation services',
      type: 'RFQ',
      customer: 'Bosch',
      sales_owner: 'Priya S',
      received_on: '2026-10-01',
      stage: 'Lead',
      probability: '5',
      currency: 'EUR',
      priority: 'Medium',
      go_no_go: 'Pending',
    });
    await post(app.base, '/people', { name: 'Ravi K', role: 'Presales', active: 'on' });
    ravi = app.store.findPersonByName('Ravi K').id;
  });

  after(async () => {
    await app.close();
  });

  test('adding a supporter saves one commit and a timeline entry', async () => {
    const before = commits(app.root);
    const res = await post(app.base, `/deals/${DEAL}/support`, { action: 'add', person_id: ravi });
    assert.equal(res.status, 303);
    assert.equal(commits(app.root), before + 1);
    assert.deepEqual(app.store.getDeal(DEAL).support_ids, [ravi]);
    const history = app.store.getDeal(DEAL).history.map((h) => h.text);
    assert.ok(history.some((t) => t === 'Supporters: — → Ravi K'));
    assert.equal(git(app.root, 'log', '-1', '--format=%s'), `${DEAL}: supporters updated`);
  });

  test('an unknown person, a duplicate and an owner are refused with no commit', async () => {
    const before = commits(app.root);
    const unknown = await post(app.base, `/deals/${DEAL}/support`, { action: 'add', person_id: 'PE-9999' });
    assert.match(flashOf(unknown), /Choose a person first/);

    const duplicate = await post(app.base, `/deals/${DEAL}/support`, { action: 'add', person_id: ravi });
    assert.match(flashOf(duplicate), /already a supporter/);

    const priya = app.store.findPersonByName('Priya S').id;
    const owner = await post(app.base, `/deals/${DEAL}/support`, { action: 'add', person_id: priya });
    assert.match(flashOf(owner), /already owns this deal/);
    assert.equal(commits(app.root), before);
  });

  test('adding an ask gives it an id, an assignee and a due date', async () => {
    const before = commits(app.root);
    const res = await post(app.base, `/deals/${DEAL}/asks`, {
      text: 'Effort estimate for the Q&A',
      assignee_id: ravi,
      due_on: '2026-10-25',
    });
    assert.equal(res.status, 303);
    assert.equal(commits(app.root), before + 1);
    const ask = app.store.getDeal(DEAL).support_requests[0];
    assert.equal(ask.id, 'SR-001');
    assert.equal(ask.assignee_id, ravi);
    assert.equal(ask.due_on, '2026-10-25');
    assert.equal(ask.status, 'Open');
  });

  test('an ask with no text is refused, with no commit', async () => {
    const before = commits(app.root);
    const res = await post(app.base, `/deals/${DEAL}/asks`, { text: '   ', assignee_id: '', due_on: '' });
    assert.match(flashOf(res), /Write what is being asked/);
    assert.equal(commits(app.root), before);
  });

  test('a bad due date is refused', async () => {
    const res = await post(app.base, `/deals/${DEAL}/asks`, { text: 'x', due_on: '2026-02-30' });
    assert.match(flashOf(res), /real date/);
  });

  test('status changes set and clear the done date', async () => {
    const res = await post(app.base, `/deals/${DEAL}/asks/SR-001`, { status: 'Done' });
    assert.equal(res.status, 303);
    assert.equal(app.store.getDeal(DEAL).support_requests[0].done_on, TODAY_ISO());
    await post(app.base, `/deals/${DEAL}/asks/SR-001`, { status: 'Open' });
    assert.equal(app.store.getDeal(DEAL).support_requests[0].done_on, null);
  });

  test('editing an ask changes only the fields sent', async () => {
    await post(app.base, `/deals/${DEAL}/asks/SR-001`, { text: 'Effort estimate for Q&A round 2' });
    const ask = app.store.getDeal(DEAL).support_requests[0];
    assert.equal(ask.text, 'Effort estimate for Q&A round 2');
    assert.equal(ask.assignee_id, ravi, 'assignee kept when not sent');
    assert.equal(ask.due_on, '2026-10-25', 'due date kept when not sent');
  });

  test('an unknown assignee is refused', async () => {
    const res = await post(app.base, `/deals/${DEAL}/asks/SR-001`, { assignee_id: 'PE-9999' });
    assert.match(flashOf(res), /Choose the assignee/);
  });

  test('removing an ask keeps the others, and its number is not reused', async () => {
    await post(app.base, `/deals/${DEAL}/asks`, { text: 'Architecture slide' });
    await post(app.base, `/deals/${DEAL}/asks`, { text: 'Pricing input' });
    await post(app.base, `/deals/${DEAL}/asks/SR-003/delete`, {});
    assert.deepEqual(app.store.getDeal(DEAL).support_requests.map((a) => a.id), ['SR-001', 'SR-002']);
    await post(app.base, `/deals/${DEAL}/asks`, { text: 'Last one' });
    assert.equal(app.store.getDeal(DEAL).support_requests.at(-1).id, 'SR-004');
  });

  test('editing the deal keeps its supporters and asks', async () => {
    const deal = app.store.getDeal(DEAL);
    const fields = {
      title: 'ADAS validation services – phase 2',
      type: 'RFQ',
      customer: 'Bosch',
      sales_owner: 'Priya S',
      received_on: deal.received_on,
      stage: deal.stage,
      probability: String(deal.probability),
      currency: 'EUR',
      priority: 'Medium',
      go_no_go: 'Pending',
    };
    const res = await post(app.base, `/deals/${DEAL}`, fields);
    assert.equal(res.status, 303);
    const after = app.store.getDeal(DEAL);
    assert.equal(after.title, 'ADAS validation services – phase 2');
    assert.deepEqual(after.support_ids, [ravi]);
    assert.equal(after.support_requests.length, 3);
    assert.equal(after.support_seq, 4);
  });

  test('the deal page shows the support card, the supporter and the asks', async () => {
    const page = await get(app.base, `/deals/${DEAL}`);
    assert.equal(page.status, 200);
    assert.match(page.html, /<h2>Support<\/h2>/);
    assert.match(page.html, /aria-label="Remove Ravi K as a supporter"/);
    assert.match(page.html, /SR-001/);
    assert.match(page.html, /Effort estimate for Q&amp;A round 2/);
    assert.doesNotMatch(page.html, /No asks yet/, 'the empty state is not shown when there are asks');
  });

  test('a supporter can be removed', async () => {
    const res = await post(app.base, `/deals/${DEAL}/support`, { action: 'remove', person_id: ravi });
    assert.equal(res.status, 303);
    assert.deepEqual(app.store.getDeal(DEAL).support_ids, []);
  });
});

describe('supporters and asks: a deal saved before this feature', () => {
  let app;

  before(async () => {
    app = await startApp();
    await post(app.base, '/setup', { name: 'Amod Mulay', email: '' });
    await post(app.base, '/deals', {
      title: 'Old deal',
      type: 'RFQ',
      customer: 'Bosch',
      sales_owner: 'Priya S',
      received_on: '2026-10-01',
      stage: 'Lead',
      probability: '5',
      currency: 'EUR',
      priority: 'Medium',
      go_no_go: 'Pending',
    });
    // Strip the new keys, as an older file would look.
    const file = path.join(app.root, 'data', 'deals', `${DEAL}.json`);
    const obj = JSON.parse(await fs.readFile(file, 'utf8'));
    for (const key of ['support_ids', 'support_requests', 'support_seq']) delete obj[key];
    await fs.writeFile(file, JSON.stringify(obj, null, 2) + '\n');
    await app.store.loadAll();
  });

  after(async () => {
    await app.close();
  });

  test('the file loads with empty support fields and the page renders', async () => {
    assert.deepEqual(app.store.problems, []);
    assert.deepEqual(app.store.getDeal(DEAL).support_ids, []);
    const page = await get(app.base, `/deals/${DEAL}`);
    assert.equal(page.status, 200);
    assert.match(page.html, /No supporters yet/);
  });
});

/** The date the app uses for "today" (local). */
function TODAY_ISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
