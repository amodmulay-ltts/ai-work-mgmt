import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { activityErrors, activityQuiet, lastTouched, newActivityUpdate, parseActivityForm } from '../app/lib/activities.js';
import { createApp } from '../app/server.js';
import { cleanup, git, makeClone, makeRemote } from './helpers.js';

const TODAY = '2026-10-21';
const good = (overrides = {}) => ({
  title: 'Supplier quality assistant', kind: 'AI solution', status: 'In progress', owner_id: '', start_on: '2026-09-01',
  target_on: '2026-12-31', description: 'Answers supplier questions from past reports.', links: 'https://example.com/demo', tags: 'AI, Quality',
  ...overrides,
});

describe('activity rules', () => {
  test('a valid form gives the fields, with tags and links split', () => {
    const { typed, errors } = parseActivityForm(good());
    assert.deepEqual(errors, {});
    assert.deepEqual(typed.tags, ['AI', 'Quality']);
    assert.deepEqual(typed.links, ['https://example.com/demo']);
    assert.equal(typed.status, 'In progress');
  });

  test('the form refuses a missing title, unknown kind and status, a target before the start, and a bad link', () => {
    assert.match(parseActivityForm(good({ title: '  ' })).errors.title, /required/);
    assert.match(parseActivityForm(good({ kind: 'Donut' })).errors.kind, /kind/i);
    assert.match(parseActivityForm(good({ status: 'Won' })).errors.status, /status/i);
    assert.match(parseActivityForm(good({ target_on: '2026-08-01' })).errors.target_on, /before the start/);
    assert.match(parseActivityForm(good({ links: 'ftp://nope' })).errors.links, /http/);
  });

  test('an update needs text, is not dated in the future, and defaults to today', () => {
    assert.match(newActivityUpdate({ text: '  ' }, { at: 'T', today: TODAY }).error, /Write what happened/);
    assert.match(newActivityUpdate({ text: 'x', on: '2026-10-22' }, { at: 'T', today: TODAY }).error, /future/);
    const { update } = newActivityUpdate({ text: 'Demo to the team' }, { at: '2026-10-21T10:00:00+01:00', today: TODAY });
    assert.equal(update.on, TODAY);
    assert.equal(update.created_at, '2026-10-21T10:00:00+01:00');
  });

  test('a stored activity needs an AC id, a known kind and status, and valid update dates', () => {
    const base = { id: 'AC-0001', title: 'x', kind: 'Concept', status: 'Idea', updates: [] };
    assert.deepEqual(activityErrors(base), []);
    assert.equal(activityErrors({ ...base, id: 'DL-0001' }).length, 1);
    assert.equal(activityErrors({ ...base, updates: [{ on: 'yesterday', text: 'x' }] }).length, 1);
  });

  test('the last touch is the latest update, or the day it was created when there are none', () => {
    const made = { created_at: '2026-09-01T09:00:00+01:00', updates: [] };
    assert.equal(lastTouched(made), '2026-09-01');
    assert.equal(lastTouched({ ...made, updates: [{ on: '2026-10-05' }, { on: '2026-09-20' }] }), '2026-10-05');
  });

  test('only an in-progress activity with no update for longer than the limit is quiet', () => {
    const a = { created_at: '2026-09-01T09:00:00+01:00', updates: [], status: 'In progress' };
    assert.equal(activityQuiet(a, TODAY, 14).quiet, true, '50 days with no update');
    assert.equal(activityQuiet({ ...a, status: 'On hold' }, TODAY, 14).quiet, false, 'on hold is never quiet');
    assert.equal(activityQuiet({ ...a, updates: [{ on: '2026-10-15' }] }, TODAY, 14).quiet, false, 'recent update');
  });
});

describe('activities over HTTP', () => {
  let app;
  let root;
  let close;

  before(async () => {
    const remote = await makeRemote();
    root = await makeClone(remote.dir, 'app', null);
    const created = await createApp({ root, syncEnabled: false });
    const server = await new Promise((resolve) => {
      const s = created.app.listen(0, '127.0.0.1', () => resolve(s));
    });
    app = { base: `http://127.0.0.1:${server.address().port}`, store: created.store };
    close = async () => {
      await new Promise((resolve) => server.close(resolve));
      await cleanup(remote.dir);
    };
    await post('/setup', { name: 'Amod Mulay', email: '' });
  });

  after(async () => {
    await close();
  });

  const post = (url, fields) =>
    fetch(app.base + url, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields),
    });
  const commits = () => Number(git(root, 'rev-list', '--count', 'HEAD'));
  const ACT = 'AC-0001';

  test('an activity is created as its own file with the AC id, and is not an opportunity', async () => {
    const res = await post('/activities', good());
    assert.equal(res.status, 303);
    const file = JSON.parse(await fs.readFile(path.join(root, 'data', 'activities', `${ACT}.json`), 'utf8'));
    assert.equal(file.title, 'Supplier quality assistant');
    assert.equal(file.customer_id, undefined);
    assert.equal(app.store.listDeals().length, 0, 'no opportunity is created');
  });

  test('the list shows open activities by default, and the detail page shows the activity', async () => {
    const list = await (await fetch(`${app.base}/activities`)).text();
    assert.match(list, /Supplier quality assistant/);
    const detail = await (await fetch(`${app.base}/activities/${ACT}`)).text();
    assert.match(detail, /Add update/);
    assert.match(detail, /Supplier quality assistant/);
  });

  test('a dated update is saved as its own commit, and an update in the future is refused', async () => {
    const before = commits();
    await post(`/activities/${ACT}/updates`, { text: 'Demo to the quality team', on: '2026-10-20' });
    assert.equal(commits(), before + 1);
    assert.equal(app.store.getActivity(ACT).updates.length, 1);
    const refused = await post(`/activities/${ACT}/updates`, { text: 'Later', on: '2099-01-01' });
    assert.equal(refused.status, 303);
    assert.equal(app.store.getActivity(ACT).updates.length, 1);
  });

  test('changing the status is its own commit, and Done leaves the default list', async () => {
    const before = commits();
    await post(`/activities/${ACT}/status`, { status: 'Done' });
    assert.equal(commits(), before + 1);
    assert.equal(app.store.getActivity(ACT).status, 'Done');
    const list = await (await fetch(`${app.base}/activities`)).text();
    assert.doesNotMatch(list, /Supplier quality assistant/);
    const all = await (await fetch(`${app.base}/activities?status=all`)).text();
    assert.match(all, /Supplier quality assistant/);
  });

  test('an unknown owner and a bad kind are refused, and nothing is written', async () => {
    const before = commits();
    const res = await post('/activities', good({ title: 'Bad', kind: 'Donut' }));
    assert.equal(res.status, 422);
    const owner = await post('/activities', good({ title: 'Bad owner', owner_id: 'PE-9999' }));
    assert.equal(owner.status, 422);
    assert.equal(commits(), before);
  });

  test('deleting needs the ID typed, and the dashboard does not count activities as opportunities', async () => {
    const wrong = await post(`/activities/${ACT}/delete`, {});
    assert.equal(wrong.status, 303);
    assert.ok(app.store.getActivity(ACT), 'kept without the ID');
    await post(`/activities/${ACT}/delete`, { confirm: ACT });
    assert.ok(!app.store.getActivity(ACT), 'deleted with the ID');
  });

  test('the dashboard has an activities card and the nav links to it', async () => {
    await post('/activities', good({ title: 'Concept: plant digital twin', kind: 'Concept', status: 'In progress' }));
    const html = await (await fetch(`${app.base}/`)).text();
    assert.match(html, /<h2 class="card-pad">Internal activities<\/h2>/);
    assert.match(html, /Concept: plant digital twin/);
    assert.match(html, /href="\/activities"/);
    assert.match(html, /Open opportunities<\/div>\s*<div class="kpi-value">0<\/div>/, 'activities are not counted as open opportunities');
  });
});
