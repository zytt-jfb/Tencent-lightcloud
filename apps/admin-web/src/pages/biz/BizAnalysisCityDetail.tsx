import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, Button, Card, Descriptions, Drawer, message, Select, Space, Spin, Table, Tabs, Tag, Typography } from 'antd';
import { ArrowLeftOutlined, DownloadOutlined, HomeOutlined, ReloadOutlined } from '@ant-design/icons';
import { ALLOCATION_STATUS_TEXT, bizAnalysisCityDetail, bizAnalysisCityDetailSnapshot, bizAnalysisYears, bizContractDetail, CONTRACT_STATUS_COLOR, CONTRACT_STATUS_TEXT, effectiveContractStatus, type BizContractDetail } from '@/api/biz.api';
import { writeWorkbook } from '@/utils/page-export-core';

/** 预警类型中文（与 BizContracts 视图保持一致） */
const ALERT_LABEL: Record<string, string> = {
  nearly_full: '接近满额', overfull: '满额/超额', expiring: '即将到期', expired: '已到期', pending_complete: '待完成确认',
};

const { Title, Text } = Typography;

function fenToYuan(value: number | null | undefined): string {
  return (Number(value ?? 0) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatMonthLabel(v: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(String(v ?? ''));
  return m ? `${m[2]}月` : (v ?? '-');
}

function formatDate(v: string | null | undefined): string {
  return v ?? '-';
}

/** 成本六列固定（与后端 COST_SIX_COLUMNS 对齐；other 等类别只进明细，不混入任意一列） */
const COST_COLUMNS: Array<{ key: string; title: string }> = [
  { key: 'reimbursementFen', title: '报销' },
  { key: 'rentFen', title: '房租' },
  { key: 'laborFen', title: '人工成本' },
  { key: 'utilitiesFen', title: '水电费' },
  { key: 'fuelFen', title: '油补' },
  { key: 'entertainmentFen', title: '招待费' },
];

const COST_CATEGORY_OPTIONS = [
  { value: 'reimbursement', label: '报销' },
  { value: 'rent', label: '房租' },
  { value: 'labor', label: '人工成本' },
  { value: 'utilities', label: '水电费' },
  { value: 'fuel', label: '油补' },
  { value: 'entertainment', label: '招待费' },
];

/** 经营单位详情（只读聚合）：总览/合同明细/成本明细/完工明细。数据全部来自 GET /biz/analysis/city/:cityId，前端只做格式化展示，不自行重算。 */
export default function BizAnalysisCityDetail() {
  const navigate = useNavigate();
  const { cityId = '' } = useParams<{ cityId: string }>();
  const [year, setYear] = useState<string>(String(new Date().getFullYear()));
  const [months, setMonths] = useState<string[]>([]);
  const [categoryCodes, setCategoryCodes] = useState<string[]>([]);
  const [years, setYears] = useState<string[]>([]);
  const [data, setData] = useState<Awaited<ReturnType<typeof bizAnalysisCityDetail>> | null>(null);
  const [snapshot, setSnapshot] = useState<Awaited<ReturnType<typeof bizAnalysisCityDetailSnapshot>> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // #5 合同详情 Drawer（在当前页打开，不跳走）
  const [drawerDetail, setDrawerDetail] = useState<BizContractDetail | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerLoading, setDrawerLoading] = useState(false);

  const load = useCallback(async () => {
    if (!cityId) return;
    setLoading(true);
    setError(null);
    try {
      const [yearsResult, snap] = await Promise.all([
        bizAnalysisYears(),
        bizAnalysisCityDetailSnapshot(cityId),
      ]);
      const yearSet = new Set<string>([String(new Date().getFullYear())]);
      for (const y of yearsResult?.items ?? []) yearSet.add(String(y));
      setYears([...yearSet].sort().reverse());
      setSnapshot(snap);
    } catch (e) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      setError(status === 403 ? '当前账号无权查看该地市数据' : status === 404 ? '地市不存在' : '地市详情加载失败，请稍后重试');
      setSnapshot(null);
      setData(null);
      setLoading(false);
      return;
    }
    // 实时明细（成本/订单/线下完工）仍走实时接口，与快照口径分离；失败不影响快照主体
    try {
      const detail = await bizAnalysisCityDetail(cityId, { year, months: months.length ? months : undefined, categoryCodes: categoryCodes.length ? categoryCodes : undefined });
      setData(detail);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [cityId, year, months, categoryCodes]);

  /** #5 合同编号点击：在当前页打开只读合同详情 Drawer，不跳转到合同概览/合同管理 */
  const openContractDetail = async (contractId: string) => {
    if (!contractId) return;
    setDrawerOpen(true);
    setDrawerDetail(null);
    setDrawerLoading(true);
    try {
      setDrawerDetail(await bizContractDetail(contractId));
    } catch {
      message.error('合同详情加载失败');
    } finally {
      setDrawerLoading(false);
    }
  };

  useEffect(() => { void load(); }, [load]);

  const monthOptions = useMemo(() => {
    const opts: Array<{ value: string; label: string }> = [];
    for (let m = 1; m <= 12; m += 1) opts.push({ value: `${year}-${String(m).padStart(2, '0')}`, label: `${String(m).padStart(2, '0')}月` });
    return opts;
  }, [year]);

  // ---------- 表格列定义 ----------
  const contractColumns = [
    { title: '合同编号', dataIndex: 'contractNo', key: 'contractNo', width: 200, fixed: 'left' as const, render: (value: string, row: Record<string, unknown>) => <Button type="link" size="small" style={{ padding: 0 }} onClick={() => void openContractDetail(String(row.id))}>{value}</Button> },
    { title: '合同名称', dataIndex: 'contractName', key: 'contractName', ellipsis: true },
    { title: '省份', dataIndex: 'provinceName', key: 'provinceName', width: 100 },
    { title: '地市', dataIndex: 'cityName', key: 'cityName', width: 110 },
    { title: '含税合同额（元）', dataIndex: 'taxInclusiveAmountFen', key: 'taxInclusiveAmountFen', width: 140, align: 'right' as const, render: (v: number) => fenToYuan(v) },
    { title: '合同状态', dataIndex: 'status', key: 'status', width: 90, render: (_value: string, row: Record<string, unknown>) => { const eff = effectiveContractStatus(row); return <Tag color={CONTRACT_STATUS_COLOR[eff.status] ?? 'default'}>{CONTRACT_STATUS_TEXT[eff.status] ?? eff.status}</Tag>; } },
    { title: '签订日期', dataIndex: 'signedDate', key: 'signedDate', width: 110, render: (v: string | null) => formatDate(v) },
    { title: '合同到期日期', dataIndex: 'endDate', key: 'endDate', width: 110, render: (v: string | null) => formatDate(v) },
    { title: '累计完工（元）', dataIndex: 'cumulativeCompletionFen', key: 'cumulativeCompletionFen', width: 130, align: 'right' as const, render: (v: number) => fenToYuan(v) },
    { title: '剩余额度（元）', dataIndex: 'remainingFen', key: 'remainingFen', width: 130, align: 'right' as const, render: (v: number) => fenToYuan(v) },
    { title: '超额状态', dataIndex: 'overrunStatus', key: 'overrunStatus', width: 100, render: (v: string) => v === 'overrun' ? <Tag color="red">超额</Tag> : <Tag color="green">正常</Tag> },
  ];

  const costDetailColumns = [
    { title: '成本类别', dataIndex: 'categoryName', key: 'categoryName', width: 110 },
    { title: '金额（元）', dataIndex: 'amountFen', key: 'amountFen', width: 130, align: 'right' as const, render: (v: number) => fenToYuan(v) },
    { title: '说明', dataIndex: 'description', key: 'description', ellipsis: true, render: (v: string | null) => v ?? '-' },
    { title: '提交时间', dataIndex: 'submittedAt', key: 'submittedAt', width: 160, render: (v: string | null) => formatDate(v ? String(v).replace('T', ' ').slice(0, 16) : v) },
    { title: '状态', dataIndex: 'status', key: 'status', width: 90, render: (v: string) => <Tag color="green">{v}</Tag> },
  ];

  const orderColumns = [
    { title: '业务月份', dataIndex: 'businessMonth', key: 'businessMonth', width: 100 },
    { title: '采购订单编号', dataIndex: 'purchaseOrderNo', key: 'purchaseOrderNo', width: 200 },
    { title: '合同编号', dataIndex: 'contractId', key: 'contractId', width: 220, render: (v: string, row: Record<string, unknown>) => { const no = (row.contractNo as string) || contractNoById.get(String(v)); return no ? <Button type="link" size="small" style={{ padding: 0 }} onClick={() => void openContractDetail(String(v))}>{no}</Button> : (v ? String(v).slice(0, 8) + '…' : '-'); } },
    { title: '供应商', dataIndex: 'supplierName', key: 'supplierName', ellipsis: true },
    { title: '订单金额（元）', dataIndex: 'orderAmountFen', key: 'orderAmountFen', width: 130, align: 'right' as const, render: (v: number) => fenToYuan(v) },
    { title: '完工金额（元）', dataIndex: 'completionAmountFen', key: 'completionAmountFen', width: 130, align: 'right' as const, render: (v: number) => fenToYuan(v) },
    { title: '毛利（元）', dataIndex: 'grossProfitFen', key: 'grossProfitFen', width: 130, align: 'right' as const, render: (v: number) => fenToYuan(v) },
    { title: '状态', dataIndex: 'validationStatus', key: 'validationStatus', width: 90, render: (v: string) => <Tag color={v === 'valid' ? 'green' : 'orange'}>{v}</Tag> },
  ];

  const offlineColumns = [
    { title: '业务月份', dataIndex: 'businessMonth', key: 'businessMonth', width: 100 },
    { title: '合同编号', dataIndex: 'contractId', key: 'contractId', width: 220, render: (v: string, row: Record<string, unknown>) => { const no = (row.contractNo as string) || contractNoById.get(String(v)); return no ? <Button type="link" size="small" style={{ padding: 0 }} onClick={() => void openContractDetail(String(v))}>{no}</Button> : (v ? String(v).slice(0, 8) + '…' : '-'); } },
    { title: '完工类型', dataIndex: 'completionType', key: 'completionType', width: 100, render: () => '线下完工' },
    { title: '完工金额（元）', dataIndex: 'amountFen', key: 'amountFen', width: 130, align: 'right' as const, render: (v: number) => fenToYuan(v) },
    { title: '毛利（元）', dataIndex: 'grossProfitFen', key: 'grossProfitFen', width: 130, align: 'right' as const, render: (v: number) => fenToYuan(v) },
    { title: '提交时间', dataIndex: 'submittedAt', key: 'submittedAt', width: 160, render: (v: string | null) => formatDate(v ? String(v).replace('T', ' ').slice(0, 16) : v) },
    { title: '状态', dataIndex: 'status', key: 'status', width: 90, render: (v: string) => <Tag color="green">{v}</Tag> },
  ];

  // ---------- 成本明细（按月分组 + 合计行） ----------
  const costRows = useMemo(() => {
    const rows = (data?.costs ?? []).map((row) => {
      const out: Record<string, unknown> = { month: String(row.month), monthTotalFen: Number(row.monthTotalFen) || 0, entries: row.entries ?? [] };
      for (const col of COST_COLUMNS) out[col.key] = Number(row[col.key]) || 0;
      return out;
    });
    if (data?.costTotal) {
      const total: Record<string, unknown> = { month: '合计', entries: [] };
      for (const col of COST_COLUMNS) total[col.key] = Number(data.costTotal[col.key]) || 0;
      total.monthTotalFen = Number(data.costTotal.monthTotalFen) || 0;
      rows.push(total);
    }
    return rows;
  }, [data]);

  const costColumns = [
    { title: '月份', dataIndex: 'month', key: 'month', width: 100, render: (v: string) => v === '合计' ? <Text strong>{v}</Text> : <Button type="link" size="small" style={{ padding: 0 }} onClick={() => setExpandedMonth(expandedMonth === v ? null : v)}>{formatMonthLabel(v)}</Button> },
    ...COST_COLUMNS.map((col) => ({ title: col.title, dataIndex: col.key, key: col.key, width: 120, align: 'right' as const, render: (v: number) => fenToYuan(v) })),
    { title: '月合计', dataIndex: 'monthTotalFen', key: 'monthTotalFen', width: 130, align: 'right' as const, render: (v: number) => <Text strong>{fenToYuan(v)}</Text> },
  ];
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);

  // ---------- 指标卡（快照口径：与经营分析概览/单位对比/预警同一 ready 快照；无快照时回退实时） ----------
  // #4 经营单位详情聚合纳入经营分析快照：合同数/合同额/订单完工/线下完工/成本/毛利/净利 + 合同明细及累计完工，均读取同一 ready 快照。
  // 成本/订单/线下完工原始明细仍走实时接口（#4 允许原始明细保持实时）。
  const city = snapshot?.city ?? data?.city ?? null;
  const summary = snapshot?.summary ?? data?.summary ?? null;
  const contracts = snapshot?.status === 'ready' ? (snapshot.contracts ?? []) : (data?.contracts ?? []);
  const contractNoById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of contracts ?? []) m.set(String(c.id), String(c.contractNo ?? c.id));
    return m;
  }, [contracts]);
  const snapshotReady = snapshot?.status === 'ready';
  const metrics = [
    { label: '合同数', value: String(summary?.contractCount ?? 0), color: '#2878b8', isMoney: false },
    { label: '合同额（元）', value: fenToYuan(summary?.contractAmountFen ?? 0), color: '#2878b8', isMoney: true },
    { label: '订单完工（元）', value: fenToYuan(summary?.orderCompletionFen ?? 0), color: '#0F766E', isMoney: true },
    { label: '线下完工（元）', value: fenToYuan(summary?.offlineCompletionFen ?? 0), color: '#0F766E', isMoney: true },
    { label: '成本（元）', value: fenToYuan(summary?.costFen ?? 0), color: '#c47b20', isMoney: true },
    { label: '毛利（元）', value: fenToYuan(summary?.grossProfitFen ?? 0), color: '#2f9e62', isMoney: true },
    { label: '净利（元）', value: fenToYuan(summary?.netProfitFen ?? 0), color: (summary?.netProfitFen ?? 0) >= 0 ? '#2f9e62' : '#c64b4b', isMoney: true },
  ];

  const filterSummary = [
    `年度：${year}`,
    `月份：${months.length ? months.map(formatMonthLabel).join('、') : '全年'}`,
    `成本类别：${categoryCodes.length ? categoryCodes.map((c) => COST_CATEGORY_OPTIONS.find((o) => o.value === c)?.label ?? c).join('、') : '全部'}`,
  ].join(' ｜ ');

  return (
    <div className="v3-content">
      <div className="v3-page-head">
        <div className="v3-page-titles">
          <Title level={4} style={{ margin: 0 }}>
            {city ? `${city.provinceName} · ${city.name}${city.unitType === 'province_branch' ? '（省级直属）' : '（普通地市）'}` : '地市详情'}
          </Title>
        </div>
        <Space className="v3-page-head-actions" wrap>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/biz/analysis/cities')}>返回地市对比</Button>
          <Button icon={<HomeOutlined />} onClick={() => navigate('/biz/portal')}>返回门户首页</Button>
          <Button icon={<DownloadOutlined />} disabled={!snapshot} onClick={() => writeWorkbook(`地市详情-${city?.name ?? cityId}-${year}.xlsx`, [
            { name: '经营汇总', rows: [['指标', '金额（元）'], ['合同数', summary?.contractCount ?? 0], ['合同额', fenToYuan(summary?.contractAmountFen ?? 0)], ['订单完工', fenToYuan(summary?.orderCompletionFen ?? 0)], ['线下完工', fenToYuan(summary?.offlineCompletionFen ?? 0)], ['成本', fenToYuan(summary?.costFen ?? 0)], ['毛利', fenToYuan(summary?.grossProfitFen ?? 0)], ['净利', fenToYuan(summary?.netProfitFen ?? 0)]] },
            { name: '合同明细', rows: contracts.length ? [Object.keys(contracts[0]), ...contracts.map((row) => Object.values(row))] : [['合同明细']] },
            { name: '成本汇总', rows: costRows.length ? [Object.keys(costRows[0]), ...costRows.map((row) => Object.values(row))] : [['成本汇总']] },
            { name: '成本明细', rows: (data?.costs ?? []).flatMap((row) => row.entries ?? []).length ? [Object.keys((data?.costs ?? []).flatMap((row) => row.entries ?? [])[0]), ...(data?.costs ?? []).flatMap((row) => row.entries ?? []).map((row) => Object.values(row))] : [['成本明细']] },
            { name: '订单完工', rows: data?.orderCompletions?.length ? [Object.keys(data.orderCompletions[0]), ...data.orderCompletions.map((row) => Object.values(row))] : [['订单完工']] },
            { name: '线下完工', rows: data?.offlineCompletions?.length ? [Object.keys(data.offlineCompletions[0]), ...data.offlineCompletions.map((row) => Object.values(row))] : [['线下完工']] },
          ])}>导出 Excel</Button>
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>刷新</Button>
        </Space>
      </div>
      <div className="v3-toolbar">
        <Select
          data-testid="city-detail-year-filter"
          value={year} style={{ width: 120 }} options={years.map((y) => ({ value: y, label: `${y}年` }))}
          onChange={(v) => { setYear(v); setMonths([]); }}
        />
        <Select
          data-testid="city-detail-month-filter"
          mode="multiple" maxTagCount="responsive" allowClear value={months} placeholder="可多选月份（01月…）" style={{ width: 240 }}
          options={monthOptions} onChange={setMonths}
        />
        <Select
          data-testid="city-detail-category-filter"
          mode="multiple" maxTagCount="responsive" allowClear value={categoryCodes} placeholder="可多选成本类别" style={{ width: 260 }}
          options={COST_CATEGORY_OPTIONS} onChange={setCategoryCodes}
        />
      </div>
      <div className="v3-note">当前筛选条件：{filterSummary}。地市与省份固定为当前地市，不可再选其他地市。{snapshotReady ? `页面头部汇总指标与合同明细读取经营分析快照（基准日 ${snapshot?.asOf ?? '-'}）。` : '尚未生成经营分析快照，头部汇总指标与合同明细回退实时数据。'}订单完工/线下完工/成本原始明细按筛选范围实时聚合。</div>

      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} action={<Button size="small" onClick={() => void load()}>重试</Button>} />}

      {!error && (
        <>
          <div className="biz-metric-strip">
            {metrics.map((m) => (
              <div className="v3-metric" key={m.label}>
                <span className="v3-metric-label">{m.label}</span>
                <span className="v3-metric-value" style={{ color: m.color }}>{m.value}</span>
              </div>
            ))}
          </div>

          <Card size="small" style={{ marginTop: 16 }}>
            <Tabs
              defaultActiveKey="overview"
              items={[
                {
                  key: 'overview',
                  label: '总览',
                  children: (
                    <Descriptions size="small" column={3} bordered>
                      <Descriptions.Item label="省份">{city?.provinceName ?? '-'}</Descriptions.Item>
                      <Descriptions.Item label="地市">{city?.name ?? '-'}</Descriptions.Item>
                      <Descriptions.Item label="单位类型">{city?.unitType === 'province_branch' ? '省级直属' : '普通地市'}</Descriptions.Item>
                      <Descriptions.Item label="合同数">{summary?.contractCount ?? 0}</Descriptions.Item>
                      <Descriptions.Item label="合同额（元）">{fenToYuan(summary?.contractAmountFen ?? 0)}</Descriptions.Item>
                      <Descriptions.Item label="订单完工（元）">{fenToYuan(summary?.orderCompletionFen ?? 0)}</Descriptions.Item>
                      <Descriptions.Item label="线下完工（元）">{fenToYuan(summary?.offlineCompletionFen ?? 0)}</Descriptions.Item>
                      <Descriptions.Item label="成本（元）">{fenToYuan(summary?.costFen ?? 0)}</Descriptions.Item>
                      <Descriptions.Item label="毛利（元）">{fenToYuan(summary?.grossProfitFen ?? 0)}</Descriptions.Item>
                      <Descriptions.Item label="净利（元）"><Text style={{ color: (summary?.netProfitFen ?? 0) >= 0 ? '#2f9e62' : '#c64b4b' }}>{fenToYuan(summary?.netProfitFen ?? 0)}</Text></Descriptions.Item>
                    </Descriptions>
                  ),
                },
                {
                  key: 'contracts',
                  label: `合同明细（${contracts?.length ?? 0}）`,
                  children: (
                    <Table
                      size="small" rowKey="id" scroll={{ x: 'max-content' }} loading={loading}
                      dataSource={contracts ?? []} locale={{ emptyText: '暂无数据' }} pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (t: number) => `共 ${t} 条` }}
                      columns={contractColumns}
                    />
                  ),
                },
                {
                  key: 'costs',
                  label: '成本明细',
                  children: (
                    <Table
                      size="small" rowKey="month" scroll={{ x: 'max-content' }} loading={loading}
                      dataSource={costRows} locale={{ emptyText: '暂无数据' }} pagination={false}
                      columns={costColumns}
                      expandable={{
                        expandedRowKeys: expandedMonth ? [expandedMonth] : [],
                        onExpand: (expanded: boolean, row: Record<string, unknown>) => setExpandedMonth(expanded ? String(row.month) : null),
                        expandedRowRender: (row: Record<string, unknown>) => (
                          <Table
                            size="small" rowKey="id" scroll={{ x: 'max-content' }} pagination={false}
                            dataSource={(row.entries ?? []) as Array<Record<string, unknown>>} locale={{ emptyText: '暂无数据' }}
                            columns={costDetailColumns}
                          />
                        ),
                      }}
                    />
                  ),
                },
                {
                  key: 'completions',
                  label: '完工明细',
                  children: (
                    <Tabs
                      size="small"
                      items={[
                        { key: 'order', label: `订单完工（${data?.orderCompletions?.length ?? 0}）`, children: <Table size="small" rowKey="id" scroll={{ x: 'max-content' }} loading={loading} dataSource={data?.orderCompletions ?? []} locale={{ emptyText: '暂无数据' }} pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (t: number) => `共 ${t} 条` }} columns={orderColumns} /> },
                        { key: 'offline', label: `线下完工（${data?.offlineCompletions?.length ?? 0}）`, children: <Table size="small" rowKey="id" scroll={{ x: 'max-content' }} loading={loading} dataSource={data?.offlineCompletions ?? []} locale={{ emptyText: '暂无数据' }} pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (t: number) => `共 ${t} 条` }} columns={offlineColumns} /> },
                      ]}
                    />
                  ),
                },
              ]}
            />
          </Card>
        </>
      )}

      {/* #5 合同详情 Drawer：在当前页打开，不跳走；展示编号/名称/状态(中文)/金额/期限/生效中分配/累计完工/管理费率/预警；已取消分配不展示 */}
      <Drawer title={drawerDetail ? `${drawerDetail.contract.contractName} / ${drawerDetail.contract.contractNo}` : '合同详情'} open={drawerOpen} onClose={() => setDrawerOpen(false)} width="88%">
        {drawerLoading ? <div style={{ textAlign: 'center', padding: 48 }}><Spin /></div> : drawerDetail && (
          <>
            <Descriptions bordered size="small" column={2}>
              <Descriptions.Item label="合同编号">{drawerDetail.contract.contractNo}</Descriptions.Item>
              <Descriptions.Item label="合同名称">{drawerDetail.contract.contractName}</Descriptions.Item>
              <Descriptions.Item label="状态"><Tag color={CONTRACT_STATUS_COLOR[effectiveContractStatus(drawerDetail.contract).status] ?? 'default'}>{CONTRACT_STATUS_TEXT[effectiveContractStatus(drawerDetail.contract).status] ?? effectiveContractStatus(drawerDetail.contract).status}</Tag></Descriptions.Item>
              <Descriptions.Item label="含税合同额（元）">{fenToYuan(drawerDetail.contract.taxInclusiveAmountFen)}</Descriptions.Item>
              <Descriptions.Item label="签订日期">{drawerDetail.contract.signedDate ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="合同期限">{drawerDetail.contract.startDate ?? '-'} 至 {drawerDetail.contract.endDate ?? '-'}</Descriptions.Item>
            </Descriptions>
            <Alert style={{ marginTop: 16 }} type="info" message={`地市分配 ${drawerDetail.allocations.filter((a) => a.status === 'active').length} 条，累计完工 ${fenToYuan(drawerDetail.progress.totalCompletionFen)} 元`} />
            <Card title="地市分配（仅生效中）" size="small" style={{ marginTop: 16 }}>
              <Table
                size="small" rowKey={(row) => String(row.cityId)} pagination={false}
                dataSource={drawerDetail.allocations.filter((a) => a.status === 'active')}
                columns={[
                  { title: '地市', dataIndex: 'cityName', key: 'cityName' },
                  { title: '分配额度（元）', dataIndex: 'quotaFen', key: 'quotaFen', render: (v: number) => fenToYuan(v) },
                  { title: '累计完工（元）', dataIndex: 'completionFen', key: 'completionFen', render: (v: number) => fenToYuan(v) },
                  { title: '状态', dataIndex: 'status', key: 'status', render: (v: string) => <Tag>{ALLOCATION_STATUS_TEXT[v] ?? v}</Tag> },
                ]}
              />
            </Card>
            <Card title="管理费率" size="small" style={{ marginTop: 16 }}>
              <Table
                size="small" rowKey={(row) => `${row.cityId}-${row.effectiveMonth}`} pagination={{ pageSize: 8 }}
                dataSource={drawerDetail.feeRates}
                columns={[
                  { title: '地市', dataIndex: 'cityId', key: 'cityId', render: (cityId: string) => drawerDetail.allocations.find((a) => a.cityId === cityId)?.cityName ?? cityId },
                  { title: '生效月份', dataIndex: 'effectiveMonth', key: 'effectiveMonth' },
                  { title: '管理费率', dataIndex: 'rateBp', key: 'rateBp', render: (value: number) => `${(value / 100).toFixed(2)}%` },
                  { title: '说明', dataIndex: 'changeReason', key: 'changeReason', render: (value: string | null) => value ?? '-' },
                ]}
              />
            </Card>
            {drawerDetail.alerts?.length ? (
              <Card title="预警" size="small" style={{ marginTop: 16 }}>
                <Table
                  size="small" rowKey={(_: unknown, i?: number) => String(i ?? 0)} pagination={false}
                  dataSource={drawerDetail.alerts}
                  columns={[
                    { title: '类型', dataIndex: 'alertType', key: 'alertType', render: (v: string) => ALERT_LABEL[v] ?? v },
                    { title: '首次触发', dataIndex: 'firstTriggeredAt', key: 'firstTriggeredAt', render: (v: string | null) => v ?? '-' },
                  ]}
                />
              </Card>
            ) : null}
          </>
        )}
      </Drawer>
    </div>
  );
}
