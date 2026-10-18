import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { addDays, mondayOf } from '../app/lib/dates.js';
import { createApp } from '../app/server.js';
import { cleanup, makeClone, makeRemote } from './helpers.js';

test('mondayOf returns the Monday of the week for every day of the week', () => {
  for (let offset = 0; offset < 14; offset += 1) {
    const day = addDays('2026-10-12', offset);
    const monday = mondayOf(day);
    const weekday = new Date(`${monday}T00:00:00Z`).getUTCDay();
    assert.equal(weekday, 1, `${monday} is a Monday`);
    assert.ok(day >= monday && day <= addDays(monday, 6), `${day} is inside the week of ${monday}`);
  }
});

test('addDays crosses month and year ends', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2027-03-01', -1), '2027-02-28');
});

describe('weekly report', () => {
  let dir;
  let base;
  let close;
  before(async () => {
    const remote = await makeRemote();
    dir = remote.dir;
    const root = await makeClone(dir, 'app', null);
    const { app } = await createApp({ root, syncEnabled: false });
    const server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    base = `http://127.0.0.1:${server.address().port}`;
    close = () => new Promise((resolve) => server.close(resolve));
    await fetch(`${base}/setup`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ name: 'Amod', email: '' }),
    });
    const today = new Date().toISOString().slice(0, 10);
    await fetch(`${base}/deals`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        title: 'Report deal', type: 'RFQ', customer: 'Bosch', received_on: today, stage: 'Lead',
        probability: '5', currency: 'EUR', est_value: '2000', submission_due: addDays(today, 3),
        priority: 'Medium', go_no_go: 'Pending',
      }),
    });
  });
  after(async () => {
    await close();
    await cleanup(dir);
  });

  test('the report page lists the week and the new deal, as Markdown in a textarea', async () => {
    const res = await fetch(`${base}/report/weekly`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /# Weekly status/);
    assert.match(html, /## New this week/);
    assert.match(html, /Report deal/);
    assert.match(html, /<textarea id="report-text"[^>]*readonly/);
  });

  test('an invalid week falls back to the current week', async () => {
    const res = await fetch(`${base}/report/weekly?week=not-a-date`);
    assert.equal(res.status, 200);
  });
});
