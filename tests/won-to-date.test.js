import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../app/server.js';
import { cleanup, makeClone, makeRemote } from './helpers.js';

describe('the dashboard shows the value won to date', () => {
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
    const base = { customer: 'Bosch', sales_owner: 'Priya S', received_on: '2026-10-01', type: 'Lead', probability: '100', priority: 'Medium', go_no_go: 'Go' };
    await post('/setup', { name: 'Amod Mulay', email: '' });
    await post('/opportunities', { ...base, title: 'Won in euro', stage: 'Won', currency: 'EUR', est_value: '5000' });
    await post('/opportunities', { ...base, title: 'Won again', stage: 'Won', est_value: '2000' });
    await post('/opportunities', { ...base, title: 'Still open', stage: 'Lead', currency: 'EUR', est_value: '9000', probability: '5' });
  });

  after(async () => {
    await close();
  });

  test('the won card shows the count and the value in each currency, and open work is not counted', async () => {
    const html = await (await fetch(`${app.base}/`)).text();
    assert.match(html, /Won to date<\/div>/);
    const card = html.slice(html.indexOf('Won to date'), html.indexOf('2 won'));
    assert.match(card, /EUR 7K/, 'every value is EUR, so the two wins add up');
    assert.doesNotMatch(html, /Win rate/, 'the win rate card is replaced');
  });
});
