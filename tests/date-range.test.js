import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../app/server.js';
import { cleanup, makeClone, makeRemote } from './helpers.js';

describe('the opportunities list filters by received date, from and to', () => {
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
    const common = { customer: 'Bosch', sales_owner: 'Priya S', type: 'Lead', stage: 'Lead', probability: '5', currency: 'EUR', priority: 'Medium', go_no_go: 'Pending' };
    await post('/setup', { name: 'Amod Mulay', email: '' });
    await post('/opportunities', { ...common, title: 'September one', received_on: '2026-09-15' });
    await post('/opportunities', { ...common, title: 'Early October', received_on: '2026-10-02' });
    await post('/opportunities', { ...common, title: 'Late October', received_on: '2026-10-20' });
  });

  after(async () => {
    await close();
  });

  const titles = async (query) => {
    const html = await (await fetch(`${base}/opportunities${query}`)).text();
    return ['September one', 'Early October', 'Late October'].filter((t) => html.includes(t));
  };

  test('from and to together keep only the opportunities received in that range', async () => {
    assert.deepEqual(await titles('?from=2026-10-01&to=2026-10-10'), ['Early October']);
  });

  test('from alone, and to alone, leave the other end open', async () => {
    assert.deepEqual(await titles('?from=2026-10-01'), ['Early October', 'Late October']);
    assert.deepEqual(await titles('?to=2026-09-30'), ['September one']);
  });

  test('a date that is not a date is ignored, so nothing is filtered out by mistake', async () => {
    assert.equal((await titles('?from=soon')).length, 3);
  });

  test('the date boxes show the range that is applied', async () => {
    const html = await (await fetch(`${base}/opportunities?from=2026-10-01&to=2026-10-10`)).text();
    assert.match(html, /<input type="date" id="filter-from" name="from" value="2026-10-01"/);
    assert.match(html, /<input type="date" id="filter-to" name="to" value="2026-10-10"/);
  });
});
