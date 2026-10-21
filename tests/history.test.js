import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diff, noteEntry } from '../app/history.js';

const AT = '2026-10-18T10:00:00+00:00';
const people = new Map([
  ['PE-0001', { id: 'PE-0001', name: 'Priya S' }],
  ['PE-0002', { id: 'PE-0002', name: 'Amod M' }],
]);
const customers = new Map([['CU-0003', { id: 'CU-0003', name: 'Bosch' }]]);
const lookup = { people, customers, at: AT };

/** A saved-looking deal. Tests change the fields they need. */
function deal(overrides = {}) {
  return {
    schema_version: 1,
    id: 'DL-2026-0014',
    title: 'ADAS validation services',
    type: 'RFQ',
    source: null,
    description: '',
    customer_id: 'CU-0003',
    contact_ids: [],
    c4c_id: '4589123',
    sales_owner_id: 'PE-0001',
    presales_owner_id: 'PE-0002',
    delivery_owner_id: null,
    bu: null,
    practice: null,
    region: null,
    stage: 'Solutioning',
    on_hold: false,
    probability: 35,
    priority: 'Medium',
    go_no_go: 'Pending',
    go_no_go_on: null,
    received_on: '2026-09-28',
    qa_due: null,
    submission_due: '2026-10-20',
    submitted_on: null,
    expected_decision_on: null,
    expected_start_on: null,
    closed_on: null,
    currency: 'EUR',
    est_value: 1250000,
    effort_person_months: null,
    duration_months: null,
    pricing_model: null,
    incumbent: null,
    competitors: [],
    outcome_reason: null,
    next_action: null,
    next_action_due: null,
    tags: [],
    links: [],
    history: [],
    created_at: '2026-09-28T09:12:00+05:30',
    updated_at: '2026-10-02T15:40:00+05:30',
    ...overrides,
  };
}

test('a new opportunity gets one created entry and the create summary', () => {
  const { entries, summary } = diff(null, deal(), lookup);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, 'created');
  assert.equal(entries[0].text, 'Opportunity created');
  assert.equal(summary, 'created – ADAS validation services');
});

test('a stage change logs a stage entry and the summary is just the stage', () => {
  const before = deal();
  const after = deal({ stage: 'Proposal Submitted', probability: 50 });
  const { entries, summary } = diff(before, after, lookup);
  assert.equal(entries.find((e) => e.kind === 'stage').text, 'Stage: Solutioning → Proposal Submitted');
  assert.equal(summary, 'stage Solutioning → Proposal Submitted');
});

test('probability that follows a stage change does not count as its own field', () => {
  const { entries } = diff(deal(), deal({ stage: 'Proposal Submitted', probability: 50 }), lookup);
  assert.equal(entries.some((e) => e.text.startsWith('Probability')), false);
});

test('one changed field gives a field entry and a summary with the raw values', () => {
  const after = deal({ submission_due: '2026-10-24' });
  const { entries, summary } = diff(deal(), after, lookup);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, 'field');
  assert.equal(entries[0].text, 'Submission due: 20 Oct 2026 → 24 Oct 2026');
  assert.equal(summary, 'submission due 2026-10-20 → 2026-10-24');
});

test('several changed fields give an updated-N summary', () => {
  const after = deal({ bu: 'Mobility', region: 'Europe', priority: 'High' });
  const { entries, summary } = diff(deal(), after, lookup);
  assert.equal(entries.length, 3);
  assert.equal(summary, 'updated 3 fields');
});

test('owner ids are shown as names in the timeline', () => {
  const after = deal({ sales_owner_id: 'PE-0002' });
  const { entries } = diff(deal(), after, lookup);
  assert.equal(entries[0].text, 'Sales owner: Priya S → Amod M');
});

test('hold and resume each get their own entry', () => {
  assert.equal(diff(deal(), deal({ on_hold: true }), lookup).entries[0].text, 'Put on hold');
  assert.equal(diff(deal({ on_hold: true }), deal(), lookup).entries[0].text, 'Resumed');
});

test('a description change never shows the text itself', () => {
  const { entries } = diff(deal(), deal({ description: 'A very long scope note' }), lookup);
  assert.equal(entries[0].text, 'Description updated');
});

test('no change gives no entries', () => {
  const { entries, summary } = diff(deal(), deal(), lookup);
  assert.deepEqual(entries, []);
  assert.equal(summary, 'no changes');
});

test('a note entry and its summary are built by noteEntry', () => {
  assert.deepEqual(noteEntry('Called the buyer', AT), {
    at: AT,
    kind: 'note',
    text: 'Called the buyer',
    from_value: null,
    to_value: null,
  });
});
