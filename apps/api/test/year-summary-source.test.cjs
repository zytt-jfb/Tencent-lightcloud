const test = require('node:test');
const assert = require('node:assert/strict');
const { PackagesService } = require('./compiled-root.cjs')('packages/packages.service.js');

test('year summary selects either snapshot or realtime rows for each month', async () => {
  const packageRepo = {
    findOne: async () => ({ id: 1, cityId: 7, reportYear: 2026 }),
  };
  const contractRowRepo = {
    find: async () => [
      {
        monthNo: 1,
        contractId: 11,
        completionAmount: 999,
        acceptanceAmount: 999,
        invoiceAmount: 999,
        orderAmount: 999,
      },
      {
        monthNo: 2,
        contractId: 22,
        completionAmount: 200,
        acceptanceAmount: 180,
        invoiceAmount: 20,
        orderAmount: 25,
      },
    ],
  };
  const costRowRepo = {
    find: async () => [
      { monthNo: 1, costCategoryCode: 'labor', amount: 999 },
      { monthNo: 2, costCategoryCode: 'rent', amount: 40 },
    ],
  };
  const snapshotRepo = {
    find: async () => [
      {
        belongMonth: 1,
        contractRowsJson: [{
          contractId: 11,
          completionAmount: 100,
          acceptanceAmount: 90,
          invoiceAmount: 10,
          orderAmount: 15,
        }],
        costRowsJson: [{ costCategoryCode: 'labor', amount: 30 }],
        summaryJson: { orderGrossProfit: 50 },
      },
      {
        belongMonth: 2,
        contractRowsJson: [{ contractId: 22, completionAmount: 888 }],
        costRowsJson: [{ costCategoryCode: 'rent', amount: 888 }],
        summaryJson: { orderGrossProfit: 444 },
      },
    ],
  };
  const unlockGrantRepo = { find: async () => [{ monthNo: 2 }] };
  const allocationRepo = {
    find: async () => [
      { contractId: 11, rate: 0.5 },
      { contractId: 22, rate: 0.5 },
    ],
  };
  const unusedRepo = {};
  const service = new PackagesService(
    packageRepo,
    contractRowRepo,
    costRowRepo,
    unusedRepo,
    snapshotRepo,
    unlockGrantRepo,
    unusedRepo,
    allocationRepo,
    unusedRepo,
    unusedRepo,
  );

  const summary = await service.getYearSummary(1);

  assert.equal(summary.completionTotal, 300);
  assert.equal(summary.acceptanceTotal, 270);
  assert.equal(summary.invoiceTotal, 30);
  assert.equal(summary.orderTotal, 40);
  assert.equal(summary.costTotal, 70);
  assert.equal(summary.orderGrossProfit, 150);
  assert.equal(summary.netProfit, 80);
  assert.equal(summary.costCategoryTotals.labor, 30);
  assert.equal(summary.costCategoryTotals.rent, 40);
});
