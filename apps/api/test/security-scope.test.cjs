const test = require('node:test');
const assert = require('node:assert/strict');
const { ForbiddenException } = require('@nestjs/common');
const { Role } = require('@biz-reporting/shared-types');
const { isSystemAdmin, assertCityScope } = require('./compiled-root.cjs')('common/security/scope.js');

const admin = { userId: 1, role: Role.SYSTEM_ADMIN, cityId: null };
const cityUser = { userId: 2, role: Role.CITY_USER, cityId: 8 };

test('system admins can access any city scope', () => {
  assert.equal(isSystemAdmin(admin), true);
  assert.doesNotThrow(() => assertCityScope(admin, 99));
  assert.doesNotThrow(() => assertCityScope(admin, null));
});

test('city users can access only their own city', () => {
  assert.equal(isSystemAdmin(cityUser), false);
  assert.doesNotThrow(() => assertCityScope(cityUser, 8));
  assert.throws(() => assertCityScope(cityUser, 9), ForbiddenException);
  assert.throws(() => assertCityScope(cityUser, null), ForbiddenException);
});

test('unknown roles cannot access business data', () => {
  assert.throws(
    () => assertCityScope({ userId: 3, role: 'reviewer', cityId: 8 }, 8),
    ForbiddenException,
  );
});
