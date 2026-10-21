import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../app/server.js';
import { cleanup, makeClone, makeRemote } from './helpers.js';

async function startApp() {
  const { dir } = await makeRemote();
  const root = await makeClone(dir, 'app', null);
  const { app } = await createApp({ root, syncEnabled: false });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      await cleanup(dir);
    },
  };
}

describe('deals are called opportunities', () => {
  let app;

  before(async () => {
    app = await startApp();
    await fetch(app.base + '/setup', {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ name: 'Amod Mulay', email: '' }),
    });
  });

  after(async () => {
    await app.close();
  });

  test('the old /deals addresses redirect to /opportunities, and keep the rest of the URL', async () => {
    const list = await fetch(`${app.base}/deals?status=won`, { redirect: 'manual' });
    assert.equal(list.status, 308);
    assert.equal(list.headers.get('location'), '/opportunities?status=won');

    const newOne = await fetch(`${app.base}/deals/new`, { redirect: 'manual' });
    assert.equal(newOne.headers.get('location'), '/opportunities/new');

    const xlsx = await fetch(`${app.base}/export/deals.xlsx?tag=RFQ`, { redirect: 'manual' });
    assert.equal(xlsx.headers.get('location'), '/export/opportunities.xlsx?tag=RFQ');
  });

  test('the new pages use the new name in the navigation, titles and buttons', async () => {
    const page = await (await fetch(`${app.base}/opportunities`)).text();
    assert.match(page, /<title>Opportunities · Work Tracker<\/title>/);
    assert.match(page, /href="\/opportunities"[^>]*>Opportunities</);
    assert.match(page, /\+ New opportunity/);
    assert.match(page, /No opportunities yet/);
    assert.doesNotMatch(page, />Deals</);
  });

  test('a missing opportunity is reported with the new name', async () => {
    const res = await fetch(`${app.base}/opportunities/DL-2026-9999`);
    assert.equal(res.status, 404);
    assert.match(await res.text(), /This opportunity was not found/);
  });
});
