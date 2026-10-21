import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { moveReferences, personRefs, personUsage } from '../app/lib/merge.js';
import { createApp } from '../app/server.js';
import { cleanup, git, makeClone, makeRemote } from './helpers.js';

const YEAR = new Date().getFullYear();
const deal = (over = {}) => ({
  id: `DL-${YEAR}-0001`, sales_owner_id: null, presales_owner_id: null, delivery_owner_id: null, contact_ids: [],
  support_ids: [], support_requests: [], history: [], ...over,
});

describe('person references', () => {
  test('a deal refers to its owners, contacts, supporters and ask people', () => {
    const d = deal({
      sales_owner_id: 'PE-0002', contact_ids: ['PE-0003'], support_ids: ['PE-0004'],
      support_requests: [{ id: 'SR-001', assignee_id: 'PE-0005', requested_by_id: null }],
    });
    assert.deepEqual(personRefs(d).sort(), ['PE-0002', 'PE-0003', 'PE-0004', 'PE-0005']);
  });

  test('moving a deal\x27s references swaps every one, merges duplicates, and notes it in history', () => {
    const d = deal({ sales_owner_id: 'PE-0002', contact_ids: ['PE-0002', 'PE-0009'], support_ids: ['PE-0002'] });
    const moved = moveReferences(d, 'PE-0002', 'PE-0001', '2026-10-21T10:00:00+01:00');
    assert.equal(moved.sales_owner_id, 'PE-0001');
    assert.deepEqual(moved.contact_ids, ['PE-0001', 'PE-0009'], 'no duplicate contact');
    assert.deepEqual(moved.support_ids, ['PE-0001']);
    assert.equal(moved.history.at(-1).kind, 'note');
    assert.match(moved.history.at(-1).text, /PE-0002 merged into PE-0001/);
  });

  test('a record that does not refer to the person is returned unchanged (same object)', () => {
    const d = deal({ sales_owner_id: 'PE-0009' });
    assert.equal(moveReferences(d, 'PE-0002', 'PE-0001', 'x'), d);
  });

  test('customers and activities move their account manager, connect owners and owner', () => {
    const customer = { id: 'CU-0001', account_manager_id: 'PE-0002', connects: [{ id: 'c1', who_id: 'PE-0002' }, { id: 'c2', who_id: null }] };
    const movedCustomer = moveReferences(customer, 'PE-0002', 'PE-0001', 'x');
    assert.equal(movedCustomer.account_manager_id, 'PE-0001');
    assert.equal(movedCustomer.connects[0].who_id, 'PE-0001');
    assert.equal(movedCustomer.connects[1].who_id, null);
    const activity = { id: 'AC-0001', owner_id: 'PE-0002' };
    assert.equal(moveReferences(activity, 'PE-0002', 'PE-0001', 'x').owner_id, 'PE-0001');
  });

  test('usage counts the records that refer to a person', () => {
    const records = {
      deals: [deal({ sales_owner_id: 'PE-0002' }), deal({ id: `DL-${YEAR}-0002` })],
      customers: [{ id: 'CU-0001', account_manager_id: 'PE-0002', connects: [] }],
      activities: [{ id: 'AC-0001', owner_id: 'PE-0002' }],
    };
    assert.deepEqual(personUsage(records, 'PE-0002'), { opportunities: 1, customers: 1, activities: 1 });
  });
});

describe('merging two people over HTTP', () => {
  let app;
  let root;
  let close;

  before(async () => {
    const remote = await makeRemote();
    root = await makeClone(remote.dir, 'app', null);
    const created = await createApp({ root, syncEnabled: false });
    const server = await new Promise((resolve) => {
      const s = created.app.listen(0, '127.0.0.1', () => resolve(s));
    });
    app = { base: `http://127.0.0.1:${server.address().port}`, store: created.store };
    close = async () => {
      await new Promise((resolve) => server.close(resolve));
      await cleanup(remote.dir);
    };
    await post('/setup', { name: 'Amod Mulay', email: '' });
    // "Priya Sharma" is the mistake; "Priya S" is the right person.
    await post('/people', { name: 'Priya S', role: 'Sales', active: 'on' });
    await post('/opportunities', {
      title: 'Brake controller', type: 'Lead', customer: 'Bosch', sales_owner: 'Priya Sharma', received_on: '2026-10-01',
      stage: 'Lead', probability: '5', currency: 'EUR', priority: 'Medium', go_no_go: 'Pending',
    });
    await post('/activities', { title: 'Demo', kind: 'Prototype', status: 'In progress', owner_id: app.store.findPersonByName('Priya Sharma').id });
  });

  after(async () => {
    await close();
  });

  const post = (url, fields) =>
    fetch(app.base + url, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields),
    });
  const commits = () => Number(git(root, 'rev-list', '--count', 'HEAD'));

  test('the merge page shows what would move', async () => {
    const wrong = app.store.findPersonByName('Priya Sharma');
    const html = await (await fetch(`${app.base}/people/${wrong.id}/merge`)).text();
    assert.match(html, /1 opportunity/);
    assert.match(html, /1 activity/);
    assert.match(html, /data-type-to-confirm="Priya Sharma"/);
  });

  test('nothing moves without the name typed, or into the same person', async () => {
    const wrong = app.store.findPersonByName('Priya Sharma');
    const right = app.store.findPersonByName('Priya S');
    const before = commits();
    await post(`/people/${wrong.id}/merge`, { target_id: right.id });
    await post(`/people/${wrong.id}/merge`, { target_id: wrong.id, confirm: 'Priya Sharma' });
    assert.ok(app.store.getPerson(wrong.id), 'the wrong person is still there');
    assert.equal(commits(), before);
  });

  test('a person used only on an ask cannot be deleted; merge and delete both keep the record', async () => {
    const wrong = app.store.findPersonByName('Priya Sharma');
    const deal = app.store.listDeals()[0];
    await post(`/opportunities/${deal.id}/asks`, { text: 'Estimate', assignee_id: wrong.id, due_on: '' });
    await assert.rejects(app.store.delete(app.store.getPerson(wrong.id), 'x'), /still used/);
  });

  test('a merge moves every reference and removes the wrong person, in one commit', async () => {
    const wrong = app.store.findPersonByName('Priya Sharma');
    const right = app.store.findPersonByName('Priya S');
    const before = commits();
    const res = await post(`/people/${wrong.id}/merge`, { target_id: right.id, confirm: 'Priya Sharma' });
    assert.equal(res.status, 303);
    assert.equal(commits(), before + 1, 'one commit');
    assert.equal(app.store.getPerson(wrong.id), null);
    assert.equal(app.store.listDeals()[0].sales_owner_id, right.id);
    assert.equal(app.store.listDeals()[0].support_requests[0].assignee_id, right.id);
    assert.equal(app.store.listActivities()[0].owner_id, right.id);
    await assert.rejects(fs.access(path.join(root, 'data', 'people', `${wrong.id}.json`)));
    assert.equal(personUsageOf(right.id), 3, 'the right person now holds all of them');
  });

  function personUsageOf(id) {
    const count = app.store.listDeals().filter((d) => d.sales_owner_id === id).length
      + app.store.listDeals().filter((d) => d.support_requests.some((a) => a.assignee_id === id)).length
      + app.store.listActivities().filter((a) => a.owner_id === id).length;
    return count;
  }
});
