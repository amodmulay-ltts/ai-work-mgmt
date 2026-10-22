import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../app/server.js';
import { cleanup, makeClone, makeRemote } from './helpers.js';

const HEADERS = [
  'Region', 'Vertical', 'Sales/ ARM', 'Account', 'Opportunity Name (schedule)', 'C4C Id', 'Sales Phase',
  'Close Month', 'TCV ($Mn)', 'Tenure (Y)', 'Status', 'Remarks',
];

describe('pipeline export for sharing', () => {
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
    await post('/setup', { name: 'Amod Mulay', email: '' });
    await post('/opportunities', {
      title: 'Brake controller', type: 'RFQ', customer: 'Bosch', sales_owner: 'Priya S', received_on: '2026-10-01',
      stage: 'Proposal Submitted', probability: '50', currency: 'EUR', est_value: '2500000', priority: 'Medium',
      go_no_go: 'Pending', region: 'Europe', c4c_id: 'C4C-77', duration_months: '24', next_action: 'Call the buyer',
      expected_decision_on: '2026-12-15', submission_due: '2026-11-01',
    });
    const customer = app.store.findCustomerByName('Bosch');
    await app.store.save([{ ...customer, industry: 'Automotive' }], 'test: industry');
  });

  after(async () => {
    await close();
  });

  test('the headers are the ones asked for, in that order', async () => {
    const res = await fetch(`${app.base}/export/pipeline.xlsx`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-disposition'), /filename="pipeline-\d{8}\.xlsx"/);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await res.arrayBuffer()));
    const sheet = workbook.getWorksheet('Pipeline');
    assert.deepEqual(sheet.getRow(1).values.slice(1), HEADERS);
  });

  test('each column holds its value: customer industry, TCV in millions, tenure in years, close month', async () => {
    const res = await fetch(`${app.base}/export/pipeline.xlsx`);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await res.arrayBuffer()));
    const row = workbook.getWorksheet('Pipeline').getRow(2).values.slice(1);
    assert.equal(row[0], 'Europe');
    assert.equal(row[1], 'Automotive');
    assert.equal(row[2], 'Priya S');
    assert.equal(row[3], 'Bosch');
    assert.equal(row[4], 'Brake controller');
    assert.equal(row[5], 'C4C-77');
    assert.equal(row[6], 'Proposal Submitted');
    assert.equal(row[7].getFullYear(), 2026);
    assert.equal(row[7].getMonth(), 11, 'December, from the expected decision date');
    assert.equal(row[8], 2.5);
    assert.equal(row[9], 2);
    assert.equal(row[10], 'Open');
    assert.equal(row[11], 'Call the buyer');
  });

  test('the pipeline export holds open opportunities only, like the list by default', async () => {
    const res = await fetch(`${app.base}/export/pipeline.xlsx`);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await res.arrayBuffer()));
    assert.equal(workbook.getWorksheet('Pipeline').rowCount, 2, 'header and one open row');
  });
  test('Export pipeline opens the rows as JSON with a copy button, and the JSON has the headers in order', async () => {
    const res = await fetch(`${app.base}/export/pipeline`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /data-copy-from="pipeline-json"/);
    const raw = html.match(/<textarea id="pipeline-json"[^>]*>([\s\S]*?)<\/textarea>/)[1];
    const json = raw.replaceAll('&#34;', '"').replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
    const records = JSON.parse(json);
    assert.equal(records.length, 1);
    assert.deepEqual(Object.keys(records[0]), HEADERS);
    assert.equal(records[0]['Account'], 'Bosch');
    assert.equal(records[0]['Close Month'], '2026-12');
    assert.equal(records[0]['TCV ($Mn)'], 2.5);
    assert.equal(records[0]['Tenure (Y)'], 2);
  });
});
