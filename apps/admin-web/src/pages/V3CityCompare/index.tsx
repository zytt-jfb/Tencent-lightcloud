import { useEffect, useMemo, useState } from 'react';
import { Alert, Card, Empty, Select, Space, Table, Typography } from 'antd';
import type { FactAggregateResponse } from '@biz-reporting/shared-types';
import { useSearchParams } from 'react-router-dom';
import { factsApi } from '@/api/facts.api';
import { listAdminCities, type AdminCityItem } from '@/api/cities.api';
import { cityIdsFromSearch, singleMonth } from '@/utils/v3-context';
import { showRequestError } from '@/utils/request';

const { Title, Text } = Typography;
const money = (value: number) => Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function V3CityCompare() {
  const [search, setSearch] = useSearchParams();
  const [cities, setCities] = useState<AdminCityItem[]>([]);
  const [data, setData] = useState<FactAggregateResponse>();
  const [loading, setLoading] = useState(false);
  const cityIds = cityIdsFromSearch(search);
  const query = useMemo(() => ({ cityIds, year: Number(search.get('year') || new Date().getFullYear()), month: singleMonth(search) }), [cityIds, search]);
  useEffect(() => {
    void listAdminCities()
      .then((items) => setCities(items.filter((item) => !item.isDeleted)))
      .catch((error) => showRequestError(error, '地市列表加载失败'));
  }, []);
  useEffect(() => {
    if (cityIds.length < 2 || cityIds.length > 5) { setData(undefined); return; }
    setLoading(true);
    void factsApi.adminSummary(query)
      .then(setData)
      .catch((error) => showRequestError(error, '地市对比加载失败'))
      .finally(() => setLoading(false));
  }, [query]);
  const setCitiesInUrl = (values: number[]) => { const next = new URLSearchParams(search); if (values.length) { next.set('cities', values.join(',')); } else { next.delete('cities'); } setSearch(next); };
  return <Space direction="vertical" size={16} style={{ width: '100%' }}>
    <div><Title level={3} style={{ margin: 0 }}>地市测算</Title><Text type="secondary">2–5 个地市使用同一期间与指标口径进行横向比较。</Text></div>
    <Card size="small"><Select aria-label="选择对比地市" mode="multiple" maxCount={5} value={cityIds} placeholder="选择 2–5 个地市" style={{ minWidth: 320, maxWidth: 560 }} options={cities.map((city) => ({ value: city.id, label: city.name }))} onChange={setCitiesInUrl} /></Card>
    {cityIds.length < 2 ? <Alert showIcon type="info" message="至少选择 2 个地市开始对比" /> : cityIds.length > 5 ? <Alert showIcon type="error" message="最多选择 5 个地市" /> : <Card styles={{ body: { padding: 0 } }}><Table rowKey="cityId" loading={loading} dataSource={data?.cities ?? []} locale={{ emptyText: <Empty description="所选范围暂无当前有效数据" /> }} pagination={false} scroll={{ x: 900 }} columns={[
      { title: '地市', dataIndex: 'cityName', fixed: 'left', width: 120 }, { title: '合同数', dataIndex: 'contractCount', width: 90 }, { title: '数据月份', dataIndex: 'dataMonthCount', width: 100 },
      { title: '验收审定', render: (_, row) => money(row.totals.acceptanceAmount), align: 'right' }, { title: '订单金额', render: (_, row) => money(row.totals.orderAmount), align: 'right' },
      { title: '实际成本', render: (_, row) => money(row.totals.actualCost), align: 'right' }, { title: '毛利润', render: (_, row) => money(row.totals.grossProfit), align: 'right' },
      { title: '实际净利润', render: (_, row) => money(row.totals.actualNetProfit), align: 'right' },
    ]} /></Card>}
  </Space>;
}
