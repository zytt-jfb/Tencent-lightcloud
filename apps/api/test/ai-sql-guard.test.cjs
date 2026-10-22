const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./compiled-root.cjs');

const guard = load('ai/sql/sql-guard.js');

const base = { maxRows: 500, params: [] };

test('允许的 SELECT 通过并返回表名与 limit', () => {
  const result = guard.guardSql({
    sql: 'SELECT city_name FROM biz_assessment_record WHERE eval_month = ? LIMIT 50',
    params: ['2026-09'],
    maxRows: 500,
  });
  assert.deepEqual(result.tables, ['biz_assessment_record']);
  assert.equal(result.limit, 50);
});

test('写操作一律拒绝', () => {
  for (const sql of [
    'INSERT INTO biz_cities (id) VALUES (1)',
    'UPDATE biz_cities SET name = 1 LIMIT 1',
    'DELETE FROM biz_cities LIMIT 1',
    'DROP TABLE biz_cities',
    'ALTER TABLE biz_cities ADD COLUMN x INT',
    'TRUNCATE TABLE biz_cities',
  ]) {
    assert.throws(() => guard.guardSql({ ...base, sql, params: [] }), guard.SqlGuardError, sql);
  }
});

test('列名含 update/created 不会被误判为写操作', () => {
  assert.doesNotThrow(() =>
    guard.guardSql({
      ...base,
      sql: 'SELECT created_at, updated_at FROM biz_cost_entries LIMIT 10',
      params: [],
    }),
  );
});

test('多语句与注释被拒绝', () => {
  assert.throws(
    () => guard.guardSql({ ...base, sql: 'SELECT 1 FROM biz_cities LIMIT 1; SELECT 2 FROM biz_cities LIMIT 1' }),
    /多条语句/,
  );
  assert.throws(() => guard.guardSql({ ...base, sql: 'SELECT 1 FROM biz_cities -- x\nLIMIT 1' }), /注释/);
  assert.throws(() => guard.guardSql({ ...base, sql: 'SELECT 1 FROM biz_cities /* x */ LIMIT 1' }), /注释/);
});

test('白名单之外的表被拒绝（含用户/权限表）', () => {
  for (const table of ['biz_users', 'biz_roles', 'biz_permissions', 'biz_user_roles', 'information_schema.tables']) {
    assert.throws(
      () => guard.guardSql({ ...base, sql: `SELECT * FROM ${table} LIMIT 1` }),
      guard.SqlGuardError,
      table,
    );
  }
});

test('必须包含字面量 LIMIT', () => {
  assert.throws(() => guard.guardSql({ ...base, sql: 'SELECT city_name FROM biz_cities' }), /LIMIT/);
  assert.throws(() => guard.guardSql({ ...base, sql: 'SELECT city_name FROM biz_cities LIMIT ?', params: [10] }), /LIMIT/);
});

test('LIMIT 不得超过上限', () => {
  assert.throws(
    () => guard.guardSql({ ...base, sql: 'SELECT city_name FROM biz_cities LIMIT 5000' }),
    /超过上限/,
  );
});

test('参数个数必须与占位符一致', () => {
  assert.throws(
    () => guard.guardSql({ ...base, sql: 'SELECT city_name FROM biz_cities WHERE id = ? LIMIT 1', params: [] }),
    /参数个数不匹配/,
  );
  assert.throws(
    () =>
      guard.guardSql({
        ...base,
        sql: 'SELECT city_name FROM biz_cities WHERE id = ? LIMIT 1',
        params: ['a', 'b'],
      }),
    /参数个数不匹配/,
  );
});

test('引号内的问号不计入占位符', () => {
  assert.equal(guard.countPlaceholders("SELECT '?' AS q FROM biz_cities WHERE id = ? LIMIT 1"), 1);
  assert.equal(guard.countPlaceholders("SELECT 'it''s ?' AS q FROM biz_cities LIMIT 1"), 0);
});

test('scope 占位必须在第一个 ? 之前', () => {
  assert.throws(
    () => guard.assertScopePlaceholder('SELECT 1 FROM biz_cities WHERE id = ? AND {{scope}} LIMIT 1'),
    /{{scope}} 必须出现在第一个 \? 之前/,
  );
  assert.doesNotThrow(() =>
    guard.assertScopePlaceholder('SELECT 1 FROM biz_cities WHERE {{scope}} AND id = ? LIMIT 1'),
  );
  assert.throws(() => guard.assertScopePlaceholder('SELECT 1 FROM biz_cities LIMIT 1'), /缺少 \{\{scope\}\}/);
});

test('危险函数与系统库被拒绝', () => {
  for (const sql of [
    "SELECT SLEEP(5) FROM biz_cities LIMIT 1",
    "SELECT LOAD_FILE('/etc/passwd') FROM biz_cities LIMIT 1",
    'SELECT * FROM mysql.user LIMIT 1',
  ]) {
    assert.throws(() => guard.guardSql({ ...base, sql }), guard.SqlGuardError, sql);
  }
});

test('表名提取覆盖 JOIN 与别名反引号', () => {
  const tables = guard.extractTables(
    'SELECT c.id FROM `biz_contracts` c JOIN biz_contract_city_allocations a ON a.contract_id = c.id LIMIT 10',
  );
  assert.deepEqual(tables.sort(), ['biz_contract_city_allocations', 'biz_contracts']);
});
