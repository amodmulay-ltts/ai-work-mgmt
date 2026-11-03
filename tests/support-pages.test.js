import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../app/server.js';
import { cleanup, makeClone, makeRemote } from './helpers.js';

/** The real app on a temp repo with no remote, on a random port. */
async function startApp() {
  const { dir } = await makeRemote();
  const root = await makeClone(dir, 'app', null);
  const { app, store } = await createApp({ root, syncEnabled: false });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
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

/** Today plus `offset` days, as YYYY-MM-DD (local date, as the app uses). */
function dayOffset(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Presales owner is Meera, not me: a new opportunity defaults its presales owner to me, and an owner
// cannot also be added as a supporter. Supporting someone else's bid is the case this feature is for.
const dealForm = (title) => ({
  title,
  type: 'Lead',
  customer: 'Bosch',
  sales_owner: 'Priya S',
  presales_owner: 'Meera T',
  received_on: dayOffset(-10),
  stage: 'Lead',
  probability: '5',
  currency: 'EUR',
  priority: 'Medium',
  go_no_go: 'Pending',
  submission_due: dayOffset(20),
});

const YEAR = new Date().getFullYear();
const id = (n) => `DL-${YEAR}-${String(n).padStart(4, '0')}`;

/** The text inside the <tr> that holds `needle`, or null. */
function rowWith(html, needle) {
  const rows = html.split('<tr');
  return rows.find((r) => r.includes(needle)) ?? null;
}

describe('RFQs I support: pages, filters and dashboard', () => {
  let app;
  let ravi;

  before(async () => {
    app = await startApp();
    await post(app.base, '/setup', { name: 'Amod Mulay', email: '' });
    const me = app.store.config().me_person_id;
    await post(app.base, '/people', { name: 'Ravi K', role: 'Presales', active: 'on' });
    await post(app.base, '/people', { name: 'Meera T', role: 'Presales', active: 'on' });
    await post(app.base, '/people', { name: 'Tom B', role: 'Presales', active: 'on' });
    ravi = app.store.findPersonByName('Ravi K').id;

    await post(app.base, '/opportunities', dealForm('Mine supported'));   // 0001
    await post(app.base, '/opportunities', dealForm('Ravi supports'));    // 0002
    await post(app.base, '/opportunities', dealForm('Not mine'));         // 0003
    // New opportunities start with me as supporter; take myself off this colleague's deal.
    await post(app.base, `/opportunities/${id(3)}/support`, { action: 'remove', person_id: app.store.config().me_person_id });
    await post(app.base, '/opportunities', dealForm('Won one'));          // 0004
    await post(app.base, `/opportunities/${id(4)}/stage`, { stage: 'Won' });

    await post(app.base, `/opportunities/${id(1)}/support`, { action: 'add', person_id: me });
    await post(app.base, `/opportunities/${id(2)}/support`, { action: 'add', person_id: ravi });
    await post(app.base, `/opportunities/${id(4)}/support`, { action: 'add', person_id: me });

    // My asks: one overdue and open (D1), one due soon (D2), one done (D1, must not show).
    await post(app.base, `/opportunities/${id(1)}/asks`, { text: 'Overdue ask', assignee_id: me, due_on: dayOffset(-3) });
    await post(app.base, `/opportunities/${id(2)}/asks`, { text: 'Soon ask', assignee_id: me, due_on: dayOffset(5) });
    await post(app.base, `/opportunities/${id(1)}/asks`, { text: 'Finished ask', assignee_id: me, due_on: dayOffset(1) });
    await post(app.base, `/opportunities/${id(1)}/asks/SR-002`, { status: 'Done' });
  });

  after(async () => {
    await app.close();
  });

  test('the support page lists open RFQs I support, and hides the others', async () => {
    const page = await get(app.base, '/support');
    assert.equal(page.status, 200);
    assert.match(page.html, /<title>RFQs I support · Work Tracker<\/title>/);
    assert.match(page.html, new RegExp(id(1)));
    assert.match(page.html, new RegExp(id(2)), 'D2 is on my list because I have an open ask on it');
    assert.doesNotMatch(page.html, new RegExp(id(3)));
    assert.doesNotMatch(page.html, new RegExp(id(4)), 'won deals are not open');
  });

  test('the support page shows my open asks and the next due date for each RFQ', async () => {
    const page = await get(app.base, '/support');
    assert.match(page.html, /My open asks/);
    assert.match(page.html, /Next ask due/);
    const d1 = rowWith(page.html, id(1));
    assert.match(d1, /#support">1<\/a>/, 'one open ask on D1, the done one is not counted');
  });

  test('the support page can show a colleague’s RFQs', async () => {
    const page = await get(app.base, `/support?who=${ravi}`);
    assert.match(page.html, /RFQs Ravi K supports/);
    assert.match(page.html, new RegExp(id(2)));
    assert.doesNotMatch(page.html, new RegExp(id(1)));
  });

  test('a colleague with nothing open gets a clear empty state', async () => {
    const meera = app.store.findPersonByName('Meera T').id;
    const page = await get(app.base, `/support?who=${meera}`);
    assert.match(page.html, /Meera T is not supporting any open RFQs/);
  });

  test('the status filter on the support page shows won RFQs', async () => {
    const page = await get(app.base, '/support?status=won');
    assert.match(page.html, new RegExp(id(4)));
    assert.doesNotMatch(page.html, new RegExp(id(1)));
  });

  test('the search box filters the support page', async () => {
    const page = await get(app.base, '/support?q=ravi');
    assert.match(page.html, new RegExp(id(2)));
    assert.doesNotMatch(page.html, new RegExp(id(1)));
    const none = await get(app.base, '/support?q=zzz-nothing');
    assert.match(none.html, /No RFQs match these filters/);
  });

  test('my asks lists open asks, overdue first, and leaves out done ones', async () => {
    const page = await get(app.base, '/support/asks');
    assert.equal(page.status, 200);
    assert.match(page.html, /<title>My asks · Work Tracker<\/title>/);
    const overdue = page.html.indexOf('Overdue ask');
    const soon = page.html.indexOf('Soon ask');
    assert.ok(overdue > 0 && soon > 0, 'both open asks are listed');
    assert.ok(overdue < soon, 'the overdue ask comes first');
    assert.doesNotMatch(page.html, /Finished ask/);
    assert.match(page.html, new RegExp(`href="/opportunities/${id(1)}#support"`));
  });

  test('the dashboard shows asks for me, with the count due this week', async () => {
    const page = await get(app.base, '/');
    assert.match(page.html, /<h2>Asks for me<\/h2>/);
    assert.match(page.html, /2 due this week/);
    assert.match(page.html, /All my asks \(2\)/);
    assert.match(page.html, /Overdue ask/);
  });

  test('the navigation has the support pages', async () => {
    const page = await get(app.base, '/');
    assert.match(page.html, /href="\/support"/);
    assert.match(page.html, /href="\/support\/asks"/);
  });

  test('the opportunities list can filter to RFQs I support and shows the supporters', async () => {
    const page = await get(app.base, '/opportunities?support=me');
    assert.match(page.html, new RegExp(id(1)));
    assert.match(page.html, new RegExp(id(2)));
    assert.doesNotMatch(page.html, new RegExp(id(3)));
    assert.match(rowWith(page.html, id(2)), /Ravi K/);
  });

  test('the supporters column shows two names and a count for the rest', async () => {
    const tom = app.store.findPersonByName('Tom B').id;
    await post(app.base, `/opportunities/${id(2)}/support`, { action: 'add', person_id: tom });
    const me = app.store.config().me_person_id;
    await post(app.base, `/opportunities/${id(2)}/support`, { action: 'add', person_id: me });
    const page = await get(app.base, '/opportunities');
    assert.match(rowWith(page.html, id(2)), / \+1</, 'three supporters: two names and +1');
  });

  test('every support page has an empty state when nothing matches', async () => {
    const page = await get(app.base, '/opportunities?support=nobody-at-all');
    assert.match(page.html, /No opportunities match these filters/);
  });
});

describe('RFQs I support: before the first person is set up', () => {
  let app;

  before(async () => {
    app = await startApp();
  });

  after(async () => {
    await app.close();
  });

  test('the support pages explain what to do', async () => {
    const support = await get(app.base, '/support');
    assert.equal(support.status, 200);
    assert.match(support.html, /Tell us who you are on the/);
    const asks = await get(app.base, '/support/asks');
    assert.match(asks.html, /Tell us who you are on the/);
  });
});

describe('RFQs I support: nothing assigned to me', () => {
  let app;

  before(async () => {
    app = await startApp();
    await post(app.base, '/setup', { name: 'Amod Mulay', email: '' });
  });

  after(async () => {
    await app.close();
  });

  test('my asks shows the empty state', async () => {
    const page = await get(app.base, '/support/asks');
    assert.match(page.html, /No open asks for you/);
  });

  test('the dashboard card says so too', async () => {
    const page = await get(app.base, '/');
    assert.match(page.html, /No open asks for you/);
  });
});
