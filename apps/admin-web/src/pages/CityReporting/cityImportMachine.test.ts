// 地市端导入向导状态机测试。
// cityImportMachine.ts 仅含 `import type`（运行时擦除），可用 node 原生类型剥离直接运行：
//   cd apps/admin-web && node --test src/pages/CityReporting/cityImportMachine.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cityImportReducer,
  initialCityImportContext,
  canConfirm,
  canUpload,
  previewErrors,
  hasMeaningfulDiff,
  type CityImportContext,
} from './cityImportMachine.ts';

const cleanPreview = { jobId: 10, status: 'previewed', parsedSummary: { successCount: 3 }, diffSummary: null, errorSummary: null };
const errorPreview = { jobId: 10, status: 'previewed', parsedSummary: {}, diffSummary: null, errorSummary: { errors: ['第2行：城市不匹配'] } };
const diffPreview = { jobId: 10, status: 'previewed', parsedSummary: {}, diffSummary: { overwriteCount: 5 }, errorSummary: null };

function run(events, ctx = initialCityImportContext) {
  return events.reduce((acc, ev) => cityImportReducer(acc, ev), ctx);
}

test('初始状态为 idle 且可上传', () => {
  assert.equal(initialCityImportContext.state, 'idle');
  assert.equal(canUpload(initialCityImportContext), true);
  assert.equal(canConfirm(initialCityImportContext), false);
});

test('完整成功链路：upload → preview → ready → confirm → success', () => {
  const afterUploadStart = run([{ type: 'UPLOAD_START', fileName: 'report.xlsx' }]);
  assert.equal(afterUploadStart.selectedFileName, 'report.xlsx');
  assert.equal(afterUploadStart.state, 'uploading');

  const afterUploadOk = cityImportReducer(afterUploadStart, { type: 'UPLOAD_OK', jobId: 10 });
  assert.equal(afterUploadOk.state, 'previewing');
  assert.equal(afterUploadOk.jobId, 10);

  const afterPreview = cityImportReducer(afterUploadOk, { type: 'PREVIEW_OK', preview: cleanPreview });
  assert.equal(afterPreview.state, 'ready_to_confirm');
  assert.equal(canConfirm(afterPreview), true);

  const afterConfirmStart = cityImportReducer(afterPreview, { type: 'CONFIRM_START' });
  assert.equal(afterConfirmStart.state, 'confirming');

  const afterConfirmOk = cityImportReducer(afterConfirmStart, { type: 'CONFIRM_OK' });
  assert.equal(afterConfirmOk.state, 'success');
  assert.equal(afterConfirmOk.jobId, null);
  assert.equal(afterConfirmOk.preview, null);
});

test('上传/预览失败清空 jobId + preview', () => {
  const failed = run([
    { type: 'UPLOAD_START', fileName: 'report.xlsx' },
    { type: 'UPLOAD_OK', jobId: 10 },
    { type: 'UPLOAD_OR_PREVIEW_FAIL', error: '解析失败' },
  ]);
  assert.equal(failed.state, 'failed');
  assert.equal(failed.jobId, null);
  assert.equal(failed.preview, null);
  assert.equal(failed.errorMessage, '解析失败');
});

test('预览含阻断错误时禁止确认', () => {
  const withErrors = run([
    { type: 'UPLOAD_START', fileName: 'report.xlsx' },
    { type: 'UPLOAD_OK', jobId: 10 },
    { type: 'PREVIEW_OK', preview: errorPreview },
  ]);
  assert.equal(withErrors.state, 'ready_to_confirm');
  assert.equal(previewErrors(withErrors.preview).length, 1);
  assert.equal(canConfirm(withErrors), false);
  // CONFIRM_START 被守卫拦截，状态不变
  assert.equal(cityImportReducer(withErrors, { type: 'CONFIRM_START' }).state, 'ready_to_confirm');
});

test('RESET 清空全部上下文（年份/月份/模式/用户变化）', () => {
  const ready = run([
    { type: 'UPLOAD_START', fileName: 'report.xlsx' },
    { type: 'UPLOAD_OK', jobId: 10 },
    { type: 'PREVIEW_OK', preview: cleanPreview },
  ]);
  const reset = cityImportReducer(ready, { type: 'RESET' });
  assert.deepEqual(reset, initialCityImportContext);
});

test('确认失败进入 failed 并清空旧作业，不允许重试旧 jobId', () => {
  const confirming = run([
    { type: 'UPLOAD_START', fileName: 'report.xlsx' },
    { type: 'UPLOAD_OK', jobId: 10 },
    { type: 'PREVIEW_OK', preview: cleanPreview },
    { type: 'CONFIRM_START' },
  ]);
  const failed = cityImportReducer(confirming, { type: 'CONFIRM_FAIL', error: '写入失败' });
  assert.equal(failed.state, 'failed');
  assert.equal(failed.jobId, null);
  assert.equal(failed.preview, null);
  assert.equal(failed.selectedFileName, 'report.xlsx');
  assert.equal(canConfirm(failed), false);
});

test('非法转移被忽略：uploading 状态下再次 UPLOAD_START 无效', () => {
  const uploading: CityImportContext = {
    state: 'uploading',
    jobId: null,
    preview: null,
    errorMessage: null,
    selectedFileName: 'report.xlsx',
  };
  assert.equal(canUpload(uploading), false);
  assert.equal(cityImportReducer(uploading, { type: 'UPLOAD_START', fileName: 'other.xlsx' }).state, 'uploading');
});

test('差异检测：overwriteCount > 0 触发覆盖提示', () => {
  assert.equal(hasMeaningfulDiff(diffPreview), true);
  assert.equal(hasMeaningfulDiff(cleanPreview), false);
  assert.equal(hasMeaningfulDiff(null), false);
});
