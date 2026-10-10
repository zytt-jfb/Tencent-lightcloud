import { useEffect, useReducer, useRef } from 'react';
import { Alert, Button, Card, Descriptions, Modal, Space, Tag, Typography, message } from 'antd';
import { CheckOutlined, CloudUploadOutlined, EyeOutlined } from '@ant-design/icons';
import * as cityImportApi from '@/api/city-import-jobs.api';
import type { CityImportPreviewResponse } from '@/api/city-import-jobs.api';
import {
  canConfirm,
  canUpload,
  cityImportReducer,
  hasMeaningfulDiff,
  initialCityImportContext,
  previewErrors,
} from './cityImportMachine';

const { Text } = Typography;

interface CityImportWizardProps {
  reportYear: number;
  /** 参与上下文清理：月份变化时清空当前作业。 */
  monthNo: number;
  mode: 'report' | 'cost';
  onImported: () => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function previewCount(preview: CityImportPreviewResponse | null, key: string): number {
  if (!preview || !isRecord(preview.parsedSummary)) return 0;
  const value = preview.parsedSummary[key];
  if (Array.isArray(value)) return value.length;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? fallback + '：' + error.message : fallback;
}

const STATUS_TEXT: Record<string, string> = {
  idle: '待上传',
  uploading: '上传中',
  previewing: '预览中',
  ready_to_confirm: '待确认',
  confirming: '导入中',
  success: '已导入',
  failed: '失败',
};

export default function CityImportWizard({ reportYear, monthNo, mode, onImported }: CityImportWizardProps) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [ctx, dispatch] = useReducer(cityImportReducer, initialCityImportContext);

  // 上下文清理（任务7）：年份 / 月份 / 模式变化时清空当前作业。
  // 登录用户变化由 App 层 key=userId 触发整棵子树重挂载，无需在此处理。
  useEffect(() => {
    dispatch({ type: 'RESET' });
  }, [reportYear, monthNo, mode]);

  const errors = previewErrors(ctx.preview);
  const hasDifferences = hasMeaningfulDiff(ctx.preview);
  const busy = ctx.state === 'uploading' || ctx.state === 'previewing' || ctx.state === 'confirming';

  async function handleFile(file: File) {
    dispatch({ type: 'UPLOAD_START', fileName: file.name });
    try {
      const jobType = mode === 'cost' ? 'city_cost' : 'city_reporting';
      const job = await cityImportApi.createCityImportJob(file, jobType, reportYear);
      dispatch({ type: 'UPLOAD_OK', jobId: job.jobId });
      const nextPreview = await cityImportApi.previewCityImportJob(job.jobId);
      dispatch({ type: 'PREVIEW_OK', preview: nextPreview });
      message.success('文件已上传并完成预览');
    } catch (error: unknown) {
      dispatch({ type: 'UPLOAD_OR_PREVIEW_FAIL', error: errorMessage(error, '文件上传或预览失败') });
      message.error(errorMessage(error, '文件上传或预览失败'));
    }
  }

  async function confirm(confirmOverwrite: boolean) {
    if (!canConfirm(ctx) || ctx.jobId === null) return;
    const jobId = ctx.jobId;
    dispatch({ type: 'CONFIRM_START' });
    try {
      const result = await cityImportApi.confirmCityImportJob(jobId, confirmOverwrite);
      if (!result.success) {
        dispatch({ type: 'CONFIRM_FAIL', error: '没有可导入的数据，请先修正文件' });
        message.warning('没有可导入的数据，请先修正文件');
        return;
      }
      dispatch({ type: 'CONFIRM_OK' });
      message.success('文件已确认导入');
      onImported();
    } catch (error: unknown) {
      dispatch({ type: 'CONFIRM_FAIL', error: errorMessage(error, '确认导入失败') });
      message.error(errorMessage(error, '确认导入失败'));
    }
  }

  function requestConfirm() {
    if (!hasDifferences) {
      void confirm(false);
      return;
    }
    Modal.confirm({
      title: '确认覆盖已有数据',
      content: '预览检测到与现有数据存在差异，继续导入将覆盖对应数据。',
      okText: '覆盖并导入',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: () => confirm(true),
    });
  }

  const confirmDisabled = !canConfirm(ctx);

  return (
    <Card
      title={mode === 'cost' ? '成本文件上传' : '报表文件上传'}
      extra={<Text type="secondary">请使用标准报表模板，先预览，确认后写入</Text>}
    >
      <Space wrap>
        <input
          ref={fileRef}
          hidden
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void handleFile(file);
          }}
        />
        <Button
          icon={<CloudUploadOutlined />}
          loading={ctx.state === 'uploading' || ctx.state === 'previewing'}
          disabled={busy || !canUpload(ctx)}
          onClick={() => fileRef.current?.click()}
        >
          {mode === 'cost' ? '选择成本文件' : '选择报表文件'}
        </Button>
        <Tag color={ctx.state === 'failed' ? 'error' : ctx.state === 'success' ? 'green' : 'processing'}>
          {STATUS_TEXT[ctx.state] ?? ctx.state}
        </Tag>
        {ctx.preview && ctx.jobId !== null && (
          <Tag icon={<EyeOutlined />} color={errors.length > 0 ? 'warning' : 'green'}>
            导入任务 #{ctx.jobId} 已预览
          </Tag>
        )}
        <Button
          type="primary"
          icon={<CheckOutlined />}
          loading={ctx.state === 'confirming'}
          disabled={confirmDisabled}
          onClick={requestConfirm}
        >
          确认导入
        </Button>
      </Space>

      {ctx.selectedFileName && (
        <Descriptions style={{ marginTop: 16 }} size="small" column={3} bordered>
          <Descriptions.Item label="文件名">{ctx.selectedFileName}</Descriptions.Item>
          <Descriptions.Item label="作业编号">{ctx.jobId === null ? '-' : `#${ctx.jobId}`}</Descriptions.Item>
          <Descriptions.Item label="当前状态">{STATUS_TEXT[ctx.state] ?? ctx.state}</Descriptions.Item>
        </Descriptions>
      )}

      {ctx.preview && (
        <Descriptions style={{ marginTop: 16 }} size="small" column={3} bordered>
          <Descriptions.Item label="月度行">{previewCount(ctx.preview, 'monthlyRows')}</Descriptions.Item>
          <Descriptions.Item label="成本行">{previewCount(ctx.preview, 'costRows')}</Descriptions.Item>
          <Descriptions.Item label="成功行">{previewCount(ctx.preview, 'successCount')}</Descriptions.Item>
        </Descriptions>
      )}

      {errors.length > 0 && (
        <Alert
          style={{ marginTop: 16 }}
          type="error"
          showIcon
          message="文件存在错误，不能确认导入"
          description={<ul>{errors.slice(0, 10).map((error, index) => <li key={`${error}-${index}`}>{error}</li>)}</ul>}
        />
      )}

      {ctx.state === 'failed' && ctx.errorMessage && errors.length === 0 && (
        <Alert style={{ marginTop: 16 }} type="error" showIcon message={ctx.errorMessage} />
      )}

      {ctx.preview && hasDifferences && (
        <Alert style={{ marginTop: 16 }} type="warning" showIcon message="检测到与现有数据存在差异" />
      )}
    </Card>
  );
}
