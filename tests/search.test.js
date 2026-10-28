import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { matchesSearch, searchWords } from '../app/lib/search.js';
import { createApp } from '../app/server.js';
import { cleanup, makeClone, makeRemote } from './helpers.js';

describe('search helper', () => {
  test('words are lower-cased and split on spaces', () => {
    assert.deepEqual(searchWords('  Bosch   DACH '), ['bosch', 'dach']);
    assert.deepEqual(searchWords(undefined), []);
  });

  test('an empty query matches everything', () => {
    assert.equal(matchesSearch([null, undefined, ''], []), true);
  });

  test('every word must appear, in any field, ignoring case and arrays', () => {
    const fields = ['Brake controller', 'Bosch', ['ADAS', 'Hi-Tech']];
    assert.equal(matchesSearch(fields, searchWords('bosch ADAS')), true);
    assert.equal(matchesSearch(fields, searchWords('bosch radar')), false);
    assert.equal(matchesSearch(fields, searchWords('hi-tech brake')), true);
  });

  test('a missing field does not break the match', () => {
    assert.equal(matchesSearch([undefined, 'Volkswagen'], searchWords('volks')), true);
  });
});

// ---------------------------------------------------------------- over HTTP

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

const get = async (base, url) => (await fetch(base + url)).text();

const opportunity = (overrides) => ({
  type: 'Lead',
  received_on: '2026-10-01',
  stage: 'Lead',
  probability: '5',
  currency: 'EUR',
  priority: 'Medium',
  go_no_go: 'Pending',
  sales_owner: 'Priya S',
  ...overrides,
});

describe('search on customers and opportunities', () => {
  let app;
  before(async () => {
    app = await startApp();
    await post(app.base, '/setup', { name: 'Amod Mulay', email: '' });
    await post(app.base, '/customers', { name: 'Bosch Mobility', industry: 'Automotive', region: 'DACH', notes: 'Radar sensor work' });
    await post(app.base, '/customers', { name: 'Volkswagen', industry: 'Automotive', region: 'EU - Nordics' });
    await post(app.base, '/opportunities', opportunity({ title: 'Brake controller validation', customer: 'Bosch Mobility', bu: 'Mobility', next_action: 'Send the estimate' }));
    await post(app.base, '/opportunities', opportunity({ title: 'Cabin HMI study', customer: 'Volkswagen', bu: 'Hi-Tech' }));
  });
  after(async () => {
    await app.close();
  });

  test('customers search finds a customer by name and by a note', async () => {
    const byName = await get(app.base, '/customers?q=volks');
    assert.match(byName, /Volkswagen/);
    assert.doesNotMatch(byName, /Bosch Mobility/);
    const byNote = await get(app.base, '/customers?q=radar');
    assert.match(byNote, /Bosch Mobility/);
    assert.doesNotMatch(byNote, /Volkswagen<\/a>/);
  });

  test('customers search with no match says so, and the full list is still there without a query', async () => {
    const none = await get(app.base, '/customers?q=nothingliketh');
    assert.match(none, /No customers match/);
    const all = await get(app.base, '/customers');
    assert.match(all, /Bosch Mobility/);
    assert.match(all, /Volkswagen/);
  });

  test('opportunities search finds by title, customer and next action', async () => {
    assert.match(await get(app.base, '/opportunities?status=all&q=brake'), /Brake controller/);
    assert.doesNotMatch(await get(app.base, '/opportunities?status=all&q=brake'), /Cabin HMI/);
    assert.match(await get(app.base, '/opportunities?status=all&q=volkswagen'), /Cabin HMI/);
    assert.match(await get(app.base, '/opportunities?status=all&q=estimate'), /Brake controller/);
  });

  test('opportunities search matches the BU and the owner name', async () => {
    assert.match(await get(app.base, '/opportunities?status=all&q=hi-tech'), /Cabin HMI/);
    assert.match(await get(app.base, '/opportunities?status=all&q=priya'), /Cabin HMI/);
  });

  test('opportunities search needs every word to match', async () => {
    const html = await get(app.base, '/opportunities?status=all&q=brake+volkswagen');
    assert.doesNotMatch(html, /Brake controller/);
    assert.doesNotMatch(html, /Cabin HMI/);
  });
});
