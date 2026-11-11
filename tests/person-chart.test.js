import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DEFAULT_CONFIG } from '../app/config-defaults.js';
import { byPerson } from '../app/metrics.js';
import { createApp } from '../app/server.js';
import { cleanup, makeClone, makeRemote } from './helpers.js';

const names = { PE_A: 'Asha', PE_B: 'Ben', PE_C: 'Chen' };
const nameOf = (id) => names[id] ?? '—';

describe('dashboard: open opportunities by person', () => {
  test('a deal counts once for each person in its owner roles', () => {
    const deals = [
      { sales_owner_id: 'PE_A', presales_owner_id: 'PE_B', delivery_owner_id: null, currency: 'EUR', est_value: 100 },
      { sales_owner_id: 'PE_A', presales_owner_id: 'PE_A', delivery_owner_id: 'PE_C', currency: 'EUR', est_value: 50 },
    ];
    const result = byPerson(deals, DEFAULT_CONFIG, nameOf);
    assert.deepEqual(result.map((r) => [r.person, r.count]), [['Asha', 2], ['Ben', 1], ['Chen', 1]]);
    assert.deepEqual(result[0].totals, { EUR: 150 }, 'Asha is on both deals, counted once per deal');
  });

  test('the dashboard shows the card with links to the owner filter', async () => {
    const { dir } = await makeRemote();
    const root = await makeClone(dir, 'app', null);
    const created = await createApp({ root, syncEnabled: false });
    const server = await new Promise((resolve) => {
      const s = created.app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      await fetch(`${base}/setup`, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ name: 'Amod Mulay', email: '' }),
      });
      await fetch(`${base}/opportunities`, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          title: 'Alpha', type: 'Lead', customer: 'Bosch', sales_owner: 'Priya S', presales_owner: 'Amod Mulay',
          received_on: '2026-10-01', stage: 'Lead', probability: '5', currency: 'EUR', priority: 'Medium', go_no_go: 'Pending',
        }),
      });
      const html = await (await fetch(`${base}/`)).text();
      assert.match(html, /<h2>Open opportunities by person<\/h2>/);
      assert.match(html, /href="\/opportunities\?owner=PE-\d{4}"/);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      await cleanup(dir);
    }
  });
});
