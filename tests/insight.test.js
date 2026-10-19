import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import ExcelJS from 'exceljs';
import { createApp } from '../app/server.js';
import { cleanup, git, makeClone, makeRemote, writeFile } from './helpers.js';

/** Starts the real app on a temp repo with no remote, on a random port. */
async function startApp() {
  const { dir } = await makeRemote();
  const root = await makeClone(dir, 'app', null);
  const { app, store } = await createApp({ root, syncEnabled: false });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    root,
    store,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      await cleanup(dir);
    },
  };
}

const post = (base, url, fields, headers = {}) =>
  fetch(base + url, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(fields),
  });

const get = async (base, url) => {
  const res = await fetch(base + url, { redirect: 'manual' });
  return { status: res.status, location: res.headers.get('location'), html: await res.text(), res };
};

/** Today's date plus `offset` days, as YYYY-MM-DD (local date, as the app uses). */
function dayOffset(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The number under a KPI label on the dashboard. */
const kpi = (html, label) => {
  const match = html.match(new RegExp(`kpi-label">${label}</div>\\s*<div class="kpi-value[^"]*">([^<]*)<`));
  return match ? match[1].trim() : null;
};

const dealForm = (overrides = {}) => ({
  title: 'Deal',
  type: 'RFQ',
  customer: 'Bosch',
  sales_owner: 'Priya S',
  received_on: dayOffset(-5),
  stage: 'Lead',
  probability: '5',
  currency: 'EUR',
  est_value: '100000',
  submission_due: dayOffset(30),
  priority: 'Medium',
  go_no_go: 'Pending',
  ...overrides,
});

describe('phase 2: dashboard, settings, export, conflicts', () => {
  let app;
  before(async () => {
    app = await startApp();
    await post(app.base, '/setup', { name: 'Amod Mulay', email: '' });
  });
  after(async () => {
    await app.close();
  });

  test('the dashboard counts open deals, overdue, due soon and win rate', async () => {
    await post(app.base, '/deals', dealForm({ title: 'Overdue one', submission_due: dayOffset(-2), est_value: '1000' }));
    await post(app.base, '/deals', dealForm({ title: 'Due soon', submission_due: dayOffset(2), est_value: '2000', presales_owner: 'Amod Mulay' }));
    await post(app.base, '/deals', dealForm({ title: 'Will win', submission_due: dayOffset(30), est_value: '3000' }));
    await post(app.base, '/deals/DL-' + new Date().getFullYear() + '-0003/stage', { stage: 'Won' });

    const page = await get(app.base, '/');
    assert.equal(kpi(page.html, 'Open deals'), '2');
    assert.equal(kpi(page.html, 'Due in 7 days'), '1');
    assert.match(page.html, /1 overdue/);
    assert.equal(kpi(page.html, 'Win rate \\(90 days\\)'), '100%');
    assert.match(page.html, /Needs attention/);
    assert.match(page.html, /Overdue one/);
  });

  test('the dashboard inline next action saves and returns to the dashboard', async () => {
    const res = await post(
      app.base,
      '/deals/DL-' + new Date().getFullYear() + '-0002/next-action',
      { next_action: 'Send the estimate', next_action_due: dayOffset(1) },
      { referer: app.base + '/' },
    );
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/');
    assert.equal(app.store.getDeal('DL-' + new Date().getFullYear() + '-0002').next_action, 'Send the estimate');
    const page = await get(app.base, '/');
    assert.match(page.html, /Send the estimate/);
  });

  test('settings save the stale threshold, the lists and my name in one commit', async () => {
    const before = Number(git(app.root, 'rev-list', '--count', 'HEAD'));
    const res = await post(app.base, '/settings', {
      name: 'Amod M.',
      email: 'amod.mulay@ltts.com',
      stale_after_days: '21',
      business_units: 'Mobility\nSustainability\nHi-Tech\nAerospace',
      regions: 'Europe\nIndia',
      currencies: 'EUR\nusd',
      pricing_models: 'T&M\nFixed Price',
      sources: 'Customer RFQ\nOther',
      outcome_reasons: 'Price\nOther',
    });
    assert.equal(res.status, 303);
    const cfg = app.store.config();
    assert.equal(cfg.stale_after_days, 21);
    assert.deepEqual(cfg.business_units, ['Mobility', 'Sustainability', 'Hi-Tech', 'Aerospace']);
    assert.deepEqual(cfg.currencies, ['EUR', 'USD'], 'currencies are upper-cased');
    assert.equal(app.store.getPerson('PE-0001').name, 'Amod M.');
    assert.equal(Number(git(app.root, 'rev-list', '--count', 'HEAD')), before + 1);
    assert.equal(git(app.root, 'log', '-1', '--format=%s'), 'PE-0001: updated');
  });

  test('settings reject an empty list and a bad currency code', async () => {
    const res = await post(app.base, '/settings', {
      name: 'Amod M.',
      email: '',
      stale_after_days: '14',
      business_units: '',
      regions: 'Europe',
      currencies: 'EURO',
      pricing_models: 'T&M',
      sources: 'Other',
      outcome_reasons: 'Other',
    });
    assert.equal(res.status, 422);
    const html = await res.text();
    assert.match(html, /Keep at least one item\./);
    assert.match(html, /Use three-letter codes/);
  });

  test('the Excel export has the spec columns, one row per deal and real dates', async () => {
    const res = await fetch(`${app.base}/export/deals.xlsx`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /spreadsheetml/);
    assert.match(res.headers.get('content-disposition'), /attachment; filename="deals-\d{8}\.xlsx"/);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await res.arrayBuffer()));
    const sheet = workbook.getWorksheet('Deals');
    assert.equal(sheet.getRow(1).getCell(1).value, 'ID');
    assert.equal(sheet.getRow(1).cellCount, 38, 'two support columns were added after Delivery owner');
    assert.equal(sheet.rowCount, 1 + app.store.listDeals().filter((d) => d.stage !== 'Won' && d.stage !== 'Lost').length, 'default filter is open deals');
    const dateCell = sheet.getRow(2).getCell(18).value;
    assert.ok(dateCell instanceof Date, 'Received is a real date');
  });

  test('the export honours the same filters as the deals list', async () => {
    const res = await fetch(`${app.base}/export/deals.xlsx?status=won`);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await res.arrayBuffer()));
    assert.equal(workbook.getWorksheet('Deals').rowCount, 2, 'header plus the one won deal');
  });

  test('a conflict copy can be resolved by using the other version', async () => {
    const id = 'DL-' + new Date().getFullYear() + '-0001';
    const local = app.store.getDeal(id);
    const remote = { ...local, title: 'Title from the other computer', history: [] };
    const file = `${id}.20261018-120000.theirs.json`;
    await writeFile(app.root, `data/_conflicts/${file}`, JSON.stringify(remote, null, 2) + '\n');
    git(app.root, 'add', 'data/_conflicts');
    git(app.root, 'commit', '-q', '-m', 'sync: merge remote changes (1 conflicts saved)');
    await app.store.loadAll();

    const page = await get(app.base, '/conflicts');
    assert.match(page.html, new RegExp(id));
    assert.match(page.html, /Use the other computer/);

    const res = await post(app.base, `/conflicts/${encodeURIComponent(file)}/resolve`, { action: 'use_theirs' });
    assert.equal(res.status, 303);
    assert.equal(app.store.getDeal(id).title, 'Title from the other computer');
    await assert.rejects(fs.access(path.join(app.root, 'data', '_conflicts', file)));
    assert.match(git(app.root, 'log', '-1', '--format=%s'), /conflict resolved – used the other version/);
  });

  test('a conflict copy can be resolved by keeping this version', async () => {
    const id = 'DL-' + new Date().getFullYear() + '-0002';
    const file = `${id}.20261018-130000.theirs.json`;
    await writeFile(app.root, `data/_conflicts/${file}`, JSON.stringify({ ...app.store.getDeal(id), title: 'Ignored' }) + '\n');
    git(app.root, 'add', 'data/_conflicts');
    git(app.root, 'commit', '-q', '-m', 'sync: merge remote changes (1 conflicts saved)');
    await app.store.loadAll();

    await post(app.base, `/conflicts/${encodeURIComponent(file)}/resolve`, { action: 'keep_mine' });
    assert.notEqual(app.store.getDeal(id).title, 'Ignored');
    await assert.rejects(fs.access(path.join(app.root, 'data', '_conflicts', file)));
    assert.match(git(app.root, 'log', '-1', '--format=%s'), /conflict resolved – kept this version/);
  });

  test('a data file that cannot be read shows a banner', async () => {
    await writeFile(app.root, 'data/people/PE-0099.json', '{ broken');
    await app.store.loadAll();
    const page = await get(app.base, '/');
    assert.match(page.html, /data file could not be read/);
    const settings = await get(app.base, '/settings');
    assert.match(settings.html, /PE-0099\.json/);
    await fs.rm(path.join(app.root, 'data', 'people', 'PE-0099.json'));
    await app.store.loadAll();
  });
});
