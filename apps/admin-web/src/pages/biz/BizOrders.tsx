import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBizPermission } from '@/utils/biz-permission';
import { Badge, Button, Card, Drawer, Form, Input, Modal, Progress, Select, Space, Spin, Table, Tag, Typography, Upload, message } from 'antd';
import { DownloadOutlined, InboxOutlined, ReloadOutlined, UploadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { exportPageRows } from '@/utils/page-export-core';
import {
  bizAdminCities, bizAdminProvinces, bizContractList, bizMe, bizOrderBatches, bizOrderBatchDetail, bizOrderBatchDelete, bizOrderUpload, bizOrderRows, bizOrderRowMaintain, bizOrderReviewExport,
} from '@/api/biz.api';

const { Title } = Typography;

const BATCH_STATUS: Record<string, { label: string; color: string }> = {
  parsing: { label: '解析中', color: 'processing' },
  imported: { label: '已导入', color: 'success' },
  failed: { label: '导入失败', color: 'error' },
  voided: { label: '已作废', color: 'default' },
};


/** 显示层月份统一 yyyy年mm月（数据库/接口保留 YYYY-MM） */
function formatMonth(v: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})$/.exec(String(v ?? ''));
  return m ? `${m[1]}年${m[2]}月` : (v ?? '-');
}

function fenToYuan(fen: number | null): string {
  if (fen === null || fen === undefined) return '-';
  return (fen / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** 订单管理（新基线 M4）：上传/批次/错误报告/订单行（敏感列脱敏） */
export default function BizOrders() {
  const navigate = useNavigate();
  const canUpload = useBizPermission('operation.order.upload');
  const [batches, setBatches] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<{ batch: Record<string, unknown>; errors: Array<Record<string, unknown>>; rowCount: number } | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [overrunFilter, setOverrunFilter] = useState<string | undefined>();
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [rowTotal, setRowTotal] = useState(0);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState('');
  const [previewRows, setPreviewRows] = useState<Array<Record<string, unknown>>>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewBatchId, setPreviewBatchId] = useState<string | null>(null);
  const [previewFilter, setPreviewFilter] = useState<'all' | 'valid' | 'needs_review'>('all');
  const [previewPage, setPreviewPage] = useState(1);
  const [previewTotal, setPreviewTotal] = useState(0);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<Record<string, unknown> | null>(null);
  const [provinceOptions, setProvinceOptions] = useState<Array<{ label: string; value: string }>>([]);
  const [cityOptions, setCityOptions] = useState<Array<{ label: string; value: string }>>([]);
  const [contractOptions, setContractOptions] = useState<Array<{ label: string; value: string }>>([]);
  const [editForm] = Form.useForm();
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  // 页面级权限保护：无上传权限的账号直接跳回经营管理，避免停留在无意义页面。
  // canUpload === null 时保持加载态，防止权限判定前闪现订单内容。
  useEffect(() => {
    if (canUpload === false) navigate('/biz/operation', { replace: true });
  }, [canUpload, navigate]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await bizOrderBatches();
      setBatches(data.items);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (canUpload !== true) return;
    void load();
  }, [load, canUpload]);

  const loadRows = useCallback(async () => {
    setRowsLoading(true);
    try {
      const data = await bizOrderRows(overrunFilter ? { overrun: overrunFilter as 'city' | 'contract' | 'any' } : {});
      setRows(data.items);
      setRowTotal(data.total);
    } finally {
      setRowsLoading(false);
    }
  }, [overrunFilter]);

  const exportRows = async () => {
    const first = await bizOrderRows({ ...(overrunFilter ? { overrun: overrunFilter as 'city' | 'contract' | 'any' } : {}), page: 1, pageSize: 500 });
    const pages = await Promise.all(Array.from({ length: Math.ceil(first.total / first.pageSize) - 1 }, (_, index) => bizOrderRows({ ...(overrunFilter ? { overrun: overrunFilter as 'city' | 'contract' | 'any' } : {}), page: index + 2, pageSize: first.pageSize })));
    const allRows = [first.items, ...pages.map((page) => page.items)].flat();
    exportPageRows('订单管理', allRows, overrunFilter || '当前有效订单');
  };

  useEffect(() => {
    if (canUpload !== true) return;
    void loadRows();
  }, [loadRows, canUpload]);

  useEffect(() => {
    if (canUpload !== true) return;
    void bizMe().then((me) => setIsSuperAdmin(me.roleCode === 'super_admin')).catch(() => setIsSuperAdmin(false));
  }, [canUpload]);

  if (canUpload !== true) {
    return (
      <div style={{ minHeight: 240, display: 'grid', placeItems: 'center' }}>
        <Spin tip={canUpload === false ? '当前账号无订单上传权限，正在返回…' : '正在加载权限…'}>
          <div style={{ minHeight: 120, minWidth: 240 }} />
        </Spin>
      </div>
    );
  }

  const onUpload = async (file: File) => {
    const idempotencyKey = `up-${dayjs().format('YYYYMMDDHHmmss')}-${Math.random().toString(36).slice(2, 10)}`;
    setUploading(true);
    setUploadProgress(10);
    setUploadStatus('正在上传文件');
    try {
      const result = await bizOrderUpload(file, idempotencyKey, (percent) => {
        setUploadProgress(Math.max(10, Math.round(percent * 0.35)));
        setUploadStatus(`正在上传文件 ${percent}%`);
      });
      setUploadProgress(35);
      setUploadStatus('文件已提交，正在解析');
      const deadline = Date.now() + 30 * 60_000;
      let batchStatus = result.status;
      while (batchStatus === 'parsing' && Date.now() < deadline) {
        await new Promise((resolve) => window.setTimeout(resolve, 700));
        const batch = await bizOrderBatchDetail(result.batchId);
        batchStatus = String(batch.batch.status);
        setUploadProgress((value) => Math.min(92, Math.max(value + 6, 48)));
      }
      if (batchStatus !== 'imported') {
        const batch = await bizOrderBatchDetail(result.batchId);
        throw new Error(String(batch.batch.failureReason ?? '订单解析失败'));
      }
      setUploadProgress(100);
      setUploadStatus('解析完成，正在生成预览');
      const batchDetail = await bizOrderBatchDetail(result.batchId);
      setDetail(batchDetail);
      setPreviewBatchId(result.batchId);
      setPreviewFilter('all');
      const parsedRows = await bizOrderRows({ batchId: result.batchId, page: 1, pageSize: 20 });
      setPreviewRows(parsedRows.items);
      setPreviewPage(parsedRows.page);
      setPreviewTotal(parsedRows.total);
      setPreviewOpen(true);
      const reviewCount = Number(batchDetail.batch.totalRows) - Number(batchDetail.batch.importedRows);
      message.success(reviewCount > 0
        ? `已保存 ${batchDetail.batch.totalRows} 行，其中 ${reviewCount} 行待维护`
        : `已导入 ${batchDetail.batch.totalRows} 条订单`);
      void load();
      void loadRows();
    } catch (e: unknown) {
      const detailMsg = (e as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
      message.error(Array.isArray(detailMsg) ? detailMsg.join('；') : (detailMsg ?? (e instanceof Error ? e.message : '上传失败')));
      setUploadStatus('上传或解析失败');
    } finally {
      window.setTimeout(() => {
        setUploading(false);
        setUploadProgress(0);
        setUploadStatus('');
      }, 900);
    }
    return false;
  };

  const openDetail = async (id: string) => {
    setDetailOpen(true);
    try {
      const d = await bizOrderBatchDetail(id);
      setDetail(d);
    } catch {
      message.error('批次详情加载失败');
    }
  };

  const onDeleteBatch = (id: string) => {
    Modal.confirm({
      title: '删除上传记录',
      content: '将永久删除该上传记录、本批订单行和错误明细。此操作不可恢复。',
      okText: '确认删除',
      okButtonProps: { danger: true },
      onOk: async () => {
        await bizOrderBatchDelete(id);
        message.success('上传记录已删除');
        await load();
        await loadRows();
      },
    });
  };

  const downloadReview = async (id: string) => {
    try {
      const blob = await bizOrderReviewExport(id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `订单待维护-${id.slice(0, 8)}.xlsx`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error: unknown) {
      const detailMsg = (error as { response?: { data?: { message?: string } } }).response?.data?.message;
      message.error(detailMsg ?? '待维护订单下载失败');
    }
  };

  const onCorrectionUpload = async (file: File, sourceBatchId: string) => {
    setUploading(true);
    try {
      const result = await bizOrderUpload(file, `correction-${sourceBatchId}-${Date.now()}`, undefined, sourceBatchId);
      message.success(`修正上传已提交：${result.batchId.slice(0, 8)}`);
      void load();
    } catch (error: unknown) {
      const detailMsg = (error as { response?: { data?: { message?: string } } }).response?.data?.message;
      message.error(detailMsg ?? '修正文件上传失败');
    } finally {
      setUploading(false);
    }
    return false;
  };

  const openMaintenance = async (id: string) => {
    setPreviewLoading(true);
    try {
      const [batchDetail, pendingRows] = await Promise.all([
        bizOrderBatchDetail(id),
        bizOrderRows({ batchId: id, validationStatus: 'needs_review', page: 1, pageSize: 20 }),
      ]);
      setDetail(batchDetail);
      setPreviewBatchId(id);
      setPreviewFilter('needs_review');
      setPreviewRows(pendingRows.items);
      setPreviewPage(pendingRows.page);
      setPreviewTotal(pendingRows.total);
      setPreviewOpen(true);
    } catch {
      message.error('待维护数据加载失败');
    } finally {
      setPreviewLoading(false);
    }
  };

  const loadPreviewRows = async (filter: 'all' | 'valid' | 'needs_review' = previewFilter, page = previewPage) => {
    if (!previewBatchId) return;
    setPreviewLoading(true);
    try {
      const result = await bizOrderRows({ batchId: previewBatchId, page, pageSize: 20, ...(filter === 'all' ? {} : { validationStatus: filter }) });
      setPreviewRows(result.items);
      setPreviewPage(result.page);
      setPreviewTotal(result.total);
    } finally {
      setPreviewLoading(false);
    }
  };

  const openRowEditor = async (row: Record<string, unknown>) => {
    setEditingRow(row);
    const provinceId = String(row.provinceId ?? '');
    editForm.setFieldsValue({
      provinceId, cityId: String(row.cityId ?? ''), contractId: String(row.contractId ?? ''),
      businessMonth: String(row.businessMonth ?? ''),
      feeRateSnapshotBp: row.feeRateSnapshotBp == null ? undefined : Number(row.feeRateSnapshotBp), reason: '',
    });
    setEditOpen(true);
    try {
      const provinces = await bizAdminProvinces();
      setProvinceOptions(provinces.items.map((item) => ({ label: item.name, value: item.id })));
      const [cities, contracts] = await Promise.all([
        bizAdminCities(provinceId || undefined),
        bizContractList(provinceId ? { provinceId } : undefined),
      ]);
      setCityOptions(cities.items.map((item) => ({ label: item.name, value: item.id })));
      setContractOptions(contracts.items.map((item) => ({ label: `${item.contractNo} ${item.contractName}`, value: item.id })));
    } catch {
      message.error('参考数据加载失败');
    }
  };

  const onProvinceChange = async (provinceId: string) => {
    editForm.setFieldsValue({ cityId: undefined, contractId: undefined });
    const [cities, contracts] = await Promise.all([
      bizAdminCities(provinceId), bizContractList({ provinceId }),
    ]);
    setCityOptions(cities.items.map((item) => ({ label: item.name, value: item.id })));
    setContractOptions(contracts.items.map((item) => ({ label: `${item.contractNo} ${item.contractName}`, value: item.id })));
  };

  const onMaintain = async (values: { provinceId: string; cityId: string; contractId: string; businessMonth: string; feeRateSnapshotBp?: number; reason?: string }) => {
    if (!editingRow || !previewBatchId) return;
    await bizOrderRowMaintain(String(editingRow.id), values);
    message.success('订单行已重新校验');
    setEditOpen(false);
    const current = await bizOrderBatchDetail(previewBatchId);
    setDetail(current);
    await loadPreviewRows(previewFilter, previewPage);
    void loadRows();
  };

  const columns = [
    { title: '生效状态', dataIndex: 'lifecycleStatus', key: 'lifecycleStatus', render: (v: string) => <Tag color={v === 'current' ? 'green' : 'default'}>{v === 'current' ? '当前生效' : '历史批次'}</Tag> },
    { title: '文件名', dataIndex: 'filename', key: 'filename', ellipsis: true },
    { title: '状态', dataIndex: 'status', key: 'status', render: (v: string) => { const s = BATCH_STATUS[v] ?? { label: v, color: 'default' }; return <Badge status={s.color as 'success' | 'processing' | 'error' | 'default'} text={s.label} />; } },
    { title: '总行数', dataIndex: 'totalRows', key: 'totalRows' },
    { title: '入账行数', dataIndex: 'importedRows', key: 'importedRows' },
    { title: '上传人', dataIndex: 'uploadedBy', key: 'uploadedBy', render: (v: string) => v ?? '-' },
    { title: '上传时间', dataIndex: 'uploadedAt', key: 'uploadedAt', render: (v: string) => v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-' },
    { title: '导入说明', dataIndex: 'failureReason', key: 'failureReason', ellipsis: true, render: (v: string | null) => v ? <Tag color="orange">{v.slice(0, 40)}</Tag> : '-' },
    {
      title: '操作', key: 'action', width: 220,
      render: (_: unknown, row: Record<string, unknown>) => (
        <Space wrap>
          <Button size="small" onClick={() => openDetail(String(row.id))}>详情</Button>
          {row.status === 'imported' && String(row.failureReason ?? '').includes('待维护') && (<>
            <Button size="small" type="primary" onClick={() => void openMaintenance(String(row.id))}>待维护</Button>
            <Button size="small" icon={<DownloadOutlined />} onClick={() => void downloadReview(String(row.id))}>下载</Button>
            <Upload beforeUpload={(file) => onCorrectionUpload(file, String(row.id))} accept=".xlsx" showUploadList={false} disabled={uploading}><Button size="small" icon={<UploadOutlined />}>上传修正</Button></Upload>
          </>)}
          {isSuperAdmin && <Button size="small" danger onClick={() => onDeleteBatch(String(row.id))}>删除</Button>}
        </Space>
      ),
    },
  ];

  const rowColumns = [
    { title: '行号', dataIndex: 'sourceRowNo', key: 'sourceRowNo', width: 70 },
    { title: '采购订单编号', dataIndex: 'purchaseOrderNo', key: 'purchaseOrderNo', width: 130 },
    { title: '合同编号', dataIndex: 'contractNo', key: 'contractNo', width: 170, render: (v: string | null) => v ?? '-' },
    { title: '合同名称', dataIndex: 'contractName', key: 'contractName', width: 260, ellipsis: true, render: (v: string | null) => v ?? '-' },
    { title: '地市', dataIndex: 'cityName', key: 'cityName', width: 90 },
    { title: '业务月份', dataIndex: 'businessMonth', key: 'businessMonth', width: 110, render: (v: string) => formatMonth(v) },
    { title: '含税金额（元）', dataIndex: 'completionAmountFen', key: 'completionAmountFen', render: (v: number | null) => <span style={{ color: Number(v) < 0 ? '#c64b4b' : undefined }}>{fenToYuan(v)}</span> },
    { title: '费率快照', dataIndex: 'feeRateSnapshotBp', key: 'feeRateSnapshotBp', render: (v: number | null) => v != null ? `${(v / 100).toFixed(2)}%` : '-' },
    { title: '毛利润（元）', dataIndex: 'grossProfitFen', key: 'grossProfitFen', render: (v: number | null) => fenToYuan(v) },
    { title: '收货人电话', dataIndex: 'receiverPhone', key: 'receiverPhone' },
    { title: '收货地址', dataIndex: 'receiverAddress', key: 'receiverAddress', ellipsis: true },
    { title: '状态', key: 'status', render: (_: unknown, row: Record<string, unknown>) => {
      if (row.isVoid) return <Tag color="red">已作废</Tag>;
      return row.validationStatus === 'needs_review'
        ? <Tag color="orange" title={String(row.validationError ?? '')}>待维护</Tag>
        : <Tag color="green">有效</Tag>;
    } },
  ];

  return (
    <div className="v3-content">
      <div className="v3-page-head">
        <div className="v3-page-titles">
          <Title level={4} style={{ margin: 0 }}>订单管理</Title>
        </div>
        <Space className="v3-page-head-actions" wrap>
          <Select
            allowClear placeholder="超额筛选" style={{ width: 150 }} value={overrunFilter}
            onChange={(v) => setOverrunFilter(v)}
            options={[
              { value: 'city', label: '超地市额度' },
              { value: 'contract', label: '超合同额' },
              { value: 'any', label: '任一超额' },
            ]}
          />
          <Button icon={<ReloadOutlined />} onClick={() => { void load(); void loadRows(); }}>刷新</Button>
          <Button icon={<DownloadOutlined />} disabled={!rowTotal} onClick={() => void exportRows()}>导出 Excel</Button>
          <Button onClick={() => navigate('/biz/operation')}>返回合同管理</Button>
        </Space>
      </div>

      <Card title="上传订单全量总表（.xlsx，≤50MB，≤30 万行，单工作表）" style={{ marginBottom: 16 }}>
        <Upload.Dragger
          accept=".xlsx"
          beforeUpload={onUpload}
          maxCount={1}
          showUploadList={false}
          disabled={uploading}
        >
          <p className="ant-upload-drag-icon"><InboxOutlined /></p>
          <p className="ant-upload-text">点击或拖拽 .xlsx 文件到此处上传</p>
          <p className="ant-upload-hint">导入成功后替换当前订单；历史批次保留用于追溯，无法识别的行标记为待维护</p>
        </Upload.Dragger>
        {uploading && <Progress percent={uploadProgress} status="active" format={() => uploadStatus} style={{ marginTop: 16 }} />}
      </Card>

      <Card title="导入批次" style={{ marginBottom: 16 }}>
        <Table scroll={{ x: "max-content" }}  rowKey="id" size="small" loading={loading} columns={columns} dataSource={batches} pagination={{ pageSize: 8 }} />
      </Card>

      <Card title={`订单行（共 ${rows.length} 条展示）`}>
        <Table scroll={{ x: "max-content" }}  rowKey="id" size="small" loading={rowsLoading} columns={rowColumns} dataSource={rows} pagination={{ pageSize: 10 }} />
      </Card>

      <Drawer title="批次详情" open={detailOpen} onClose={() => setDetailOpen(false)} width={720}>
        {detail && (
          <div>
            <p><b>文件：</b>{String(detail.batch.filename)}</p>
            <p><b>状态：</b>{BATCH_STATUS[String(detail.batch.status)]?.label ?? detail.batch.status}（{String(detail.rowCount)} 行入库）</p>
            {detail.batch.failureReason ? <p><b>导入说明：</b>{String(detail.batch.failureReason)}</p> : null}
            {detail.batch.status === 'imported' && String(detail.batch.failureReason ?? '').includes('待维护') && (
              <>
                <Button type="primary" onClick={() => { setDetailOpen(false); void openMaintenance(String(detail.batch.id)); }} style={{ marginBottom: 12 }}>
                  进入待维护
                </Button>
                <Space style={{ marginBottom: 12 }}><Button icon={<DownloadOutlined />} onClick={() => void downloadReview(String(detail.batch.id))}>下载待维护订单</Button><Upload beforeUpload={(file) => onCorrectionUpload(file, String(detail.batch.id))} accept=".xlsx" showUploadList={false} disabled={uploading}><Button icon={<UploadOutlined />}>上传修正文件</Button></Upload></Space>
              </>
            )}
            {detail.errors.length > 0 && (
              <>
                <p><b>错误报告（{detail.errors.length} 条，最多展示 100 条）：</b></p>
                <Table scroll={{ x: "max-content" }} 
                  size="small" rowKey="id" pagination={false}
                  dataSource={detail.errors.slice(0, 100)}
                  columns={[
                    { title: '行号', dataIndex: 'rowNo', key: 'rowNo', width: 70, render: (v: number | null) => v ?? '-' },
                    { title: '类型', dataIndex: 'errorType', key: 'errorType', width: 90 },
                    { title: '字段', dataIndex: 'field', key: 'field', width: 110, render: (v: string | null) => v ?? '-' },
                    { title: '说明', dataIndex: 'message', key: 'message' },
                  ]}
                />
              </>
            )}
          </div>
        )}
      </Drawer>

      {false && <Space wrap style={{ marginBottom: 12 }}>
        <Tag color="blue">总行数 {detail?.rowCount ?? 0}</Tag>
        <Tag color="green">有效 {Math.max(0, (detail?.rowCount ?? 0) - new Set(detail?.errors.map((error) => String(error.rowNo)).filter((rowNo) => rowNo !== 'null')).size)}</Tag>
        <Tag color="orange">待维护 {new Set(detail?.errors.map((error) => String(error.rowNo)).filter((rowNo) => rowNo !== 'null')).size}</Tag>
        <Select value={previewFilter} style={{ width: 150 }} options={[{ value: 'all', label: '全部行' }, { value: 'valid', label: '仅有效' }, { value: 'needs_review', label: '仅待维护' }]} onChange={(value: 'all' | 'valid' | 'needs_review') => { setPreviewFilter(value); setPreviewPage(1); void loadPreviewRows(value, 1); }} />
      </Space>}

      <Modal title="订单解析预览" open={previewOpen} onCancel={() => setPreviewOpen(false)} footer={<Button type="primary" onClick={() => setPreviewOpen(false)}>关闭</Button>} width={980}>
        <Space wrap style={{ marginBottom: 12 }}>
          <Tag color="blue">总行数 {detail?.rowCount ?? 0}</Tag>
          <Tag color="green">有效 {Math.max(0, (detail?.rowCount ?? 0) - new Set(detail?.errors.map((error) => String(error.rowNo)).filter((rowNo) => rowNo !== 'null')).size)}</Tag>
          <Tag color="orange">待维护 {new Set(detail?.errors.map((error) => String(error.rowNo)).filter((rowNo) => rowNo !== 'null')).size}</Tag>
          <Select value={previewFilter} style={{ width: 150 }} options={[{ value: 'all', label: '全部行' }, { value: 'valid', label: '仅有效' }, { value: 'needs_review', label: '仅待维护' }]} onChange={(value: 'all' | 'valid' | 'needs_review') => { setPreviewFilter(value); setPreviewPage(1); void loadPreviewRows(value, 1); }} />
        </Space>
        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>点击待维护行可修改标准化信息并重新校验。</Typography.Text>
        <Table
          scroll={{ x: 'max-content' }}
          size="small"
          rowKey="id"
          pagination={{ current: previewPage, pageSize: 20, total: previewTotal, showSizeChanger: false, onChange: (page) => { void loadPreviewRows(previewFilter, page); } }}
          dataSource={previewRows}
          loading={previewLoading}
          onRow={(row) => row.validationStatus === 'needs_review' ? { onClick: () => void openRowEditor(row), style: { cursor: 'pointer' } } : {}}
          columns={[
            { title: '采购订单编号', dataIndex: 'purchaseOrderNo', key: 'purchaseOrderNo' },
            { title: '地市', dataIndex: 'cityName', key: 'cityName' },
            { title: '业务月份', dataIndex: 'businessMonth', key: 'businessMonth', render: (value: string) => formatMonth(value) },
            { title: '含税金额（元）', dataIndex: 'completionAmountFen', key: 'completionAmountFen', render: (value: number | null) => fenToYuan(value) },
            { title: '项目名称', dataIndex: 'projectName', key: 'projectName', ellipsis: true },
            { title: '状态', key: 'validationStatus', render: (_: unknown, row: Record<string, unknown>) => row.validationStatus === 'needs_review' ? <Tag color="orange">待维护</Tag> : <Tag color="green">有效</Tag> },
            { title: '待维护原因', dataIndex: 'validationError', key: 'validationError', width: 300, render: (value: string | null) => value ?? '-' },
          ]}
        />
      </Modal>

      <Modal title="修正订单标准化信息" open={editOpen} onCancel={() => setEditOpen(false)} onOk={() => void editForm.submit()} okText="保存并重新校验" width={520}>
        <Form form={editForm} layout="vertical" onFinish={(values) => void onMaintain(values)}>
          <Form.Item name="provinceId" label="省份" rules={[{ required: true, message: '请选择省份' }]}><Select options={provinceOptions} onChange={(value) => void onProvinceChange(value)} /></Form.Item>
          <Form.Item name="cityId" label="地市" rules={[{ required: true, message: '请选择地市' }]}><Select options={cityOptions} /></Form.Item>
          <Form.Item name="contractId" label="合同" rules={[{ required: true, message: '请选择合同' }]}><Select showSearch optionFilterProp="label" options={contractOptions} /></Form.Item>
          <Form.Item name="businessMonth" label="业务月份" rules={[{ required: true, pattern: /^\d{4}-(0[1-9]|1[0-2])$/, message: '格式应为 YYYY-MM' }]}><Input placeholder="YYYY-MM" /></Form.Item>
          <Form.Item name="feeRateSnapshotBp" label="管理费率（基点，可留空自动取合同费率）"><Input type="number" min={1} max={10000} /></Form.Item>
          <Form.Item name="reason" label="修正说明"><Input.TextArea maxLength={255} rows={3} /></Form.Item>
          <Typography.Text type="secondary">Excel 原始字段保持不变，本次仅修正标准化关联信息。</Typography.Text>
        </Form>
      </Modal>
    </div>
  );
}
