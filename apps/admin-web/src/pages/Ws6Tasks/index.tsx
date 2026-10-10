import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  InputNumber,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import type { TableColumnsType } from 'antd';
import { CloudUploadOutlined, DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import type {
  ExportJobResponse,
  ImportPreviewResponse,
  RecalcTaskItem,
} from '@biz-reporting/shared-types';
import * as ws6Api from '@/api/ws6.api';
import { listCities } from '@/api/city-estimates.api';

const { Title } = Typography;

const STATUS_LABELS: Record<string, string> = {
  pending: '待处理',
  processing: '处理中',
  completed: '已完成',
  failed: '失败',
};

const COST_CATEGORY_LABELS: Record<string, string> = {
  labor: '人工成本',
  utilities: '水电费',
  fuel: '燃油费',
  entertainment: '招待费',
  rent: '房租',
  reimbursement: '报销',
  other: '其他成本',
};

function statusLabel(value: string): string {
  return STATUS_LABELS[value] ?? '未知状态';
}

function safeDisplayText(value: unknown, fallback: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return text && /[\u4e00-\u9fff]/.test(text) && !/[A-Za-z]/.test(text) ? text : fallback;
}

interface ImportJobState {
  jobId: number;
  status: string;
  type: 'contract' | 'reporting';
  fileName: string;
}

interface ContractPreviewRow {
  contractCode: string;
  contractName: string;
  amount: number;
  rate: number;
  cityCount: number;
  status: string;
}

interface AllocationPreviewRow {
  contractCode: string;
  cityName: string;
  cityContractAmount: number;
  rate: number;
  accumulatedOrderAmount: number;
  accumulatedInvoiceAmount: number;
  estimatedOrderAmount2026: number;
  estimatedIncomeAmount2026: number;
}

interface ReportingMonthlyRow {
  cityName: string;
  contractCode: string;
  contractName: string;
  monthNo: number;
  completionAmount: number;
  acceptanceAmount: number;
  excelRow: number;
}

interface ReportingCostRow {
  cityName: string;
  monthNo: number;
  costCategoryCode: string;
  amount: number;
  excelRow: number;
}

interface PreviewData {
  contracts: ContractPreviewRow[];
  allocations: AllocationPreviewRow[];
  monthlyRows: ReportingMonthlyRow[];
  costRows: ReportingCostRow[];
  errors: string[];
  successCount: number;
  failCount: number;
  validation: {
    isValid: boolean;
    detectedCityNames: string[];
    selectedCityName: string | null;
    blockingErrorCount: number;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function toStringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function formatMoney(value: number): string {
  return value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatRate(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function extractError(error: unknown): string {
  if (isRecord(error)) {
    const response = error.response;
    if (isRecord(response)) {
      const data = response.data;
      if (isRecord(data) && data.message) {
        return safeDisplayText(data.message, '操作失败，请稍后重试');
      }
    }
  }
  return '操作失败，请稍后重试';
}

function normalizeContractRow(value: unknown): ContractPreviewRow | null {
  if (!isRecord(value)) return null;
  return {
    contractCode: toStringValue(value.contractCode),
    contractName: toStringValue(value.contractName),
    amount: toNumber(value.amount),
    rate: toNumber(value.rate),
    cityCount: toNumber(value.cityCount),
    status: toStringValue(value.status),
  };
}

function normalizeAllocationRow(value: unknown): AllocationPreviewRow | null {
  if (!isRecord(value)) return null;
  return {
    contractCode: toStringValue(value.contractCode),
    cityName: toStringValue(value.cityName),
    cityContractAmount: toNumber(value.cityContractAmount),
    rate: toNumber(value.rate),
    accumulatedOrderAmount: toNumber(value.accumulatedOrderAmount),
    accumulatedInvoiceAmount: toNumber(value.accumulatedInvoiceAmount),
    estimatedOrderAmount2026: toNumber(value.estimatedOrderAmount2026),
    estimatedIncomeAmount2026: toNumber(value.estimatedIncomeAmount2026),
  };
}

function normalizeMonthlyRow(value: unknown): ReportingMonthlyRow | null {
  if (!isRecord(value)) return null;
  return {
    cityName: toStringValue(value.cityName),
    contractCode: toStringValue(value.contractCode),
    contractName: toStringValue(value.contractName),
    monthNo: toNumber(value.monthNo),
    completionAmount: toNumber(value.completionAmount),
    acceptanceAmount: toNumber(value.acceptanceAmount),
    excelRow: toNumber(value.excelRow),
  };
}

function normalizeCostRow(value: unknown): ReportingCostRow | null {
  if (!isRecord(value)) return null;
  return {
    cityName: toStringValue(value.cityName),
    monthNo: toNumber(value.monthNo),
    costCategoryCode: toStringValue(value.costCategoryCode),
    amount: toNumber(value.amount),
    excelRow: toNumber(value.excelRow),
  };
}

function normalizePreview(response: ImportPreviewResponse | null): PreviewData | null {
  if (!response || !isRecord(response.parsedSummary)) return null;
  const parsed = response.parsedSummary;
  const errorSummary = isRecord(response.errorSummary) ? response.errorSummary : null;
  const rawErrors = Array.isArray(errorSummary?.errors) ? errorSummary.errors : [];
  const rawValidation = isRecord(parsed.validation) ? parsed.validation : {};
  return {
    contracts: Array.isArray(parsed.contracts) ? parsed.contracts.map(normalizeContractRow).filter((row): row is ContractPreviewRow => row !== null) : [],
    allocations: Array.isArray(parsed.allocations) ? parsed.allocations.map(normalizeAllocationRow).filter((row): row is AllocationPreviewRow => row !== null) : [],
    monthlyRows: Array.isArray(parsed.monthlyRows) ? parsed.monthlyRows.map(normalizeMonthlyRow).filter((row): row is ReportingMonthlyRow => row !== null) : [],
    costRows: Array.isArray(parsed.costRows) ? parsed.costRows.map(normalizeCostRow).filter((row): row is ReportingCostRow => row !== null) : [],
    errors: rawErrors.map(String),
    successCount: toNumber(parsed.successCount),
    failCount: toNumber(parsed.failCount),
    validation: {
      isValid: typeof rawValidation.isValid === 'boolean' ? rawValidation.isValid : rawErrors.length === 0,
      detectedCityNames: Array.isArray(rawValidation.detectedCityNames) ? rawValidation.detectedCityNames.map(String) : [],
      selectedCityName: toStringValue(rawValidation.selectedCityName) || null,
      blockingErrorCount: toNumber(rawValidation.blockingErrorCount) || rawErrors.length,
    },
  };
}

const contractColumns: TableColumnsType<ContractPreviewRow> = [
  { title: '合同编码', dataIndex: 'contractCode', key: 'contractCode', width: 160 },
  { title: '合同名称', dataIndex: 'contractName', key: 'contractName', ellipsis: true },
  { title: '合同金额', dataIndex: 'amount', key: 'amount', width: 140, align: 'right', render: (value: number) => formatMoney(value) },
  { title: '费率', dataIndex: 'rate', key: 'rate', width: 90, align: 'right', render: (value: number) => formatRate(value) },
  { title: '分配城市数', dataIndex: 'cityCount', key: 'cityCount', width: 110, align: 'right' },
];

const allocationColumns: TableColumnsType<AllocationPreviewRow> = [
  { title: '合同编码', dataIndex: 'contractCode', key: 'contractCode', width: 160 },
  { title: '地市', dataIndex: 'cityName', key: 'cityName', width: 90 },
  { title: '城市合同金额', dataIndex: 'cityContractAmount', key: 'cityContractAmount', width: 140, align: 'right', render: (value: number) => formatMoney(value) },
  { title: '费率', dataIndex: 'rate', key: 'rate', width: 90, align: 'right', render: (value: number) => formatRate(value) },
  { title: '累计订单金额', dataIndex: 'accumulatedOrderAmount', key: 'accumulatedOrderAmount', width: 140, align: 'right', render: (value: number) => formatMoney(value) },
  { title: '累计开票金额', dataIndex: 'accumulatedInvoiceAmount', key: 'accumulatedInvoiceAmount', width: 140, align: 'right', render: (value: number) => formatMoney(value) },
  { title: '26年预估订单', dataIndex: 'estimatedOrderAmount2026', key: 'estimatedOrderAmount2026', width: 140, align: 'right', render: (value: number) => formatMoney(value) },
  { title: '26年预计收入', dataIndex: 'estimatedIncomeAmount2026', key: 'estimatedIncomeAmount2026', width: 140, align: 'right', render: (value: number) => formatMoney(value) },
];

const monthlyColumns: TableColumnsType<ReportingMonthlyRow> = [
  { title: '地市', dataIndex: 'cityName', key: 'cityName', width: 90 },
  { title: '月份', dataIndex: 'monthNo', key: 'monthNo', width: 70, align: 'right', render: (value: number) => `${value}月` },
  { title: '合同编码', dataIndex: 'contractCode', key: 'contractCode', width: 160 },
  { title: '合同名称', dataIndex: 'contractName', key: 'contractName', ellipsis: true },
  { title: '立项完工金额', dataIndex: 'completionAmount', key: 'completionAmount', width: 140, align: 'right', render: (value: number) => formatMoney(value) },
  { title: '验收审定金额', dataIndex: 'acceptanceAmount', key: 'acceptanceAmount', width: 140, align: 'right', render: (value: number) => formatMoney(value) },
];

const costColumns: TableColumnsType<ReportingCostRow> = [
  { title: '地市', dataIndex: 'cityName', key: 'cityName', width: 90 },
  { title: '月份', dataIndex: 'monthNo', key: 'monthNo', width: 70, align: 'right', render: (value: number) => `${value}月` },
  { title: '费用类型', dataIndex: 'costCategoryCode', key: 'costCategoryCode', width: 140, render: (value: string) => COST_CATEGORY_LABELS[value] ?? '未知费用类型' },
  { title: '金额', dataIndex: 'amount', key: 'amount', width: 140, align: 'right', render: (value: number) => formatMoney(value) },
  { title: '表格行号', dataIndex: 'excelRow', key: 'excelRow', width: 100, align: 'right' },
];

export default function Ws6Tasks() {
  const [importJob, setImportJob] = useState<ImportJobState | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreviewResponse | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [manualJobId, setManualJobId] = useState<number | null>(null);
  const [reportYear, setReportYear] = useState<number>(new Date().getFullYear());
  const [reportingCityId, setReportingCityId] = useState<number | null>(null);
  const contractFileRef = useRef<HTMLInputElement | null>(null);
  const reportingFileRef = useRef<HTMLInputElement | null>(null);

  const [exportYear, setExportYear] = useState(new Date().getFullYear());
  const [exportMonth, setExportMonth] = useState<number | null>(new Date().getMonth() + 1);
  const [exportMode, setExportMode] = useState<'current_realtime' | 'month_snapshot'>('month_snapshot');
  const [exportResult, setExportResult] = useState<{ jobId: number; status: string } | null>(null);
  const [exportDetail, setExportDetail] = useState<ExportJobResponse | null>(null);
  const [exportLoading, setExportLoading] = useState(false);

  const [recalcItems, setRecalcItems] = useState<RecalcTaskItem[]>([]);
  const [recalcLoading, setRecalcLoading] = useState(false);

  const previewData = normalizePreview(importPreview);
  const citiesQuery = useQuery({ queryKey: ['admin', 'cities'], queryFn: listCities });
  const canConfirm = Boolean(
      importJob &&
      previewData?.validation.isValid &&
      importJob.status === 'pending' &&
      (importJob.type === 'reporting' ? previewData.successCount > 0 : previewData.contracts.length > 0),
    );

  function openFilePicker(ref: React.RefObject<HTMLInputElement | null>) {
    if (!ref.current) return;
    ref.current.value = '';
    ref.current.click();
  }

  async function handleFileSelected(
    event: React.ChangeEvent<HTMLInputElement>,
    type: 'contract' | 'reporting',
  ) {
    const file = event.target.files?.[0];
    if (!file) return;

    setImportLoading(true);
    setImportPreview(null);
    try {
      const result = type === 'contract'
        ? await ws6Api.uploadContracts(file)
        : await ws6Api.uploadReporting(file, type === 'reporting' ? reportingCityId : null);
      const nextJob = { jobId: result.jobId, status: result.status, type, fileName: file.name };
      setImportJob(nextJob);
      setManualJobId(result.jobId);
      message.success(`上传成功，任务编号为 ${result.jobId}`);
      await loadImportPreview(result.jobId, nextJob, type === 'reporting' ? reportingCityId : null);
    } catch (error: unknown) {
      message.error(`上传失败：${extractError(error)}`);
    } finally {
      setImportLoading(false);
    }
  }

  async function loadImportPreview(jobId: number, knownJob?: ImportJobState, cityId?: number | null) {
    setImportLoading(true);
    try {
      const response = await ws6Api.getImportPreview(jobId, cityId ?? reportingCityId);
      setImportPreview(response);
      setImportJob((current) => knownJob ?? current ?? {
        jobId,
        status: response.status,
        type: 'reporting',
        fileName: '',
      });
      message.info(`任务状态：${statusLabel(response.status)}`);
    } catch (error: unknown) {
      message.error(`预览失败：${extractError(error)}`);
    } finally {
      setImportLoading(false);
    }
  }

  async function confirmCurrentImport() {
    if (!importJob) return;
    setImportLoading(true);
    try {
      const result = await ws6Api.confirmImport(importJob.jobId, {
        confirmOverwrite: true,
        cityId: importJob.type === 'reporting' ? reportingCityId : null,
        reportYear: importJob.type === 'reporting' ? reportYear : null,
      });
      if (result.success) {
        message.success(`确认导入成功，任务编号为 ${result.jobId}`);
        setImportJob({ ...importJob, status: 'completed' });
      } else {
        message.warning(`导入未写入数据，请查看错误信息，任务编号为 ${result.jobId}`);
        setImportJob({ ...importJob, status: 'failed' });
      }
      await loadImportPreview(importJob.jobId, importJob);
    } catch (error: unknown) {
      message.error(`确认失败：${extractError(error)}`);
    } finally {
      setImportLoading(false);
    }
  }

  async function handleCreateExport() {
    setExportLoading(true);
    try {
      const result = await ws6Api.createExportJob({
        exportMode,
        scopeType: 'all_cities',
        reportYear: exportYear,
        belongMonth: exportMonth,
        snapshotRange: exportMode === 'month_snapshot' ? 'month_only' : null,
      });
      setExportResult(result);
      message.success(`导出任务创建成功，任务编号为 ${result.jobId}`);
    } catch (error: unknown) {
      message.error(`导出失败：${extractError(error)}`);
    } finally {
      setExportLoading(false);
    }
  }

  async function handleGetExport(jobId: number) {
    try {
      const result = await ws6Api.getExportJob(jobId);
      setExportDetail(result);
    } catch (error: unknown) {
      message.error(`查询失败：${extractError(error)}`);
    }
  }

  async function handleListRecalc() {
    setRecalcLoading(true);
    try {
      const result = await ws6Api.listRecalcTasks();
      setRecalcItems(result.items);
    } catch (error: unknown) {
      message.error(`查询失败：${extractError(error)}`);
    } finally {
      setRecalcLoading(false);
    }
  }

  async function handleRetry(taskId: number) {
    try {
      const result = await ws6Api.retryRecalcTask(taskId);
      message.success(`重试成功，任务编号为 ${result.taskId}`);
      await handleListRecalc();
    } catch (error: unknown) {
      message.error(`重试失败：${extractError(error)}`);
    }
  }

  const recalcColumns: TableColumnsType<RecalcTaskItem> = [
    { title: '任务编号', dataIndex: 'id', key: 'id', width: 100 },
    { title: '类型', dataIndex: 'taskType', key: 'taskType', width: 140, render: () => '数据重算' },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (value: string) => <Tag color={value === 'failed' ? 'red' : value === 'completed' ? 'green' : 'blue'}>{statusLabel(value)}</Tag>,
    },
    { title: '错误信息', dataIndex: 'errorMessage', key: 'errorMessage', ellipsis: true, render: (value: unknown) => value ? safeDisplayText(value, '任务执行失败') : '-' },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 180,
      render: (value: string) => String(value ?? '').slice(0, 19).replace('T', ' '),
    },
    {
      title: '操作',
      key: 'action',
      width: 100,
      render: (_: unknown, row: RecalcTaskItem) =>
        row.status === 'failed' ? <Button size="small" onClick={() => handleRetry(row.id)}>重试</Button> : null,
    },
  ];

  return (
    <div>
      <Title level={4}>任务中心</Title>

      <Card title="导入" style={{ marginBottom: 16 }}>
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Alert
            type="info"
            showIcon
            message="导入只会写入草稿数据"
            description="上传不会立刻改数据；确认导入后才写库。合同导入会更新合同、地市分配和测算指标；报表导入会更新合同月度金额和成本行，不会自动提交，也不会生成快照。"
          />

          <Space wrap>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              ref={contractFileRef}
              style={{ display: 'none' }}
              onChange={(event) => handleFileSelected(event, 'contract')}
            />
            <Button
              icon={<CloudUploadOutlined />}
              loading={importLoading}
              onClick={() => openFilePicker(contractFileRef)}
            >
              上传合同
            </Button>

            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              ref={reportingFileRef}
              style={{ display: 'none' }}
              onChange={(event) => handleFileSelected(event, 'reporting')}
            />
            <Button
              icon={<CloudUploadOutlined />}
              loading={importLoading}
              onClick={() => openFilePicker(reportingFileRef)}
            >
              上传报表
            </Button>
            <Select
              allowClear
              aria-label="报表地市"
              placeholder="自动识别地市"
              style={{ width: 150 }}
              value={reportingCityId ?? undefined}
              loading={citiesQuery.isLoading}
              options={(citiesQuery.data ?? []).map((city) => ({ value: city.id, label: city.name }))}
              onChange={(value) => setReportingCityId(value ?? null)}
            />

            <InputNumber
              min={2000}
              max={2100}
              value={reportYear}
              addonBefore="报表年份"
              onChange={(value) => value && setReportYear(value)}
            />
          </Space>

          <Space wrap>
            <InputNumber
              min={1}
              placeholder="任务编号"
              value={manualJobId}
              onChange={(value) => setManualJobId(value ?? null)}
            />
            <Button disabled={!manualJobId} onClick={() => manualJobId && loadImportPreview(manualJobId, undefined, reportingCityId)}>
              查看预览
            </Button>
            <Button
              type="primary"
              disabled={!canConfirm}
              loading={importLoading}
              onClick={confirmCurrentImport}
            >
              确认导入
            </Button>
          </Space>

          {importJob && (
            <Descriptions size="small" bordered column={4}>
              <Descriptions.Item label="任务编号">{importJob.jobId}</Descriptions.Item>
              <Descriptions.Item label="类型">{importJob.type === 'contract' ? '合同' : '报表'}</Descriptions.Item>
              <Descriptions.Item label="状态"><Tag>{statusLabel(importJob.status)}</Tag></Descriptions.Item>
              <Descriptions.Item label="文件">{importJob.fileName || '-'}</Descriptions.Item>
            </Descriptions>
          )}

          {previewData && (
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              <Descriptions size="small" bordered column={4}>
                <Descriptions.Item label="可写入">{previewData.successCount}</Descriptions.Item>
                <Descriptions.Item label="错误">{previewData.failCount}</Descriptions.Item>
                {importJob?.type === 'contract' ? (
                  <>
                    <Descriptions.Item label="合同">{previewData.contracts.length}</Descriptions.Item>
                    <Descriptions.Item label="分配">{previewData.allocations.length}</Descriptions.Item>
                  </>
                ) : null}
                <Descriptions.Item label="月度行">{previewData.monthlyRows.length}</Descriptions.Item>
                <Descriptions.Item label="费用行">{previewData.costRows.length}</Descriptions.Item>
              </Descriptions>

              {previewData.contracts.length > 0 && (
                <Table
                  title={() => '合同预览'}
                  rowKey={(row) => row.contractCode}
                  size="small"
                  columns={contractColumns}
                  dataSource={previewData.contracts}
                  pagination={{ pageSize: 5 }}
                />
              )}

              {previewData.allocations.length > 0 && (
                <Table
                  title={() => '地市分配预览'}
                  rowKey={(row) => `${row.contractCode}-${row.cityName}`}
                  size="small"
                  columns={allocationColumns}
                  dataSource={previewData.allocations}
                  pagination={{ pageSize: 5 }}
                  scroll={{ x: 1100 }}
                />
              )}

              {previewData.monthlyRows.length > 0 && (
                <Table
                  title={() => '合同月度金额预览'}
                  rowKey={(row) => `${row.cityName}-${row.contractCode}-${row.monthNo}-${row.excelRow}`}
                  size="small"
                  columns={monthlyColumns}
                  dataSource={previewData.monthlyRows}
                  pagination={{ pageSize: 6 }}
                  scroll={{ x: 900 }}
                />
              )}

              {previewData.costRows.length > 0 && (
                <Table
                  title={() => '成本预览'}
                  rowKey={(row) => `${row.cityName}-${row.monthNo}-${row.costCategoryCode}-${row.excelRow}`}
                  size="small"
                  columns={costColumns}
                  dataSource={previewData.costRows}
                  pagination={{ pageSize: 6 }}
                  scroll={{ x: 650 }}
                />
              )}

              {previewData.errors.length > 0 && (
                <Alert
                  type="error"
                  showIcon
                  message="预览存在阻断错误，不能确认导入"
                  description={
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {previewData.errors.slice(0, 20).map((item, index) => <li key={`${item}-${index}`}>{safeDisplayText(item, '文件存在无法识别的问题')}</li>)}
                    </ul>
                  }
                />
              )}
            </Space>
          )}
        </Space>
      </Card>

      <Card title="导出" style={{ marginBottom: 16 }}>
        <Space direction="vertical" style={{ width: '100%' }}>
          <Space wrap>
            <Select
              value={exportMode}
              onChange={setExportMode}
              style={{ width: 180 }}
              options={[
                { value: 'current_realtime', label: '当前实时数据' },
                { value: 'month_snapshot', label: '月度快照数据' },
              ]}
            />
            <InputNumber addonBefore="年" value={exportYear} onChange={(value) => value && setExportYear(value)} min={2020} max={2100} />
            <InputNumber addonBefore="月" value={exportMonth} onChange={(value) => setExportMonth(value ?? null)} min={1} max={12} />
            <Button icon={<DownloadOutlined />} loading={exportLoading} onClick={handleCreateExport}>
              创建导出
            </Button>
          </Space>

          {exportResult && (
            <Descriptions size="small" bordered column={3}>
              <Descriptions.Item label="任务编号">{exportResult.jobId}</Descriptions.Item>
              <Descriptions.Item label="状态"><Tag>{statusLabel(exportResult.status)}</Tag></Descriptions.Item>
              <Descriptions.Item label="操作">
                <Button size="small" onClick={() => handleGetExport(exportResult.jobId)}>刷新详情</Button>
              </Descriptions.Item>
            </Descriptions>
          )}

          {exportDetail && (
            <Descriptions size="small" bordered column={3}>
              <Descriptions.Item label="状态"><Tag>{statusLabel(exportDetail.status)}</Tag></Descriptions.Item>
              <Descriptions.Item label="下载地址">{exportDetail.fileUrl || '-'}</Descriptions.Item>
              <Descriptions.Item label="过期时间">{String(exportDetail.expiresAt ?? '').slice(0, 19).replace('T', ' ') || '-'}</Descriptions.Item>
            </Descriptions>
          )}
        </Space>
      </Card>

      <Card title="重算任务">
        <Space direction="vertical" style={{ width: '100%' }}>
          <Button icon={<ReloadOutlined />} loading={recalcLoading} onClick={handleListRecalc}>刷新列表</Button>
          <Table<RecalcTaskItem>
            rowKey="id"
            columns={recalcColumns}
            dataSource={recalcItems}
            loading={recalcLoading}
            size="small"
            pagination={false}
            locale={{ emptyText: '暂无重算任务' }}
          />
        </Space>
      </Card>
    </div>
  );
}
