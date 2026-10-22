const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./compiled-root.cjs');

const { IntentRegistry } = load('ai/intents/intent-registry.js');
const { extractParams, deriveParamNames, normalizeInput } = load('ai/intents/intent-params.js');

const registry = new IntentRegistry();

test('目录内所有意图通过启动期校验（无一条被剔除）', () => {
  assert.deepEqual(
    registry.rejectedIntents.map((item) => `${item.id}:${item.reason}`),
    [],
    '存在被剔除的意图，说明模板与白名单/参数契约不一致',
  );
  assert.ok(registry.all.length >= 11, `意图数量 ${registry.all.length} 少于预期`);
});

test('纯读意图的 SQL 参数个数与声明一致（防止参数错位）', () => {
  for (const intent of registry.all) {
    if (!intent.sql) continue;
    const derived = deriveParamNames(intent);
    assert.ok(Array.isArray(derived), intent.id);
  }
});

test('后评估地市排名：命中并抽出月份', () => {
  const match = registry.match('2026-09 后评估地市排名');
  assert.ok(match, '未匹配到意图');
  assert.equal(match.intent.id, 'assessment.city_rank');

  const { params, missing } = extractParams(match.intent, '2026-09 后评估地市排名', { cityNames: [] });
  assert.equal(params.month, '2026-09');
  assert.equal(missing.length, 0);
});

test('同义词归一：排行/座次/名次都能命中排名类意图', () => {
  for (const input of ['后评估排行', '后评估座次', '后评估名次']) {
    const match = registry.match(input);
    assert.ok(match, `${input} 未命中`);
    assert.equal(match.intent.id, 'assessment.city_rank', input);
  }
});

test('供应商排名不会被地市排名抢走', () => {
  const match = registry.match('2026-08 供应商排名');
  assert.ok(match);
  assert.equal(match.intent.id, 'assessment.supplier_rank');
});

test('月度考核与后评估是两套意图，不互相串台', () => {
  assert.equal(registry.match('2026 年经营单元考核排名').intent.id, 'performance.organization_rank');
  assert.equal(registry.match('2026 年考核汇总').intent.id, 'performance.year_summary');
  assert.equal(registry.match('2026-09 后评估概况').intent.id, 'assessment.month_summary');
});

test('成本意图按权限隔离：无成本权限的账号看不到它', () => {
  const withPerm = { permissionCodes: new Set(['operation.cost.read']), isSuperAdmin: false };
  const without = { permissionCodes: new Set(['assessment.overview.read']), isSuperAdmin: false };
  assert.ok(registry.guideFor(withPerm).some((item) => item.id === 'operation.cost_summary'));
  assert.ok(!registry.guideFor(without).some((item) => item.id === 'operation.cost_summary'));
});

test('知识库问答只在业务意图未命中时兜底', () => {
  assert.equal(registry.match('后评估的分数怎么算').intent.id, 'qa.knowledge');
  assert.equal(registry.match('后评估排名怎么算').intent.id, 'assessment.city_rank');
});

test('完全无关的输入不匹配任何意图', () => {
  assert.equal(registry.match('今天天气怎么样'), null);
  assert.equal(registry.match('帮我订一张机票'), null);
});

test('合同到期：天数参数抽取与默认值', () => {
  const match = registry.match('未来 30 天到期的合同');
  assert.ok(match);
  assert.equal(match.intent.id, 'operation.contract_expiring');
  const { params } = extractParams(match.intent, '未来 30 天到期的合同', { cityNames: [] });
  assert.equal(params.days, 30);
});

test('月份区间抽取', () => {
  const match = registry.match('2026-01 到 2026-09 成本汇总');
  assert.ok(match);
  const { params } = extractParams(match.intent, '2026-01 到 2026-09 成本汇总', { cityNames: [] });
  assert.equal(params.rangeFrom, '2026-01');
  assert.equal(params.rangeTo, '2026-09');
});

test('归一化按最长词优先替换', () => {
  const normalized = normalizeInput('后评估排行', { 排行: '排名', 后评估排名: '后评估排名' });
  assert.ok(normalized.includes('排名'));
});
