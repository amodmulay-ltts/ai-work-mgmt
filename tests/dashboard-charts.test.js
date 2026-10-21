import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_CONFIG } from '../app/config-defaults.js';
import { byBusinessUnit, healthMix, submissionsByMonth } from '../app/metrics.js';

const TODAY = '2026-10-21';
const deal = (overrides = {}) => ({
  stage: 'Lead', on_hold: false, bu: null, currency: 'EUR', est_value: 100, submission_due: null, submitted_on: null,
  ...overrides,
});

test('health mix counts each open level and ignores closed rows', () => {
  const rows = [{ health: { level: 'red' } }, { health: { level: 'red' } }, { health: { level: 'amber' } }, { health: { level: 'hold' } }];
  assert.deepEqual(healthMix(rows), { red: 2, amber: 1, green: 0, hold: 1 });
  assert.deepEqual(healthMix([]), { red: 0, amber: 0, green: 0, hold: 0 });
});

test('submissions are counted by month for the next six months, starting this month', () => {
  const deals = [
    deal({ submission_due: '2026-10-30' }),
    deal({ submission_due: '2026-11-03' }),
    deal({ submission_due: '2027-03-01' }),
    deal({ submission_due: '2026-10-05' }), // overdue
    deal({ submission_due: '2026-12-01', submitted_on: '2026-10-10' }), // already submitted
    deal({ submission_due: '2026-12-01', stage: 'Won' }), // closed
    deal({ submission_due: '2027-09-01' }), // beyond the window
  ];
  const result = submissionsByMonth(deals, DEFAULT_CONFIG, TODAY);
  assert.deepEqual(result.months.map((m) => [m.key, m.count]), [
    ['2026-10', 1], ['2026-11', 1], ['2026-12', 0], ['2027-01', 0], ['2027-02', 0], ['2027-03', 1],
  ]);
  assert.equal(result.overdue, 1);
  assert.equal(result.later, 1);
});

test('the month window wraps the year', () => {
  const result = submissionsByMonth([], DEFAULT_CONFIG, '2026-11-15');
  assert.deepEqual(result.months.map((m) => m.key), ['2026-11', '2026-12', '2027-01', '2027-02', '2027-03', '2027-04']);
});

test('business units list their open count and value, with No BU last', () => {
  const deals = [
    deal({ bu: 'Mobility', est_value: 100 }),
    deal({ bu: 'Hi-Tech', est_value: 50 }),
    deal({ bu: 'Mobility', est_value: 25, currency: 'USD' }),
    deal({ bu: null }),
    deal({ bu: null }),
    deal({ bu: 'Aerospace', est_value: null }),
  ];
  const result = byBusinessUnit(deals, DEFAULT_CONFIG);
  assert.deepEqual(result.map((b) => b.bu), ['Mobility', 'Aerospace', 'Hi-Tech', 'No BU']);
  assert.equal(result[0].count, 2);
  assert.deepEqual(result[0].totals, { EUR: 100, USD: 25 });
  assert.deepEqual(result[1].totals, {}, 'a deal without a value adds no money');
  assert.equal(result[3].count, 2);
});
