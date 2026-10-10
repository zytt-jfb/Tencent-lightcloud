import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Descriptions,
  Drawer,
  Form,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Upload,
  message,
} from 'antd';
import type { TableColumnsType, UploadFile } from 'antd';
import {
  CloseCircleOutlined,
  CloudUploadOutlined,
  EyeOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import { Role } from '@biz-reporting/shared-types';
import type { ImportJobDetail, ImportJobListItem, ImportQualityIssue } from '@biz-reporting/shared-types';
import type { CurrentUser } from '@/types';
import { listAdminCities } from '@/api/cities.api';
import * as importJobsApi from '@/api/import-jobs.api';
import type { ImportJobListParams, ImportJobTypeValue } from '@/api/import-jobs.api';
import './index.css';

const JOB_TYPE_LABELS: Record<string, string> = {
  contract: '合同主数据',
  city_reporting: '经营报表',
  city_cost: '成本数据',
};

const STATUS_META: Record<string, { label: string; color: string }> = {
  pending: { label: '待解析', color: 'default' },
  processing: { label: '解析中', color: 'processing' },
  previewed: { label: '待确认', color: 'warning' },
  completed: { label: '已确认', color: 'success' },
  failed: { label: '失败', color: 'error' },
  cancelled: { label: '已取消', color: 'default' },
};

const ISSUE_TYPE_LABELS: Record<string, string> = {
  template: '模板问题',
  mapping: '映射问题',
  duplicate: '重复数据',
  scope: '范围越界',
  parse: '解析问题',
  validation: '校验问题',
};

interface ImportJobsProps {
  currentUser: CurrentUser;
}

interface UploadFormValue {
  jobType: ImportJobTypeValue;
  reportYear?: number;
  cityId?: number;
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

function statusTag(status: string) {
  const meta = STATUS_META[status] ?? { label: status, color: 'default' };
  return <Tag color={meta.color}>{meta.label}</Tag>;
}

function hasOverwrite(diff: Record<string, unknown> | null): boolean {
  if (!diff) return false;
  return Object.entries(diff).some(([key, value]) =>
    /overwrite|update|replace|覆盖|更新/i.test(key)
      && ((typeof value === 'number' && value > 0) || value === true || (Array.isArray(value) && value.length > 0)),
  );
}

function summaryValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') return String(value);
  if (Array.isArray(value)) return `${value.length} 项`;
  return '结构化结果';
}

function SummaryGrid({ value }: { value: Record<string, unknown> | null }) {
  if (!value) return <Alert type="info" showIcon message="暂无结果" />;
  const entries = Object.entries(value).slice(0, 12);
  return (
    <div className="import-detail__summary-grid">
      {entries.map(([key, item]) => (
        <div className="import-detail__summary-cell" key={key}>
          <span>{key}</span>
          <strong>{summaryValue(item)}</strong>
        </div>
      ))}
    </div>
  );
}

export default function ImportJobs({ currentUser }: ImportJobsProps) {
  const queryClient = useQueryClient();
  const isSystemAdmin = currentUser.role === Role.SYSTEM_ADMIN;
  const [filters, setFilters] = useState<ImportJobListParams>({ page: 1, pageSize: 20 });
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadFiles, setUploadFiles] = useState<UploadFile[]>([]);
  const [uploadForm] = Form.useForm<UploadFormValue>();
  const selectedType = Form.useWatch('jobType', uploadForm);

  const listQuery = useQuery({
    queryKey: ['import-jobs', currentUser.id, isSystemAdmin, filters],
    queryFn: () => importJobsApi.listImportJobs(isSystemAdmin, filters),
  });
  const detailQuery = useQuery({
    queryKey: ['import-job', currentUser.id, isSystemAdmin, selectedJobId],
    queryFn: () => importJobsApi.getImportJob(isSystemAdmin, selectedJobId as number),
    enabled: selectedJobId !== null,
  });
  const citiesQuery = useQuery({
    queryKey: ['admin', 'cities', 'import-jobs', currentUser.id],
    queryFn: listAdminCities,
    enabled: isSystemAdmin,
  });

  async function refreshJob(jobId: number) {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['import-jobs'] }),
      queryClient.invalidateQueries({ queryKey: ['import-job', currentUser.id, isSystemAdmin, jobId] }),
    ]);
  }

  const uploadMutation = useMutation({
    mutationFn: (input: importJobsApi.CreateImportJobInput) => importJobsApi.createImportJob(isSystemAdmin, input),
    onSuccess: async (job) => {
      message.success(`导入任务 #${job.id} 已创建`);
      setUploadOpen(false);
      setUploadFiles([]);
      uploadForm.resetFields();
      setSelectedJobId(job.id);
      await refreshJob(job.id);
    },
  });

  const previewMutation = useMutation({
    mutationFn: (jobId: number) => importJobsApi.previewImportJob(isSystemAdmin, jobId),
    onSuccess: async (_, jobId) => {
      message.success('解析与校验已完成');
      await refreshJob(jobId);
    },
  });

  const confirmMutation = useMutation({
    mutationFn: ({ jobId, overwrite }: { jobId: number; overwrite: boolean }) =>
      importJobsApi.confirmImportJob(isSystemAdmin, jobId, overwrite),
    onSuccess: async (result, input) => {
      message.success(result.alreadyConfirmed ? '该任务已确认，数据库结果未重复写入' : '写入成功，已重新查询数据库状态');
      await refreshJob(input.jobId);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (jobId: number) => importJobsApi.cancelImportJob(isSystemAdmin, jobId),
    onSuccess: async (_, jobId) => {
      message.success('任务已取消');
      await refreshJob(jobId);
    },
  });

  const columns = useMemo<TableColumnsType<ImportJobListItem>>(() => [
    { title: '任务', dataIndex: 'id', width: 76, render: (id: number) => <span className="import-workbench__mono">#{id}</span> },
    { title: '文件', dataIndex: 'sourceFileName', ellipsis: true, render: (value: string | null) => <span className="import-workbench__file" title={value ?? ''}>{value ?? '未命名文件'}</span> },
    { title: '类型', dataIndex: 'jobType', width: 104, render: (value: string) => JOB_TYPE_LABELS[value] ?? value },
    { title: '地市', dataIndex: 'cityName', width: 90, render: (value: string | null) => value ?? '全局' },
    { title: '年度', dataIndex: 'reportYear', width: 74, render: (value: number | null) => value ?? '—' },
    { title: '操作者', dataIndex: 'operatorName', width: 110, render: (value: string | null, row) => value ?? `用户 #${row.operatorUserId}` },
    { title: '状态', dataIndex: 'status', width: 86, render: statusTag },
    { title: '创建时间', dataIndex: 'createdAt', width: 150, render: formatDate },
    { title: '操作', key: 'action', fixed: 'right', width: 92, render: (_, row) => <Button type="link" icon={<EyeOutlined />} onClick={() => setSelectedJobId(row.id)}>查看</Button> },
  ], []);

  const qualityColumns: TableColumnsType<ImportQualityIssue> = [
    { title: '类型', dataIndex: 'issueType', width: 104, render: (value: string) => ISSUE_TYPE_LABELS[value] ?? value },
    { title: '严重程度', dataIndex: 'severity', width: 96, render: () => <Tag color="error">阻塞</Tag> },
    { title: '位置', dataIndex: 'sourceLocation', width: 110 },
    { title: '原始值', dataIndex: 'originalValue', width: 120, ellipsis: true, render: (value: string | null) => value ?? '—' },
    { title: '问题说明', dataIndex: 'description' },
    { title: '建议处理人', dataIndex: 'suggestedOwner', width: 110, render: (value: string) => value === Role.SYSTEM_ADMIN ? '系统管理员' : '地市填报人' },
  ];

  const detail: ImportJobDetail | undefined = detailQuery.data;
  const blocking = detail?.qualityIssues.some((issue) => issue.blocking) ?? false;
  const canProcess = detail?.status === 'pending' || detail?.status === 'previewed';

  function requestConfirm(job: ImportJobDetail) {
    const overwrite = hasOverwrite(job.diffSummary);
    Modal.confirm({
      title: overwrite ? '确认覆盖并写入数据库？' : '确认写入数据库？',
      icon: <SafetyCertificateOutlined />,
      content: overwrite
        ? '差异预览显示现有记录将被覆盖。确认后将执行真实事务写入，并重新查询结果。'
        : '确认后将执行真实事务写入，并重新查询任务与业务数据。',
      okText: overwrite ? '确认覆盖并写入' : '确认写入',
      cancelText: '返回检查',
      onOk: () => confirmMutation.mutateAsync({ jobId: job.id, overwrite }),
    });
  }

  async function submitUpload(values: UploadFormValue) {
    const file = uploadFiles[0]?.originFileObj;
    if (!file) {
      message.error('请选择要上传的 Excel 文件');
      return;
    }
    await uploadMutation.mutateAsync({ ...values, file });
  }

  return (
    <main className="import-workbench">
      <header className="import-workbench__header">
        <div>
          <h2>数据接入工作台</h2>
          <p>上传、解析、质量校验、差异确认与数据库写入使用同一任务链路。</p>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void listQuery.refetch()}>刷新</Button>
          <Button type="primary" icon={<CloudUploadOutlined />} onClick={() => setUploadOpen(true)}>上传文件</Button>
        </Space>
      </header>

      <section className="import-workbench__filters" aria-label="导入任务筛选">
        {isSystemAdmin && (
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="全部地市"
            style={{ width: 150 }}
            options={citiesQuery.data?.filter((city) => !city.isDeleted).map((city) => ({ value: city.id, label: city.name }))}
            onChange={(cityId) => setFilters((value) => ({ ...value, cityId, page: 1 }))}
          />
        )}
        <InputNumber min={2000} max={2100} placeholder="年度" controls={false} onChange={(reportYear) => setFilters((value) => ({ ...value, reportYear: reportYear ?? undefined, page: 1 }))} />
        <Select allowClear placeholder="全部类型" style={{ width: 140 }} options={Object.entries(JOB_TYPE_LABELS).filter(([key]) => isSystemAdmin || key !== 'contract').map(([value, label]) => ({ value, label }))} onChange={(jobType) => setFilters((value) => ({ ...value, jobType, page: 1 }))} />
        <Select allowClear placeholder="全部状态" style={{ width: 130 }} options={Object.entries(STATUS_META).map(([value, meta]) => ({ value, label: meta.label }))} onChange={(status) => setFilters((value) => ({ ...value, status, page: 1 }))} />
      </section>

      <section className="import-workbench__table">
        <Table
          rowKey="id"
          size="small"
          loading={listQuery.isLoading}
          columns={columns}
          dataSource={listQuery.data?.items ?? []}
          scroll={{ x: 1120 }}
          pagination={{
            current: listQuery.data?.page ?? filters.page,
            pageSize: listQuery.data?.pageSize ?? filters.pageSize,
            total: listQuery.data?.total ?? 0,
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 个任务`,
            onChange: (page, pageSize) => setFilters((value) => ({ ...value, page, pageSize })),
          }}
        />
      </section>

      <Modal title="创建导入任务" open={uploadOpen} destroyOnHidden confirmLoading={uploadMutation.isPending} okText="上传并创建任务" cancelText="取消" onCancel={() => { setUploadOpen(false); setUploadFiles([]); }} onOk={() => uploadForm.submit()}>
        <Form form={uploadForm} layout="vertical" initialValues={{ jobType: 'city_reporting', reportYear: 2026 }} onFinish={(values) => void submitUpload(values)}>
          <Form.Item name="jobType" label="任务类型" rules={[{ required: true }]}>
            <Select options={Object.entries(JOB_TYPE_LABELS).filter(([key]) => isSystemAdmin || key !== 'contract').map(([value, label]) => ({ value, label }))} />
          </Form.Item>
          {selectedType !== 'contract' && (
            <>
              {isSystemAdmin && <Form.Item name="cityId" label="目标地市" rules={[{ required: true, message: '请选择目标地市' }]}><Select showSearch optionFilterProp="label" options={citiesQuery.data?.filter((city) => !city.isDeleted).map((city) => ({ value: city.id, label: city.name }))} /></Form.Item>}
              <Form.Item name="reportYear" label="报表年度" rules={[{ required: true }]}><InputNumber min={2000} max={2100} style={{ width: '100%' }} /></Form.Item>
            </>
          )}
          <Form.Item label="源文件" required>
            <Upload.Dragger accept=".xlsx,.xls" maxCount={1} fileList={uploadFiles} beforeUpload={() => false} onChange={({ fileList }) => setUploadFiles(fileList.slice(-1))}>
              <p><CloudUploadOutlined style={{ fontSize: 26, color: '#167a5b' }} /></p>
              <p>选择或拖入 Excel 文件</p>
              <p style={{ color: '#5d6a62', fontSize: 12 }}>文件将在服务端解析，预览确认前不会写入业务表。</p>
            </Upload.Dragger>
          </Form.Item>
        </Form>
      </Modal>

      <Drawer title={detail ? `导入任务 #${detail.id}` : '导入任务'} width={860} open={selectedJobId !== null} onClose={() => setSelectedJobId(null)} loading={detailQuery.isLoading}>
        {detail && (
          <div className="import-detail">
            <Descriptions size="small" bordered column={3} items={[
              { key: 'file', label: '文件', span: 2, children: detail.sourceFileName ?? '未命名文件' },
              { key: 'status', label: '状态', children: statusTag(detail.status) },
              { key: 'type', label: '类型', children: JOB_TYPE_LABELS[detail.jobType] ?? detail.jobType },
              { key: 'city', label: '地市', children: detail.cityName ?? '全局' },
              { key: 'year', label: '年度', children: detail.reportYear ?? '—' },
              { key: 'operator', label: '操作者', children: detail.operatorName ?? `用户 #${detail.operatorUserId}` },
              { key: 'created', label: '创建时间', children: formatDate(detail.createdAt) },
              { key: 'confirmed', label: '确认时间', children: formatDate(detail.confirmedAt) },
            ]} />
            {blocking && <Alert style={{ marginTop: 16 }} type="error" showIcon message={`${detail.qualityIssues.length} 个阻塞性质量问题`} description="当前任务不能确认写入。修复源文件后请重新创建任务。" />}
            <Tabs style={{ marginTop: 12 }} items={[
              { key: 'parsed', label: '解析结果', children: <><SummaryGrid value={detail.parsedSummary} /><pre className="import-detail__json">{JSON.stringify(detail.parsedSummary, null, 2)}</pre></> },
              { key: 'diff', label: '差异预览', children: <><SummaryGrid value={detail.diffSummary} /><pre className="import-detail__json">{JSON.stringify(detail.diffSummary, null, 2)}</pre></> },
              { key: 'issues', label: `质量问题 ${detail.qualityIssues.length ? `(${detail.qualityIssues.length})` : ''}`, children: detail.qualityIssues.length > 0 ? <Table rowKey="id" size="small" pagination={false} columns={qualityColumns} dataSource={detail.qualityIssues} scroll={{ x: 780 }} /> : <Alert type="success" showIcon message="未发现阻塞性质量问题" /> },
            ]} />
            <div className="import-detail__actions">
              <Space>
                {canProcess && <Button icon={<ReloadOutlined />} loading={previewMutation.isPending} onClick={() => previewMutation.mutate(detail.id)}>解析并校验</Button>}
                {detail.status === 'previewed' && <Button type="primary" disabled={blocking} loading={confirmMutation.isPending} onClick={() => requestConfirm(detail)}>确认写入</Button>}
                {canProcess && <Button danger icon={<CloseCircleOutlined />} loading={cancelMutation.isPending} onClick={() => Modal.confirm({ title: '取消该导入任务？', okText: '确认取消', cancelText: '返回', onOk: () => cancelMutation.mutateAsync(detail.id) })}>取消任务</Button>}
              </Space>
            </div>
          </div>
        )}
      </Drawer>
    </main>
  );
}
