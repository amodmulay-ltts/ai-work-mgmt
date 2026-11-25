import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { todayIso } from '../app/models.js';
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

describe('meeting notes: taking them live', () => {
  let app;
  let root;
  let meetingId;

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
    const res = await post(app.base, '/meetings', { title: 'Live notes', on: '2026-11-25' });
    meetingId = res.headers.get('location').split('/').at(-1);
  });

  after(async () => {
    await app.close();
  });

  const notes = () => app.store.getMeeting(meetingId).notes;

  test('adding a note appends it with its time and trimmed text, in one commit', async () => {
    const before = commits(root);
    const res = await post(app.base, `/meetings/${meetingId}/notes`, { text: '  Agreed the scope  ' });
    assert.equal(res.status, 303);
    assert.equal(commits(root), before + 1);
    assert.equal(notes().length, 1);
    assert.equal(notes()[0].text, 'Agreed the scope');
    assert.ok(notes()[0].at);
    assert.equal(git(root, 'log', '-1', '--format=%s'), `${meetingId}: note added`);
  });

  test('three notes come back oldest first on the page', async () => {
    await post(app.base, `/meetings/${meetingId}/notes`, { text: 'Second point' });
    await post(app.base, `/meetings/${meetingId}/notes`, { text: 'Third point' });
    const html = await (await fetch(`${app.base}/meetings/${meetingId}`)).text();
    const first = html.indexOf('Agreed the scope');
    const second = html.indexOf('Second point');
    const third = html.indexOf('Third point');
    assert.ok(first > 0 && second > first && third > second, 'in the order they were typed');
  });

  test('an empty note is refused with no commit and no note added', async () => {
    const before = commits(root);
    const count = notes().length;
    const res = await post(app.base, `/meetings/${meetingId}/notes`, { text: '   ' });
    assert.equal(res.status, 303);
    assert.equal(commits(root), before);
    assert.equal(notes().length, count);
  });

  test('a note over 2000 characters is refused with no commit', async () => {
    const before = commits(root);
    await post(app.base, `/meetings/${meetingId}/notes`, { text: 'x'.repeat(2001) });
    assert.equal(commits(root), before);
  });

  test('editing a note changes its text and keeps its id and time', async () => {
    const target = notes()[0];
    const res = await post(app.base, `/meetings/${meetingId}/notes/${target.id}`, { text: 'Agreed the revised scope' });
    assert.equal(res.status, 303);
    const edited = notes().find((n) => n.id === target.id);
    assert.equal(edited.text, 'Agreed the revised scope');
    assert.equal(edited.at, target.at);
  });

  test('editing an unknown note id returns 404', async () => {
    const res = await post(app.base, `/meetings/${meetingId}/notes/nope0000`, { text: 'x' });
    assert.equal(res.status, 404);
  });

  test('removing a note drops that one and keeps the others', async () => {
    const target = notes()[1];
    const res = await post(app.base, `/meetings/${meetingId}/notes/${target.id}/delete`, {});
    assert.equal(res.status, 303);
    assert.equal(notes().some((n) => n.id === target.id), false);
    assert.equal(notes().length, 2);
  });

  test('removing an unknown note id returns 404', async () => {
    const res = await post(app.base, `/meetings/${meetingId}/notes/nope0000/delete`, {});
    assert.equal(res.status, 404);
  });

  test('the page shows each note with its Edit and Remove controls', async () => {
    const html = await (await fetch(`${app.base}/meetings/${meetingId}`)).text();
    for (const n of notes()) {
      assert.ok(html.includes(n.text), `shows ${n.text}`);
      assert.ok(html.includes(`data-reveal="note-${n.id}"`), 'has an Edit control');
      assert.ok(html.includes(`/meetings/${meetingId}/notes/${n.id}/delete`), 'has a Remove control');
    }
  });

  test('note text containing a script tag is escaped on the page', async () => {
    await post(app.base, `/meetings/${meetingId}/notes`, { text: '<script>alert(1)</script>' });
    const html = await (await fetch(`${app.base}/meetings/${meetingId}`)).text();
    assert.equal(html.includes('<script>alert(1)</script>'), false);
    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  });
});

describe('meetings: on the dashboard', () => {
  let app;

  before(async () => {
    const { dir } = await makeRemote();
    const root = await makeClone(dir, 'app', null);
    const created = await createApp({ root, syncEnabled: false });
    const server = await new Promise((resolve) => {
      const s = created.app.listen(0, '127.0.0.1', () => resolve(s));
    });
    app = {
      base: `http://127.0.0.1:${server.address().port}`,
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

  test('the dashboard has the + Meeting notes button, and the card shows the empty state', async () => {
    const html = await (await fetch(`${app.base}/`)).text();
    assert.match(html, /<a class="btn btn-primary" href="\/meetings\/new">\+ Meeting notes<\/a>/);
    assert.match(html, /No meetings yet\. <a href="\/meetings\/new">Start one<\/a>/);
  });

  test('a meeting dated today appears in the card with a Take notes link to its page', async () => {
    const res = await post(app.base, '/meetings', { title: 'Standup now', on: todayIso(), attendees: 'Priya S' });
    const id = res.headers.get('location').split('/').at(-1);
    const html = await (await fetch(`${app.base}/`)).text();
    assert.match(html, new RegExp(`href="/meetings/${id}"[^>]*>Take notes</a>`));
    assert.match(html, /Standup now/);
  });

  test('a meeting dated earlier appears under Recent, not under Today', async () => {
    await post(app.base, '/meetings', { title: 'Last month review', on: '2026-10-02' });
    const html = await (await fetch(`${app.base}/`)).text();
    const card = html.slice(html.indexOf('<h2>Meetings</h2>'), html.indexOf('<h2>Backlog</h2>'));
    assert.match(card, /<strong>Recent<\/strong>/);
    assert.match(card, /Last month review/);
    assert.doesNotMatch(card.slice(0, card.indexOf('<strong>Recent</strong>')), /Last month review/);
  });
});
