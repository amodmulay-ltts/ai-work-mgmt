import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { DEFAULT_CONFIG } from '../app/config-defaults.js';
import { byCustomer } from '../app/metrics.js';
import { createApp } from '../app/server.js';
import { cleanup, makeClone, makeRemote } from './helpers.js';

describe('open opportunities by customer', () => {
  test('counts open opportunities per customer, with values per currency, most first', () => {
    const names = { 'CU-0001': 'Bosch', 'CU-0002': 'Tata' };
    const deals = [
      { customer_id: 'CU-0002', currency: 'EUR', est_value: 100 },
      { customer_id: 'CU-0001', currency: 'EUR', est_value: 300 },
      { customer_id: 'CU-0001', currency: 'USD', est_value: 50 },
      { customer_id: 'CU-0001', currency: 'EUR', est_value: null },
    ];
    const result = byCustomer(deals, DEFAULT_CONFIG, (id) => names[id]);
    assert.deepEqual(result.map((c) => [c.customer, c.count]), [['Bosch', 3], ['Tata', 1]]);
    assert.deepEqual(result[0].totals, { EUR: 300, USD: 50 });
  });

  test('ties are sorted by name', () => {
    const names = { a: 'Zeta', b: 'Alpha' };
    const result = byCustomer([{ customer_id: 'a', currency: 'EUR', est_value: 1 }, { customer_id: 'b', currency: 'EUR', est_value: 1 }], DEFAULT_CONFIG, (id) => names[id]);
    assert.deepEqual(result.map((c) => c.customer), ['Alpha', 'Zeta']);
  });
});

describe('the dashboard shows the customer chart', () => {
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
    const base = { sales_owner: 'Priya S', received_on: '2026-10-01', type: 'Lead', stage: 'Lead', probability: '20', priority: 'Medium', go_no_go: 'Pending', currency: 'EUR', est_value: '4000' };
    await post('/setup', { name: 'Amod Mulay', email: '' });
    await post('/opportunities', { ...base, title: 'Brake one', customer: 'Bosch' });
    await post('/opportunities', { ...base, title: 'Brake two', customer: 'Bosch' });
    await post('/opportunities', { ...base, title: 'Seat', customer: 'Tata Motors' });
  });

  after(async () => {
    await close();
  });

  test('the card lists each customer with its open count', async () => {
    const html = await (await fetch(`${app.base}/`)).text();
    assert.match(html, /<h2>Open opportunities by customer<\/h2>/);
    const card = html.slice(html.indexOf('Open opportunities by customer'), html.indexOf('Open opportunities by customer') + 800);
    assert.match(card, /Bosch/);
    assert.match(card, /2 · EUR 8K/);
    assert.match(card, /Tata Motors/);
  });
});
