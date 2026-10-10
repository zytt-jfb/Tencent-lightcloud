const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateProfitMetrics } = require('./compiled-root.cjs')('domain/finance/business-calculator.js');

test('calculates shared profit metrics with the reporting formula', () => {
  assert.deepEqual(
    calculateProfitMetrics(1000, 200, 500),
    {
      costRate: 0.2,
      costIncomeRate: 0.4,
      netProfit: 300,
      netProfitRate: 0.3,
    },
  );
});

test('returns zero rates for zero or non-finite denominators', () => {
  assert.deepEqual(
    calculateProfitMetrics(0, 10, 0),
    {
      costRate: 0,
      costIncomeRate: 0,
      netProfit: -10,
      netProfitRate: 0,
    },
  );
  assert.equal(calculateProfitMetrics(Number.NaN, 10, 20).costRate, 0);
});
