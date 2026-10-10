import { Alert, Tabs } from 'antd';
import { useSearchParams } from 'react-router-dom';
import type { CurrentUser } from '@/types';
import CityOverview from '@/pages/CityOverview';
import CityContracts from '@/pages/CityContracts';
import CityCosts from '@/pages/CityCosts';
import CityOrders from '@/pages/CityOrders';
import FactOverview from '@/pages/FactOverview';
import DataIntakeMonitor from '@/pages/DataIntakeMonitor';

const CITY_VIEWS = ['summary', 'contracts', 'costs', 'orders'] as const;

export function CityDataWorkspace() {
  const [search, setSearch] = useSearchParams();
  const requested = search.get('view');
  const activeKey = CITY_VIEWS.includes(requested as (typeof CITY_VIEWS)[number]) ? requested! : 'costs';
  const changeView = (view: string) => {
    const next = new URLSearchParams(search);
    next.set('view', view);
    setSearch(next);
  };
  return <Tabs activeKey={activeKey} onChange={changeView} items={[
    { key: 'summary', label: '经营汇总', children: <CityOverview /> },
    { key: 'contracts', label: '本地合同', children: <CityContracts /> },
    { key: 'costs', label: '成本数据', children: <CityCosts /> },
    { key: 'orders', label: '订单数据', children: <CityOrders /> },
  ]} />;
}

export function AdminCityDataWorkspace() {
  return <><Alert style={{ marginBottom: 12 }} showIcon type="info" message="当前有效数据" description="默认分析与导出只读取已生效事实；查看具体变化请进入版本与审计。" /><FactOverview /></>;
}

export function DataIntakeWorkspace({ currentUser }: { currentUser: CurrentUser }) {
  if (currentUser.cityId) return <><Alert style={{ marginBottom: 12 }} showIcon type="info" message="上传后自动处理" description="无阻塞错误会直接生效；有警告仍生效；校验失败不会改动当前有效数据。" /><Tabs items={[{ key: 'costs', label: '成本上传', children: <CityCosts /> }, { key: 'orders', label: '订单上传', children: <CityOrders /> }]} /></>;
  return <DataIntakeMonitor />;
}
