// 地市端导入权限纯函数测试（针对编译产物 dist）。
// 运行：cd apps/api && node --test test/city-import-access.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { checkCityImportAccess, CITY_IMPORT_ACCESS_ERRORS } = require('./compiled-root.cjs')('common/security/scope.js');

const ALLOWED = ['city_reporting', 'city_cost'];

function base(overrides = {}) {
  return {
    userRole: 'city_user',
    userId: 2,
    userCityId: 1,
    jobType: 'city_reporting',
    jobCityId: 1,
    jobOperatorUserId: 2,
    allowedJobTypes: ALLOWED,
    ...overrides,
  };
}

test('本人、本地市、允许类型 → 放行', () => {
  assert.deepEqual(checkCityImportAccess(base()), { ok: true });
  assert.deepEqual(checkCityImportAccess(base({ jobType: 'city_cost' })), { ok: true });
});

test('作业类型不在白名单 → 拒绝（不支持地市端操作）', () => {
  const r = checkCityImportAccess(base({ jobType: 'contract' }));
  assert.equal(r.ok, false);
  assert.equal(r.reason, CITY_IMPORT_ACCESS_ERRORS.UNSUPPORTED_JOB_TYPE);
});

test('非地市用户（系统管理员）→ 拒绝（仅地市用户）', () => {
  const r = checkCityImportAccess(base({ userRole: 'system_admin' }));
  assert.equal(r.ok, false);
  assert.equal(r.reason, CITY_IMPORT_ACCESS_ERRORS.NOT_CITY_USER);
});

test('跨地市 → 拒绝（其他地市数据）', () => {
  const r = checkCityImportAccess(base({ jobCityId: 9 }));
  assert.equal(r.ok, false);
  assert.equal(r.reason, CITY_IMPORT_ACCESS_ERRORS.CITY_MISMATCH);
});

test('用户无地市（cityId=null）→ 拒绝（其他地市数据）', () => {
  const r = checkCityImportAccess(base({ userCityId: null }));
  assert.equal(r.ok, false);
  assert.equal(r.reason, CITY_IMPORT_ACCESS_ERRORS.CITY_MISMATCH);
});

test('跨用户（operator 非本人）→ 拒绝（其他用户任务）', () => {
  const r = checkCityImportAccess(base({ jobOperatorUserId: 99 }));
  assert.equal(r.ok, false);
  assert.equal(r.reason, CITY_IMPORT_ACCESS_ERRORS.OPERATOR_MISMATCH);
});

test('判定顺序：类型优先于角色', () => {
  const r = checkCityImportAccess(base({ jobType: 'contract', userRole: 'system_admin' }));
  assert.equal(r.reason, CITY_IMPORT_ACCESS_ERRORS.UNSUPPORTED_JOB_TYPE);
});
