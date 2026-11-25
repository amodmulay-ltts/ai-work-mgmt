import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../app/server.js';
import { cleanup, git, makeClone, makeRemote } from './helpers.js';

const post = (base, url, fields) =>
  fetch(base + url, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
  });

const commits = (root) => Number(git(root, 'rev-list', '--count', 'HEAD'));
const PAST = '2026-10-02';
const FUTURE = '2099-03-04';

describe('meetings: pages over HTTP', () => {
  let app;
  let root;

  before(async () => {
    const { dir } = await makeRemote();
    root = await makeClone(dir, 'app', null);
    const created = await createApp({ root, syncEnabled: false });
    const server = await new Promise((resolve) => {
      const s = created.app.listen(0, '127.0.0.1', () => resolve(s));
    });
    app = {
      base: `http://127.0.0.1:${server.address().port}`,
      store: created.store,
      close: async () => {
        await new Promise((resolve) => server.close(resolve));
        await cleanup(dir);
      },
    };
    await post(app.base, '/setup', { name: 'Amod Mulay', email: '' });
  });

  after(async () => {
    await app.close();
  });

  const idFrom = (res) => res.headers.get('location').split('/').at(-1);

  test('creating a meeting redirects to its page, with one commit and empty notes', async () => {
    const before = commits(root);
    const res = await post(app.base, '/meetings', { title: 'Weekly sync', on: '2026-11-25', attendees: 'Priya S', customer_id: '', deal_id: '', summary: '' });
    assert.equal(res.status, 303);
    assert.equal(commits(root), before + 1);
    const id = idFrom(res);
    assert.match(id, /^MT-\d{4}$/);
    const meeting = app.store.getMeeting(id);
    assert.equal(meeting.on, '2026-11-25');
    assert.deepEqual(meeting.notes, []);
  });

  test('the meeting page shows the title and the date', async () => {
    const id = app.store.listMeetings()[0].id;
    const res = await fetch(`${app.base}/meetings/${id}`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /Weekly sync/);
    assert.match(html, /25 Nov 2026/);
  });

  test('the list filters past and upcoming meetings', async () => {
    await post(app.base, '/meetings', { title: 'Old review', on: PAST });
    await post(app.base, '/meetings', { title: 'Future review', on: FUTURE });
    const past = await (await fetch(`${app.base}/meetings?when=past`)).text();
    assert.match(past, /Old review/);
    assert.doesNotMatch(past, /Future review/);
    const upcoming = await (await fetch(`${app.base}/meetings?when=upcoming`)).text();
    assert.match(upcoming, /Future review/);
    assert.doesNotMatch(upcoming, /Old review/);
  });

  test('a meeting with no title is refused and nothing is saved', async () => {
    const count = app.store.listMeetings().length;
    const res = await post(app.base, '/meetings', { title: '  ', on: '2026-11-25' });
    assert.equal(res.status, 422);
    assert.equal(app.store.listMeetings().length, count);
  });

  test('a customer id that is not a real customer is refused', async () => {
    const res = await post(app.base, '/meetings', { title: 'Linked', on: '2026-11-25', customer_id: 'CU-9999' });
    assert.equal(res.status, 422);
    assert.ok(app.store.listMeetings().every((m) => m.title !== 'Linked'));
  });

  test('an opportunity id that is not a real opportunity is refused', async () => {
    const res = await post(app.base, '/meetings', { title: 'Linked', on: '2026-11-25', deal_id: 'DL-2099-0001' });
    assert.equal(res.status, 422);
    assert.ok(app.store.listMeetings().every((m) => m.title !== 'Linked'));
  });

  test('a real customer is saved and its name shows on the meeting page', async () => {
    await post(app.base, '/opportunities', {
      title: 'Seed opportunity', type: 'Lead', customer: 'Bosch', sales_owner: 'Priya S', presales_owner: 'Amod Mulay',
      received_on: '2026-10-01', stage: 'Lead', probability: '5', currency: 'EUR', priority: 'Medium', go_no_go: 'Pending',
    });
    const customer = app.store.findCustomerByName('Bosch');
    const res = await post(app.base, '/meetings', { title: 'With Bosch', on: '2026-11-25', customer_id: customer.id });
    assert.equal(res.status, 303);
    const page = await (await fetch(`${app.base}/meetings/${idFrom(res)}`)).text();
    assert.match(page, /Bosch/);
  });

  test('editing changes the title and summary and keeps created_at', async () => {
    const id = app.store.listMeetings().find((m) => m.title === 'Weekly sync').id;
    const createdAt = app.store.getMeeting(id).created_at;
    const res = await post(app.base, `/meetings/${id}`, { title: 'Weekly sync, renamed', on: '2026-11-25', summary: 'Agreed the plan' });
    assert.equal(res.status, 303);
    const meeting = app.store.getMeeting(id);
    assert.equal(meeting.title, 'Weekly sync, renamed');
    assert.equal(meeting.summary, 'Agreed the plan');
    assert.equal(meeting.created_at, createdAt);
  });

  test('delete with the wrong text keeps the meeting; the exact id removes it and goes to the list', async () => {
    const id = app.store.listMeetings().find((m) => m.title === 'Old review').id;
    await post(app.base, `/meetings/${id}/delete`, { confirm: 'MT-9999' });
    assert.ok(app.store.getMeeting(id), 'still there after a wrong confirm');
    const res = await post(app.base, `/meetings/${id}/delete`, { confirm: id });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/meetings');
    assert.equal(app.store.getMeeting(id), null);
  });

  test('the navigation has a Meetings link', async () => {
    const html = await (await fetch(`${app.base}/meetings`)).text();
    assert.match(html, /href="\/meetings"[^>]*>Meetings<\/a>/);
  });
});
