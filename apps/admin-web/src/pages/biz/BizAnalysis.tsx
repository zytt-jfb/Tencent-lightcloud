import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { App as AntdApp, Button, Card, Col, Descriptions, Drawer, Progress, Row, Select, Space, Table, Tabs, Tag, Typography } from 'antd';
import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import { writeWorkbook } from '@/utils/page-export-core';
import {
  bizAnalysisOverview, bizAnalysisTrend, bizAnalysisByCity, bizAnalysisOverrunList, bizAnalysisAlerts, bizAnalysisYears,
  bizAggregateRecalc, bizAggregateCheck, bizContractDetail, bizContractList, bizOrderRows, bizCostList, BizContractDetail,
} from '@/api/biz.api';

const { Title, Text } = Typography;

function fenToYuan(fen: number): string {
  return (fen / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function analysisRowKey(row: Record<string, unknown>): string {
  return [row.type, row.month, row.dimension, row.contractId, row.cityId, row.detail]
    .filter((value) => value != null && value !== '')
    .map(String)
    .join(':');
}

/** 显示层月份统一 yyyy年mm月（数据库/接口保留 YYYY-MM） */
export function formatMonth(v: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})$/.exec(String(v ?? ''));
  return m ? `${m[1]}年${m[2]}月` : (v ?? '-');
}

/** 经营分析（新基线 M6）：概览/趋势/地市对比/超额清单 + 汇总重算与一致性核对 */
export default function BizAnalysis() {
  const navigate = useNavigate();
  const { message: msg, modal } = AntdApp.useApp();
  const [overview, setOverview] = useState<{ orderCompletionFen: number; offlineCompletionFen: number; grossProfitFen: number; costFen: number; netProfitFen: number; contractCount: number; totalContractAmountFen: number; totalCompletionFen: number } | null>(null);
  const [trend, setTrend] = useState<Array<Record<string, unknown>>>([]);
  const [cities, setCities] = useState<Array<Record<string, unknown>>>([]);
  const [overruns, setOverruns] = useState<Array<Record<string, unknown>>>([]);
  const [contractAlerts, setContractAlerts] = useState<Array<{ contractId: string; contractNo: string; contractName: string; alertType: string; endDate: string | null; status: string }>>([]);
  const [checkResult, setCheckResult] = useState<{ warningCount: number; warnings: Array<Record<string, unknown>> } | null>(null);
  const [filterYear, setFilterYear] = useState<string | undefined>(String(new Date().getFullYear()));
  const [filterMonth, setFilterMonth] = useState<string | undefined>(undefined);
  const [filterCity, setFilterCity] = useState<string | undefined>(undefined);
  const [cityOptions, setCityOptions] = useState<Array<{ label: string; value: string }>>([]);
  const [yearOptions, setYearOptions] = useState<Array<{ label: string; value: string }>>([]);
  const [monthOptions, setMonthOptions] = useState<Array<{ label: string; value: string }>>([]);
  const [exporting, setExporting] = useState(false);
  const [contractDetail, setContractDetail] = useState<BizContractDetail | null>(null);
  const [contractDetailOpen, setContractDetailOpen] = useState(false);
  const [contractDetailLoading, setContractDetailLoading] = useState(false);
  const [alertTypeFilter, setAlertTypeFilter] = useState<string | undefined>();
  const [cityDetailOpen, setCityDetailOpen] = useState(false);
  const [cityDetailLoading, setCityDetailLoading] = useState(false);
  const [cityDetail, setCityDetail] = useState<{
    summary: Record<string, unknown>;
    contracts: Array<Record<string, unknown>>;
    orders: Array<Record<string, unknown>>;
    costs: Array<Record<string, unknown>>;
    orderTotal: number;
  } | null>(null);

  const load = useCallback(async () => {
    const params = { year: filterYear, month: filterMonth, cityId: filterCity };
    const [ov, tr, ct, or, al, yr] = await Promise.all([
      bizAnalysisOverview(params),
      bizAnalysisTrend(12, filterCity, filterYear),
      bizAnalysisByCity(filterYear, filterMonth),
      bizAnalysisOverrunList({ year: filterYear, month: filterMonth, cityId: filterCity }),
      bizAnalysisAlerts(filterCity),
      bizAnalysisYears(),
    ]);
    setOverview(ov);
    const trendItems = Array.isArray(tr?.items) ? tr.items : [];
    const cityItems = Array.isArray(ct?.items) ? ct.items : [];
    const overrunItems = Array.isArray(or?.items) ? or.items : [];
    const alertItems = Array.isArray(al?.items) ? al.items : [];
    setTrend(trendItems);
    setContractAlerts(alertItems);
    const cityRows = filterCity ? cityItems.filter((r: Record<string, unknown>) => String(r.cityId) === filterCity) : cityItems;
    setCities(cityRows);
    setOverruns(overrunItems);
    setCityOptions(cityItems.map((r: Record<string, unknown>) => ({ label: String(r.cityName ?? r.cityId ?? '').slice(0, 12), value: String(r.cityId) })));
    setMonthOptions(trendItems.map((r: Record<string, unknown>) => ({ label: formatMonth(String(r.month)), value: String(r.month) })));
    const yearSet = new Set<string>([String(new Date().getFullYear())]);
    for (const y of Array.isArray(yr?.items) ? yr.items : []) yearSet.add(String(y));
    setYearOptions([...yearSet].sort().map((y) => ({ label: `${y}年`, value: y })));
  }, [filterYear, filterMonth, filterCity]);

  useEffect(() => { void load(); }, [load]);

  const visibleAlerts = alertTypeFilter ? contractAlerts.filter((alert) => alert.alertType === alertTypeFilter) : contractAlerts;

  /** CSV 导出当前地市指标视图（元，千分位两位小数） */
  const onExport = async () => {
    setExporting(true);
    try {
      const header = ['地市', '合同数量', '合同额(元)', '订单完工(元)', '线下完工(元)', '毛利(元)', '成本(元)', '净利(元)', '超额标记'];
      const rows = cities.map((r) => {
        const overrun = overruns.find((o) => o.type === 'city' && o.cityId === r.cityId);
        return [String(r.cityName ?? r.cityId ?? '-'), String(Number(r.contractCount) || 0), fenToYuan(Number(r.contractAmountFen) || 0), fenToYuan(Number(r.orderCompletionFen) || 0), fenToYuan(Number(r.offlineCompletionFen) || 0), fenToYuan(Number(r.grossProfitFen) || 0), fenToYuan(Number(r.costFen) || 0), fenToYuan(Number(r.netProfitFen) || 0), overrun ? `超额${fenToYuan(Number(overrun.overrunFen))}` : '-'];
      });
      writeWorkbook(`经营分析-地市指标-${filterYear ?? '累计'}${filterMonth ? filterMonth : '全年'}.xlsx`, [
        { name: '地市指标', rows: [header, ...rows] },
        { name: '月度趋势', rows: [Object.keys(trend[0] ?? { month: '' }), ...trend.map((row) => Object.values(row))] },
        { name: '合同预警', rows: [Object.keys(contractAlerts[0] ?? { contractNo: '' }), ...visibleAlerts.map((row) => Object.values(row))] },
        { name: '超额清单', rows: [Object.keys(overruns[0] ?? { type: '' }), ...overruns.map((row) => Object.values(row))] },
      ]);
      msg.success(`已导出 ${rows.length} 条地市指标`);
    } finally {
      setExporting(false);
    }
  };

  const onRecalc = () => {
    modal.confirm({
      title: '全库重算汇总',
      content: '将按明细重新生成全部汇总（含二次确认）。确定执行？',
      okText: '确认重算',
      onOk: async () => {
        await bizAggregateRecalc({}, true);
        msg.success('全库重算完成');
        void load();
      },
    });
  };

  const onCheck = async () => {
    const r = await bizAggregateCheck();
    setCheckResult(r);
    if (r.warningCount === 0) msg.success('一致性核对通过：无警告');
    else msg.warning(`一致性核对发现 ${r.warningCount} 条警告（不自动改写数据）`);
  };

  const openContractDetail = async (contractId: string) => {
    setContractDetailOpen(true);
    setContractDetail(null);
    setContractDetailLoading(true);
    try {
      setContractDetail(await bizContractDetail(contractId));
    } catch {
      msg.error('合同详情加载失败');
    } finally {
      setContractDetailLoading(false);
    }
  };

  const openCityDetail = async (row: Record<string, unknown>) => {
    const cityId = String(row.cityId ?? '');
    if (!cityId) return;
    setCityDetailOpen(true);
    setCityDetailLoading(true);
    setCityDetail(null);
    try {
      const [contracts, firstOrders, costs] = await Promise.all([
        bizContractList({ cityId }),
        bizOrderRows({ cityId, page: 1, pageSize: 500 }),
        bizCostList({ cityId, businessMonth: filterMonth }),
      ]);
      const orderItems = Array.isArray(firstOrders?.items) ? firstOrders.items : [];
      const orderTotal = Number(firstOrders?.total) || orderItems.length;
      const orderPageSize = Number(firstOrders?.pageSize) || 500;
      const orderPages = Math.ceil(orderTotal / Math.max(orderPageSize, 1));
      const extraPages = orderPages > 1
        ? await Promise.all(Array.from({ length: orderPages - 1 }, (_, index) => bizOrderRows({ cityId, page: index + 2, pageSize: orderPageSize })))
        : [];
      const allOrders = [orderItems, ...extraPages.map((page) => Array.isArray(page?.items) ? page.items : [])].flat();
      const visibleOrders = filterMonth ? allOrders.filter((item) => String(item.businessMonth) === filterMonth) : allOrders;
      setCityDetail({
        summary: row,
        contracts: (Array.isArray(contracts?.items) ? contracts.items : []) as unknown as Array<Record<string, unknown>>,
        orders: visibleOrders,
        costs: Array.isArray(costs?.items) ? costs.items : [],
        orderTotal,
      });
    } catch {
      msg.error('地市明细加载失败');
    } finally {
      setCityDetailLoading(false);
    }
  };

  const cards = [
    { label: '订单完工（元）', value: overview?.orderCompletionFen ?? 0, color: '#2878b8' },
    { label: '线下完工（元）', value: overview?.offlineCompletionFen ?? 0, color: '#0F766E' },
    { label: '毛利（元）', value: overview?.grossProfitFen ?? 0, color: '#2f9e62' },
    { label: '成本（元）', value: overview?.costFen ?? 0, color: '#c47b20' },
    { label: '净利（元）', value: overview?.netProfitFen ?? 0, color: (overview?.netProfitFen ?? 0) >= 0 ? '#2f9e62' : '#c64b4b' },
  ];

  return (
    <div className="v3-content">
      <div className="v3-page-head">
        <div className="v3-page-titles">
          <Title level={4} style={{ margin: 0 }}>经营分析</Title>
        </div>
        <Space className="v3-page-head-actions" wrap>
          <Button onClick={() => navigate('/biz/operation')}>返回经营管理</Button>
          <Button onClick={onCheck}>一致性核对</Button>
          <Button danger onClick={onRecalc}>全库重算</Button>
          <Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button>
        </Space>
      </div>
      <div className="v3-toolbar">
        <Select data-testid="analysis-year-filter"
          allowClear placeholder="年度筛选（经营分析）" style={{ width: 150 }} options={yearOptions}
          value={filterYear} onChange={(v) => { setFilterYear(v ?? undefined); setFilterMonth(undefined); }}
        />
        <Select data-testid="analysis-month-filter"
          allowClear placeholder="月份筛选（全年）" style={{ width: 170 }} options={monthOptions}
          value={filterMonth} onChange={(v) => setFilterMonth(v ?? undefined)}
        />
        <Select data-testid="analysis-city-filter"
          allowClear placeholder="地市筛选" style={{ width: 170 }} options={cityOptions}
          value={filterCity} onChange={(v) => setFilterCity(v ?? undefined)}
        />
        {(filterYear || filterMonth || filterCity) && <Button data-testid="analysis-clear-filter" onClick={() => { setFilterYear(undefined); setFilterMonth(undefined); setFilterCity(undefined); }}>清空筛选</Button>}
        <Button data-testid="analysis-export" icon={<DownloadOutlined />} loading={exporting} onClick={onExport}>导出 Excel</Button>
      </div>
      <div className="v3-note">年度/月份筛选影响经营金额、订单完工、成本、毛利、净利、地市对比、超额数据、月度趋势；选年度查全年、选年度+月份查指定年月、清空=累计。合同数量/合同额（库存口径）与到期/满额提醒为累计实时口径，不受年度/月份筛选影响。</div>

      <div className="biz-metric-strip">
        <div className="v3-metric"><span className="v3-metric-label">合同数量</span><span className="v3-metric-value" style={{ color: '#2878b8' }}>{overview?.contractCount ?? 0}</span></div>
        <div className="v3-metric"><span className="v3-metric-label">总合同额（元）</span><span className="v3-metric-value" style={{ color: '#2878b8' }}>{fenToYuan(overview?.totalContractAmountFen ?? 0)}</span></div>
        <div className="v3-metric"><span className="v3-metric-label">总完工（元）</span><span className="v3-metric-value" style={{ color: '#0F766E' }}>{fenToYuan(overview?.totalCompletionFen ?? 0)}</span></div>
        {cards.map((c) => (
          <div className="v3-metric" key={c.label}><span className="v3-metric-label">{c.label}</span><span className="v3-metric-value" style={{ color: c.color }}>{fenToYuan(c.value)}</span></div>
        ))}
        <div className="v3-metric"><span className="v3-metric-label">一致性警告</span><span className="v3-metric-value" style={{ color: checkResult && checkResult.warningCount > 0 ? '#c64b4b' : '#2f9e62' }}>{checkResult ? checkResult.warningCount : '-'}</span></div>
      </div>

      {(contractAlerts.length > 0 || overruns.length > 0) && (
        <Card size="small" title="提醒中心" extra={<Text type="secondary">到期、满额与超额均实时计算</Text>} style={{ marginBottom: 16, borderLeft: '3px solid #c64b4b' }}>
          <Space style={{ marginBottom: 8 }}>
            <Select allowClear placeholder="提醒类型" style={{ width: 150 }} value={alertTypeFilter} onChange={(value) => setAlertTypeFilter(value)} options={[{ value: 'expired', label: '已到期' }, { value: 'expiring', label: '即将到期' }, { value: 'nearly_full', label: '即将满额' }, { value: 'overfull', label: '合同满额' }]} />
          </Space>
          <Table
            size="small"
            rowKey="contractId"
            pagination={{ pageSize: 6, showSizeChanger: false }}
            dataSource={visibleAlerts}
            columns={[
              { title: '提醒类型', dataIndex: 'alertType', width: 110, render: (type: string) => {
                const labels: Record<string, string> = { expired: '已到期', expiring: '即将到期', nearly_full: '即将满额', overfull: '合同满额' };
                return <Tag color={type === 'expired' || type === 'overfull' ? 'red' : type === 'expiring' ? 'orange' : 'blue'}>{labels[type] ?? type}</Tag>;
              } },
              { title: '合同编号', dataIndex: 'contractNo', width: 190, render: (value: string, row: { contractId: string }) => <Button type="link" size="small" onClick={() => void openContractDetail(row.contractId)}>{value}</Button> },
              { title: '合同名称', dataIndex: 'contractName', ellipsis: true },
              { title: '到期日', dataIndex: 'endDate', width: 120, render: (value: string | null) => value ?? '-' },
              { title: '状态', dataIndex: 'status', width: 90 },
              { title: '查看', key: 'action', width: 80, render: (_: unknown, row: { contractId: string }) => <Button size="small" onClick={() => void openContractDetail(row.contractId)}>详情</Button> },
            ]}
          />
        </Card>
      )}

      {checkResult && checkResult.warningCount > 0 && (
        <Card size="small" title={`一致性警告（${checkResult.warningCount} 条，仅告警不自动改写）`} style={{ marginBottom: 16 }}>
          <Table scroll={{ x: "max-content" }} 
            size="small" rowKey={analysisRowKey} pagination={false} dataSource={checkResult.warnings.slice(0, 20)}
            columns={[
              { title: '类型', dataIndex: 'type', key: 'type' },
              { title: '月份', dataIndex: 'month', key: 'month', render: (v: string) => formatMonth(v) },
              { title: '维度', dataIndex: 'dimension', key: 'dimension' },
              { title: '说明', dataIndex: 'detail', key: 'detail' },
            ]}
          />
        </Card>
      )}

      <Row gutter={12}>
        <Col xs={24} lg={12}>
          <Card title="月度趋势（近 12 月）" size="small" style={{ marginBottom: 16 }}>
            <Table scroll={{ x: "max-content" }} 
              size="small" rowKey="month" pagination={false} dataSource={trend}
              columns={[
                { title: '月份', dataIndex: 'month', key: 'month', render: (v: string) => formatMonth(v) },
                { title: '订单完工（元）', dataIndex: 'orderCompletionFen', key: 'oc', render: (v: number) => fenToYuan(Number(v)) },
                { title: '线下完工（元）', dataIndex: 'offlineCompletionFen', key: 'of', render: (v: number) => fenToYuan(Number(v)) },
                { title: '毛利（元）', dataIndex: 'grossProfitFen', key: 'gp', render: (v: number) => fenToYuan(Number(v)) },
                { title: '净利（元）', dataIndex: 'netProfitFen', key: 'np', render: (v: number) => fenToYuan(Number(v)) },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="地市对比" size="small" style={{ marginBottom: 16 }}>
            <div data-testid="analysis-city-table">
            <Table scroll={{ x: "max-content" }} 
              size="small" rowKey="cityId" pagination={false} dataSource={cities}
              columns={[
                { title: '地市', dataIndex: 'cityName', key: 'cityName', fixed: 'left', render: (_: unknown, r: Record<string, unknown>) => <Button type="link" size="small" style={{ padding: 0 }} onClick={() => void openCityDetail(r)}>{String(r.cityName ?? r.cityId ?? '-').slice(0, 12)}</Button> },
                { title: '合同数', dataIndex: 'contractCount', key: 'cc', render: (v: number) => Number(v) || 0 },
                { title: '合同额（元）', dataIndex: 'contractAmountFen', key: 'ca', render: (v: number) => fenToYuan(Number(v)) },
                { title: '订单完工（元）', dataIndex: 'orderCompletionFen', key: 'oc', render: (v: number) => fenToYuan(Number(v)) },
                { title: '线下完工（元）', dataIndex: 'offlineCompletionFen', key: 'of', render: (v: number) => fenToYuan(Number(v)) },
                { title: '毛利（元）', dataIndex: 'grossProfitFen', key: 'gp', render: (v: number) => fenToYuan(Number(v)) },
                { title: '成本（元）', dataIndex: 'costFen', key: 'co', render: (v: number) => fenToYuan(Number(v)) },
                { title: '净利（元）', dataIndex: 'netProfitFen', key: 'np', render: (v: number) => fenToYuan(Number(v)) },
                { title: '超额标记', key: 'overrun', render: (_: unknown, r: Record<string, unknown>) => {
                    const o = overruns.find((x) => x.type === 'city' && x.cityId === r.cityId);
                    return o ? <Tag color="red">超额 {fenToYuan(Number(o.overrunFen))}</Tag> : <Tag color="green">正常</Tag>;
                  } },
              ]}
            />
            </div>
          </Card>
        </Col>
        <Col xs={24}>
          <Card title="超额清单" size="small">
            <Table scroll={{ x: "max-content" }} 
              size="small" rowKey={analysisRowKey} pagination={false} dataSource={overruns}
              columns={[
                { title: '类型', dataIndex: 'type', key: 'type', render: (v: string) => v === 'contract' ? <Tag color="red">合同超额</Tag> : <Tag color="orange">地市超额</Tag> },
                { title: '合同/地市', dataIndex: 'contractNo', key: 'no', render: (_: unknown, r: Record<string, unknown>) => String(r.contractNo ?? (r.cityId ? String(r.cityId).slice(0, 8) : '-')) },
                { title: '超额（元）', dataIndex: 'overrunFen', key: 'of', render: (v: number) => <Tag color="red">{fenToYuan(Number(v))}</Tag> },
              ]}
            />
          </Card>
        </Col>
      </Row>
      <Drawer title="合同经营详情" open={contractDetailOpen} onClose={() => setContractDetailOpen(false)} width={760} loading={contractDetailLoading}>
        {contractDetail && <>
          <Card size="small" title={contractDetail.contract.contractNo} style={{ marginBottom: 12 }}>
            <p>{contractDetail.contract.contractName}</p>
            <Space wrap>
              <Tag>合同额 {fenToYuan(contractDetail.progress.contractAmountFen)} 元</Tag>
              <Tag color={contractDetail.progress.overrunFen > 0 ? 'red' : 'green'}>累计完工 {fenToYuan(contractDetail.progress.totalCompletionFen)} 元</Tag>
              <Tag>订单完工 {fenToYuan(contractDetail.progress.orderCompletionFen)} 元</Tag>
              <Tag>线下完工 {fenToYuan(contractDetail.progress.offlineCompletionFen)} 元</Tag>
              <Tag color={contractDetail.progress.overrunFen > 0 ? 'red' : 'blue'}>{contractDetail.progress.overrunFen > 0 ? `超额 ${fenToYuan(contractDetail.progress.overrunFen)} 元` : `剩余 ${fenToYuan(contractDetail.progress.remainingFen)} 元`}</Tag>
            </Space>
            <Progress percent={Math.min(100, Math.round(contractDetail.progress.progress * 100) / 100)} status={contractDetail.progress.overrunFen > 0 ? 'exception' : 'active'} style={{ marginTop: 14 }} />
          </Card>
          <Card size="small" title="地市分配与完工情况">
            <Table size="small" rowKey="cityId" pagination={false} dataSource={contractDetail.allocations} scroll={{ x: 'max-content' }} columns={[
              { title: '地市', dataIndex: 'cityName', key: 'cityName' },
              { title: '分配额（元）', dataIndex: 'quotaFen', key: 'quotaFen', render: (value: number) => fenToYuan(value) },
              { title: '订单完工（元）', dataIndex: 'orderCompletionFen', key: 'orderCompletionFen', render: (value: number) => fenToYuan(value) },
              { title: '线下完工（元）', dataIndex: 'offlineCompletionFen', key: 'offlineCompletionFen', render: (value: number) => fenToYuan(value) },
              { title: '累计完工（元）', dataIndex: 'completionFen', key: 'completionFen', render: (value: number) => fenToYuan(value) },
              { title: '进度', dataIndex: 'progress', key: 'progress', render: (value: number) => `${value.toFixed(1)}%` },
              { title: '状态', dataIndex: 'status', key: 'status' },
            ]} />
          </Card>
        </>}
      </Drawer>
      <Drawer
        title={cityDetail ? `${String(cityDetail.summary.cityName ?? cityDetail.summary.cityId ?? '地市')}经营明细` : '地市经营明细'}
        open={cityDetailOpen}
        onClose={() => setCityDetailOpen(false)}
        width={980}
        loading={cityDetailLoading}
      >
        {cityDetail && <>
          <Descriptions bordered size="small" column={3} style={{ marginBottom: 16 }}>
            <Descriptions.Item label="合同数">{Number(cityDetail.summary.contractCount) || 0}</Descriptions.Item>
            <Descriptions.Item label="合同额（元）">{fenToYuan(Number(cityDetail.summary.contractAmountFen) || 0)}</Descriptions.Item>
            <Descriptions.Item label="订单完工（元）">{fenToYuan(Number(cityDetail.summary.orderCompletionFen) || 0)}</Descriptions.Item>
            <Descriptions.Item label="线下完工（元）">{fenToYuan(Number(cityDetail.summary.offlineCompletionFen) || 0)}</Descriptions.Item>
            <Descriptions.Item label="成本（元）">{fenToYuan(Number(cityDetail.summary.costFen) || 0)}</Descriptions.Item>
            <Descriptions.Item label="净利（元）">{fenToYuan(Number(cityDetail.summary.netProfitFen) || 0)}</Descriptions.Item>
          </Descriptions>
          <Tabs items={[
            { key: 'contracts', label: `合同（${cityDetail.contracts.length}）`, children: <Table size="small" rowKey="id" scroll={{ x: 'max-content' }} pagination={{ pageSize: 10 }} dataSource={cityDetail.contracts} columns={[
              { title: '合同编号', dataIndex: 'contractNo', key: 'contractNo' },
              { title: '合同名称', dataIndex: 'contractName', key: 'contractName', ellipsis: true },
              { title: '合同额（元）', dataIndex: 'taxInclusiveAmountFen', key: 'amount', render: (value: number) => fenToYuan(Number(value) || 0) },
              { title: '状态', dataIndex: 'status', key: 'status' },
            ]} /> },
            { key: 'orders', label: `订单完工（${cityDetail.orders.length}${cityDetail.orderTotal > cityDetail.orders.length ? ` / ${cityDetail.orderTotal}` : ''}）`, children: <Table size="small" rowKey="id" scroll={{ x: 'max-content' }} pagination={{ pageSize: 10 }} dataSource={cityDetail.orders} columns={[
              { title: '业务月份', dataIndex: 'businessMonth', key: 'businessMonth', render: (value: string) => formatMonth(value) },
              { title: '订单号', dataIndex: 'purchaseOrderNo', key: 'purchaseOrderNo' },
              { title: '项目名称', dataIndex: 'projectName', key: 'projectName', ellipsis: true },
              { title: '完工（元）', dataIndex: 'completionAmountFen', key: 'completion', render: (value: number) => fenToYuan(Number(value) || 0) },
              { title: '校验状态', dataIndex: 'validationStatus', key: 'status' },
            ]} /> },
            { key: 'costs', label: `成本（${cityDetail.costs.length}）`, children: <Table size="small" rowKey="id" scroll={{ x: 'max-content' }} pagination={{ pageSize: 10 }} dataSource={cityDetail.costs} columns={[
              { title: '业务月份', dataIndex: 'businessMonth', key: 'businessMonth', render: (value: string) => formatMonth(value) },
              { title: '成本分类', dataIndex: 'categoryCode', key: 'categoryCode' },
              { title: '金额（元）', dataIndex: 'amountFen', key: 'amount', render: (value: number) => fenToYuan(Number(value) || 0) },
              { title: '状态', dataIndex: 'status', key: 'status' },
              { title: '说明', dataIndex: 'description', key: 'description', ellipsis: true },
            ]} /> },
          ]} />
        </>}
      </Drawer>
    </div>
  );
}
