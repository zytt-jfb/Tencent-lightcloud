const test = require('node:test');
const assert = require('node:assert/strict');
const { BadRequestException } = require('@nestjs/common');
const { Role } = require('@biz-reporting/shared-types');
const { UsersService } = require('./compiled-root.cjs')('users/users.service.js');

function createService(user) {
  const auditEntries = [];
  const userRepository = {
    findOne: async () => user,
    update: async (_id, patch) => Object.assign(user, patch),
  };
  const cityRepository = {
    findOne: async () => ({ id: user.cityId, name: 'Target city' }),
  };
  const operationLogRepo = {
    create: (entry) => entry,
    save: async (entry) => {
      auditEntries.push(entry);
      return entry;
    },
  };
  return {
    service: new UsersService(userRepository, cityRepository, operationLogRepo),
    auditEntries,
  };
}

function legacyUser() {
  return {
    id: 7,
    role: 'reviewer',
    name: 'Legacy user',
    cityId: 8,
    openid: null,
    username: 'legacy',
    passwordHash: null,
    status: 'enabled',
    registerAt: new Date('2026-01-01T00:00:00.000Z'),
    lastLoginAt: null,
  };
}

test('migrates a legacy reviewer and records before/after data', async () => {
  const { service, auditEntries } = createService(legacyUser());
  const result = await service.migrateLegacyRole(
    7,
    { targetRole: Role.CITY_USER, cityId: 9 },
    1,
  );

  assert.equal(result.role, Role.CITY_USER);
  assert.equal(result.cityId, 9);
  assert.equal(auditEntries.length, 1);
  assert.deepEqual(auditEntries[0].beforeDataJson, { role: 'reviewer', cityId: 8 });
  assert.deepEqual(auditEntries[0].afterDataJson, { role: Role.CITY_USER, cityId: 9 });
});

test('rejects unsupported migration targets', async () => {
  const { service } = createService(legacyUser());
  await assert.rejects(
    service.migrateLegacyRole(7, { targetRole: 'reviewer' }, 1),
    BadRequestException,
  );
});
