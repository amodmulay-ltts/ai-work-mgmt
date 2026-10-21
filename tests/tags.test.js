import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import ExcelJS from 'exceljs';
import { DEFAULT_CONFIG } from '../app/config-defaults.js';
import { validateRecord, withDefaultType } from '../app/models.js';
import { resolveTags, TAG_MAX } from '../app/lib/tags.js';
import { createApp } from '../app/server.js';
import { cleanup, git, makeClone, makeRemote } from './helpers.js';

describe('tags: pure rules', () => {
  test('tags are trimmed, spaces collapsed, and duplicates dropped', () => {
    const { tags, added, errors } = resolveTags(['  Hot  lead ', '', 'Hot lead', 'ADAS'], []);
    assert.deepEqual(tags, ['Hot lead', 'ADAS']);
    assert.deepEqual(added, ['Hot lead', 'ADAS']);
    assert.deepEqual(errors, []);
  });

  test('a tag that matches a known one, ignoring case, takes the known spelling', () => {
    const { tags, added } = resolveTags(['rfq', 'Mobility'], ['RFQ']);
    assert.deepEqual(tags, ['RFQ', 'Mobility']);
    assert.deepEqual(added, ['Mobility'], 'only the new tag is added to the list');
  });

  test('a tag longer than the limit is an error', () => {
    const { errors } = resolveTags(['x'.repeat(TAG_MAX + 1)], []);
    assert.equal(errors.length, 1);
  });

  test('a deal file with no type gets RFQ when it has the RFQ tag, and Lead otherwise', () => {
    assert.equal(withDefaultType({ id: 'DL-2026-0001', tags: ['rfq', 'HIL'] }).type, 'RFQ');
    assert.equal(withDefaultType({ id: 'DL-2026-0002', tags: ['HIL'] }).type, 'Lead');
  });

  test('a deal file that already has a type keeps it', () => {
    assert.equal(withDefaultType({ id: 'DL-2026-0003', type: 'RFI', tags: [] }).type, 'RFI');
  });

  test('validation rejects an opportunity tag that is not in the config', () => {
    const deal = {
      schema_version: 1, id: 'DL-2026-0001', title: 'x', type: 'Lead', customer_id: 'CU-0001', sales_owner_id: null,
      presales_owner_id: null, delivery_owner_id: null, support_ids: [], support_requests: [], support_seq: 0,
      contact_ids: [], source: null, description: '', c4c_id: null, bu: null, practice: null, region: null,
      stage: 'Lead', on_hold: false, probability: 5, priority: 'Medium', go_no_go: 'Pending', go_no_go_on: null,
      received_on: '2026-10-01', qa_due: null, submission_due: null, submitted_on: null,
      expected_decision_on: null, expected_start_on: null, closed_on: null, currency: 'EUR', est_value: null,
      effort_person_months: null, duration_months: null, pricing_model: null, incumbent: null, competitors: [],
      outcome_reason: null, next_action: null, next_action_due: null, tags: ['Mystery'], links: [], history: [],
      created_at: '2026-10-01T09:00:00+01:00', updated_at: '2026-10-01T09:00:00+01:00',
    };
    assert.deepEqual(validateRecord('deal', deal, DEFAULT_CONFIG), ["Tag: unknown value 'Mystery'"]);
    assert.deepEqual(validateRecord('deal', { ...deal, tags: ['RFQ'] }, DEFAULT_CONFIG), []);
  });
});

async function startApp() {
  const { dir } = await makeRemote();
  const root = await makeClone(dir, 'app', null);
  const { app, store } = await createApp({ root, syncEnabled: false });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    root,
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

const commits = (root) => Number(git(root, 'rev-list', '--count', 'HEAD'));
const YEAR = new Date().getFullYear();
const DEAL = `DL-${YEAR}-0001`;

const dealForm = (overrides = {}) => ({
  type: 'Lead',
  title: 'ADAS validation',
  customer: 'Bosch',
  sales_owner: 'Priya S',
  received_on: '2026-10-01',
  stage: 'Lead',
  probability: '5',
  currency: 'EUR',
  priority: 'Medium',
  go_no_go: 'Pending',
  ...overrides,
});

/** Settings form, with every list filled in so only the field under test changes. */
const settingsForm = (overrides = {}) => ({
  name: 'Amod Mulay',
  email: '',
  stale_after_days: '14',
  business_units: 'Mobility\nSustainability\nHi-Tech',
  regions: 'Europe',
  currencies: 'EUR',
  pricing_models: 'T&M',
  sources: 'Other',
  outcome_reasons: 'Other',
  tags: DEFAULT_CONFIG.tags.join('\n'),
  ...overrides,
});

describe('tags on opportunities, over HTTP', () => {
  let app;

  before(async () => {
    app = await startApp();
    await post(app.base, '/setup', { name: 'Amod Mulay', email: '' });
  });

  after(async () => {
    await app.close();
  });

  test('a new tag is created and saved in the same commit as the opportunity', async () => {
    const before = commits(app.root);
    const res = await post(app.base, '/opportunities', dealForm({ tags: 'rfq, Hot lead' }));
    assert.equal(res.status, 303);
    assert.equal(commits(app.root), before + 1, 'deal and the new tag are one commit');
    const deal = app.store.getDeal(DEAL);
    assert.deepEqual(deal.tags, ['RFQ', 'Hot lead'], 'the known spelling is used');
    assert.ok(app.store.config().tags.includes('Hot lead'));
    assert.match(git(app.root, 'show', 'HEAD', '--stat', '--format='), /config\.json/);
  });

  test('the opportunity form has a Type select and suggests known tags', async () => {
    const page = await get(app.base, `/opportunities/${DEAL}/edit`);
    assert.match(page.html, /<select id="f-type" name="type"/);
    assert.match(page.html, /<datalist id="tag-options">/);
    assert.match(page.html, /<option value="RFQ">/);
  });

  test('editing the tags records a Tags change in the history', async () => {
    const deal = app.store.getDeal(DEAL);
    await post(app.base, `/opportunities/${DEAL}`, dealForm({ tags: 'RFQ' }));
    assert.deepEqual(app.store.getDeal(DEAL).tags, ['RFQ']);
    const entry = app.store.getDeal(DEAL).history.at(-1);
    assert.match(entry.text, /Tags/);
    assert.equal(deal.id, DEAL);
  });

  test('a tag is removed from settings only when no deal uses it', async () => {
    const refused = await post(app.base, '/settings', settingsForm({ tags: 'Hot lead\nSustainability' }));
    assert.equal(refused.status, 422, 'RFQ is still used by DL-…-0001');
    const html = await refused.text();
    assert.match(html, /is used by 1 opportunity\. Remove it from them first\./);

    const kept = await post(app.base, '/settings', settingsForm({ tags: 'RFQ\nHot lead\nMobility' }));
    assert.equal(kept.status, 303);
    assert.deepEqual(app.store.config().tags, ['RFQ', 'Hot lead', 'Mobility']);
  });

  test('a settings form that does not send tags leaves them alone', async () => {
    const { tags: _ignored, ...withoutTags } = settingsForm();
    await post(app.base, '/settings', withoutTags);
    assert.deepEqual(app.store.config().tags, ['RFQ', 'Hot lead', 'Mobility']);
  });

  test('the export has Type at column 3 and Tags at the end', async () => {
    const res = await fetch(`${app.base}/export/opportunities.xlsx`);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await res.arrayBuffer()));
    const sheet = workbook.getWorksheet('Opportunities');
    assert.equal(sheet.getRow(1).getCell(3).value, 'Type');
    assert.equal(sheet.getRow(1).getCell(38).value, 'Tags');
    assert.equal(sheet.getRow(1).cellCount, 38);
    assert.equal(sheet.getRow(2).getCell(3).value, 'Lead');
  });
});

describe('tags: an opportunity file from before this change', () => {
  let app;

  before(async () => {
    app = await startApp();
    await post(app.base, '/setup', { name: 'Amod Mulay', email: '' });
    await post(app.base, '/opportunities', dealForm({ title: 'Old one', tags: 'HIL' }));
    // Put a fixed 'type' back in the file, as the old version wrote it, and drop 'HIL' from the config.
    const file = path.join(app.root, 'data', 'deals', `${DEAL}.json`);
    const obj = JSON.parse(await fs.readFile(file, 'utf8'));
    await fs.writeFile(file, JSON.stringify({ ...obj, type: 'RFQ', tags: ['HIL'] }, null, 2) + '\n');
    const configFile = path.join(app.root, 'data', 'config.json');
    const cfg = JSON.parse(await fs.readFile(configFile, 'utf8'));
    await fs.writeFile(configFile, JSON.stringify({ ...cfg, tags: ['RFQ'] }, null, 2) + '\n');
    await app.store.loadAll();
  });

  after(async () => {
    await app.close();
  });

  test('the type is kept and the file loads without problems', () => {
    assert.deepEqual(app.store.problems, []);
    assert.equal(app.store.getDeal(DEAL).type, 'RFQ');
    assert.deepEqual(app.store.getDeal(DEAL).tags, ['HIL']);
  });

  test('a tag that is only on an opportunity is added to the known list', () => {
    assert.ok(app.store.config().tags.includes('HIL'));
  });

  test('the opportunity page still renders', async () => {
    const page = await get(app.base, `/opportunities/${DEAL}`);
    assert.equal(page.status, 200);
    assert.match(page.html, /<span class="tag">HIL<\/span>/);
  });
});
