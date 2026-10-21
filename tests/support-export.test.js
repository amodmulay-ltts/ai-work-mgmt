import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import ExcelJS from 'exceljs';
import { createApp } from '../app/server.js';
import { addDays, mondayOf } from '../app/lib/dates.js';
import { weeklyReport } from '../app/report.js';
import { todayIso } from '../app/models.js';
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

const YEAR = new Date().getFullYear();
const id = (n) => `DL-${YEAR}-${String(n).padStart(4, '0')}`;

const dealForm = (title) => ({
  title,
  type: 'RFQ',
  customer: 'Bosch',
  sales_owner: 'Priya S',
  presales_owner: 'Meera T',
  received_on: '2026-10-01',
  stage: 'Lead',
  probability: '5',
  currency: 'EUR',
  priority: 'Medium',
  go_no_go: 'Pending',
});

// The reported week is this week (Monday to Sunday). "Next week" is the one after.
const THIS_MONDAY = mondayOf(todayIso());
const NEXT_MONDAY = addDays(THIS_MONDAY, 7);
const dates = {
  overdue: addDays(THIS_MONDAY, -3),   // still open, due before next week starts
  nextWeek: addDays(NEXT_MONDAY, 2),   // due next week
  twoWeeks: addDays(NEXT_MONDAY, 9),   // due after next week: not listed
};

describe('support export and weekly report', () => {
  let app;
  let ravi;

  before(async () => {
    app = await startApp();
    await post(app.base, '/setup', { name: 'Amod Mulay', email: '' });
    await post(app.base, '/people', { name: 'Ravi K', role: 'Presales', active: 'on' });
    await post(app.base, '/people', { name: 'Meera T', role: 'Presales', active: 'on' });
    ravi = app.store.findPersonByName('Ravi K').id;
    const meera = app.store.findPersonByName('Meera T').id;
    const me = app.store.config().me_person_id;

    await post(app.base, '/deals', dealForm('Alpha'));    // 0001
    await post(app.base, '/deals', dealForm('Beta'));     // 0002
    await post(app.base, '/deals', dealForm('Gamma'));    // 0003
    await post(app.base, '/deals', dealForm('Delta'));    // 0004, won
    await post(app.base, `/deals/${id(4)}/stage`, { stage: 'Won' });

    await post(app.base, `/deals/${id(1)}/support`, { action: 'add', person_id: ravi });
    await post(app.base, `/deals/${id(1)}/support`, { action: 'add', person_id: me });

    // Alpha: one ask due next week (assigned to Ravi), one due in two weeks, one done.
    await post(app.base, `/deals/${id(1)}/asks`, { text: 'Effort estimate', assignee_id: ravi, due_on: dates.nextWeek });
    await post(app.base, `/deals/${id(1)}/asks`, { text: 'Later ask', assignee_id: ravi, due_on: dates.twoWeeks });
    await post(app.base, `/deals/${id(1)}/asks`, { text: 'Finished', assignee_id: ravi, due_on: dates.nextWeek });
    await post(app.base, `/deals/${id(1)}/asks/SR-003`, { status: 'Done' });

    // Beta: an overdue ask with no assignee.
    await post(app.base, `/deals/${id(2)}/asks`, { text: 'Pricing sheet', due_on: dates.overdue });

    // Gamma: nothing to list. Delta (won): an ask due next week, but the deal is closed.
    await post(app.base, `/deals/${id(4)}/asks`, { text: 'Closed deal ask', assignee_id: meera, due_on: dates.nextWeek });
  });

  after(async () => {
    await app.close();
  });

  describe('Excel export', () => {
    test('two support columns follow Delivery owner, and the values are right', async () => {
      const res = await fetch(`${app.base}/export/deals.xlsx`);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(Buffer.from(await res.arrayBuffer()));
      const sheet = workbook.getWorksheet('Deals');
      assert.equal(sheet.getRow(1).getCell(13).value, 'Supporters');
      assert.equal(sheet.getRow(1).getCell(14).value, 'Open asks');
      assert.equal(sheet.getRow(1).getCell(18).value, 'Received');
      assert.equal(sheet.getRow(1).cellCount, 37);

      let alpha = null;
      sheet.eachRow((row, n) => {
        if (n > 1 && row.getCell(1).value === id(1)) alpha = row;
      });
      assert.equal(alpha.getCell(13).value, 'Ravi K, Amod Mulay');
      assert.equal(alpha.getCell(14).value, 2, 'two open asks on Alpha: the done one is not counted');
    });
  });

  describe('weekly report', () => {
    test('the section lists open asks due by the end of next week, overdue ones marked', () => {
      const md = weeklyReport(app.store, THIS_MONDAY);
      const section = md.split('## Asks due next week\n')[1].split('\n## ')[0];
      const lines = section.trim().split('\n');
      assert.equal(lines.length, 2, 'the overdue ask and the next-week ask, nothing else');
      assert.match(lines[0], /Pricing sheet/, 'overdue first');
      assert.match(lines[0], /unassigned/);
      assert.match(lines[0], /\(overdue\)$/);
      assert.match(lines[1], /Effort estimate/);
      assert.match(lines[1], /Ravi K/);
      assert.doesNotMatch(lines[1], /overdue/);
      assert.doesNotMatch(md, /Later ask/, 'due after next week');
      assert.doesNotMatch(md, /Finished/, 'done asks are not listed');
      assert.doesNotMatch(md, /Closed deal ask/, 'asks on closed deals are not listed');
    });

    test('the report page shows the section', async () => {
      const res = await fetch(`${app.base}/report/weekly?week=${THIS_MONDAY}`);
      const html = await res.text();
      assert.equal(res.status, 200);
      assert.match(html, /Asks due next week/);
    });
  });
});

describe('weekly report with no asks due', () => {
  let app;

  before(async () => {
    app = await startApp();
    await post(app.base, '/setup', { name: 'Amod Mulay', email: '' });
    await post(app.base, '/deals', dealForm('Lonely'));
  });

  after(async () => {
    await app.close();
  });

  test('the section says None', () => {
    const md = weeklyReport(app.store, THIS_MONDAY);
    assert.match(md, /## Asks due next week\n- None\n/);
  });
});
