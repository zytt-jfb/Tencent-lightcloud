const test = require('node:test');
const assert = require('node:assert/strict');
const { BizSnapshotService } = require('./compiled-root.cjs')('biz-snapshots/biz-snapshot.service.js');

function createService(readyRun) {
  const saved = [];
  const service = Object.create(BizSnapshotService.prototype);
  service.buildLocks = new Map();
  service.logger = { error() {} };
  service.runRepo = {
    findOne: async ({ where }) => where.status === 'building' ? null : readyRun,
    create: (value) => ({ id: 'new-run', ...value }),
    save: async (run) => {
      saved.push({ ...run });
      return run;
    },
    update: async () => {},
  };
  service.buildSnapshot = async () => {};
  return { service, saved };
}

test('manual request rebuilds a ready snapshot for the same business day', async () => {
  const readyRun = { id: 'existing-run', asOf: '2026-10-08', status: 'ready' };
  const { service, saved } = createService(readyRun);

  const result = await service.requestBuild('2026-10-08', 'manual');

  assert.deepEqual(result, { runId: 'existing-run', status: 'building' });
  assert.equal(saved.length, 1);
  assert.equal(saved[0].status, 'building');
  assert.equal(saved[0].source, 'manual');
  assert.equal(saved[0].errorMessage, null);
});

test('automatic request stays idempotent when today already has a ready snapshot', async () => {
  const readyRun = { id: 'existing-run', asOf: '2026-10-08', status: 'ready' };
  const { service, saved } = createService(readyRun);

  const result = await service.requestBuild('2026-10-08', 'auto');

  assert.deepEqual(result, { runId: 'existing-run', status: 'ready' });
  assert.equal(saved.length, 0);
});
