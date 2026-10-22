import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../app/server.js';
import { cleanup, makeClone, makeRemote } from './helpers.js';

const YEAR = new Date().getFullYear();

describe('Recently updated shows the next step and a summary on hover', () => {
  let app;
  let close;

  before(async () => {
    const remote = await makeRemote();
    const root = await makeClone(remote.dir, 'app', null);
    const created = await createApp({ root, syncEnabled: false });
    const server = await new Promise((resolve) => {
      const s = created.app.listen(0, '127.0.0.1', () => resolve(s));
    });
    app = { base: `http://127.0.0.1:${server.address().port}` };
    close = async () => {
      await new Promise((resolve) => server.close(resolve));
      await cleanup(remote.dir);
    };
    const post = (url, fields) => fetch(app.base + url, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields),
    });
    await post('/setup', { name: 'Amod Mulay', email: '' });
    await post('/opportunities', {
      title: 'Brake controller', type: 'Lead', customer: 'Bosch', sales_owner: 'Priya S', received_on: '2026-10-01',
      stage: 'Lead', probability: '20', currency: 'EUR', est_value: '4000', priority: 'Medium', go_no_go: 'Pending',
      next_action: 'Call the buyer <today>', next_action_due: '2026-10-30', description: 'Second source for brake modules.',
    });
  });

  after(async () => {
    await close();
  });

  test('the table has a Next step column with the step and its due date', async () => {
    const html = await (await fetch(`${app.base}/`)).text();
    assert.match(html, /<th scope="col">Next step<\/th>/);
    assert.match(html, /Call the buyer &lt;today&gt;/, 'the step is escaped');
    assert.match(html, /<span class="rel">30 Oct 2026<\/span>/);
  });

  test('hovering a row shows what the opportunity is, its owners, value and next step', async () => {
    const html = await (await fetch(`${app.base}/`)).text();
    const title = html.match(/<tr class="clickable" data-href="\/opportunities\/DL-\d{4}-0001" title="([^"]*)"/);
    assert.ok(title, 'the row has a title');
    const text = title[1].replaceAll('&#39;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>');
    assert.match(text, new RegExp(`DL-${YEAR}-0001 · Brake controller`));
    assert.match(text, /Bosch · Lead \(Open\)/);
    assert.match(text, /Sales: Priya S/);
    assert.match(text, /EUR 4K · probability 20%/);
    assert.match(text, /Next step: Call the buyer <today> \(due 30 Oct 2026\)/);
    assert.match(text, /Second source for brake modules\./);
  });

  test('a row with no next step says so', async () => {
    const post = await fetch(`${app.base}/opportunities`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ title: 'No step yet', type: 'Lead', customer: 'Tata', sales_owner: 'Priya S', received_on: '2026-10-01', stage: 'Lead', probability: '5', currency: 'EUR', priority: 'Medium', go_no_go: 'Pending' }),
    });
    assert.equal(post.status, 303);
    const html = await (await fetch(`${app.base}/`)).text();
    assert.match(html, /Not set/);
  });
});

describe('Recently updated shows the date of the last update', () => {
  test('a Last updated column is in the table, after the value', async () => {
    const remote = await makeRemote();
    const root = await makeClone(remote.dir, 'app', null);
    const created = await createApp({ root, syncEnabled: false });
    const server = await new Promise((resolve) => {
      const s = created.app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      await fetch(`${base}/setup`, {
        method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ name: 'Amod Mulay', email: '' }),
      });
      await fetch(`${base}/opportunities`, {
        method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ title: 'Dated', type: 'Lead', customer: 'Bosch', sales_owner: 'Priya S', received_on: '2026-10-01', stage: 'Lead', probability: '5', currency: 'EUR', priority: 'Medium', go_no_go: 'Pending' }),
      });
      const html = await (await fetch(`${base}/`)).text();
      const deal = created.store.listDeals()[0];
      const day = new Date(deal.updated_at.slice(0, 10) + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
      assert.match(html, /<th scope="col">Last updated<\/th>\s*<th scope="col">Next step<\/th>/);
      assert.ok(html.includes(day), `the update date ${day} is shown`);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      await cleanup(remote.dir);
    }
  });
});
