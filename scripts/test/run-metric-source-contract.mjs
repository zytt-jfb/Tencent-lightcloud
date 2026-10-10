import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const requireFromShared = createRequire(path.join(repoRoot, 'packages', 'shared-types', 'package.json'));
const { V3_METRIC_SOURCE_MANIFEST } = requireFromShared('./dist/index.js');
const dashboardSource = fs.readFileSync(path.join(repoRoot, 'apps/api/src/dashboard/dashboard.service.ts'), 'utf8');
const factsSource = fs.readFileSync(path.join(repoRoot, 'apps/api/src/facts/facts.service.ts'), 'utf8');
const cityEstimateSource = fs.readFileSync(path.join(repoRoot, 'apps/admin-web/src/pages/CityEstimate/index.tsx'), 'utf8');

assert.equal(V3_METRIC_SOURCE_MANIFEST.dashboard.actualCost, 'cost_facts.amount');
assert.equal(V3_METRIC_SOURCE_MANIFEST.dashboard.orderAmount, 'order_facts.tax_inclusive_amount');
assert.equal(V3_METRIC_SOURCE_MANIFEST.dashboard.grossProfit, 'acceptanceAmount * contract_city_allocations.rate');
assert.equal(V3_METRIC_SOURCE_MANIFEST.cityEstimate.lifecycle, 'read_only_compatibility');
assert.equal(V3_METRIC_SOURCE_MANIFEST.legacyPackageLifecycle.mode, 'read_only_compatibility');
assert.ok(V3_METRIC_SOURCE_MANIFEST.legacyPackageLifecycle.exitPlan.length >= 3);

assert.match(dashboardSource, /this\.facts\.aggregate\(\{ year/);
assert.doesNotMatch(dashboardSource, /MonthSnapshotEntity|ContractMonthRowEntity|CostFactEntity|OrderFactEntity/);
assert.match(dashboardSource, /dataSources:\s*V3_METRIC_SOURCE_MANIFEST\.dashboard/);

assert.match(factsSource, /this\.progressRepo\.find/);
assert.match(factsSource, /Number\(item\.invoiceAmount\)/);
assert.match(factsSource, /Number\(item\.taxInclusiveAmount\)/);
assert.match(factsSource, /Number\(item\.amount\)/);
assert.doesNotMatch(factsSource, /snapshotRepo|MonthSnapshotEntity/);
assert.ok(factsSource.includes('const allocationByContractId = new Map(allocations.map((item) => [Number(item.contractId), item]))'));
assert.ok(factsSource.includes('Number(item.contractId) === contractId'));
assert.ok(factsSource.includes('Number(conflict.id) !== Number(id)'));

assert.match(cityEstimateSource, /factsApi\.adminProgress/);
assert.match(cityEstimateSource, /factsApi\.adminOrders/);
assert.match(cityEstimateSource, /acceptanceTotal \* managementFee/);
assert.match(cityEstimateSource, /V3_METRIC_SOURCE_MANIFEST\.version/);

console.log(`METRIC_SOURCE_CONTRACT_OK version=${V3_METRIC_SOURCE_MANIFEST.version} legacy=${V3_METRIC_SOURCE_MANIFEST.legacyPackageLifecycle.mode}`);
