import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../app/server.js';
import { cleanup, makeClone, makeRemote } from './helpers.js';

describe('the Visits page for entering customer visits', () => {
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
  const visitForm = (over = {}) => ({
    customer_id: 'CU-0001', kind: 'EI center visit', status: 'Done', on: '2026-10-20', who_id: '', with: 'Plant lead', note: 'Demo', ...over,
  });

  test('the page has the entry form, with the customer, the visit and the status to pick', async () => {
    const res = await fetch(`${base}/visits`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /<h3>Log a visit<\/h3>/);
    assert.match(html, /<select id="f-customer_id" name="customer_id"/);
    assert.match(html, /<option value="CU-0001">Bosch<\/option>/);
    assert.match(html, /Visit to the EI centre/);
    assert.match(html, /Visit to customer premises/);
  });

  test('a completed visit to customer premises is saved on the customer', async () => {
    const res = await post('/visits', visitForm({ kind: 'Customer premises visit' }));
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/visits');
    const saved = store.getCustomer('CU-0001').connects.at(-1);
    assert.equal(saved.kind, 'Customer premises visit');
    assert.equal(saved.status, 'Done');
    assert.equal(saved.with, 'Plant lead');
  });

  test('a planned visit to the EI centre is saved as planned', async () => {
    await post('/visits', visitForm({ status: 'Planned', on: '2099-02-03' }));
    const planned = store.getCustomer('CU-0001').connects.at(-1);
    assert.equal(planned.status, 'Planned');
    const html = await (await fetch(`${base}/visits?status=Planned`)).text();
    assert.match(html, /2099|3 Feb 2099/);
    assert.doesNotMatch(html, /20 Oct 2026/, 'the filter keeps only the planned visits');
  });

  test('a Teams meeting is refused here, and the typed values are kept on the form', async () => {
    const before = store.getCustomer('CU-0001').connects.length;
    const res = await post('/visits', visitForm({ kind: 'Teams', with: 'Typed name' }));
    assert.equal(res.status, 422);
    const html = await res.text();
    assert.match(html, /Pick a visit: to the EI centre or to customer premises/);
    assert.match(html, /value="Typed name"/);
    assert.equal(store.getCustomer('CU-0001').connects.length, before, 'nothing is saved');
  });

  test('a planned visit in the past is refused, and a visit needs a customer', async () => {
    const before = store.getCustomer('CU-0001').connects.length;
    assert.equal((await post('/visits', visitForm({ status: 'Planned', on: '2020-01-01' }))).status, 422);
    assert.equal((await post('/visits', visitForm({ customer_id: '' }))).status, 422);
    assert.equal(store.getCustomer('CU-0001').connects.length, before);
  });

  test('Mark done and Remove from the Visits page go back to the Visits page', async () => {
    // A planned visit whose day has passed cannot be typed in, so it is set up directly (as after its date).
    const customer = store.getCustomer('CU-0001');
    const due = { id: 'duevisit', on: '2020-02-02', kind: 'EI center visit', status: 'Planned', who_id: null, with: 'Due today', note: '', created_at: '2020-01-01T00:00:00Z' };
    await store.save([{ ...customer, connects: [...customer.connects, due] }], 'test: due visit');
    const done = await post(`/customers/CU-0001/connects/${due.id}/done`, { next: '/visits' });
    assert.equal(done.headers.get('location'), '/visits');
    assert.equal(store.getCustomer('CU-0001').connects.find((c) => c.id === due.id).status, 'Done');
    const removed = await post(`/customers/CU-0001/connects/${due.id}/delete`, { next: '/visits' });
    assert.equal(removed.headers.get('location'), '/visits');
    assert.ok(!store.getCustomer('CU-0001').connects.some((c) => c.id === due.id));
  });

  test('the customer page still goes back to the customer when no next is sent', async () => {
    const res = await post('/customers/CU-0001/connects', { on: '2020-03-03', kind: 'Teams', status: 'Done' });
    assert.equal(res.headers.get('location'), '/customers/CU-0001');
  });
});
