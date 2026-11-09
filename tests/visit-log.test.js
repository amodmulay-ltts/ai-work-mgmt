import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../app/server.js';
import { cleanup, makeClone, makeRemote } from './helpers.js';

const post = (base, url, fields) =>
  fetch(base + url, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
  });

const visit = (status, on, note) => ({
  customer: 'Bosch',
  kind: 'EI center visit',
  status,
  on,
  sales_lead: 'Priya S',
  with: 'Ravi K',
  note,
});

describe('visit log: cancel, counts and JSON export', () => {
  let app;
  let customerId;

  before(async () => {
    const { dir } = await makeRemote();
    const root = await makeClone(dir, 'app', null);
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
    await post(app.base, '/visits', visit('Done', '2026-10-01', 'Kick-off'));
    await post(app.base, '/visits', visit('Planned', '2099-06-01', 'Demo'));
    customerId = app.store.listCustomers()[0].id;
  });

  after(async () => {
    await app.close();
  });

  const plannedId = () => app.store.getCustomer(customerId).connects.find((c) => c.status === 'Planned').id;

  test('cancelling a planned visit saves it as Cancelled, with one commit', async () => {
    const res = await post(app.base, `/customers/${customerId}/connects/${plannedId()}/cancel`, { next: '/visits' });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/visits');
    const cancelled = app.store.getCustomer(customerId).connects.filter((c) => c.status === 'Cancelled');
    assert.equal(cancelled.length, 1);
    assert.equal(cancelled[0].note, 'Demo');
  });

  test('a cancelled visit cannot be marked done', async () => {
    const id = app.store.getCustomer(customerId).connects.find((c) => c.status === 'Cancelled').id;
    await post(app.base, `/customers/${customerId}/connects/${id}/done`, {});
    assert.equal(app.store.getCustomer(customerId).connects.find((c) => c.id === id).status, 'Cancelled');
  });

  test('the dashboard shows completed, planned and cancelled visit counts', async () => {
    const html = await (await fetch(`${app.base}/`)).text();
    assert.match(html, /visit-total">1<\/span>\s*<span class="kpi-sub">completed/);
    assert.match(html, /visit-total">0<\/span>\s*<span class="kpi-sub">planned/);
    assert.match(html, /visit-total">1<\/span>\s*<span class="kpi-sub">cancelled/);
  });

  test('the visits page can filter to cancelled visits', async () => {
    const html = await (await fetch(`${app.base}/visits?status=Cancelled`)).text();
    assert.match(html, /<option value="Cancelled" selected>/);
    assert.match(html, /Demo/);
    assert.doesNotMatch(html, /Kick-off/);
  });

  test('the JSON export shows each visit with its details, as JSON opened in the browser', async () => {
    const res = await fetch(`${app.base}/export/visits.json`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /application\/json/);
    assert.equal(res.headers.get('content-disposition'), null, 'opens in the browser, not as a download');
    const body = await res.json();
    assert.equal(body.count, 2);
    assert.equal(body.status, 'All');
    const kickoff = body.visits.find((v) => v.note === 'Kick-off');
    assert.deepEqual(
      { customer: kickoff.customer, kind: kickoff.kind, status: kickoff.status, on: kickoff.on, sales_lead: kickoff.sales_lead, who_met: kickoff.who_met },
      { customer: 'Bosch', kind: 'EI center visit', status: 'Done', on: '2026-10-01', sales_lead: 'Priya S', who_met: 'Ravi K' },
    );
    assert.ok(kickoff.id && kickoff.customer_id === customerId && kickoff.created_at);
  });

  test('the JSON export can be filtered by status', async () => {
    const body = await (await fetch(`${app.base}/export/visits.json?status=Cancelled`)).json();
    assert.equal(body.status, 'Cancelled');
    assert.equal(body.count, 1);
    assert.equal(body.visits[0].status, 'Cancelled');
  });
});
