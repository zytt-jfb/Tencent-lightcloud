import { useEffect, useState } from 'react';
import { Button, Col, Row, Select, Space, Statistic, Table, Tag, Typography, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { maintenanceList, type MaintenanceItem } from '@/api/maintenance.api';

const kinds = ['personnel', 'vehicles', 'generators'] as const;
const labels = { personnel: '人员', vehicles: '车辆', generators: '油机' };
type Reminder = { id: string; category: string; name: string; region: string; title: string; date: string; days: number };

export default function MaintenanceOverview() {
  const [data, setData] = useState<Record<string, MaintenanceItem[]>>({});
  const [loading, setLoading] = useState(false);
  const [windowDays, setWindowDays] = useState(30);
  const load = async () => {
    setLoading(true);
    try {
      const results = await Promise.all(kinds.map(async kind => {
        const rows: MaintenanceItem[] = [];
        for (let page = 1; ; page++) {
          const result = await maintenanceList(kind, { page, pageSize: 100 });
          rows.push(...result.items);
          if (rows.length >= result.total || !result.items.length) break;
        }
        return [kind, rows] as const;
      }));
      setData(Object.fromEntries(results));
    } catch { message.error('数据总览加载失败'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  const reminders: Reminder[] = [];
  const regions: Record<string, { region: string; personnel: number; vehicles: number; generators: number }> = {};
  for (const kind of kinds) for (const item of data[kind] ?? []) {
    const region = `${item.orgProvince} / ${item.orgCompany} / ${item.orgRegion}`;
    regions[region] ??= { region, personnel: 0, vehicles: 0, generators: 0 };
    regions[region][kind]++;
    const expirations = (item.expirations ?? []) as { title: string; date: string }[];
    expirations.forEach((entry, index) => {
      const days = Math.round((Date.parse(entry.date) - Date.parse(today)) / 86400000);
      if (Number.isFinite(days) && days <= windowDays) reminders.push({ id: `${kind}-${item.id}-${index}`, category: labels[kind], name: String(item.name ?? item.plateNumber ?? item.generatorCode), region, title: entry.title, date: entry.date, days });
    });
  }
  reminders.sort((a, b) => a.days - b.days);
  return <main style={{ padding: 24 }}>
    <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 24 }}><Typography.Title level={4} style={{ margin: 0 }}>数据总览</Typography.Title><Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>刷新</Button></Space>
    <Row gutter={[24, 16]} style={{ marginBottom: 32 }}>{kinds.map(kind => <Col xs={12} md={6} key={kind}><Statistic title={`${labels[kind]}总数`} value={data[kind]?.length ?? 0} /></Col>)}<Col xs={12} md={6}><Statistic title="已到期事项" value={reminders.filter(r => r.days < 0).length} valueStyle={{ color: '#cf1322' }} /></Col></Row>
    <Space style={{ marginBottom: 16 }}><Typography.Title level={5} style={{ margin: 0 }}>到期提醒</Typography.Title><Select value={windowDays} onChange={setWindowDays} options={[7, 30, 60, 90].map(value => ({ value, label: `${value}天内到期` }))} /></Space>
    <Table loading={loading} rowKey="id" dataSource={reminders} scroll={{ x: 800 }} locale={{ emptyText: '暂无已登记的到期提醒' }} columns={[{ title: '类别', dataIndex: 'category' }, { title: '人员 / 资产', dataIndex: 'name' }, { title: '到期事项', dataIndex: 'title' }, { title: '到期日期', dataIndex: 'date' }, { title: '状态', dataIndex: 'days', render: (days: number) => <Tag color={days < 0 ? 'red' : 'orange'}>{days < 0 ? `逾期${-days}天` : days === 0 ? '今天到期' : `${days}天后到期`}</Tag> }, { title: '所属组织', dataIndex: 'region' }]} />
    <Typography.Title level={5}>组织汇总</Typography.Title>
    <Table loading={loading} rowKey="region" dataSource={Object.values(regions)} columns={[{ title: '所属组织', dataIndex: 'region' }, ...kinds.map(kind => ({ title: labels[kind], dataIndex: kind }))]} />
  </main>;
}
