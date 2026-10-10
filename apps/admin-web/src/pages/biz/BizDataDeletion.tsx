import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Cascader, Input, Modal, Select, Space, Spin, Table, Tag, Typography, message } from 'antd';
import { DeleteOutlined, DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import { exportPageRows } from '@/utils/page-export-core';
import dayjs from 'dayjs';
import {
  bizMe, bizSuperDelete, bizSuperDeleteList, bizSuperDeleteResources,
  type BizSuperDeleteListItem, type BizSuperDeleteResource,
} from '@/api/biz.api';

const { Title, Text } = Typography;

export default function BizDataDeletion() {
  const navigate = useNavigate();
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [resources, setResources] = useState<Array<{ code: BizSuperDeleteResource; label: string }>>([]);
  const [resource, setResource] = useState<BizSuperDeleteResource>('order-import-record');
  const [resourcePath, setResourcePath] = useState<string[]>([]);
  const [items, setItems] = useState<BizSuperDeleteListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [targetId, setTargetId] = useState('');

  useEffect(() => {
    void bizMe().then((me) => {
      const allowed = me.roleCode === 'super_admin';
      setAuthorized(allowed);
      if (!allowed) navigate('/biz/portal', { replace: true });
    }).catch(() => setAuthorized(false));
  }, [navigate]);

  const loadResources = useCallback(async () => {
    const result = await bizSuperDeleteResources();
    setResources(result.items);
    if (!result.items.some((item) => item.code === resource) && result.items[0]) setResource(result.items[0].code);
  }, [resource]);

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const result = await bizSuperDeleteList(resource);
      setItems(result.items);
    } catch (error: unknown) {
      const detail = (error as { response?: { data?: { message?: string } } }).response?.data?.message;
      message.error(detail ?? '数据加载失败');
    } finally {
      setLoading(false);
    }
  }, [resource]);

  useEffect(() => {
    if (authorized !== true) return;
    void loadResources();
  }, [authorized, loadResources]);

  useEffect(() => {
    if (authorized !== true) return;
    void loadItems();
  }, [authorized, loadItems]);

  const confirmDelete = (id: string, label: string) => {
    Modal.confirm({
      title: '永久删除数据',
      content: `将永久删除“${label}”及其自有明细，其他业务对象不受影响。此操作不可恢复。`,
      okText: '确认删除',
      okButtonProps: { danger: true },
      onOk: async () => {
        const result = await bizSuperDelete(resource, id);
        const total = Object.values(result.deleted).reduce((sum, count) => sum + count, 0);
        message.success(`已删除 ${total} 条数据`);
        if (targetId === id) setTargetId('');
        await loadItems();
      },
    });
  };

  if (authorized !== true) {
    return <div style={{ minHeight: 240, display: 'grid', placeItems: 'center' }}><Spin tip="正在验证超级管理员权限" /></div>;
  }

  const selectedLabel = resources.find((item) => item.code === resource)?.label ?? resource;
  const deletionHierarchy = [
    { value: 'maintenance', label: '维护管理', children: [
      { value: 'personnel', label: '人员管理', children: [{ value: 'maintenance-personnel', label: '人员记录' }] },
      { value: 'assets', label: '资产管理', children: [{ value: 'maintenance-vehicle', label: '车辆记录' }, { value: 'maintenance-generator', label: '油机记录' }] },
    ] },
    { value: 'operation', label: '经营管理', children: [
      { value: 'contracts', label: '合同管理', children: ['contract-import-record', 'contract', 'contract-allocation', 'contract-fee-rate', 'contract-alert'].map(code => ({ value: code, label: resources.find(row => row.code === code)?.label ?? code })) },
      { value: 'orders', label: '订单管理', children: ['order-import-record', 'order-row'].map(code => ({ value: code, label: resources.find(row => row.code === code)?.label ?? code })) },
      { value: 'completion', label: '完工管理', children: [{ value: 'offline-completion', label: '完工记录' }] },
      { value: 'costs', label: '成本管理', children: ['cost-entry', 'cost-category'].map(code => ({ value: code, label: resources.find(row => row.code === code)?.label ?? code })) },
    ] },
    { value: 'system', label: '系统设置', children: [
      { value: 'regions', label: '省市设置', children: ['province', 'city', 'city-alias'].map(code => ({ value: code, label: resources.find(row => row.code === code)?.label ?? code })) },
      { value: 'communications', label: '消息与公告', children: ['announcement', 'announcement-read', 'message'].map(code => ({ value: code, label: resources.find(row => row.code === code)?.label ?? code })) },
      { value: 'audit', label: '审计日志', children: [{ value: 'operation-log', label: '操作日志' }] },
    ] },
  ];
  const columns = [
    { title: '记录', dataIndex: 'label', key: 'label', ellipsis: true },
    { title: '摘要', dataIndex: 'details', key: 'details', ellipsis: true },
    { title: '创建时间', dataIndex: 'createdAt', key: 'createdAt', width: 170, render: (value: string | null) => value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '-' },
    { title: '记录 ID', dataIndex: 'id', key: 'id', width: 270, ellipsis: true, render: (value: string) => <Text code>{value}</Text> },
    { title: '操作', key: 'action', width: 100, render: (_: unknown, row: BizSuperDeleteListItem) => <Button size="small" danger icon={<DeleteOutlined />} onClick={() => confirmDelete(row.id, row.label)}>删除</Button> },
  ];

  return (
    <div className="v3-content">
      <div className="v3-page-head">
        <div className="v3-page-titles"><Title level={4} style={{ margin: 0 }}>数据删除</Title></div>
        <Space><Button icon={<DownloadOutlined />} disabled={!items.length} onClick={() => exportPageRows('数据删除记录', items)}>导出 Excel</Button><Button icon={<ReloadOutlined />} onClick={() => void loadItems()}>刷新</Button></Space>
      </div>
      <Card>
        <Space wrap style={{ marginBottom: 16 }}>
          <Cascader placeholder="选择门户 / 模块 / 数据内容" value={resourcePath} style={{ width: 340 }} options={deletionHierarchy} displayRender={(labels) => labels.join(' / ')} onChange={(path) => { const nextPath = (path ?? []) as string[]; setResourcePath(nextPath); const code = nextPath[nextPath.length - 1]; if (code && resources.some(item => item.code === code)) { setResource(code as BizSuperDeleteResource); setTargetId(''); } }} />
          <Input value={targetId} onChange={(event) => setTargetId(event.target.value)} placeholder="输入记录 ID 精确删除" style={{ width: 330 }} />
          <Button danger icon={<DeleteOutlined />} disabled={!targetId.trim()} onClick={() => confirmDelete(targetId.trim(), `${selectedLabel}（指定 ID）`)}>删除指定记录</Button>
          <Tag color="red">永久删除</Tag>
        </Space>
        <Table scroll={{ x: 'max-content' }} rowKey="id" loading={loading} columns={columns} dataSource={items} pagination={{ pageSize: 20, showSizeChanger: false }} />
      </Card>
    </div>
  );
}
