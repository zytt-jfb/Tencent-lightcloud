/**
 * 地市端导入向导状态机（纯函数 reducer，可独立单测）。
 *
 * 状态：idle → uploading → previewing → ready_to_confirm → confirming → success
 *                                                    ↘ failed（上传/预览/确认失败）
 *
 * 上下文清理规则（对应任务7）：
 *  - RESET（年份/月份/模式/登录用户变化）：整体回到 idle，清空 jobId + preview + error。
 *  - 上传/预览失败：进入 failed，并清空 jobId + preview（不可基于失效作业确认）。
 *  - 未成功预览（未进入 ready_to_confirm 或预览含阻断错误）时禁止确认。
 */
import type { CityImportPreviewResponse } from '@/api/city-import-jobs.api';

export type CityImportState =
  | 'idle'
  | 'uploading'
  | 'previewing'
  | 'ready_to_confirm'
  | 'confirming'
  | 'success'
  | 'failed';

export interface CityImportContext {
  state: CityImportState;
  jobId: number | null;
  preview: CityImportPreviewResponse | null;
  errorMessage: string | null;
  selectedFileName: string | null;
}

export type CityImportEvent =
  | { type: 'UPLOAD_START'; fileName: string }
  | { type: 'UPLOAD_OK'; jobId: number }
  | { type: 'PREVIEW_OK'; preview: CityImportPreviewResponse }
  | { type: 'UPLOAD_OR_PREVIEW_FAIL'; error: string }
  | { type: 'CONFIRM_START' }
  | { type: 'CONFIRM_OK' }
  | { type: 'CONFIRM_FAIL'; error: string }
  | { type: 'RESET' };

export const initialCityImportContext: CityImportContext = {
  state: 'idle',
  jobId: null,
  preview: null,
  errorMessage: null,
  selectedFileName: null,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** 提取预览中的阻断性错误列表。 */
export function previewErrors(preview: CityImportPreviewResponse | null): string[] {
  if (!preview || !isRecord(preview.errorSummary)) return [];
  const errors = preview.errorSummary.errors;
  return Array.isArray(errors) ? errors.map(String) : [];
}

/** 预览是否检测到需要覆盖的差异。 */
export function hasMeaningfulDiff(preview: CityImportPreviewResponse | null): boolean {
  if (!preview || !isRecord(preview.diffSummary)) return false;
  const overwriteCount = Number(preview.diffSummary.overwriteCount ?? 0);
  return Number.isFinite(overwriteCount) && overwriteCount > 0;
}

/** 是否允许点击“确认导入”：必须已成功预览且无阻断错误。 */
export function canConfirm(ctx: CityImportContext): boolean {
  return (
    ctx.state === 'ready_to_confirm'
    && ctx.jobId !== null
    && ctx.preview !== null
    && previewErrors(ctx.preview).length === 0
  );
}

/** 是否允许发起上传（空闲/成功/失败/已就绪均可重新上传）。 */
export function canUpload(ctx: CityImportContext): boolean {
  return ctx.state === 'idle'
    || ctx.state === 'success'
    || ctx.state === 'failed'
    || ctx.state === 'ready_to_confirm';
}

export function cityImportReducer(
  ctx: CityImportContext,
  event: CityImportEvent,
): CityImportContext {
  switch (event.type) {
    case 'RESET':
      return { ...initialCityImportContext };

    case 'UPLOAD_START':
      if (!canUpload(ctx)) return ctx;
      return {
        state: 'uploading',
        jobId: null,
        preview: null,
        errorMessage: null,
        selectedFileName: event.fileName,
      };

    case 'UPLOAD_OK':
      if (ctx.state !== 'uploading') return ctx;
      return { ...ctx, state: 'previewing', jobId: event.jobId, preview: null, errorMessage: null };

    case 'PREVIEW_OK':
      if (ctx.state !== 'previewing') return ctx;
      return { ...ctx, state: 'ready_to_confirm', preview: event.preview, errorMessage: null };

    case 'UPLOAD_OR_PREVIEW_FAIL':
      if (ctx.state !== 'uploading' && ctx.state !== 'previewing') return ctx;
      // 关键：上传/预览失败清空 jobId + preview，避免基于失效作业确认。
      return { ...ctx, state: 'failed', jobId: null, preview: null, errorMessage: event.error };

    case 'CONFIRM_START':
      if (!canConfirm(ctx)) return ctx;
      return { ...ctx, state: 'confirming', errorMessage: null };

    case 'CONFIRM_OK':
      if (ctx.state !== 'confirming') return ctx;
      return { ...initialCityImportContext, state: 'success' };

    case 'CONFIRM_FAIL':
      if (ctx.state !== 'confirming') return ctx;
      // 确认失败后旧作业不可继续使用；保留文件名仅用于解释失败来源。
      return {
        state: 'failed',
        jobId: null,
        preview: null,
        errorMessage: event.error,
        selectedFileName: ctx.selectedFileName,
      };

    default:
      return ctx;
  }
}
