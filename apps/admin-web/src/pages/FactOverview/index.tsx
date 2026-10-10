import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, DatePicker, Input, Select, Space, Statistic, Table, Tabs, Typography } from 'antd';
import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import type { CostFactItem, FactAggregateResponse, FactListQuery, OrderFactItem } from '@biz-reporting/shared-types';
import dayjs from 'dayjs';
import { useSearchParams } from 'react-router-dom';
import { listAdminCities, type AdminCityItem } from '@/api/cities.api';
import { factsApi } from '@/api/facts.api';
import { showRequestError } from '@/utils/request';
import { exportPageWorkbook } from '@/utils/page-export';
import { cityIdsFromSearch, singleMonth } from '@/utils/v3-context';

const { Title, Text } = Typography;
const money = (value: number) => Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function FactOverview() {
  const [search, setSearch] = useSearchParams();
  const [cities, setCities] = useState<AdminCityItem[]>([]);
  const cityIds = cityIdsFromSearch(search);
  const year = Number(search.get('year') || dayjs().year());
  const month = singleMonth(search);
  const setSharedFilter = (key: 'year' | 'months' | 'cities', value?: string) => { const next = new URLSearchParams(search); if (value) { next.set(key, value); } else { next.delete(key); } next.delete('page'); setSearch(next); };
  const [sourceType, setSourceType] = useState<string>();
  const [keyword, setKeyword] = useState('');
  const [costCategory, setCostCategory] = useState<string>();
  const [orderStatus, setOrderStatus] = useState<string>();
  const [summary, setSummary] = useState<FactAggregateResponse>();
  const [costs, setCosts] = useState<CostFactItem[]>([]);
  const [orders, setOrders] = useState<OrderFactItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    void listAdminCities()
      .then((data) => setCities(data.filter((item) => !item.isDeleted)))
      .catch((error) => showRequestError(error, '地市列表加载失败'));
  }, []);

  const query = useMemo<FactListQuery>(() => ({
    cityIds,
    year,
    month,
    sourceType,
    keyword: keyword.trim() || undefined,
  }), [cityIds, keyword, month, sourceType, year]);

  const load = async () => {
    setLoading(true);
    try {
      const [nextSummary, costPage, orderPage] = await Promise.all([
        factsApi.adminSummary(query),
        factsApi.adminCosts({ ...query, costCategory, page: 1, pageSize: 10000 }),
        factsApi.adminOrders({ ...query, orderStatus, page: 1, pageSize: 10000 }),
      ]);
      setSummary(nextSummary);
      setCosts(costPage.items);
      setOrders(orderPage.items);
    } catch (error) {
      showRequestError(error, '事实数据加载失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [query, costCategory, orderStatus]);

  const scopeLabel = cityIds.length === 0
    ? '全省'
    : cities.filter((city) => cityIds.includes(city.id)).map((city) => city.name).join('、');

  const exportCurrent = async () => {
    if (exporting || (!summary?.items.length && !costs.length && !orders.length)) return;
    setExporting(true);
    try {
      await exportPageWorkbook({
        pageName: '事实数据查询',
        scope: scopeLabel,
        period: `${year}年${month ? `${month}月` : ''}`,
        filters: { cityIds: cityIds.join(','), year, month, sourceType, keyword, costCategory, orderStatus },
        rowCount: (summary?.items.length ?? 0) + costs.length + orders.length,
        sheets: [
          { name: '合同经营汇总', moneyColumns: [3, 4, 5, 6, 7, 8, 9], percentColumns: [10], rows: [
            ['地市', '合同编码', '合同名称', '立项完工', '验收审定', '开票', '订单', '实际成本', '实际净利润', '生效管理费率'],
            ...(summary?.items ?? []).map((item) => [item.cityName, item.contractCode, item.contractName, item.completionAmount, item.acceptanceAmount, item.invoiceAmount, item.orderAmount, item.actualCost, item.actualNetProfit, item.effectiveRate]),
          ] },
          { name: '成本明细', moneyColumns: [5], rows: [
            ['地市', '日期', '合同编码', '成本类别', '事由', '金额', '来源', '更新时间'],
            ...costs.map((item) => [item.cityName, item.occurredOn, item.contractCode, item.costCategoryCode, item.description, item.amount, item.sourceType, item.updatedAt]),
          ] },
          { name: '订单明细', moneyColumns: [6], rows: [
            ['地市', '采购订单编号', '订单状态', '合同编码', '物料编码', '物料名称', '含税金额', '下单时间', '来源'],
            ...orders.map((item) => [item.cityName, item.purchaseOrderNo, item.orderStatus, item.contractCode, item.materialCode, item.materialName, item.taxInclusiveAmount, item.orderedAt, item.sourceType]),
          ] },
        ],
      });
    } catch (error) {
      showRequestError(error, '导出失败，请稍后重试');
    } finally {
      setExporting(false);
    }
  };

  return <Space direction="vertical" size={16} style={{ width: '100%' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
      <div><Title level={3} style={{ margin: 0 }}>事实数据查询</Title><Text type="secondary">支持全省、单地市或多地市范围，页面与导出共用当前筛选结果。</Text></div>
      <Space>
        <Button icon={<DownloadOutlined />} loading={exporting} disabled={!summary?.items.length && !costs.length && !orders.length} onClick={() => void exportCurrent()}>导出本页</Button>
        <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>刷新</Button>
      </Space>
    </div>
    <Card size="small"><Space wrap>
      <Select mode="multiple" allowClear maxTagCount="responsive" placeholder="全省（可选择多个地市）" value={cityIds} style={{ minWidth: 260, maxWidth: 480 }} options={cities.map((city) => ({ value: city.id, label: city.name }))} onChange={(value) => setSharedFilter('cities', value.length ? value.join(',') : undefined)} />
      <DatePicker picker="year" value={dayjs().year(year)} onChange={(value) => value && setSharedFilter('year', String(value.year()))} allowClear={false} />
      <Select allowClear placeholder="月份" value={month} style={{ width: 100 }} options={Array.from({ length: 12 }, (_, index) => ({ value: index + 1, label: `${index + 1}月` }))} onChange={(value) => setSharedFilter('months', value ? String(value) : undefined)} />
      <Select allowClear placeholder="来源" value={sourceType} style={{ width: 190 }} options={[
        { value: 'excel_daily_reimbursement', label: '日常报销 Excel' }, { value: 'excel_mileage_subsidy', label: '里程油补 Excel' },
        { value: 'excel_standard_cost', label: '标准成本模板' }, { value: 'excel_ecommerce_order', label: '电商订单 Excel' },
        { value: 'manual', label: '在线维护' }, { value: 'reversal', label: '冲销' },
      ]} onChange={setSourceType} />
      <Select allowClear placeholder="成本类别" value={costCategory} style={{ width: 130 }} options={['labor', 'fuel', 'entertainment', 'reimbursement', 'other'].map((value) => ({ value, label: value }))} onChange={setCostCategory} />
      <Select allowClear placeholder="订单状态" value={orderStatus} style={{ width: 130 }} options={['已下单', '已收货', '已取消', '冲销'].map((value) => ({ value, label: value }))} onChange={setOrderStatus} />
      <Input allowClear placeholder="合同、订单或事由关键词" value={keyword} style={{ width: 220 }} onChange={(event) => setKeyword(event.target.value)} />
    </Space></Card>
    <Alert showIcon type="info" message="实际成本与成本预算分别统计；订单按来源行含税金额求和，负数与取消订单作为合法冲销计入。" />
    <Card loading={loading}><Space size={48} wrap>
      <Statistic title="立项完工" value={money(summary?.totals.completionAmount ?? 0)} />
      <Statistic title="验收审定" value={money(summary?.totals.acceptanceAmount ?? 0)} />
      <Statistic title="开票金额" value={money(summary?.totals.invoiceAmount ?? 0)} />
      <Statistic title="订单金额" value={money(summary?.totals.orderAmount ?? 0)} />
      <Statistic title="实际成本" value={money(summary?.totals.actualCost ?? 0)} />
      <Statistic title="实际净利润" value={money(summary?.totals.actualNetProfit ?? 0)} />
    </Space></Card>
    <Card styles={{ body: { paddingTop: 8 } }}><Tabs items={[
      { key: 'summary', label: `合同汇总（${summary?.items.length ?? 0}）`, children: <Table rowKey={(row) => `${row.cityId}:${row.contractId}`} loading={loading} dataSource={summary?.items ?? []} pagination={{ pageSize: 20, showSizeChanger: true }} scroll={{ x: 1200 }} columns={[
        { title: '地市', dataIndex: 'cityName', fixed: 'left', width: 90 }, { title: '合同编码', dataIndex: 'contractCode', width: 180 }, { title: '合同名称', dataIndex: 'contractName', width: 220 },
        { title: '立项完工', dataIndex: 'completionAmount', align: 'right', render: money }, { title: '验收审定', dataIndex: 'acceptanceAmount', align: 'right', render: money }, { title: '开票', dataIndex: 'invoiceAmount', align: 'right', render: money },
        { title: '订单', dataIndex: 'orderAmount', align: 'right', render: money }, { title: '实际成本', dataIndex: 'actualCost', align: 'right', render: money }, { title: '实际净利润', dataIndex: 'actualNetProfit', align: 'right', render: money },
      ]} /> },
      { key: 'costs', label: `成本明细（${costs.length}）`, children: <Table rowKey="id" loading={loading} dataSource={costs} pagination={{ pageSize: 20, showSizeChanger: true }} scroll={{ x: 1000 }} columns={[
        { title: '地市', dataIndex: 'cityName', width: 90 }, { title: '日期', dataIndex: 'occurredOn', width: 110 }, { title: '合同', dataIndex: 'contractCode', width: 180 }, { title: '类别', dataIndex: 'costCategoryCode', width: 120 }, { title: '事由', dataIndex: 'description', width: 240 }, { title: '金额', dataIndex: 'amount', align: 'right', render: money }, { title: '来源', dataIndex: 'sourceType', width: 180 },
      ]} /> },
      { key: 'orders', label: `订单明细（${orders.length}）`, children: <Table rowKey="id" loading={loading} dataSource={orders} pagination={{ pageSize: 20, showSizeChanger: true }} scroll={{ x: 1100 }} columns={[
        { title: '地市', dataIndex: 'cityName', width: 90 }, { title: '采购订单编号', dataIndex: 'purchaseOrderNo', width: 190 }, { title: '状态', dataIndex: 'orderStatus', width: 100 }, { title: '合同', dataIndex: 'contractCode', width: 180 }, { title: '物料', dataIndex: 'materialName', width: 220 }, { title: '含税金额', dataIndex: 'taxInclusiveAmount', align: 'right', render: money }, { title: '来源', dataIndex: 'sourceType', width: 180 },
      ]} /> },
    ]} /></Card>
  </Space>;
}

