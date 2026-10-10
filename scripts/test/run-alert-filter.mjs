/**
 * 合同预警筛选定向测试（纯函数）。
 *
 * 覆盖：
 *  1. items 含 expiring / nearly_full / overfull 时，选择 overfull 只得到 overfull；
 *  2. 当前数据没有 overfull 时，选择 overfull 得到空数组（页面显示"暂无符合条件的预警"）；
 *  3. 同一合同同时存在 overfull 与 expiring 时，两种筛选互不串类型；
 *  4. 未筛选时返回全部真实预警；
 *  5. none / normal 不进入结果；
 *  6. 按 contractId + alertType + cityId 去重，不能只按合同编号去重。
 *
 * 运行：node scripts/test/run-alert-filter.mjs
 */
import assert from 'node:assert/strict';
import {
  ALERT_TYPE_OPTIONS,
  ALERT_TYPE_VALUES,
  normalizeAlerts,
  filterAlertsByTypes,
  selectVisibleAlerts,
  alertTypeLabel,
} from '../../apps/admin-web/src/utils/alert-filter.ts';

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  PASS  ${name}`);
}

// 构造：与生产分布一致 —— overfull 0 条 / expiring 145 条 / nearly_full 16 条 / expired 3 条
function buildProductionLikeItems() {
  const items = [];
  for (let i = 0; i < 145; i += 1) {
    items.push({ contractId: `C-expiring-${i}`, contractNo: `HT-${i}`, alertType: 'expiring', cityId: 'city-1' });
  }
  for (let i = 0; i < 16; i += 1) {
    items.push({ contractId: `C-nearly-${i}`, contractNo: `HT-N${i}`, alertType: 'nearly_full', cityId: 'city-1' });
  }
  for (let i = 0; i < 3; i += 1) {
    items.push({ contractId: `C-expired-${i}`, contractNo: `HT-E${i}`, alertType: 'expired', cityId: 'city-2' });
  }
  return items;
}

console.log('=== 合同预警筛选定向测试 ===\n');

check('选项 value 严格使用后端枚举值，且 label 为中文', () => {
  assert.deepEqual(ALERT_TYPE_VALUES, ['expiring', 'overfull', 'nearly_full', 'expired']);
  assert.deepEqual(ALERT_TYPE_OPTIONS.map((o) => o.label), ['即将到期', '已满额/超额', '接近满额', '已到期']);
  // 中文 label 绝不能被当作筛选值
  for (const opt of ALERT_TYPE_OPTIONS) {
    assert.ok(!ALERT_TYPE_VALUES.includes(opt.label), `${opt.label} 不应作为枚举值`);
  }
});

check('生产数据下：选择 overfull（0 条）→ 空数组，不得串出 expiring', () => {
  const items = buildProductionLikeItems();
  const result = selectVisibleAlerts(items, ['overfull']);
  assert.equal(result.length, 0, `期望 0 条，实际 ${result.length} 条`);
});

check('选择 expiring → 只得到 expiring（145 条）', () => {
  const items = buildProductionLikeItems();
  const result = selectVisibleAlerts(items, ['expiring']);
  assert.equal(result.length, 145);
  assert.ok(result.every((r) => r.alertType === 'expiring'));
});

check('选择 nearly_full → 只得到 nearly_full（16 条）', () => {
  const items = buildProductionLikeItems();
  const result = selectVisibleAlerts(items, ['nearly_full']);
  assert.equal(result.length, 16);
  assert.ok(result.every((r) => r.alertType === 'nearly_full'));
});

check('选择 expired → 只得到 expired（3 条）', () => {
  const items = buildProductionLikeItems();
  const result = selectVisibleAlerts(items, ['expired']);
  assert.equal(result.length, 3);
  assert.ok(result.every((r) => r.alertType === 'expired'));
});

check('同一合同同时有 overfull 与 expiring：筛选互不串类型', () => {
  const items = [
    { contractId: 'C-1', alertType: 'overfull', cityId: 'city-1' },
    { contractId: 'C-1', alertType: 'expiring', cityId: 'city-1' }, // 同一合同两种预警，业务允许
  ];
  const onlyOverfull = selectVisibleAlerts(items, ['overfull']);
  assert.equal(onlyOverfull.length, 1);
  assert.equal(onlyOverfull[0].alertType, 'overfull');

  const onlyExpiring = selectVisibleAlerts(items, ['expiring']);
  assert.equal(onlyExpiring.length, 1);
  assert.equal(onlyExpiring[0].alertType, 'expiring');

  // 不筛选时两条真实预警都要在
  assert.equal(selectVisibleAlerts(items, []).length, 2);
  assert.equal(selectVisibleAlerts(items, undefined).length, 2);
});

check('多选 overfull + expiring（无 overfull 数据）→ 只返回 expiring，不返回其他类型', () => {
  const items = buildProductionLikeItems(); // overfull 0 条
  const result = selectVisibleAlerts(items, ['overfull', 'expiring']);
  assert.equal(result.length, 145);
  assert.ok(result.every((r) => r.alertType === 'expiring'));
});

check('未筛选（空数组 / undefined / null）→ 返回全部真实预警', () => {
  const items = buildProductionLikeItems();
  assert.equal(selectVisibleAlerts(items, []).length, 164);
  assert.equal(selectVisibleAlerts(items, undefined).length, 164);
  assert.equal(selectVisibleAlerts(items, null).length, 164);
});

check('预警列表固定按即将到期、已满额、接近满额、已到期排序', () => {
  const items = [
    { contractId: 'C-near', alertType: 'nearly_full', cityId: 'city-1' },
    { contractId: 'C-over', alertType: 'overfull', cityId: 'city-1' },
    { contractId: 'C-expiring', alertType: 'expiring', cityId: 'city-1' },
    { contractId: 'C-expired', alertType: 'expired', cityId: 'city-1' },
  ];
  assert.deepEqual(selectVisibleAlerts(items, []).map((row) => row.alertType), ['expiring', 'overfull', 'nearly_full', 'expired']);
});

check('none / normal 不进入结果（历史快照残留行）', () => {
  const items = [
    { contractId: 'C-1', alertType: 'none', cityId: 'city-1' },
    { contractId: 'C-2', alertType: 'normal', cityId: 'city-1' },
    { contractId: 'C-3', alertType: 'overfull', cityId: 'city-1' },
  ];
  const result = selectVisibleAlerts(items, []);
  assert.equal(result.length, 1);
  assert.equal(result[0].alertType, 'overfull');
});

check('去重按 contractId + alertType + cityId，不误删同合同不同预警类型', () => {
  const items = [
    { contractId: 'C-1', alertType: 'overfull', cityId: 'city-1' },
    { contractId: 'C-1', alertType: 'overfull', cityId: 'city-1' }, // 完全重复
    { contractId: 'C-1', alertType: 'overfull', cityId: 'city-2' }, // 同合同同类型不同地市 → 保留
    { contractId: 'C-1', alertType: 'expiring', cityId: 'city-1' }, // 同合同不同类型 → 保留
  ];
  const normalized = normalizeAlerts(items);
  assert.equal(normalized.length, 3, '应去重 1 条，保留 3 条');
  // 只按合同编号去重会误删，这里验证不同类型仍在
  assert.equal(normalized.filter((r) => r.alertType === 'expiring').length, 1);
  assert.equal(normalized.filter((r) => r.alertType === 'overfull').length, 2);
});

check('filterAlertsByTypes 严格按枚举匹配，不模糊匹配', () => {
  const items = [
    { contractId: 'C-1', alertType: 'expiring', cityId: 'city-1' },
    { contractId: 'C-2', alertType: 'expired', cityId: 'city-1' },
  ];
  // 'expir' 不是合法枚举，不能命中任何行；中文 label 也不得命中
  assert.equal(filterAlertsByTypes(items, ['expir']).length, 0);
  assert.equal(filterAlertsByTypes(items, ['即将到期']).length, 0);
  assert.equal(filterAlertsByTypes(items, ['expiring']).length, 1);
});

check('alertTypeLabel 映射正确，未知值原样返回', () => {
  assert.equal(alertTypeLabel('overfull'), '已满额/超额');
  assert.equal(alertTypeLabel('expiring'), '即将到期');
  assert.equal(alertTypeLabel('nearly_full'), '接近满额');
  assert.equal(alertTypeLabel('expired'), '已到期');
  assert.equal(alertTypeLabel('weird'), 'weird');
});

check('脏数据防御：items 非数组 / selected 含空值', () => {
  assert.deepEqual(selectVisibleAlerts(undefined, ['overfull']), []);
  assert.deepEqual(selectVisibleAlerts(null, null), []);
  const items = [{ contractId: 'C-1', alertType: 'overfull', cityId: 'city-1' }];
  assert.equal(selectVisibleAlerts(items, ['', null, undefined].filter(Boolean)).length, 1);
  assert.equal(selectVisibleAlerts(items, ['']).length, 1, '空串选中值应视为未筛选');
});

console.log(`\n=== 全部通过：${passed} 项 ===`);
