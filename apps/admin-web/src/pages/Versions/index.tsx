import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Descriptions, Drawer, Empty, Select, Space, Table, Tabs, Tag, Typography } from 'antd';
import { EyeOutlined, ReloadOutlined } from '@ant-design/icons';
import type { FactKind, FactVersionItem, FactVersionLifecycleStatus, OperationLogListResponse } from '@biz-reporting/shared-types';
import { useSearchParams } from 'react-router-dom';
import { factsApi } from '@/api/facts.api';
import { auditApi } from '@/api/audit.api';
import { cityIdsFromSearch, singleMonth } from '@/utils/v3-context';
import { showRequestError } from '@/utils/request';

const { Title, Text } = Typography;
const statusMeta: Record<FactVersionLifecycleStatus, { label: string; color: string }> = {
  current_effective: { label: '当前有效', color: 'success' },
  effective_with_warning: { label: '有警告，已生效', color: 'warning' },
  replaced: { label: '已被替代', color: 'default' },
};

function JsonBlock({ value }: { value: unknown }) {
  return <pre style={{ maxHeight: 360, overflow: 'auto', margin: 0, padding: 12, background: '#f6f8f7', border: '1px solid #e5e8e6', fontSize: 12 }}>{JSON.stringify(value, null, 2)}</pre>;
}

export default function Versions({ admin }: { admin: boolean }) {
  const [search, setSearch] = useSearchParams();
  const [items, setItems] = useState<FactVersionItem[]>([]);
  const [total, setTotal] = useState(0);
  const [audit, setAudit] = useState<OperationLogListResponse>();
  const [selected, setSelected] = useState<FactVersionItem>();
  const [loading, setLoading] = useState(false);
  const factKind = (search.get('factKind') || undefined) as FactKind | undefined;
  const lifecycleStatus = (search.get('status') || undefined) as FactVersionLifecycleStatus | undefined;
  const page = Math.max(1, Number(search.get('page') || 1));
  const query = useMemo(() => ({
    year: Number(search.get('year') || new Date().getFullYear()), month: singleMonth(search), cityIds: admin ? cityIdsFromSearch(search) : undefined,
    factKind, lifecycleStatus, page, pageSize: 20,
  }), [admin, factKind, lifecycleStatus, page, search]);

  const load = async () => {
    setLoading(true);
    try {
      const [versions, logs] = await Promise.all([
        admin ? factsApi.adminVersions(query) : factsApi.cityVersions(query),
        admin ? auditApi.list({ page: 1, pageSize: 20, cityId: query.cityIds?.length === 1 ? query.cityIds[0] : undefined }) : Promise.resolve(undefined),
      ]);
      setItems(versions.items);
      setTotal(versions.total);
      setAudit(logs);
    } catch (error) { showRequestError(error, '版本与审计加载失败'); } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [query]);
  const setFilter = (key: string, value?: string | number) => { const next = new URLSearchParams(search); if (value) { next.set(key, String(value)); } else { next.delete(key); } if (key !== 'page') next.delete('page'); setSearch(next); };

  return <Space direction="vertical" size={16} style={{ width: '100%' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}><div><Title level={3} style={{ margin: 0 }}>{admin ? '版本与审计' : '版本历史'}</Title><Text type="secondary">默认展示当前有效版本；历史记录通过前后关系保留，不允许覆盖式修改。</Text></div><Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>刷新</Button></div>
    <Alert showIcon type="info" message="版本状态口径" description="当前有效与有警告版本均已进入业务分析；已被替代版本只读保留。校验失败批次不会生成业务版本。" />
    <Card size="small"><Space wrap><Select allowClear placeholder="全部数据类型" value={factKind} style={{ width: 150 }} options={[{ value: 'cost', label: '成本' }, { value: 'order', label: '订单' }]} onChange={(value) => setFilter('factKind', value)} /><Select allowClear placeholder="全部版本状态" value={lifecycleStatus} style={{ width: 170 }} options={Object.entries(statusMeta).map(([value, meta]) => ({ value, label: meta.label }))} onChange={(value) => setFilter('status', value)} /></Space></Card>
    <Tabs items={[
      { key: 'versions', label: `业务版本（${items.length}）`, children: <Table rowKey="id" loading={loading} dataSource={items} locale={{ emptyText: <Empty description="当前筛选无版本记录" /> }} pagination={{ current: page, pageSize: 20, total, onChange: (value) => setFilter('page', value) }} scroll={{ x: 1080 }} columns={[
        { title: '状态', dataIndex: 'lifecycleStatus', width: 150, render: (value: FactVersionLifecycleStatus) => <Tag color={statusMeta[value].color}>{statusMeta[value].label}</Tag> },
        { title: '对象', width: 120, render: (_, row) => `${row.factKind === 'cost' ? '成本' : '订单'} #${row.factId}` },
        { title: '版本', dataIndex: 'versionNo', width: 80, render: (value) => `V${value}` },
        { title: '取代版本', dataIndex: 'supersedesVersionId', width: 110, render: (value) => value ? `#${value}` : '-' },
        { title: '被取代于', dataIndex: 'supersededByVersionId', width: 110, render: (value) => value ? `#${value}` : '-' },
        { title: '来源', dataIndex: 'sourceType', width: 150 }, { title: '修改原因', dataIndex: 'reason', ellipsis: true },
        { title: '变化字段', dataIndex: 'changedFields', width: 180, render: (value: string[]) => value.slice(0, 3).join('、') || '-' },
        { title: '时间', dataIndex: 'createdAt', width: 170, render: (value) => new Date(value).toLocaleString('zh-CN') },
        { title: '操作', width: 72, fixed: 'right', render: (_, row) => <Button type="text" aria-label="查看版本详情" icon={<EyeOutlined />} onClick={() => setSelected(row)} /> },
      ]} /> },
      ...(admin ? [{ key: 'audit', label: `操作审计（${audit?.total ?? 0}）`, children: <Table rowKey="id" loading={loading} dataSource={audit?.items ?? []} pagination={false} columns={[{ title: '时间', dataIndex: 'createdAt', width: 180, render: (value) => new Date(value).toLocaleString('zh-CN') }, { title: '操作者', dataIndex: 'operatorName', width: 130, render: (value, row) => value || `用户 #${row.operatorUserId}` }, { title: '地市', dataIndex: 'operatorCityName', width: 100, render: (value) => value || '全省' }, { title: '动作', dataIndex: 'actionType', width: 150 }, { title: '对象', width: 180, render: (_, row) => `${row.targetType} #${row.targetId}` }, { title: '摘要', dataIndex: 'summaryText' }, { title: '结果', dataIndex: 'resultStatus', width: 90, render: (value) => <Tag color={value === 'success' ? 'success' : value === 'denied' ? 'warning' : 'error'}>{value}</Tag> }]} /> }] : []),
    ]} />
    <Drawer title={selected ? `版本 #${selected.id} · V${selected.versionNo}` : '版本详情'} open={Boolean(selected)} width={760} onClose={() => setSelected(undefined)}>{selected && <Space direction="vertical" size={16} style={{ width: '100%' }}><Descriptions bordered size="small" column={2} items={[{ key: 'status', label: '状态', children: <Tag color={statusMeta[selected.lifecycleStatus].color}>{statusMeta[selected.lifecycleStatus].label}</Tag> }, { key: 'reason', label: '修改原因', children: selected.reason }, { key: 'source', label: '来源', children: selected.sourceType }, { key: 'operator', label: '操作者', children: `#${selected.operatorUserId}` }, { key: 'relation', label: '版本关系', span: 2, children: `取代 #${selected.supersedesVersionId ?? '-'} / 被 #${selected.supersededByVersionId ?? '-'} 取代` }, { key: 'fields', label: '变化字段', span: 2, children: selected.changedFields.join('、') || '-' }]} />{selected.warningSummary.length > 0 && <Alert type="warning" showIcon message={`已生效，包含 ${selected.warningSummary.length} 条非阻塞警告`} />}<Tabs items={[{ key: 'before', label: '修改前', children: <JsonBlock value={selected.beforeData} /> }, { key: 'after', label: '修改后', children: <JsonBlock value={selected.afterData} /> }]} /></Space>}</Drawer>
  </Space>;
}
