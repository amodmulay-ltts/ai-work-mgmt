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

const newRfq = (presales) => ({
  title: 'Finance cockpit',
  type: 'Lead',
  customer: 'Bosch',
  sales_owner: 'Priya S',
  presales_owner: presales,
  received_on: '2026-10-01',
  stage: 'Lead',
  probability: '5',
  currency: 'EUR',
  priority: 'Medium',
  go_no_go: 'Pending',
});

describe('new opportunity: default supporter', () => {
  let app;
  let me;

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
    me = app.store.config().me_person_id;
  });

  after(async () => {
    await app.close();
  });

  test('a new opportunity where I am not an owner starts with me as supporter', async () => {
    const res = await post(app.base, '/opportunities', newRfq('Rahul K'));
    assert.equal(res.status, 303);
    const deal = app.store.listDeals().find((d) => d.title === 'Finance cockpit');
    assert.deepEqual(deal.support_ids, [me]);
  });

  test('a new opportunity where I am the presales owner does not repeat me as supporter', async () => {
    const res = await post(app.base, '/opportunities', { ...newRfq('Amod Mulay'), title: 'Owned by me' });
    assert.equal(res.status, 303);
    const deal = app.store.listDeals().find((d) => d.title === 'Owned by me');
    assert.deepEqual(deal.support_ids, []);
  });
});
