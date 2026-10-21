import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../app/server.js';
import { cleanup, git, makeClone, makeRemote } from './helpers.js';

/** Starts the real app on a temp repo with no remote, on a random port. */
async function startApp() {
  const { dir } = await makeRemote();
  const root = await makeClone(dir, 'app', null);
  const { app, store } = await createApp({ root, syncEnabled: false });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    root,
    store,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      await cleanup(dir);
    },
  };
}

/** Form POST without following the redirect. */
const post = (base, url, fields) =>
  fetch(base + url, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
  });

const get = async (base, url) => {
  const res = await fetch(base + url, { redirect: 'manual' });
  return { status: res.status, location: res.headers.get('location'), html: await res.text(), res };
};

/** The flash text set by the last response, decoded from its cookie. */
function flashOf(res) {
  const cookie = res.headers.get('set-cookie') ?? '';
  const match = cookie.match(/flash=([^;]+)/);
  return match ? JSON.parse(decodeURIComponent(match[1])) : null;
}

/** A valid new-deal form. Tests override the fields they change. */
const dealForm = (overrides = {}) => ({
  title: 'ADAS validation services',
  type: 'RFQ',
  customer: 'Bosch',
  contacts: 'Ravi K',
  sales_owner: 'Priya S',
  presales_owner: '',
  received_on: '2026-10-01',
  stage: 'Lead',
  probability: '5',
  currency: 'EUR',
  est_value: '1250000',
  submission_due: '2026-10-20',
  priority: 'Medium',
  go_no_go: 'Pending',
  ...overrides,
});

describe('app routes', () => {
  let app;
  before(async () => {
    app = await startApp();
    await post(app.base, '/setup', { name: 'Amod Mulay', email: 'amod.mulay@ltts.com' });
  });
  after(async () => {
    await app.close();
  });

  test('first run: setup saves the user and the dashboard greets them', async () => {
    const page = await get(app.base, '/');
    assert.equal(page.status, 200);
    assert.match(page.html, /Good (morning|afternoon|evening), Amod/);
    assert.equal(app.store.config().me_person_id, 'PE-0001');
  });

  test('the setup form rejects a missing name and keeps the email', async () => {
    const res = await post(app.base, '/setup', { name: '', email: 'bad' });
    assert.equal(res.status, 422);
    const html = await res.text();
    assert.match(html, /Enter your name\./);
    assert.match(html, /Enter a valid email address\./);
  });

  test('creating an opportunity with a new customer and owners makes one commit', async () => {
    const before = Number(git(app.root, 'rev-list', '--count', 'HEAD'));
    const res = await post(app.base, '/opportunities', dealForm());
    assert.equal(res.status, 303);
    assert.match(res.headers.get('location'), /^\/opportunities\/DL-\d{4}-0001$/);
    assert.equal(Number(git(app.root, 'rev-list', '--count', 'HEAD')), before + 1);

    const deal = app.store.getDeal('DL-2026-0001');
    assert.equal(app.store.getCustomer(deal.customer_id).name, 'Bosch');
    assert.equal(app.store.getPerson(deal.sales_owner_id).name, 'Priya S');
    assert.equal(app.store.getPerson(deal.presales_owner_id).id, 'PE-0001', 'presales defaults to me');
    assert.equal(app.store.getPerson(deal.contact_ids[0]).role, 'Customer');
    assert.match(git(app.root, 'log', '-1', '--format=%s'), /^DL-2026-0001: created – ADAS validation services$/);
    assert.equal(flashOf(res).kind, 'success');
  });

  test('a form with errors is shown again with the typed values (422)', async () => {
    const res = await post(app.base, '/opportunities', dealForm({ customer: '', title: 'Keep me' }));
    assert.equal(res.status, 422);
    const html = await res.text();
    assert.match(html, /Customer is required/);
    assert.match(html, /value="Keep me"/);
  });

  test('the opportunity detail page shows the opportunity, its stage stepper and timeline', async () => {
    const page = await get(app.base, '/opportunities/DL-2026-0001');
    assert.equal(page.status, 200);
    assert.match(page.html, /ADAS validation services/);
    assert.match(page.html, /Opportunity created/);
    assert.match(page.html, /aria-current="step"/);
  });

  test('marking an opportunity as Proposal Submitted sets the submitted date', async () => {
    const res = await post(app.base, '/opportunities/DL-2026-0001/stage', { stage: 'Proposal Submitted' });
    assert.equal(res.status, 303);
    const deal = app.store.getDeal('DL-2026-0001');
    assert.equal(deal.stage, 'Proposal Submitted');
    assert.equal(deal.probability, 50);
    assert.match(deal.submitted_on, /^\d{4}-\d{2}-\d{2}$/);
  });

  test('marking an opportunity Lost without a reason is refused and nothing changes', async () => {
    const res = await post(app.base, '/opportunities/DL-2026-0001/stage', { stage: 'Lost', outcome_reason: '' });
    assert.equal(res.status, 303);
    assert.equal(flashOf(res).kind, 'error');
    assert.equal(app.store.getDeal('DL-2026-0001').stage, 'Proposal Submitted');
  });

  test('marking an opportunity Lost with a reason closes it', async () => {
    await post(app.base, '/opportunities/DL-2026-0001/stage', { stage: 'Lost', outcome_reason: 'Price' });
    const deal = app.store.getDeal('DL-2026-0001');
    assert.equal(deal.stage, 'Lost');
    assert.equal(deal.outcome_reason, 'Price');
    assert.match(deal.closed_on, /^\d{4}-\d{2}-\d{2}$/);
  });

  test('a note is added to the timeline', async () => {
    await post(app.base, '/opportunities/DL-2026-0001/notes', { note: 'Buyer asked for a call' });
    const page = await get(app.base, '/opportunities/DL-2026-0001');
    assert.match(page.html, /Buyer asked for a call/);
    assert.equal(git(app.root, 'log', '-1', '--format=%s'), 'DL-2026-0001: note added');
  });

  test('the opportunities list defaults to open opportunities and filters by status', async () => {
    await post(app.base, '/opportunities', dealForm({ title: 'Second deal', customer: 'Bosch' }));
    const open = await get(app.base, '/opportunities');
    assert.equal(open.status, 200);
    assert.match(open.html, /Second deal/);
    assert.doesNotMatch(open.html, /DL-2026-0001/, 'the lost deal is not open');

    const lost = await get(app.base, '/opportunities?status=lost');
    assert.match(lost.html, /DL-2026-0001/);
    assert.doesNotMatch(lost.html, /Second deal/);
  });

  test('the opportunities list sorts and searches', async () => {
    const sorted = await get(app.base, '/opportunities?status=all&sort=title&dir=desc');
    assert.equal(sorted.status, 200);
    const search = await get(app.base, '/opportunities?status=all&q=second');
    assert.match(search.html, /Second deal/);
    assert.doesNotMatch(search.html, /ADAS validation/);
  });

  test('a customer with deals is kept, and the refusal is shown', async () => {
    const customer = app.store.findCustomerByName('Bosch');
    const res = await post(app.base, `/customers/${customer.id}/delete`, {});
    assert.equal(res.status, 303);
    assert.match(flashOf(res).text, /Customer has 2 opportunities/);
    assert.ok(app.store.getCustomer(customer.id));
  });

  test('a person used on an opportunity can be marked inactive but not deleted', async () => {
    const priya = app.store.findPersonByName('Priya S');
    await post(app.base, `/people/${priya.id}/delete`, {});
    assert.ok(app.store.getPerson(priya.id), 'still there');
    await post(app.base, `/people/${priya.id}/deactivate`, {});
    assert.equal(app.store.getPerson(priya.id).active, false);
  });

  test('the main pages render', async () => {
    const customer = app.store.findCustomerByName('Bosch');
    for (const url of [
      '/opportunities/new', '/opportunities/new?customer=' + customer.id, '/opportunities/DL-2026-0001/edit',
      '/customers', `/customers/${customer.id}`, `/customers/${customer.id}/edit`, '/customers/new',
      '/people', '/people/new', '/people?role=Sales',
    ]) {
      const page = await get(app.base, url);
      assert.equal(page.status, 200, `${url} should render`);
      assert.match(page.html, /<title>/);
    }
  });

  test('an unknown deal shows the not-found page', async () => {
    const page = await get(app.base, '/opportunities/DL-2026-9999');
    assert.equal(page.status, 404);
    assert.match(page.html, /was not found/);
  });

  test('the sync status endpoint reports local mode when no remote is set', async () => {
    const res = await fetch(`${app.base}/api/sync/status`);
    const body = await res.json();
    assert.equal(body.state, 'offline');
  });

  test('the session lock is held by this session on the repo', async () => {
    const lock = JSON.parse(await fs.readFile(path.join(app.root, 'data', '_lock.json'), 'utf8'));
    assert.ok(lock.holder);
  });
});
