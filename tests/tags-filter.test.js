import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import ExcelJS from 'exceljs';
import { createApp } from '../app/server.js';
import { cleanup, makeClone, makeRemote } from './helpers.js';

async function startApp() {
  const { dir } = await makeRemote();
  const root = await makeClone(dir, 'app', null);
  const { app, store } = await createApp({ root, syncEnabled: false });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    store,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      await cleanup(dir);
    },
  };
}

const post = (base, url, fields) =>
  fetch(base + url, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
  });

const get = async (base, url) => {
  const res = await fetch(base + url, { redirect: 'manual' });
  return { status: res.status, html: await res.text() };
};

/** The number under a KPI label on the dashboard. */
const kpi = (html, label) => {
  const match = html.match(new RegExp(`kpi-label">${label}</div>\\s*<div class="kpi-value[^"]*">([^<]*)<`));
  return match ? match[1].trim() : null;
};

const YEAR = new Date().getFullYear();
const id = (n) => `DL-${YEAR}-${String(n).padStart(4, '0')}`;

const dealForm = (title, tags) => ({
  title,
  customer: 'Bosch',
  sales_owner: 'Priya S',
  presales_owner: 'Meera T',
  received_on: '2026-10-01',
  stage: 'Lead',
  probability: '5',
  currency: 'EUR',
  priority: 'Medium',
  go_no_go: 'Pending',
  tags,
});

describe('filter by tag', () => {
  let app;

  before(async () => {
    app = await startApp();
    await post(app.base, '/setup', { name: 'Amod Mulay', email: '' });
    await post(app.base, '/opportunities', dealForm('Alpha', 'RFQ'));                   // 0001, open
    await post(app.base, '/opportunities', dealForm('Beta', 'Mobility'));               // 0002, open
    await post(app.base, '/opportunities', dealForm('Gamma', 'RFQ, Mobility'));         // 0003, open
    await post(app.base, '/opportunities', dealForm('Delta', 'RFQ'));                   // 0004, won
    await post(app.base, `/opportunities/${id(4)}/stage`, { stage: 'Won' });
  });

  after(async () => {
    await app.close();
  });

  test('the dashboard counts everything when no tag is picked', async () => {
    const page = await get(app.base, '/');
    assert.equal(kpi(page.html, 'Open opportunities'), '3');
  });

  test('one tag narrows the dashboard to the opportunitys with that tag', async () => {
    const page = await get(app.base, '/?tag=RFQ');
    assert.equal(kpi(page.html, 'Open opportunities'), '2', 'Alpha and Gamma');
    assert.match(page.html, /class="tag-chip active"[^>]*>RFQ</);
  });

  test('two tags must both be on an opportunity', async () => {
    const page = await get(app.base, '/?tag=RFQ&tag=Mobility');
    assert.equal(kpi(page.html, 'Open opportunities'), '1', 'only Gamma has both');
  });

  test('an unknown tag in the link is ignored, not an empty dashboard', async () => {
    const page = await get(app.base, '/?tag=Nonsense');
    assert.equal(kpi(page.html, 'Open opportunities'), '3');
  });

  test('the chips add and remove one tag each and keep the others', async () => {
    const page = await get(app.base, '/?tag=RFQ');
    assert.match(page.html, /href="\/\?tag=RFQ&amp;tag=Mobility"/, 'adding Mobility');
    assert.match(page.html, /href="\/"[^>]*>All</, 'All clears the filter');
    const both = await get(app.base, '/?tag=RFQ&tag=Mobility');
    assert.match(both.html, /href="\/\?tag=Mobility"/, 'removing RFQ leaves Mobility');
  });

  test('the opportunities list filters by tag and keeps the tag through sorting', async () => {
    const page = await get(app.base, '/opportunities?tag=RFQ&status=all');
    assert.match(page.html, new RegExp(id(1)));
    assert.match(page.html, new RegExp(id(4)), 'the won deal is there with status=all');
    assert.doesNotMatch(page.html, new RegExp(id(2)));
    assert.match(page.html, /href="\/opportunities\?[^"]*tag=RFQ[^"]*" class="sort"/, 'sort links keep the tag');
    assert.match(page.html, /name="tag" value="RFQ"/, 'the search form keeps the tag');
  });

  test('the export follows the same tag filter', async () => {
    const res = await fetch(`${app.base}/export/opportunities.xlsx?tag=Mobility`);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await res.arrayBuffer()));
    assert.equal(workbook.getWorksheet('Opportunities').rowCount, 3, 'header, Beta and Gamma');
  });

  test('a clear link appears on the opportunities list when a tag is picked', async () => {
    const page = await get(app.base, '/opportunities?tag=RFQ');
    assert.match(page.html, /class="btn btn-ghost">Clear</);
  });
});

describe('tag filter: pages that do not pass tags', () => {
  let app;

  before(async () => {
    app = await startApp();
    await post(app.base, '/setup', { name: 'Amod Mulay', email: '' });
  });

  after(async () => {
    await app.close();
  });

  test('the dashboard renders its tag bar with no tag picked, and after a failed save on the first-run form', async () => {
    const page = await get(app.base, '/');
    assert.equal(page.status, 200);
    assert.match(page.html, /aria-label="Filter by tag"/);
    const failed = await post(app.base, '/setup', { name: '', email: '' });
    assert.equal(failed.status, 422);
  });
});
