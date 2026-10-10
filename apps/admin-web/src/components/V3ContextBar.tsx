import { useEffect, useState } from 'react';
import { DatePicker, Select, Space, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { useLocation, useSearchParams } from 'react-router-dom';
import { listAdminCities, type AdminCityItem } from '@/api/cities.api';
import { isAdminRole } from '@/auth/role-routing';
import type { CurrentUser } from '@/types';
import { cityIdsFromSearch } from '@/utils/v3-context';

const { Text } = Typography;
const contextPaths = ['/admin/dashboard', '/admin/overview', '/admin/city-compare', '/admin/city-data', '/city/overview', '/city/data'];

export default function V3ContextBar({ currentUser }: { currentUser: CurrentUser }) {
  const location = useLocation();
  const [search, setSearch] = useSearchParams();
  const [cities, setCities] = useState<AdminCityItem[]>([]);
  const admin = isAdminRole(currentUser.role);
  const visible = contextPaths.some((path) => location.pathname === path || location.pathname.startsWith(`${path}/`));
  useEffect(() => {
    if (!visible || !admin) return;
    let active = true;
    void listAdminCities()
      .then((items) => { if (active) setCities(items.filter((item) => !item.isDeleted)); })
      .catch(() => { if (active) setCities([]); });
    return () => { active = false; };
  }, [admin, visible]);
  if (!visible) return null;
  const year = Number(search.get('year') || dayjs().year());
  const months = (search.get('months') || '').split(',').map(Number).filter((value) => value >= 1 && value <= 12);
  const cityIds = cityIdsFromSearch(search);
  const metric = search.get('metric') || 'actualNetProfit';
  const update = (key: string, value?: string) => { const next = new URLSearchParams(search); if (value) { next.set(key, value); } else { next.delete(key); } next.delete('page'); setSearch(next); };

  return <div style={{ padding: '10px 16px', borderBottom: '1px solid #e8ebe9', background: '#fff' }}><Space wrap size={10}>
    <Text type="secondary">分析范围</Text>
    <DatePicker picker="year" value={dayjs().year(year)} allowClear={false} onChange={(value) => value && update('year', String(value.year()))} />
    <Select mode="multiple" allowClear maxTagCount="responsive" placeholder="全年" value={months} style={{ minWidth: 180, maxWidth: 320 }} options={Array.from({ length: 12 }, (_, index) => ({ value: index + 1, label: `${index + 1}月` }))} onChange={(value) => update('months', value.length ? value.sort((a, b) => a - b).join(',') : undefined)} />
    {admin ? <Select mode="multiple" allowClear maxTagCount="responsive" placeholder="全省" value={cityIds} style={{ minWidth: 220, maxWidth: 380 }} options={cities.map((city) => ({ value: city.id, label: city.name }))} onChange={(value) => update('cities', value.length ? value.join(',') : undefined)} /> : <Tag color="blue">{currentUser.cityName || '绑定地市'}</Tag>}
    <Select value={metric} style={{ width: 150 }} options={[{ value: 'actualNetProfit', label: '实际净利润' }, { value: 'acceptanceAmount', label: '验收审定' }, { value: 'orderAmount', label: '订单金额' }, { value: 'actualCost', label: '实际成本' }]} onChange={(value) => update('metric', value)} />
  </Space></div>;
}
