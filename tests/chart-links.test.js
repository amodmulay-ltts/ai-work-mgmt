import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../app/server.js';
import { cleanup, makeClone, makeRemote } from './helpers.js';

const YEAR = new Date().getFullYear();

describe('the opportunities list filters used by the charts', () => {
  let app;
  let close;

  before(async () => {
    const remote = await makeRemote();
    const root = await makeClone(remote.dir, 'app', null);
    const created = await createApp({ root, syncEnabled: false });
    const server = await new Promise((resolve) => {
      const s = created.app.listen(0, '127.0.0.1', () => resolve(s));
    });
    app = { base: `http://127.0.0.1:${server.address().port}`, store: created.store };
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
    const base = { customer: 'Bosch', sales_owner: 'Priya S', received_on: '2026-10-01', type: 'RFQ', probability: '20', priority: 'Medium', go_no_go: 'Pending', currency: 'EUR', est_value: '1000' };
    await post('/setup', { name: 'Amod Mulay', email: '' });
    await post('/opportunities', { ...base, title: 'Mobility due Nov', bu: 'Mobility', stage: 'Lead', submission_due: '2026-11-05' });
    await post('/opportunities', { ...base, title: 'No BU due Nov', bu: '', stage: 'Lead', submission_due: '2026-11-20' });
    await post('/opportunities', { ...base, title: 'Dec one', bu: 'Hi-Tech', stage: 'Lead', submission_due: '2026-12-02' });
    await post('/opportunities', { ...base, title: 'Won last year', bu: 'Hi-Tech', stage: 'Won', type: 'Lead', submission_due: '', closed_on: `${YEAR - 1}-03-04` });
  });

  after(async () => {
    await close();
  });

  const titles = async (query) => {
    const html = await (await fetch(`${app.base}/opportunities${query}`)).text();
    return ['Mobility due Nov', 'No BU due Nov', 'Dec one', 'Won last year'].filter((t) => html.includes(t));
  };

  test('a submission month shows only open deals due in that month', async () => {
    assert.deepEqual(await titles('?submit_month=2026-11'), ['Mobility due Nov', 'No BU due Nov']);
  });

  test('a BU of none shows the deals with no BU', async () => {
    assert.deepEqual(await titles('?bu=none'), ['No BU due Nov']);
  });

  test('a closing year with a won status shows the wins of that year', async () => {
    assert.deepEqual(await titles(`?status=won&closed_year=${YEAR - 1}`), ['Won last year']);
    assert.deepEqual(await titles(`?status=won&closed_year=${YEAR}`), []);
  });

  test('a bad month or year is ignored rather than filtering everything out', async () => {
    assert.equal((await titles('?submit_month=soon')).length, 3, 'open deals are shown as usual');
  });

  test('the dashboard charts link to these filters', async () => {
    const html = await (await fetch(`${app.base}/`)).text();
    assert.match(html, /href="\/opportunities\?health=amber"/);
    assert.match(html, /href="\/opportunities\?bu=Mobility"/);
    assert.match(html, /href="\/opportunities\?bu=none"/);
    assert.match(html, /href="\/opportunities\?customer=CU-0001"/);
    assert.match(html, /href="\/opportunities\?submit_month=2026-11"/);
  });

  test('the wins page links each year to its wins', async () => {
    const html = await (await fetch(`${app.base}/wins`)).text();
    assert.match(html, new RegExp(`href="/opportunities\\?status=won&amp;closed_year=${YEAR - 1}"|href="/opportunities\\?status=won&closed_year=${YEAR - 1}"`));
  });
});
