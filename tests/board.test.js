import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../app/server.js';
import { cleanup, makeClone, makeRemote } from './helpers.js';

describe('the board: open opportunities in lanes by stage, moved by dragging', () => {
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
    const post = (url, fields) => fetch(base + url, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields),
    });
    const common = { customer: 'Bosch', sales_owner: 'Priya S', received_on: '2026-10-01', type: 'Lead', probability: '5', currency: 'EUR', est_value: '3000', priority: 'Medium', go_no_go: 'Pending' };
    await post('/setup', { name: 'Amod Mulay', email: '' });
    await post('/opportunities', { ...common, title: 'Lead card', stage: 'Lead' });
    await post('/opportunities', { ...common, title: 'Won card', stage: 'Won', probability: '100' });
  });

  after(async () => {
    await close();
  });

  test('each open stage is a lane, and the open opportunity sits in its stage lane', async () => {
    const html = await (await fetch(`${base}/board`)).text();
    const lead = html.indexOf('data-stage="Lead"');
    const qualified = html.indexOf('data-stage="Qualified"');
    const card = html.indexOf('Lead card');
    assert.ok(lead > 0 && qualified > lead, 'the Lead lane comes first, then Qualified');
    assert.ok(card > lead && card < qualified, 'the card is inside the Lead lane');
  });

  test('won opportunities are not on the board', async () => {
    const html = await (await fetch(`${base}/board`)).text();
    assert.doesNotMatch(html, /Won card/);
  });

  test('a card moved to another stage changes its stage and its probability, as the stage route does', async () => {
    const id = store.listDeals().find((d) => d.title === 'Lead card').id;
    const res = await fetch(`${base}/opportunities/${id}/stage`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ stage: 'Qualified' }),
    });
    assert.equal(res.status, 303);
    const moved = store.getDeal(id);
    assert.equal(moved.stage, 'Qualified');
    assert.equal(moved.probability, 10);
  });

  test('the browser script moves cards on drop, through the stage route', async () => {
    const js = await (await fetch(`${base}/static/app.js`)).text();
    assert.match(js, /data-kanban-card/);
    assert.match(js, /\/opportunities\/\$\{id\}\/stage/);
  });
});
