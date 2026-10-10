import { useEffect, useMemo, useState } from 'react';
import { Button, Card, DatePicker, Drawer, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Tag, Typography, Upload, message } from 'antd';
import { CloudUploadOutlined, DownloadOutlined, EditOutlined, PlusOutlined, RollbackOutlined } from '@ant-design/icons';
import type { ColumnsType, TablePaginationConfig } from 'antd/es/table';
import type { UploadFile } from 'antd';
import type { CostFactItem, FactImportResult, LocalContractItem } from '@biz-reporting/shared-types';
import dayjs from 'dayjs';
import { useSearchParams } from 'react-router-dom';
import { factsApi } from '@/api/facts.api';
import { exportPageWorkbook, PAGE_EXPORT_ROW_LIMIT } from '@/utils/page-export';
import { getFactVersionConflict } from '@/utils/fact-conflict';
import { showRequestError } from '@/utils/request';

const { Title, Text } = Typography;
const categoryOptions = [
  ['labor', '人工'], ['utilities', '水电'], ['fuel', '油补'], ['entertainment', '招待'], ['rent', '房租'], ['reimbursement', '报销'], ['other', '其他'],
].map(([value, label]) => ({ value, label }));
const money = (value: number) => Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function CityCosts() {
  const [searchParams, setSearchParams] = useSearchParams();
  const year = Number(searchParams.get('year') || dayjs().year());
  const month = searchParams.get('month') ? Number(searchParams.get('month')) : undefined;
  const category = searchParams.get('costCategory') || undefined;
  const [items, setItems] = useState<CostFactItem[]>([]); const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1); const [loading, setLoading] = useState(false);
  const [contracts, setContracts] = useState<LocalContractItem[]>([]);
  const [editing, setEditing] = useState<CostFactItem | null>(); const [form] = Form.useForm();
  const [importOpen, setImportOpen] = useState(false); const [files, setFiles] = useState<UploadFile[]>([]);
  const [importResult, setImportResult] = useState<FactImportResult | null>(null); const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importForm] = Form.useForm();

  const query = useMemo(() => ({ year, month, costCategory: category, page, pageSize: 20 }), [year, month, category, page]);
  const load = () => { setLoading(true); void factsApi.listCosts(query).then((data) => { setItems(data.items); setTotal(data.total); }).catch((error) => showRequestError(error, '成本数据加载失败')).finally(() => setLoading(false)); };
  useEffect(load, [query]);
  useEffect(() => { void factsApi.localContracts({ year }).then(setContracts).catch((error) => showRequestError(error, '本地合同加载失败')); }, [year]);
  const setFilter = (key: string, value?: string | number) => { const next = new URLSearchParams(searchParams); if (value) { next.set(key, String(value)); } else { next.delete(key); } setSearchParams(next); setPage(1); };
  const openForm = (record?: CostFactItem) => { setEditing(record ?? null); form.setFieldsValue(record ? { ...record, occurredOn: dayjs(record.occurredOn) } : { occurredOn: dayjs(), reason: '' }); };
  const showConflict = (error: unknown) => {
    const conflict = getFactVersionConflict(error);
    if (!conflict) { showRequestError(error, '保存失败，请稍后重试'); return; }
    Modal.confirm({
      title: '数据已被其他用户更新',
      content: `服务器当前版本为 v${conflict.versionNo ?? '-'}，请重新载入后再修改。`,
      okText: '重新载入',
      cancelText: '保留当前输入',
      onOk: () => { setEditing(undefined); load(); },
    });
  };
  const save = async () => {
    const values = await form.validateFields();
    const payload = { ...values, occurredOn: values.occurredOn.format('YYYY-MM-DD') };
    try {
      if (editing) await factsApi.updateCost(editing.id, { ...payload, expectedVersionNo: editing.versionNo });
      else await factsApi.createCost(payload);
      message.success('成本记录已保存'); setEditing(undefined); load();
    } catch (error) { showConflict(error); }
  };
  const doImport = async () => { const values = await importForm.validateFields(); const file = files[0]?.originFileObj; if (!file) return message.error('请选择 Excel 文件');
    setImporting(true); try { const result = await factsApi.importCosts(file, values.templateType, values.contractCode); setImportResult(result);
      if (result.status === 'current_effective' || result.status === 'effective_with_warning') { message.success(result.idempotent ? '相同文件已导入，本次未重复累计' : `已导入 ${result.successRows} 行`); load(); }
    } catch (error) { showRequestError(error, '导入失败，请检查文件后重试'); } finally { setImporting(false); } };
  const exportCurrent = async () => {
    if (!total || exporting) return;
    if (total > PAGE_EXPORT_ROW_LIMIT) return void message.error(`筛选结果超过 ${PAGE_EXPORT_ROW_LIMIT} 行，请缩小筛选范围后重试`);
    setExporting(true);
    try {
      const all: CostFactItem[] = [];
      for (let exportPage = 1; all.length < total; exportPage += 1) {
        const result = await factsApi.listCosts({ year, month, costCategory: category, page: exportPage, pageSize: 100 });
        all.push(...result.items);
        if (!result.items.length) break;
      }
      await exportPageWorkbook({ pageName: '本地市成本', scope: '本地市', period: `${year}年${month ? `${month}月` : '全年'}`, filters: { year, month: month ?? null, costCategory: category ?? '' }, rowCount: all.length, sheets: [{ name: '成本明细', moneyColumns: [5], rows: [
        ['日期', '合同编码', '合同名称', '成本类别', '成本子类型', '金额', '事由', '实际花费人', '垫付人员', '票据类型', '审批编号', '审批状态', '来源', '导入批次', '版本', '更新时间'],
        ...all.map((item) => [item.occurredOn, item.contractCode, item.contractName, item.costCategoryCode, item.costSubtype || '', item.amount, item.description, item.actualSpender || '', item.advancePayer || '', item.receiptType || '', item.approvalNumber || '', item.approvalStatus || '', item.sourceType, item.importBatchId || '', item.versionNo, item.updatedAt]),
      ] }] });
    } catch (error) { showRequestError(error, '导出失败，请稍后重试'); } finally { setExporting(false); }
  };
  const columns: ColumnsType<CostFactItem> = [
    { title: '日期', dataIndex: 'occurredOn', width: 110, sorter: true },
    { title: '合同', width: 190, render: (_, r) => <><div>{r.contractCode}</div><Text type="secondary" ellipsis>{r.contractName}</Text></> },
    { title: '类别', dataIndex: 'costCategoryCode', width: 100, render: (v) => categoryOptions.find((o) => o.value === v)?.label || v },
    { title: '事由', dataIndex: 'description', width: 260, ellipsis: true },
    { title: '金额', dataIndex: 'amount', width: 120, align: 'right', render: money },
    { title: '实际花费人', dataIndex: 'actualSpender', width: 110, render: (v) => v || '-' },
    { title: '垫付人员', dataIndex: 'advancePayer', width: 100, render: (v) => v || '-' },
    { title: '审批', width: 150, render: (_, r) => r.approvalNumber ? <><div>{r.approvalNumber}</div><Tag>{r.approvalStatus || '未标记'}</Tag></> : '-' },
    { title: '来源', dataIndex: 'sourceType', width: 150, render: (v) => <Tag color={v === 'manual' ? 'blue' : v === 'reversal' ? 'red' : 'default'}>{v === 'manual' ? '在线新增' : v === 'reversal' ? '冲销' : 'Excel 导入'}</Tag> },
    { title: '批次', dataIndex: 'importBatchId', width: 90, render: (v) => v ? `#${v}` : '-' },
    { title: '更新时间', dataIndex: 'updatedAt', width: 160, render: (v) => dayjs(v).format('YYYY-MM-DD HH:mm') },
    { title: '操作', width: 120, fixed: 'right', render: (_, r) => <Space>
      <Button type="text" icon={<EditOutlined />} disabled={r.isReversed} onClick={() => openForm(r)} aria-label="编辑成本" />
      <Popconfirm title="确认撤销该成本？" description="系统将写入等额负数冲销记录并保留审计。" onConfirm={async () => {
        try {
          await factsApi.reverseCost(r.id, { reason: '业务冲销', expectedVersionNo: r.versionNo });
          message.success('已生成冲销记录'); load();
        } catch (error) { showConflict(error); }
      }}><Button type="text" danger icon={<RollbackOutlined />} disabled={r.isReversed} aria-label="撤销成本" /></Popconfirm>
    </Space> },
  ];
  return <Space direction="vertical" size={16} style={{ width: '100%' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><div><Title level={3} style={{ margin: 0 }}>本地市成本</Title><Text type="secondary">原始成本事实按行保存，导入与在线修改均可追溯。</Text></div><Space><Button icon={<DownloadOutlined />} disabled={!total} loading={exporting} onClick={() => void exportCurrent()}>导出本页</Button><Button icon={<CloudUploadOutlined />} onClick={() => { setImportOpen(true); setImportResult(null); }}>导入 Excel</Button><Button type="primary" icon={<PlusOutlined />} onClick={() => openForm()}>新增成本</Button></Space></div>
    <Card size="small"><Space wrap><DatePicker picker="year" value={dayjs().year(year)} onChange={(v) => v && setFilter('year', v.year())} allowClear={false} /><Select placeholder="月份" allowClear value={month} style={{ width: 110 }} options={Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: `${i + 1} 月` }))} onChange={(v) => setFilter('month', v)} /><Select placeholder="成本类别" allowClear value={category} style={{ width: 130 }} options={categoryOptions} onChange={(v) => setFilter('costCategory', v)} /></Space></Card>
    <Card styles={{ body: { padding: 0 } }}><Table rowKey="id" columns={columns} dataSource={items} loading={loading} scroll={{ x: 1550 }} pagination={{ current: page, pageSize: 20, total, showTotal: (v) => `共 ${v} 行` }} onChange={(p: TablePaginationConfig) => setPage(p.current || 1)} /></Card>
    <Drawer title={editing ? '编辑成本' : '新增成本'} open={editing !== undefined} width={520} onClose={() => setEditing(undefined)} extra={<Button type="primary" onClick={save}>保存</Button>}>
      <Form form={form} layout="vertical"><Form.Item name="contractId" label="合同" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={contracts.map((c) => ({ value: c.contractId, label: `${c.contractCode} · ${c.contractName}` }))} /></Form.Item><Form.Item name="occurredOn" label="发生日期" rules={[{ required: true }]}><DatePicker style={{ width: '100%' }} /></Form.Item><Form.Item name="costCategoryCode" label="成本类别" rules={[{ required: true }]}><Select options={categoryOptions} /></Form.Item><Form.Item name="costSubtype" label="成本子类型"><Input /></Form.Item><Form.Item name="description" label="事由" rules={[{ required: true }]}><Input.TextArea rows={3} /></Form.Item><Form.Item name="amount" label="金额" rules={[{ required: true }]}><InputNumber min={0.01} precision={2} style={{ width: '100%' }} /></Form.Item><Form.Item name="actualSpender" label="实际花费人"><Input /></Form.Item><Form.Item name="advancePayer" label="垫付人员"><Input /></Form.Item><Form.Item name="reason" label="修改原因" rules={[{ required: true }]}><Input.TextArea rows={2} /></Form.Item></Form>
    </Drawer>
    <Modal title="导入成本 Excel" open={importOpen} width={760} onCancel={() => setImportOpen(false)} onOk={doImport} confirmLoading={importing} okText="校验并导入">
      <Form form={importForm} layout="vertical" initialValues={{ templateType: 'auto' }}><Form.Item name="templateType" label="模板类型" rules={[{ required: true }]}><Select options={[{ value: 'auto', label: '自动识别' }, { value: 'daily_reimbursement', label: '日常报销' }, { value: 'mileage_subsidy', label: '里程油补' }, { value: 'standard_cost', label: '标准成本模板' }]} /></Form.Item><Form.Item name="contractCode" label="整批合同（报销与里程油补必填）"><Select allowClear showSearch optionFilterProp="label" options={contracts.map((c) => ({ value: c.contractCode, label: `${c.contractCode} · ${c.contractName}` }))} /></Form.Item><Upload accept=".xlsx,.xls" maxCount={1} beforeUpload={() => false} fileList={files} onChange={({ fileList }) => setFiles(fileList)}><Button icon={<CloudUploadOutlined />}>选择文件</Button></Upload></Form>
      {importResult && <Table size="small" style={{ marginTop: 16 }} rowKey={(r) => `${r.rowNumber}-${r.field}`} pagination={{ pageSize: 5 }} dataSource={importResult.issues} columns={[{ title: '行号', dataIndex: 'rowNumber', width: 70 }, { title: '字段', dataIndex: 'field', width: 130 }, { title: '原因', dataIndex: 'reason' }, { title: '处理建议', dataIndex: 'suggestion' }]} />}
    </Modal>
  </Space>;
}


