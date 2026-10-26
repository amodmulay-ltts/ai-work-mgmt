import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../app/server.js';
import { cleanup, makeClone, makeRemote } from './helpers.js';

describe('the opportunities summary strip', () => {
  let base;
  let close;

  before(async () => {
    const remote = await makeRemote();
    const root = await makeClone(remote.dir, 'app', null);
    const created = await createApp({ root, syncEnabled: false });
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
    const base1 = { customer: 'Bosch', sales_owner: 'Priya S', received_on: '2026-10-01', type: 'Lead', probability: '20', priority: 'Medium', go_no_go: 'Pending', currency: 'EUR', est_value: '1000' };
    await post('/setup', { name: 'Amod Mulay', email: '' });
    await post('/opportunities', { ...base1, title: 'Open one', stage: 'Lead' });
    await post('/opportunities', { ...base1, title: 'Submitted one', stage: 'Proposal Submitted' });
    await post('/opportunities', { ...base1, title: 'Won one', stage: 'Won', probability: '100' });
    await post('/opportunities', { ...base1, title: 'Lost one', stage: 'Lost', probability: '0', outcome_reason: 'Price' });
  });

  after(async () => {
    await close();
  });

  const strip = async (path = '/opportunities') => {
    const html = await (await fetch(base + path)).text();
    return [...html.matchAll(/kpi-label">[^<]*<\/div>\s*<div class="kpi-value">(\d+)<\/div>/g)].map((m) => Number(m[1]));
  };

  test('the four numbers are Won, Submitted, Lost and everything else, and they add up to the total', async () => {
    const [won, submitted, lost, other] = await strip();
    assert.deepEqual([won, submitted, lost, other], [1, 1, 1, 1]);
    assert.equal(won + submitted + lost + other, 4);
  });

  test('the numbers do not change when the status filter is set, so the strip is the whole picture', async () => {
    assert.deepEqual(await strip('/opportunities?status=won'), [1, 1, 1, 1]);
  });

  test('the Submitted number links to the open submitted opportunities', async () => {
    const html = await (await fetch(`${base}/opportunities?submitted=1`)).text();
    assert.match(html, /Submitted one/);
    assert.doesNotMatch(html, /Open one/);
    assert.doesNotMatch(html, /Won one/);
  });
});
