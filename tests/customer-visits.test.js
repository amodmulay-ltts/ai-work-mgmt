import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { connectSummary, newConnect, plannedConnects, visitCounts } from '../app/lib/connects.js';
import { createApp } from '../app/server.js';
import { cleanup, makeClone, makeRemote } from './helpers.js';

const TODAY = '2026-10-26';
const PEOPLE = [{ id: 'PE-0001', name: 'Priya S', active: true }];
const form = (over = {}) => ({ on: '2026-10-20', kind: 'EI center visit', status: 'Done', ...over });

describe('visit rules', () => {
  test('a planned visit must be today or later, and a completed one cannot be in the future', () => {
    assert.equal(newConnect(form({ status: 'Planned', on: '2026-11-03' }), { id: 'a', people: PEOPLE, today: TODAY }).errors.length, 0);
    assert.match(newConnect(form({ status: 'Planned', on: '2026-10-01' }), { id: 'a', people: PEOPLE, today: TODAY }).errors[0], /today or later/);
    assert.match(newConnect(form({ status: 'Done', on: '2026-11-03' }), { id: 'a', people: PEOPLE, today: TODAY }).errors[0], /future/);
  });

  test('a form with no status is a completed connect', () => {
    const { entry } = newConnect({ on: '2026-10-20', kind: 'Teams' }, { id: 'a', people: PEOPLE, today: TODAY });
    assert.equal(entry.status, 'Done');
  });

  test('planned visits do not count as a connect, so they do not clear the flag', () => {
    const connects = [{ id: 'p', on: '2026-11-03', kind: 'Teams', status: 'Planned' }];
    assert.deepEqual(connectSummary(connects), { first: null, last: null, count: 0 });
    assert.deepEqual(plannedConnects(connects, TODAY).map((c) => c.id), ['p']);
  });

  test('the upcoming list is soonest first and holds only planned ones from today on', () => {
    const connects = [
      { id: 'late', on: '2026-12-01', kind: 'Teams', status: 'Planned' },
      { id: 'soon', on: '2026-10-28', kind: 'Teams', status: 'Planned' },
      { id: 'past', on: '2026-10-01', kind: 'Teams', status: 'Planned' },
      { id: 'done', on: '2026-10-20', kind: 'Teams', status: 'Done' },
    ];
    assert.deepEqual(plannedConnects(connects, TODAY).map((c) => c.id), ['soon', 'late']);
  });

  test('visit counts cover EI centre and customer premises visits that are done, not Teams, and old entries count as done', () => {
    const connects = [
      { on: '2025-03-01', kind: 'EI center visit', status: 'Done' },
      { on: '2026-02-01', kind: 'Customer premises visit' },
      { on: '2026-03-01', kind: 'Visit' },
      { on: '2026-03-02', kind: 'Teams', status: 'Done' },
      { on: '2026-12-01', kind: 'EI center visit', status: 'Planned' },
    ];
    assert.deepEqual(visitCounts(connects, '2026'), { total: 3, inYear: 2 });
  });
});

describe('visits over HTTP', () => {
  let base;
  let store;
  let close;

  before(async () => {
    const remote = await makeRemote();
    const root = await makeClone(remote.dir, 'app', null);
    const created = await createApp({ root, syncEnabled: false });
    store = created.store;
    const server = await new Promise((resolve) => {
      const s = created.app.listen(0, '127.0.0.1', () => resolve(s));
    });
    base = `http://127.0.0.1:${server.address().port}`;
    close = async () => {
      await new Promise((resolve) => server.close(resolve));
      await cleanup(remote.dir);
    };
    await post('/setup', { name: 'Amod Mulay', email: '' });
    await post('/opportunities', {
      title: 'Brake controller', type: 'Lead', customer: 'Bosch', sales_owner: 'Priya S', received_on: '2026-10-01',
      stage: 'Lead', probability: '5', currency: 'EUR', priority: 'Medium', go_no_go: 'Pending',
    });
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

  test('a planned visit to the EI centre is saved and shown as upcoming', async () => {
    const res = await post('/customers/CU-0001/connects', { on: '2099-03-02', kind: 'EI center visit', status: 'Planned', who_id: '', with: 'Plant lead', note: 'Demo' });
    assert.equal(res.status, 303);
    const planned = store.getCustomer('CU-0001').connects[0];
    assert.equal(planned.status, 'Planned');
    const html = await (await fetch(`${base}/customers/CU-0001`)).text();
    assert.match(html, /<h3>Upcoming<\/h3>/);
    assert.match(html, /Mark done/);
    assert.match(html, /0 completed/);
  });

  test('the visits cards sit above Internal activities', async () => {
    const html = await (await fetch(`${base}/`)).text();
    assert.ok(html.indexOf('Upcoming visits') < html.indexOf('Internal activities'));
  });

  test('the dashboard lists the upcoming visit and links to the customer', async () => {
    const html = await (await fetch(`${base}/`)).text();
    assert.match(html, /<h2 class="card-pad">Upcoming visits<\/h2>/);
    assert.match(html, /<h2>Visits<\/h2>/);
    assert.match(html, /<a href="\/customers\/CU-0001">Bosch<\/a>/);
    assert.match(html, /EI center visit/);
  });

  test('a completed visit to customer premises counts on the dashboard', async () => {
    await post('/customers/CU-0001/connects', { on: '2020-05-10', kind: 'Customer premises visit', status: 'Done', with: 'Plant head' });
    const html = await (await fetch(`${base}/`)).text();
    assert.match(html, /<a href="\/visits\?status=Done">\s*<span class="visit-total">1<\/span>/);
    assert.match(html, /0 this year/);
  });

  test('a planned visit can be marked done only once its date has come', async () => {
    const planned = store.getCustomer('CU-0001').connects.find((c) => c.status === 'Planned');
    await post(`/customers/CU-0001/connects/${planned.id}/done`, {});
    assert.equal(store.getCustomer('CU-0001').connects.find((c) => c.id === planned.id).status, 'Planned', 'not yet');
    // A planned visit whose day has passed (set up directly, as the form would not allow it).
    const customer = store.getCustomer('CU-0001');
    const due = { id: 'pastplan', on: '2020-01-15', kind: 'EI center visit', status: 'Planned', who_id: null, with: '', note: '', created_at: '2020-01-01T00:00:00Z' };
    await store.save([{ ...customer, connects: [...customer.connects, due] }], 'test: past planned');
    await post('/customers/CU-0001/connects/pastplan/done', {});
    assert.equal(store.getCustomer('CU-0001').connects.find((c) => c.id === 'pastplan').status, 'Done');
  });

  test('a Teams meeting is not a visit, so it is not in the visit count', async () => {
    await post('/customers/CU-0001/connects', { on: '2020-06-01', kind: 'Teams', status: 'Done' });
    const html = await (await fetch(`${base}/`)).text();
    assert.match(html, /<a href="\/visits\?status=Done">\s*<span class="visit-total">2<\/span>/, 'the Teams meeting is not added');
  });
});
