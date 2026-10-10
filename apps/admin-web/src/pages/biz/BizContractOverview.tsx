import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, DatePicker, Descriptions, Drawer, Form, Input, InputNumber, Modal, Progress, Select, Space, Table, Tag, Typography, message } from 'antd';
import { DownloadOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import {
  bizCities, bizProvinces, bizContractBatchFeeRates, bizContractCopyFeeRates, bizContractDetail,
  bizContractLedger, CONTRACT_STATUS_COLOR, CONTRACT_STATUS_TEXT, effectiveContractStatus, type BizContractDetail, type BizContractLedgerItem,
} from '@/api/biz.api';
import { useBizPermission } from '@/utils/biz-permission';
import { exportPageRows } from '@/utils/page-export-core';

const { Title, Text } = Typography;

function fenToYuan(value: number | null | undefined): string {
  if (value == null) return '-';
  return (Number(value) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function BizContractOverview() {
  const [items, setItems] = useState<BizContractLedgerItem[]>([]);
  const [provinces, setProvinces] = useState<Array<{ id: string; name: string }>>([]);
  const [cities, setCities] = useState<Array<{ id: string; name: string; provinceId: string; unitType?: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [provinceId, setProvinceId] = useState<string>();
  const [cityId, setCityId] = useState<string>();
  const [status, setStatus] = useState<string>();
  const [dates, setDates] = useState<[Dayjs | null, Dayjs | null]>([null, null]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [liveFallback, setLiveFallback] = useState(false);
  const [detail, setDetail] = useState<BizContractDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [rateSaving, setRateSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [rateForm] = Form.useForm();
  const [copyForm] = Form.useForm();
  const canManageRates = useBizPermission('operation.contract.rate');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // #6 合同概览快照化：直接读取"一合同一行"台账快照（服务端分页 + 完工进度已随行返回），不再批量请求 batch-progress
      const result = await bizContractLedger({
        page, pageSize,
        keyword: keyword.trim() || undefined,
        provinceId, cityId, status,
        startDate: dates[0]?.format('YYYY-MM-DD'),
        endDate: dates[1]?.format('YYYY-MM-DD'),
      });
      setItems(result.items ?? []);
      setTotal(result.total ?? 0);
      setLiveFallback(result.snapshotMetadata?.status === 'live');
    } catch (error: unknown) {
      const detailMessage = (error as { response?: { data?: { message?: string } } }).response?.data?.message;
      message.error(detailMessage ?? '合同概览加载失败');
    } finally {
      setLoading(false);
    }
  }, [cityId, dates, keyword, page, pageSize, provinceId, status]);

  useEffect(() => { void Promise.all([bizProvinces(), bizCities()]).then(([provinceResult, cityResult]) => { setProvinces(provinceResult.items); setCities(cityResult.items); }); }, []);
  useEffect(() => { void load(); }, [load]);

  const openDetail = async (id: string) => {
    try { setDetail(await bizContractDetail(id)); setDetailOpen(true); rateForm.resetFields(); copyForm.resetFields(); } catch { message.error('合同详情加载失败'); }
  };

  const reloadDetail = async () => {
    if (!detail) return;
    setDetail(await bizContractDetail(detail.contract.id));
  };

  const exportLedger = async () => {
    setExporting(true);
    try {
      const params = { keyword: keyword.trim() || undefined, provinceId, cityId, status, startDate: dates[0]?.format('YYYY-MM-DD'), endDate: dates[1]?.format('YYYY-MM-DD') };
      const first = await bizContractLedger({ ...params, page: 1, pageSize: 200 });
      const pages = await Promise.all(Array.from({ length: Math.ceil(first.total / first.pageSize) - 1 }, (_, index) => bizContractLedger({ ...params, page: index + 2, pageSize: first.pageSize })));
      exportPageRows('合同概览', [first.items, ...pages.map((result) => result.items)].flat(), '当前筛选');
    } finally { setExporting(false); }
  };

  const saveRates = async (values: { cityIds: string[]; effectiveMonth: Dayjs; ratePercent: number; changeReason?: string }) => {
    if (!detail) return;
    const submit = async (overwrite: boolean) => {
      setRateSaving(true);
      try {
        await bizContractBatchFeeRates(detail.contract.id, { cityIds: values.cityIds, effectiveMonth: values.effectiveMonth.format('YYYY-MM'), rateBp: Math.round(values.ratePercent * 100), changeReason: values.changeReason, overwrite });
        message.success('管理费率已保存，相关订单利润正在重算');
        rateForm.resetFields();
        await reloadDetail();
      } finally { setRateSaving(false); }
    };
    try { await submit(false); } catch (error: unknown) {
      const detailMessage = (error as { response?: { data?: { message?: string } } }).response?.data?.message;
      if (String(detailMessage ?? '').includes('确认覆盖')) {
        Modal.confirm({ title: '覆盖已有费率', content: '所选地市在该生效月份已有费率，是否按当前数值覆盖？', onOk: () => submit(true) });
      } else message.error(detailMessage ?? '管理费率保存失败');
    }
  };

  const copyRates = async (values: { sourceMonth: Dayjs; targetMonth: Dayjs; cityIds?: string[] }) => {
    if (!detail) return;
    const submit = async (overwrite: boolean) => {
      setRateSaving(true);
      try {
        await bizContractCopyFeeRates(detail.contract.id, { sourceMonth: values.sourceMonth.format('YYYY-MM'), targetMonth: values.targetMonth.format('YYYY-MM'), cityIds: values.cityIds, overwrite });
        message.success('历史费率已复制，相关订单利润正在重算');
        copyForm.resetFields();
        await reloadDetail();
      } finally { setRateSaving(false); }
    };
    try { await submit(false); } catch (error: unknown) {
      const detailMessage = (error as { response?: { data?: { message?: string } } }).response?.data?.message;
      if (String(detailMessage ?? '').includes('确认覆盖')) Modal.confirm({ title: '覆盖目标月份费率', content: '目标月份已有费率，是否覆盖后复制？', onOk: () => submit(true) });
      else message.error(detailMessage ?? '历史费率复制失败');
    }
  };

  const columns = [
    { title: '合同编号', dataIndex: 'contractNo', key: 'contractNo', fixed: 'left' as const, width: 180, ellipsis: true, render: (value: string | null, row: BizContractLedgerItem) => <Button type="link" onClick={() => void openDetail(row.contractId)}>{value}</Button> },
    { title: '合同名称', dataIndex: 'contractName', key: 'contractName', width: 260, ellipsis: true, render: (value: string | null) => value ?? '-' },
    { title: '含税合同额（元）', dataIndex: 'taxInclusiveAmountFen', key: 'amount', width: 150, render: (value: number) => fenToYuan(value) },
    { title: '省份', dataIndex: 'provinceId', key: 'province', width: 110, render: (value: string | null, row: BizContractLedgerItem) => row.provinceName ?? provinces.find((item) => item.id === value)?.name ?? '-' },
    { title: '状态', dataIndex: 'status', key: 'status', width: 100, render: (_value: string | null, row: BizContractLedgerItem) => { const eff = effectiveContractStatus(row); return <Badge status={(CONTRACT_STATUS_COLOR[eff.status] as 'default' | 'processing' | 'success' | 'error' | 'warning') ?? 'default'} text={CONTRACT_STATUS_TEXT[eff.status] ?? eff.status ?? '-'} />; } },
    { title: '签订日期', dataIndex: 'signedDate', key: 'signedDate', width: 110, render: (value: string | null) => value ?? '-' },
    { title: '合同到期', dataIndex: 'endDate', key: 'endDate', width: 110, render: (value: string | null) => value ?? '-' },
    { title: '完工进度', dataIndex: 'completionProgressPct', key: 'progress', width: 140, render: (value: number | null) => {
      if (value == null) return <span style={{ color: '#999' }}>-</span>;
      // 进度预警：低于 30% 标红，30%～80% 标黄，超过 80% 标绿。
      const color = value < 30 ? '#cf1322' : value > 80 ? '#52c41a' : '#faad14';
      return <Progress percent={value} size="small" strokeColor={color} format={(p) => `${Number(p).toFixed(2)}%`} />;
    } },
    { title: '来源上传记录', dataIndex: 'sourceUploadRecordId', key: 'source', width: 120, render: (value: string | null) => value ? <Tag color="blue">已上传台账</Tag> : '-' },
  ];

  const provinceNameOf = (id: string | null) => provinces.find((item) => item.id === id)?.name ?? id ?? '-';

  return <div className="v3-content">
    <div className="v3-page-head"><div className="v3-page-titles"><Title level={4} style={{ margin: 0 }}>合同概览</Title><Text type="secondary">已上传并生效的合同台账</Text></div><Space className="v3-page-head-actions"><Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button></Space></div>
    <Card style={{ marginBottom: 16 }}>
      <Space wrap>
        <Input allowClear prefix={<SearchOutlined />} placeholder="合同编号或名称" value={keyword} onChange={(event) => setKeyword(event.target.value)} onPressEnter={() => { setPage(1); void load(); }} style={{ width: 230 }} />
        <Select allowClear placeholder="省份" value={provinceId} onChange={(value) => { setProvinceId(value); setCityId(undefined); setPage(1); }} options={provinces.map((item) => ({ value: item.id, label: item.name }))} style={{ width: 150 }} />
        <Select allowClear placeholder="地市" value={cityId} onChange={(value) => { setCityId(value); setPage(1); }} options={cities.filter((item) => !provinceId || item.provinceId === provinceId).map((item) => ({ value: item.id, label: `${item.name}${item.unitType === 'province_branch' ? '（省级直属）' : ''}` }))} style={{ width: 190 }} />
        <Select allowClear placeholder="合同状态" value={status} onChange={(value) => { setStatus(value); setPage(1); }} options={[{ value: 'active', label: '执行中' }, { value: 'expired', label: '已到期' }, { value: 'completed', label: '已完成' }, { value: 'voided', label: '已作废' }]} style={{ width: 130 }} />
        <DatePicker.RangePicker value={dates} onChange={(value) => { setDates(value as [Dayjs | null, Dayjs | null]); setPage(1); }} />
        <Button type="primary" icon={<SearchOutlined />} onClick={() => { setPage(1); void load(); }}>查询</Button>
      </Space>
    </Card>
    {liveFallback && <Alert style={{ marginBottom: 12 }} type="info" showIcon message="当前无可用快照，以下为实时聚合数据（状态：live）。点击顶部「更新数据」生成快照后将切换为快照口径。" />}
    <Card title={`已生效合同（${total}）`} extra={<Button icon={<DownloadOutlined />} loading={exporting} disabled={!total} onClick={() => void exportLedger()}>导出 Excel</Button>}>
      <Table rowKey="id" size="small" loading={loading} columns={columns} dataSource={items} scroll={{ x: 1120 }} onRow={(row) => ({ onClick: () => void openDetail(row.contractId), style: { cursor: 'pointer' } })} pagination={{ current: page, pageSize, total, showSizeChanger: true, onChange: (p, ps) => { setPage(p); setPageSize(ps); } }} />
    </Card>
    <Drawer title={detail ? `${detail.contract.contractName} / ${detail.contract.contractNo}` : '合同详情'} open={detailOpen} onClose={() => setDetailOpen(false)} width="88%">
      {detail && <><Descriptions bordered size="small" column={2}><Descriptions.Item label="状态"><Tag color={CONTRACT_STATUS_COLOR[effectiveContractStatus(detail.contract).status] ?? 'default'}>{CONTRACT_STATUS_TEXT[effectiveContractStatus(detail.contract).status] ?? effectiveContractStatus(detail.contract).status}</Tag></Descriptions.Item><Descriptions.Item label="含税合同额（元）">{fenToYuan(detail.contract.taxInclusiveAmountFen)}</Descriptions.Item><Descriptions.Item label="档案室合同编号">{detail.contract.archiveContractNo ?? '-'}</Descriptions.Item><Descriptions.Item label="项目识别编码">{detail.contract.projectIdentityCode ?? '-'}</Descriptions.Item><Descriptions.Item label="合同分类">{[detail.contract.contractCategory1, detail.contract.contractCategory2].filter(Boolean).join(' / ') || '-'}</Descriptions.Item><Descriptions.Item label="中标项目">{detail.contract.winningProjectName ?? '-'}</Descriptions.Item><Descriptions.Item label="签订日期">{detail.contract.signedDate ?? '-'}</Descriptions.Item><Descriptions.Item label="合同期限">{detail.contract.startDate ?? '-'} 至 {detail.contract.endDate ?? '-'}</Descriptions.Item><Descriptions.Item label="税率">{detail.contract.taxRateRaw ?? '-'}</Descriptions.Item><Descriptions.Item label="来源行">{detail.contract.sourceRowNo ?? '-'}</Descriptions.Item></Descriptions><Alert style={{ marginTop: 16 }} type="info" message={`地市分配 ${detail.allocations.filter((allocation) => allocation.status === 'active').length} 条，累计完工 ${fenToYuan(detail.progress.totalCompletionFen)} 元`} />
        <Card title="管理费率" size="small" style={{ marginTop: 16 }}>
          {canManageRates === true && <><Form form={rateForm} layout="inline" onFinish={(values) => void saveRates(values)}><Form.Item name="cityIds" rules={[{ required: true, message: '请选择地市' }]}><Select mode="multiple" maxTagCount="responsive" placeholder="选择地市，可多选" style={{ width: 270 }} options={detail.allocations.filter((allocation) => allocation.status === 'active').map((allocation) => ({ value: allocation.cityId, label: allocation.cityName }))} /></Form.Item><Form.Item name="effectiveMonth" rules={[{ required: true, message: '请选择生效月份' }]}><DatePicker picker="month" placeholder="生效月份" /></Form.Item><Form.Item name="ratePercent" rules={[{ required: true, message: '请输入费率' }]}><InputNumber min={0} max={100} precision={2} addonAfter="%" placeholder="管理费率" /></Form.Item><Form.Item name="changeReason"><Input placeholder="变更说明" style={{ width: 160 }} /></Form.Item><Button type="primary" htmlType="submit" loading={rateSaving}>保存所选费率</Button><Button onClick={() => rateForm.setFieldsValue({ cityIds: detail.allocations.filter((allocation) => allocation.status === 'active').map((allocation) => allocation.cityId) })}>选择全部</Button></Form>
          <Form form={copyForm} layout="inline" style={{ marginTop: 12 }} onFinish={(values) => void copyRates(values)}><Form.Item name="sourceMonth" rules={[{ required: true, message: '请选择来源月份' }]}><DatePicker picker="month" placeholder="复制来源月份" /></Form.Item><Form.Item name="targetMonth" rules={[{ required: true, message: '请选择目标月份' }]}><DatePicker picker="month" placeholder="目标月份" /></Form.Item><Form.Item name="cityIds"><Select mode="multiple" maxTagCount="responsive" allowClear placeholder="留空则复制全部已维护地市" style={{ width: 280 }} options={detail.allocations.filter((allocation) => allocation.status === 'active').map((allocation) => ({ value: allocation.cityId, label: allocation.cityName }))} /></Form.Item><Button htmlType="submit" loading={rateSaving}>复制历史费率</Button></Form></>}
          <Table size="small" style={{ marginTop: 12 }} rowKey={(row) => `${row.cityId}-${row.effectiveMonth}`} dataSource={detail.feeRates} pagination={{ pageSize: 8 }} columns={[{ title: '地市', dataIndex: 'cityId', key: 'cityId', render: (cityId: string) => detail.allocations.find((allocation) => allocation.cityId === cityId)?.cityName ?? cityId }, { title: '生效月份', dataIndex: 'effectiveMonth', key: 'effectiveMonth' }, { title: '管理费率', dataIndex: 'rateBp', key: 'rateBp', render: (value: number) => `${(value / 100).toFixed(2)}%` }, { title: '说明', dataIndex: 'changeReason', key: 'changeReason', render: (value: string | null) => value ?? '-' }]} />
        </Card></>}
    </Drawer>
  </div>;
}
