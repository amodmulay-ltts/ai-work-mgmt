import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../app/server.js';
import { applyTaskAction, newTaskComment, parseTaskForm, taskErrors } from '../app/lib/tasks.js';
import { cleanup, git, makeClone, makeRemote } from './helpers.js';

const post = (base, url, fields) =>
  fetch(base + url, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
  });

const commits = (root) => Number(git(root, 'rev-list', '--count', 'HEAD'));
const AT = '2026-11-11T09:00:00+01:00';
const TODAY = '2026-11-11';

describe('backlog: pure rules', () => {
  const task = (status) => ({ id: 'TK-0001', title: 'Write the plan', status, comments: [] });

  test('start works from Backlog and On hold, not from In progress or Done', () => {
    assert.equal(applyTaskAction(task('Backlog'), 'start', { at: AT }).status, 'In progress');
    assert.equal(applyTaskAction(task('On hold'), 'start', { at: AT }).status, 'In progress');
    assert.equal(applyTaskAction(task('In progress'), 'start', { at: AT }), null);
    assert.equal(applyTaskAction(task('Done'), 'start', { at: AT }), null);
  });

  test('put on hold, finish and reopen follow the same rules', () => {
    assert.equal(applyTaskAction(task('In progress'), 'hold', { at: AT }).status, 'On hold');
    assert.equal(applyTaskAction(task('Backlog'), 'hold', { at: AT }).status, 'On hold');
    assert.equal(applyTaskAction(task('On hold'), 'hold', { at: AT }), null);
    assert.equal(applyTaskAction(task('On hold'), 'finish', { at: AT }).status, 'Done');
    assert.equal(applyTaskAction(task('Done'), 'reopen', { at: AT }).status, 'Backlog');
    assert.equal(applyTaskAction(task('In progress'), 'reopen', { at: AT }), null);
    assert.equal(applyTaskAction(task('Backlog'), 'unknown', { at: AT }), null);
  });

  test('the title is required and the due date must be a date', () => {
    assert.deepEqual(parseTaskForm({ title: '  ' }).errors, { title: 'Title is required' });
    assert.deepEqual(parseTaskForm({ title: 'x', due_on: '11/11/2026' }).errors, { due_on: 'Enter a valid date' });
    assert.deepEqual(parseTaskForm({ title: 'x', due_on: '2026-11-20' }).typed, { title: 'x', description: '', due_on: '2026-11-20' });
  });

  test('a comment needs text and is dated today', () => {
    assert.equal(newTaskComment({ text: ' ' }, { at: AT, today: TODAY }).error, 'Write the comment first.');
    const { comment } = newTaskComment({ text: 'Sent to Meera' }, { at: AT, today: TODAY });
    assert.deepEqual([comment.on, comment.text], [TODAY, 'Sent to Meera']);
  });

  test('a stored task must have a valid id, status and comment dates', () => {
    assert.deepEqual(taskErrors({ id: 'TK-0001', title: 'x', status: 'Backlog', comments: [] }), []);
    assert.ok(taskErrors({ id: 'TK-0001', title: 'x', status: 'Stuck', comments: [] }).length > 0);
  });
});

describe('backlog: over HTTP', () => {
  let app;
  let root;
  let id;

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

  test('a new task starts in the backlog, with one commit', async () => {
    const before = commits(root);
    const res = await post(app.base, '/tasks', { title: 'Write the test plan', description: 'For the RFQ', due_on: '2026-11-20' });
    assert.equal(res.status, 303);
    assert.equal(commits(root), before + 1);
    id = res.headers.get('location').split('/').at(-1);
    assert.match(id, /^TK-\d{4}$/);
    const task = app.store.getTask(id);
    assert.equal(task.status, 'Backlog');
    assert.equal(task.due_on, '2026-11-20');
    assert.deepEqual(task.comments, []);
  });

  test('the backlog lists open tasks; Done is hidden until All is chosen', async () => {
    const open = await (await fetch(`${app.base}/tasks`)).text();
    assert.match(open, /Write the test plan/);
    await post(app.base, `/tasks/${id}/action`, { action: 'finish' });
    const hidden = await (await fetch(`${app.base}/tasks`)).text();
    assert.doesNotMatch(hidden, /Write the test plan/);
    const all = await (await fetch(`${app.base}/tasks?status=all`)).text();
    assert.match(all, /Write the test plan/);
    await post(app.base, `/tasks/${id}/action`, { action: 'reopen' });
  });

  test('start, put on hold, start again, then finish, each saved as its own commit', async () => {
    const before = commits(root);
    await post(app.base, `/tasks/${id}/action`, { action: 'start' });
    assert.equal(app.store.getTask(id).status, 'In progress');
    await post(app.base, `/tasks/${id}/action`, { action: 'hold' });
    assert.equal(app.store.getTask(id).status, 'On hold');
    await post(app.base, `/tasks/${id}/action`, { action: 'start' });
    assert.equal(app.store.getTask(id).status, 'In progress');
    await post(app.base, `/tasks/${id}/action`, { action: 'finish' });
    assert.equal(app.store.getTask(id).status, 'Done');
    assert.equal(commits(root), before + 4);
    assert.equal(git(root, 'log', '-1', '--format=%s'), `${id}: In progress → Done`);
  });

  test('an action that does not apply changes nothing', async () => {
    const before = commits(root);
    await post(app.base, `/tasks/${id}/action`, { action: 'hold' });
    assert.equal(app.store.getTask(id).status, 'Done');
    assert.equal(commits(root), before);
  });

  test('a comment is added with its date; an empty comment is refused', async () => {
    await post(app.base, `/tasks/${id}/comments`, { text: 'Waiting on the customer' });
    await post(app.base, `/tasks/${id}/comments`, { text: '   ' });
    const task = app.store.getTask(id);
    assert.equal(task.comments.length, 1);
    assert.equal(task.comments[0].text, 'Waiting on the customer');
    const page = await (await fetch(`${app.base}/tasks/${id}`)).text();
    assert.match(page, /Waiting on the customer/);
  });

  test('editing keeps the status and comments', async () => {
    const res = await post(app.base, `/tasks/${id}`, { title: 'Write the full test plan', description: '', due_on: '' });
    assert.equal(res.status, 303);
    const task = app.store.getTask(id);
    assert.equal(task.title, 'Write the full test plan');
    assert.equal(task.status, 'Done');
    assert.equal(task.comments.length, 1);
  });

  test('delete needs the id typed exactly', async () => {
    await post(app.base, `/tasks/${id}/delete`, { confirm: 'TK-9999' });
    assert.ok(app.store.getTask(id), 'still there after a wrong confirm');
    await post(app.base, `/tasks/${id}/delete`, { confirm: id });
    assert.equal(app.store.getTask(id), null);
  });
});
