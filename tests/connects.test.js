import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { connectErrors, connectState, connectSummary, newConnect, withConnectDefaults } from '../app/lib/connects.js';
import { createApp } from '../app/server.js';
import { cleanup, git, makeClone, makeRemote } from './helpers.js';

const settingsForm = (overrides = {}) => ({
  name: 'Amod Mulay',
  email: '',
  stale_after_days: '14',
  business_units: 'Mobility\nSustainability\nHi-Tech',
  regions: 'Europe',
  currencies: 'EUR',
  pricing_models: 'T&M',
  sources: 'Other',
  outcome_reasons: 'Other',
  ...overrides,
});

const TODAY = '2026-10-21';
const PEOPLE = [{ id: 'PE-0001', name: 'Priya S', active: true }];
const form = (overrides = {}) => ({ on: '2026-10-20', kind: 'Teams', who_id: 'PE-0001', with: 'Procurement', note: 'Scope call', ...overrides });

describe('connect rules', () => {
  test('an old customer file with no connects loads with an empty list', () => {
    assert.deepEqual(withConnectDefaults({ id: 'CU-0001' }).connects, []);
    const kept = { id: 'CU-0001', connects: [{ id: 'a' }] };
    assert.deepEqual(withConnectDefaults(kept).connects, [{ id: 'a' }]);
  });

  test('a valid form makes a connect with its fields', () => {
    const { entry, errors } = newConnect(form(), { id: 'abc12345', people: PEOPLE, today: TODAY });
    assert.deepEqual(errors, []);
    assert.equal(entry.id, 'abc12345');
    assert.deepEqual([entry.on, entry.kind, entry.who_id, entry.with, entry.note], ['2026-10-20', 'Teams', 'PE-0001', 'Procurement', 'Scope call']);
  });

  test('a completed connect cannot be in the future, and the kinds are checked', () => {
    assert.match(newConnect(form({ on: '2026-10-22' }), { id: 'x', people: PEOPLE, today: TODAY }).errors[0], /future/);
    assert.match(newConnect(form({ kind: 'Call' }), { id: 'x', people: PEOPLE, today: TODAY }).errors[0], /kind/);
    assert.equal(newConnect(form({ kind: 'EI center visit' }), { id: 'x', people: PEOPLE, today: TODAY }).errors.length, 0);
    assert.equal(newConnect(form({ kind: 'Customer premises visit' }), { id: 'x', people: PEOPLE, today: TODAY }).errors.length, 0);
  });

  test('our person must be an active person in the list, and the person is optional', () => {
    assert.match(newConnect(form({ who_id: 'PE-9999' }), { id: 'x', people: PEOPLE, today: TODAY }).errors[0], /Pick a person/);
    assert.deepEqual(newConnect(form({ who_id: '' }), { id: 'x', people: PEOPLE, today: TODAY }).entry.who_id, null);
  });

  test('stored connects are checked for a valid date and kind', () => {
    assert.deepEqual(connectErrors({ on: '2026-10-20', kind: 'Visit' }), []);
    assert.equal(connectErrors({ on: '20/10/2026', kind: 'Visit' }).length, 1);
    assert.equal(connectErrors({ on: '2026-10-20', kind: 'Email' }).length, 1);
  });

  test('the summary gives the first and last date', () => {
    const summary = connectSummary([{ on: '2026-03-01' }, { on: '2026-09-15' }, { on: '2026-06-02' }]);
    assert.deepEqual([summary.first, summary.last, summary.count], ['2026-03-01', '2026-09-15', 3]);
    assert.deepEqual(connectSummary([]), { first: null, last: null, count: 0 });
  });

  test('a customer is flagged when never connected, or when the last connect is older than the limit', () => {
    assert.deepEqual(connectState({ connects: [] }, TODAY, 30), { last: null, flagged: true, text: 'Never connected' });
    assert.equal(connectState({ connects: [{ on: '2026-10-01' }] }, TODAY, 30).flagged, false, '20 days is within 30');
    assert.equal(connectState({ connects: [{ on: '2026-09-01' }] }, TODAY, 30).flagged, true, '50 days is over 30');
    assert.equal(connectState({ connects: [{ on: TODAY }] }, TODAY, 30).text, 'Connected today');
  });
});

describe('connects over HTTP', () => {
  let app;
  let root;
  let store;
  let base;
  let close;

  before(async () => {
    const remote = await makeRemote();
    root = await makeClone(remote.dir, 'app', null);
    // A customer written before connects existed, with a field this version does not know about.
    await fs.mkdir(path.join(root, 'data', 'customers'), { recursive: true });
    await fs.writeFile(path.join(root, 'data', 'customers', 'CU-0001.json'), JSON.stringify({
      schema_version: 1, id: 'CU-0001', name: 'Bosch', short_name: null, industry: null, region: null, country: null,
      bu: null, account_manager_id: null, c4c_account_id: null, website: null, tags: [], notes: '',
      created_at: '2026-01-01T09:00:00+01:00', updated_at: '2026-01-01T09:00:00+01:00', legacy_field: 'keep me',
    }));
    const created = await createApp({ root, syncEnabled: false });
    store = created.store;
    app = created.app;
    const server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    base = `http://127.0.0.1:${server.address().port}`;
    close = async () => {
      await new Promise((resolve) => server.close(resolve));
      await cleanup(remote.dir);
    };
    await post('/setup', { name: 'Amod Mulay', email: '' });
  });

  after(async () => {
    await close();
  });

  const post = (url, fields) =>
    fetch(base + url, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields),
    });
  const commits = () => Number(git(root, 'rev-list', '--count', 'HEAD'));

  test('an old customer loads with no connects, and logging one keeps its unknown field', async () => {
    assert.deepEqual(store.getCustomer('CU-0001').connects, []);
    const res = await post('/customers/CU-0001/connects', { on: '2026-10-20', kind: 'Teams', who_id: '', with: 'Procurement', note: 'Scope' });
    assert.equal(res.status, 303);
    const saved = store.getCustomer('CU-0001');
    assert.equal(saved.connects.length, 1);
    assert.equal(saved.connects[0].kind, 'Teams');
    assert.equal(saved.legacy_field, 'keep me');
    const onDisk = JSON.parse(await fs.readFile(path.join(root, 'data', 'customers', 'CU-0001.json'), 'utf8'));
    assert.equal(onDisk.legacy_field, 'keep me');
    assert.equal(onDisk.connects.length, 1);
  });

  test('a refused connect writes nothing', async () => {
    const before = commits();
    const res = await post('/customers/CU-0001/connects', { on: '2099-01-01', kind: 'Teams', note: '' });
    assert.equal(res.status, 303, 'the page redirects back with the error shown');
    assert.equal(store.getCustomer('CU-0001').connects.length, 1);
    assert.equal(commits(), before);
  });

  test('a connect can be removed, and the customer keeps its other data', async () => {
    const id = store.getCustomer('CU-0001').connects[0].id;
    const res = await post(`/customers/CU-0001/connects/${id}/delete`, {});
    assert.equal(res.status, 303);
    assert.deepEqual(store.getCustomer('CU-0001').connects, []);
    assert.equal(store.getCustomer('CU-0001').legacy_field, 'keep me');
  });

  test('the customer list flags a customer that was never connected', async () => {
    const html = await (await fetch(`${base}/customers`)).text();
    assert.match(html, /First connected/);
    assert.match(html, /<td class="text-red">Never connected<\/td>/);
  });

  test('the dashboard lists a flagged customer that has open work', async () => {
    await post('/opportunities', {
      title: 'Brake controller', type: 'Lead', customer: 'Bosch', sales_owner: 'Priya S', received_on: '2026-10-01',
      stage: 'Lead', probability: '5', currency: 'EUR', priority: 'Medium', go_no_go: 'Pending',
    });
    const html = await (await fetch(`${base}/`)).text();
    assert.match(html, /Customers to connect with/);
    assert.match(html, /<a href="\/customers\/CU-0001">Bosch<\/a>/);
  });

  test('settings keep the connect setting when the form does not send it, and refuse a bad value', async () => {
    const kept = await post('/settings', settingsForm());
    assert.equal(kept.status, 303);
    assert.equal(store.config().connect_after_days, 30);
    const refused = await post('/settings', settingsForm({ connect_after_days: '0' }));
    assert.equal(refused.status, 422);
    const saved = await post('/settings', settingsForm({ connect_after_days: '45' }));
    assert.equal(saved.status, 303);
    assert.equal(store.config().connect_after_days, 45);
  });
});
