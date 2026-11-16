import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../app/server.js';
import { cleanup, git, makeClone, makeRemote } from './helpers.js';

const post = (base, url, fields) =>
  fetch(base + url, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
  });

const visit = (over = {}) => ({
  customer: 'Bosch', kind: 'EI center visit', status: 'Done', on: '2026-10-20', sales_lead: 'Priya S',
  with: 'Plant lead', note: 'Demo', ...over,
});

describe('visits: Online type and editing', () => {
  let app;
  let root;
  let customerId;
  let visitId;

  before(async () => {
    const { dir } = await makeRemote();
    root = await makeClone(dir, 'app', null);
    const created = await createApp({ root, syncEnabled: false });
    const server = await new Promise((resolve) => {
      const s = created.app.listen(0, '127.0.0.1', () => resolve(s));
    });
    app = {
      base: `http://127.0.0.1:${server.address().port}`,
      store: created.store,
      close: async () => {
        await new Promise((resolve) => server.close(resolve));
        await cleanup(dir);
      },
    };
    await post(app.base, '/setup', { name: 'Amod Mulay', email: '' });
    await post(app.base, '/visits', visit());
    customerId = app.store.listCustomers()[0].id;
    visitId = app.store.getCustomer(customerId).connects[0].id;
  });

  after(async () => {
    await app.close();
  });

  const onlyVisit = () => app.store.getCustomer(customerId).connects.find((c) => c.id === visitId);

  test('an Online visit can be logged', async () => {
    const res = await post(app.base, '/visits', visit({ kind: 'Online visit', note: 'Online check', on: '2026-10-21' }));
    assert.equal(res.status, 303);
    assert.equal(app.store.getCustomer(customerId).connects.find((c) => c.note === 'Online check').kind, 'Online visit');
  });

  test('the Visits page offers EI Center, Online and Customer Premises, and links each visit to edit', async () => {
    const html = await (await fetch(`${app.base}/visits`)).text();
    assert.match(html, /<option value="EI center visit"[^>]*>EI Center<\/option>/);
    assert.match(html, /<option value="Online visit"[^>]*>Online<\/option>/);
    assert.match(html, /<option value="Customer premises visit"[^>]*>Customer Premises<\/option>/);
    assert.match(html, new RegExp(`href="/customers/${customerId}/connects/${onlyVisit().id}/edit\\?next=/visits"`));
  });

  test('the edit form opens with the visit filled in', async () => {
    const v = onlyVisit();
    const res = await fetch(`${app.base}/customers/${customerId}/connects/${v.id}/edit`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /<option value="EI center visit" selected>EI Center<\/option>/);
    assert.match(html, /value="Plant lead"/);
    assert.match(html, /value="Priya S"/);
  });

  test('an edit changes the kind, note and date, keeps the customer and the first save date, and is one commit', async () => {
    const v = onlyVisit();
    const before = Number(git(root, 'rev-list', '--count', 'HEAD'));
    const res = await post(app.base, `/customers/${customerId}/connects/${v.id}/edit`, {
      kind: 'Customer premises visit', status: 'Done', on: '2026-10-22', sales_lead: 'Priya S', with: 'Plant head', note: 'Moved to the premises', next: '/visits',
    });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/visits');
    assert.equal(Number(git(root, 'rev-list', '--count', 'HEAD')), before + 1);
    const updated = app.store.getCustomer(customerId).connects.find((c) => c.id === v.id);
    assert.equal(updated.kind, 'Customer premises visit');
    assert.equal(updated.on, '2026-10-22');
    assert.equal(updated.note, 'Moved to the premises');
    assert.equal(updated.created_at, v.created_at);
    assert.equal(git(root, 'log', '-1', '--format=%s').includes('edited'), true);
  });

  test('a new sales lead typed on the edit is created in the same commit', async () => {
    const v = onlyVisit();
    await post(app.base, `/customers/${customerId}/connects/${v.id}/edit`, {
      kind: 'Online visit', status: 'Done', on: '2026-10-22', sales_lead: 'Newton L', with: '', note: v.note,
    });
    const person = app.store.listPeople().find((p) => p.name === 'Newton L');
    assert.ok(person, 'the new person exists');
    assert.equal(app.store.getCustomer(customerId).connects.find((c) => c.id === v.id).who_id, person.id);
  });

  test('an edit that breaks the date rule is refused and changes nothing', async () => {
    const v = onlyVisit();
    const res = await post(app.base, `/customers/${customerId}/connects/${v.id}/edit`, {
      kind: 'Online visit', status: 'Planned', on: '2020-01-01', sales_lead: '', with: '', note: 'Too early',
    });
    assert.equal(res.status, 422);
    assert.equal(app.store.getCustomer(customerId).connects.find((c) => c.id === v.id).note, v.note);
  });

  test('a cancelled visit cannot be edited', async () => {
    await post(app.base, '/visits', visit({ status: 'Planned', on: '2099-01-01', note: 'Future' }));
    const future = app.store.getCustomer(customerId).connects.find((c) => c.note === 'Future');
    await post(app.base, `/customers/${customerId}/connects/${future.id}/cancel`, {});
    const page = await fetch(`${app.base}/customers/${customerId}/connects/${future.id}/edit`, { redirect: 'manual' });
    assert.equal(page.status, 303);
    const res = await post(app.base, `/customers/${customerId}/connects/${future.id}/edit`, {
      kind: 'Online visit', status: 'Planned', on: '2099-02-01', sales_lead: '', with: '', note: 'Changed',
    });
    assert.equal(res.status, 303);
    assert.equal(app.store.getCustomer(customerId).connects.find((c) => c.id === future.id).note, 'Future');
  });

  test('a Teams meeting is not a visit and has no visit edit page', async () => {
    await post(app.base, `/customers/${customerId}/connects`, { on: '2026-09-01', kind: 'Teams', status: 'Done', note: 'Call' });
    const teams = app.store.getCustomer(customerId).connects.find((c) => c.kind === 'Teams');
    const res = await fetch(`${app.base}/customers/${customerId}/connects/${teams.id}/edit`);
    assert.equal(res.status, 404);
  });
});
