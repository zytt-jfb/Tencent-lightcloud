import { useEffect, useMemo, useState } from 'react';
import { Button, Card, DatePicker, Drawer, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Tag, Typography, Upload, message } from 'antd';
import { CloudUploadOutlined, DownloadOutlined, EditOutlined, PlusOutlined, RollbackOutlined } from '@ant-design/icons';
import type { ColumnsType, TablePaginationConfig } from 'antd/es/table';
import type { UploadFile } from 'antd';
import type { FactImportResult, LocalContractItem, OrderFactItem } from '@biz-reporting/shared-types';
import dayjs from 'dayjs';
import { useSearchParams } from 'react-router-dom';
import { factsApi } from '@/api/facts.api';
import { exportPageWorkbook, PAGE_EXPORT_ROW_LIMIT } from '@/utils/page-export';
import { getFactVersionConflict } from '@/utils/fact-conflict';
import { showRequestError } from '@/utils/request';

const { Title, Text } = Typography;
const money = (value: number) => Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function CityOrders() {
  const [searchParams, setSearchParams] = useSearchParams(); const year = Number(searchParams.get('year') || dayjs().year());
  const month = searchParams.get('month') ? Number(searchParams.get('month')) : undefined; const status = searchParams.get('orderStatus') || undefined;
  const [items, setItems] = useState<OrderFactItem[]>([]); const [total, setTotal] = useState(0); const [page, setPage] = useState(1); const [loading, setLoading] = useState(false);
  const [contracts, setContracts] = useState<LocalContractItem[]>([]); const [editing, setEditing] = useState<OrderFactItem | null>(); const [form] = Form.useForm();
  const [importOpen, setImportOpen] = useState(false); const [files, setFiles] = useState<UploadFile[]>([]); const [result, setResult] = useState<FactImportResult | null>(null); const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const query = useMemo(() => ({ year, month, orderStatus: status, page, pageSize: 20 }), [year, month, status, page]);
  const load = () => { setLoading(true); void factsApi.listOrders(query).then((data) => { setItems(data.items); setTotal(data.total); }).catch((error) => showRequestError(error, '订单数据加载失败')).finally(() => setLoading(false)); };
  useEffect(load, [query]); useEffect(() => { void factsApi.localContracts({ year }).then(setContracts).catch((error) => showRequestError(error, '本地合同加载失败')); }, [year]);
  const setFilter = (key: string, value?: string | number) => { const next = new URLSearchParams(searchParams); if (value) { next.set(key, String(value)); } else { next.delete(key); } setSearchParams(next); setPage(1); };
  const openForm = (record?: OrderFactItem) => { setEditing(record ?? null); form.setFieldsValue(record ? { ...record, orderedAt: dayjs(record.orderedAt) } : { orderedAt: dayjs(), orderStatus: '未接单', reason: '' }); };
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
    const payload = { ...values, orderedAt: values.orderedAt.toISOString() };
    try {
      if (editing) await factsApi.updateOrder(editing.id, { ...payload, expectedVersionNo: editing.versionNo });
      else await factsApi.createOrder(payload);
      message.success('订单行已保存'); setEditing(undefined); load();
    } catch (error) { showConflict(error); }
  };
  const doImport = async () => { const file = files[0]?.originFileObj; if (!file) return message.error('请选择 Excel 文件'); setImporting(true); try { const value = await factsApi.importOrders(file); setResult(value); if (value.status === 'current_effective' || value.status === 'effective_with_warning') { message.success(value.idempotent ? '相同文件已导入，本次未重复累计' : `已导入 ${value.successRows} 行`); load(); } } catch (error) { showRequestError(error, '导入失败，请检查文件后重试'); } finally { setImporting(false); } };
  const exportCurrent = async () => {
    if (!total || exporting) return;
    if (total > PAGE_EXPORT_ROW_LIMIT) return void message.error(`筛选结果超过 ${PAGE_EXPORT_ROW_LIMIT} 行，请缩小筛选范围后重试`);
    setExporting(true);
    try {
      const all: OrderFactItem[] = [];
      for (let exportPage = 1; all.length < total; exportPage += 1) {
        const value = await factsApi.listOrders({ year, month, orderStatus: status, page: exportPage, pageSize: 100 });
        all.push(...value.items);
        if (!value.items.length) break;
      }
      await exportPageWorkbook({ pageName: '本地市订单', scope: '本地市', period: `${year}年${month ? `${month}月` : '全年'}`, filters: { year, month: month ?? null, orderStatus: status ?? '' }, rowCount: all.length, sheets: [{ name: '订单行明细', moneyColumns: [4], rows: [
        ['采购订单编号', '订单状态', '合同编码', '合同名称', '行级含税金额', '物料编码', '物料名称', '项目编号', '项目名称', '站址编号', '站址名称', '下单时间', '收货状态', '来源', '导入批次', '业务键', '版本', '更新时间'],
        ...all.map((item) => [item.purchaseOrderNo, item.orderStatus, item.contractCode, item.contractName, item.taxInclusiveAmount, item.materialCode, item.materialName, item.projectCode || '', item.projectName || '', item.siteCode || '', item.siteName || '', item.orderedAt, item.receiptStatus || '', item.sourceType, item.importBatchId || '', item.businessKey, item.versionNo, item.updatedAt]),
      ] }] });
    } catch (error) { showRequestError(error, '导出失败，请稍后重试'); } finally { setExporting(false); }
  };
  const columns: ColumnsType<OrderFactItem> = [
    { title: '采购订单编号', dataIndex: 'purchaseOrderNo', width: 260, fixed: 'left' }, { title: '状态', dataIndex: 'orderStatus', width: 110, render: (v) => <Tag color={/取消/.test(v) ? 'orange' : 'blue'}>{v}</Tag> },
    { title: '合同编号', dataIndex: 'contractCode', width: 180 }, { title: '行级含税金额', dataIndex: 'taxInclusiveAmount', width: 140, align: 'right', render: (v) => <Text type={Number(v) < 0 ? 'danger' : undefined}>{money(v)}</Text> },
    { title: '物料', width: 260, render: (_, r) => <><div>{r.materialName}</div><Text type="secondary">{r.materialCode}</Text></> }, { title: '项目', width: 240, render: (_, r) => r.projectName || r.projectCode || '-' },
    { title: '站址', width: 190, render: (_, r) => r.siteName || r.siteCode || '-' }, { title: '下单时间', dataIndex: 'orderedAt', width: 170, render: (v) => dayjs(v).format('YYYY-MM-DD HH:mm') },
    { title: '收货状态', dataIndex: 'receiptStatus', width: 100, render: (v) => v || '-' }, { title: '来源', dataIndex: 'sourceType', width: 130, render: (v) => <Tag>{v === 'manual' ? '在线新增' : v === 'reversal' ? '冲销' : 'Excel 导入'}</Tag> },
    { title: '批次', dataIndex: 'importBatchId', width: 90, render: (v) => v ? `#${v}` : '-' }, { title: '操作', width: 120, fixed: 'right', render: (_, r) => <Space><Button type="text" icon={<EditOutlined />} onClick={() => openForm(r)} disabled={r.isReversal && r.sourceType === 'reversal'} aria-label="编辑订单" /><Popconfirm title="确认冲销该订单行？" description="负数冲销记录会保留原订单行和完整审计。" onConfirm={async () => {
        try {
          await factsApi.reverseOrder(r.id, { reason: '业务冲销', expectedVersionNo: r.versionNo });
          message.success('已生成负数冲销订单'); load();
        } catch (error) { showConflict(error); }
      }}><Button type="text" danger icon={<RollbackOutlined />} aria-label="冲销订单" /></Popconfirm></Space> },
  ];
  return <Space direction="vertical" size={16} style={{ width: '100%' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><div><Title level={3} style={{ margin: 0 }}>本地市订单</Title><Text type="secondary">汇总严格按每个来源行的含税金额计算，取消和负数订单作为合法冲销保留。</Text></div><Space><Button icon={<DownloadOutlined />} disabled={!total} loading={exporting} onClick={() => void exportCurrent()}>导出本页</Button><Button icon={<CloudUploadOutlined />} onClick={() => { setImportOpen(true); setResult(null); }}>导入 34 列订单</Button><Button type="primary" icon={<PlusOutlined />} onClick={() => openForm()}>新增订单行</Button></Space></div>
    <Card size="small"><Space wrap><DatePicker picker="year" value={dayjs().year(year)} onChange={(v) => v && setFilter('year', v.year())} allowClear={false} /><Select placeholder="月份" allowClear value={month} style={{ width: 110 }} options={Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: `${i + 1} 月` }))} onChange={(v) => setFilter('month', v)} /><Select placeholder="订单状态" allowClear value={status} style={{ width: 160 }} options={['未接单', '已接单未发货', '已发货', '已完成', '取消'].map((value) => ({ value, label: value }))} onChange={(v) => setFilter('orderStatus', v)} /></Space></Card>
    <Card styles={{ body: { padding: 0 } }}><Table rowKey="id" columns={columns} dataSource={items} loading={loading} scroll={{ x: 2000 }} pagination={{ current: page, pageSize: 20, total, showTotal: (v) => `共 ${v} 行` }} onChange={(p: TablePaginationConfig) => setPage(p.current || 1)} /></Card>
    <Drawer title={editing ? '编辑订单行' : '新增订单行'} open={editing !== undefined} width={560} onClose={() => setEditing(undefined)} extra={<Button type="primary" onClick={save}>保存</Button>}><Form form={form} layout="vertical"><Form.Item name="contractId" label="合同" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={contracts.map((c) => ({ value: c.contractId, label: `${c.contractCode} · ${c.contractName}` }))} /></Form.Item><Form.Item name="purchaseOrderNo" label="采购订单编号" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="orderStatus" label="订单状态" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="taxInclusiveAmount" label="行级含税金额" rules={[{ required: true }]} extra="允许负数冲销，不按采购订单编号合并。"><InputNumber precision={2} style={{ width: '100%' }} /></Form.Item><Form.Item name="materialName" label="物料名称" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="materialCode" label="物料编码" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="projectCode" label="项目编号"><Input /></Form.Item><Form.Item name="projectName" label="项目名称"><Input /></Form.Item><Form.Item name="siteCode" label="站址编号"><Input /></Form.Item><Form.Item name="siteName" label="站址信息"><Input /></Form.Item><Form.Item name="orderedAt" label="下单时间" rules={[{ required: true }]}><DatePicker showTime style={{ width: '100%' }} /></Form.Item><Form.Item name="receiptStatus" label="收货状态"><Input /></Form.Item><Form.Item name="reason" label="修改原因" rules={[{ required: true }]}><Input.TextArea rows={2} /></Form.Item></Form></Drawer>
    <Modal title="导入电商订单 Excel" open={importOpen} width={760} onCancel={() => setImportOpen(false)} onOk={doImport} confirmLoading={importing} okText="校验并导入"><Text type="secondary">文件必须符合已确认的 34 列结构。系统先校验全部行、地市、合同分配和业务键，再原子写入。</Text><div style={{ marginTop: 16 }}><Upload accept=".xlsx,.xls" maxCount={1} beforeUpload={() => false} fileList={files} onChange={({ fileList }) => setFiles(fileList)}><Button icon={<CloudUploadOutlined />}>选择文件</Button></Upload></div>{result && <Table size="small" style={{ marginTop: 16 }} rowKey={(r) => `${r.rowNumber}-${r.field}`} pagination={{ pageSize: 5 }} dataSource={result.issues} columns={[{ title: '行号', dataIndex: 'rowNumber', width: 70 }, { title: '字段', dataIndex: 'field', width: 130 }, { title: '原因', dataIndex: 'reason' }, { title: '处理建议', dataIndex: 'suggestion' }]} />}</Modal>
  </Space>;
}


