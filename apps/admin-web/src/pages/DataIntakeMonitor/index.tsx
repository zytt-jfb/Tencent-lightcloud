import { useEffect, useState } from 'react';
import { Alert, Button, Card, Descriptions, Drawer, Empty, Select, Space, Table, Tag, Typography } from 'antd';
import { EyeOutlined, ReloadOutlined } from '@ant-design/icons';
import type { FactImportLifecycleStatus } from '@biz-reporting/shared-types';
import { listAdminCities, type AdminCityItem } from '@/api/cities.api';
import { factBatchesApi, type FactImportBatchDetail, type FactImportBatchItem } from '@/api/fact-batches.api';
import { showRequestError } from '@/utils/request';

const { Title, Text } = Typography;
const statusMeta: Record<FactImportLifecycleStatus, { label: string; color: string; description: string }> = {
  processing: { label: '处理中', color: 'processing', description: '当前有效数据保持不变' },
  current_effective: { label: '当前有效', color: 'success', description: '校验通过并已生效' },
  effective_with_warning: { label: '有警告，已生效', color: 'warning', description: '非阻塞问题已保留' },
  validation_failed: { label: '校验失败', color: 'error', description: '未更新业务数据' },
};
function JsonBlock({ value }: { value: unknown }) {
  return <pre style={{ maxHeight: 320, overflow: 'auto', padding: 12, margin: 0, background: '#f6f8f7', border: '1px solid #e5e8e6', fontSize: 12 }}>{JSON.stringify(value, null, 2)}</pre>;
}
export default function DataIntakeMonitor() {
  const [cities, setCities] = useState<AdminCityItem[]>([]);
  const [cityId, setCityId] = useState<number>();
  const [items, setItems] = useState<FactImportBatchItem[]>([]);
  const [detail, setDetail] = useState<FactImportBatchDetail>();
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    void listAdminCities()
      .then((value) => setCities(value.filter((item) => !item.isDeleted)))
      .catch((error) => showRequestError(error, '地市列表加载失败'));
  }, []);
  const load = async () => { setLoading(true); try { setItems(await factBatchesApi.adminList(cityId)); } catch (error) { showRequestError(error, '接入批次加载失败'); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, [cityId]);
  const open = async (id: number) => { try { setDetail(await factBatchesApi.adminDetail(id)); } catch (error) { showRequestError(error, '批次详情加载失败'); } };
  return <Space direction="vertical" size={16} style={{ width: '100%' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}><div><Title level={3} style={{ margin: 0 }}>数据接入</Title><Text type="secondary">监控文件解析、质量校验、生效结果与版本血缘。</Text></div><Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>刷新</Button></div>
    <Alert showIcon type="info" message="自动生效规则" description="无阻塞问题直接生成当前有效版本；警告随版本保留；校验失败不会更新业务事实。" />
    <Card size="small"><Select allowClear showSearch optionFilterProp="label" placeholder="全部地市" value={cityId} style={{ width: 180 }} options={cities.map((city) => ({ value: city.id, label: city.name }))} onChange={setCityId} /></Card>
    <Card styles={{ body: { padding: 0 } }}><Table rowKey="id" loading={loading} dataSource={items} locale={{ emptyText: <Empty description="暂无接入批次" /> }} pagination={{ pageSize: 20 }} scroll={{ x: 1050 }} columns={[
      { title: '批次', dataIndex: 'id', width: 85, render: (value) => `#${value}` }, { title: '文件', dataIndex: 'sourceFileName', ellipsis: true },
      { title: '类型', dataIndex: 'factKind', width: 90, render: (value) => value === 'cost' ? '成本' : '订单' },
      { title: '状态', dataIndex: 'lifecycleStatus', width: 160, render: (value: FactImportLifecycleStatus) => <Tag color={statusMeta[value].color}>{statusMeta[value].label}</Tag> },
      { title: '结果说明', dataIndex: 'lifecycleStatus', width: 180, render: (value: FactImportLifecycleStatus) => statusMeta[value].description },
      { title: '成功/总行', width: 110, render: (_, row) => `${row.successRows}/${row.totalRows}` },
      { title: '警告', dataIndex: 'warningCount', width: 75 }, { title: '阻塞', dataIndex: 'blockingErrorCount', width: 75 },
      { title: '生效时间', dataIndex: 'effectiveAt', width: 175, render: (value) => value ? new Date(value).toLocaleString('zh-CN') : '-' },
      { title: '操作', width: 70, fixed: 'right', render: (_, row) => <Button type="text" aria-label="查看接入批次详情" icon={<EyeOutlined />} onClick={() => void open(row.id)} /> },
    ]} /></Card>
    <Drawer width={780} title={detail ? `接入批次 #${detail.id}` : '接入批次'} open={Boolean(detail)} onClose={() => setDetail(undefined)}>{detail && <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Descriptions bordered size="small" column={2} items={[{ key: 'status', label: '生效状态', children: <Tag color={statusMeta[detail.lifecycleStatus].color}>{statusMeta[detail.lifecycleStatus].label}</Tag> }, { key: 'file', label: '来源文件', children: detail.sourceFileName }, { key: 'rows', label: '行数', children: `${detail.successRows} 成功 / ${detail.totalRows} 总计` }, { key: 'quality', label: '质量', children: `${detail.warningCount} 警告 / ${detail.blockingErrorCount} 阻塞` }, { key: 'hash', label: 'SHA-256', span: 2, children: <Text code copyable>{detail.sourceFileSha256}</Text> }, { key: 'lineage', label: '血缘', span: 2, children: `${detail.lineage.sourceRows.length} 来源行 / ${detail.lineage.costFacts.length + detail.lineage.orderFacts.length} 事实 / ${detail.lineage.factVersions.length} 版本 / ${detail.lineage.operationLogIds.length} 审计` }]} />
      {detail.lifecycleStatus === 'validation_failed' && <Alert type="error" showIcon message="业务数据未更新，上一有效版本继续使用" />}
      {detail.lifecycleStatus === 'effective_with_warning' && <Alert type="warning" showIcon message="业务数据已生效，非阻塞警告随版本保留" />}
      <JsonBlock value={detail.errors ?? detail.result} />
    </Space>}</Drawer>
  </Space>;
}
