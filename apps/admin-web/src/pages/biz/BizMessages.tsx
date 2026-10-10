import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Form, Input, Modal, Select, Space, Table, Tabs, Tag, Typography, message } from 'antd';
import { BellOutlined, DownloadOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import {
  bizAdminCities, bizAdminProvinces, bizAnnouncementCreate, bizAnnouncementManageList, bizAnnouncementPublish,
  bizAnnouncementUpdate, bizAnnouncementWithdraw, bizMe, bizMessageList, bizMessageMarkRead,
  type BizAnnouncementDto, type BizInboxItem,
} from '@/api/biz.api';
import { writeWorkbook } from '@/utils/page-export-core';

const { Title, Paragraph } = Typography;
type ScopeOption = { id: string; name: string; provinceId?: string };
type AnnouncementForm = BizAnnouncementDto & { id?: string };
const statusLabels: Record<string, { label: string; color: string }> = {
  draft: { label: '草稿', color: 'default' }, published: { label: '已发布', color: 'success' }, withdrawn: { label: '已撤回', color: 'warning' },
};

function errorText(error: unknown): string {
  const detail = (error as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
  return Array.isArray(detail) ? detail.join('；') : (detail ?? '操作失败');
}
function formatTime(value: string | Date | null | undefined): string { return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-'; }

export default function BizMessages() {
  const navigate = useNavigate();
  const [me, setMe] = useState<{ roleCode: string; permissions: string[] } | null>(null);
  const [inbox, setInbox] = useState<BizInboxItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [announcements, setAnnouncements] = useState<Array<Record<string, unknown>>>([]);
  const [provinces, setProvinces] = useState<ScopeOption[]>([]);
  const [cities, setCities] = useState<ScopeOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [manageLoading, setManageLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [audienceType, setAudienceType] = useState<BizAnnouncementDto['audienceType']>('province');
  const [editingId, setEditingId] = useState<string>();
  const [form] = Form.useForm<AnnouncementForm>();
  const roleCode = me?.roleCode ?? '';
  const permissions = new Set(me?.permissions ?? []);
  const canManage = roleCode === 'super_admin' || permissions.has('operation.announcement.create');
  const canPublish = roleCode === 'super_admin' || permissions.has('operation.announcement.publish');
  const provinceOptions = provinces.map((item) => ({ value: item.id, label: item.name }));
  const selectedProvince = Form.useWatch('provinceId', form);
  const cityOptions = useMemo(() => cities.filter((item) => !selectedProvince || item.provinceId === selectedProvince).map((item) => ({ value: item.id, label: item.name })), [cities, selectedProvince]);

  const loadInbox = async () => {
    setLoading(true);
    try { const result = await bizMessageList(); setInbox(result.items); setUnreadCount(result.unreadCount); } catch (error) { message.error(errorText(error)); } finally { setLoading(false); }
  };
  const loadManage = async () => {
    if (!canManage) return;
    setManageLoading(true);
    try { setAnnouncements((await bizAnnouncementManageList()).items); } catch (error) { message.error(errorText(error)); } finally { setManageLoading(false); }
  };
  useEffect(() => {
    void (async () => {
      try {
        const current = await bizMe(); setMe(current);
        const [provinceResult, cityResult] = await Promise.all([bizAdminProvinces().catch(() => ({ items: [] })), bizAdminCities().catch(() => ({ items: [] }))]);
        setProvinces(provinceResult.items.map((item) => ({ id: String(item.id), name: String(item.name) })));
        setCities(cityResult.items.map((item) => ({ id: String(item.id), name: String(item.name), provinceId: String(item.provinceId) })));
        await loadInbox();
      } catch (error) { message.error(errorText(error)); }
    })();
  }, []);
  useEffect(() => { if (canManage) void loadManage(); }, [canManage]);

  const markRead = async (item: BizInboxItem) => {
    if (item.status === 'unread') { await bizMessageMarkRead(item.id, item.source); setInbox((items) => items.map((current) => current.id === item.id && current.source === item.source ? { ...current, status: 'read' } : current)); setUnreadCount((count) => Math.max(0, count - 1)); }
    if (item.linkUrl) { if (item.linkUrl.startsWith('/biz/')) navigate(item.linkUrl); else window.open(item.linkUrl, '_blank', 'noopener,noreferrer'); }
  };
  const openCreate = () => { setEditingId(undefined); setAudienceType(roleCode === 'super_admin' ? 'all' : 'province'); form.resetFields(); form.setFieldsValue({ audienceType: roleCode === 'super_admin' ? 'all' : 'province' }); setModalOpen(true); };
  const openEdit = (item: Record<string, unknown>) => { setEditingId(String(item.id)); const nextAudience = String(item.audienceType ?? 'province') as BizAnnouncementDto['audienceType']; setAudienceType(nextAudience); form.setFieldsValue({ id: String(item.id), title: String(item.title ?? ''), content: String(item.content ?? ''), linkUrl: item.linkUrl ? String(item.linkUrl) : undefined, audienceType: nextAudience, provinceId: item.provinceId ? String(item.provinceId) : undefined, cityId: item.cityId ? String(item.cityId) : undefined, expiresAt: item.expiresAt ? new Date(String(item.expiresAt)).toISOString().slice(0, 16) : undefined }); setModalOpen(true); };
  const saveAnnouncement = async (values: AnnouncementForm) => {
    setSaving(true);
    try {
      const payload: BizAnnouncementDto = { title: values.title, content: values.content, linkUrl: values.linkUrl || null, audienceType: values.audienceType, provinceId: values.audienceType === 'province' ? values.provinceId : null, cityId: values.audienceType === 'city' ? values.cityId : null, expiresAt: values.expiresAt || null };
      if (editingId) await bizAnnouncementUpdate(editingId, payload); else await bizAnnouncementCreate(payload);
      message.success(editingId ? '公告草稿已更新' : '公告草稿已创建'); setModalOpen(false); await loadManage();
    } catch (error) { message.error(errorText(error)); } finally { setSaving(false); }
  };
  const publish = async (id: string) => { try { await bizAnnouncementPublish(id); message.success('公告已发布'); await Promise.all([loadInbox(), loadManage()]); } catch (error) { message.error(errorText(error)); } };
  const withdraw = async (id: string) => { try { await bizAnnouncementWithdraw(id); message.success('公告已撤回'); await Promise.all([loadInbox(), loadManage()]); } catch (error) { message.error(errorText(error)); } };

  const inboxColumns = [
    { title: '状态', dataIndex: 'status', key: 'status', width: 80, render: (value: string) => value === 'unread' ? <Tag color="blue">未读</Tag> : <Tag>已读</Tag> },
    { title: '类型', dataIndex: 'messageType', key: 'messageType', width: 100, render: (value: string) => value === 'announcement' ? '公告' : '流程消息' },
    { title: '标题', dataIndex: 'title', key: 'title', width: 180 },
    { title: '内容', dataIndex: 'content', key: 'content', ellipsis: true, render: (value: string) => <Paragraph ellipsis={{ rows: 2 }} style={{ margin: 0 }}>{value}</Paragraph> },
    { title: '时间', dataIndex: 'createdAt', key: 'createdAt', width: 170, render: (value: string) => formatTime(value) },
    { title: '操作', key: 'action', width: 90, render: (_: unknown, item: BizInboxItem) => item.linkUrl ? <Button type="link" size="small" onClick={() => void markRead(item)}>查看详情</Button> : <Button type="link" size="small" onClick={() => void markRead(item)}>标记已读</Button> },
  ];
  const manageColumns = [
    { title: '标题', dataIndex: 'title', key: 'title', width: 220 },
    { title: '范围', key: 'scope', width: 130, render: (_: unknown, item: Record<string, unknown>) => item.audienceType === 'all' ? '全省' : item.audienceType === 'city' ? (cities.find((city) => city.id === item.cityId)?.name ?? '指定地市') : (provinces.find((province) => province.id === item.provinceId)?.name ?? '指定省份') },
    { title: '状态', dataIndex: 'status', key: 'status', width: 100, render: (value: string) => <Tag color={statusLabels[value]?.color}>{statusLabels[value]?.label ?? value}</Tag> },
    { title: '发布时间', dataIndex: 'publishAt', key: 'publishAt', width: 170, render: (value: string | null) => formatTime(value) },
    { title: '操作', key: 'action', width: 220, render: (_: unknown, item: Record<string, unknown>) => <Space size={0}>{item.status === 'draft' && <Button type="link" size="small" onClick={() => openEdit(item)}>编辑</Button>}{canPublish && item.status === 'draft' && <Button type="link" size="small" onClick={() => void publish(String(item.id))}>发布</Button>}{canPublish && item.status === 'published' && <Button type="link" danger size="small" onClick={() => void withdraw(String(item.id))}>撤回</Button>}</Space> },
  ];

  return <div className="v3-content">
    <div className="v3-page-head"><div className="v3-page-titles"><Title level={4} style={{ margin: 0 }}><BellOutlined /> 消息中心 {unreadCount > 0 && <Tag color="blue">{unreadCount} 条未读</Tag>}</Title></div><Space><Button icon={<DownloadOutlined />} disabled={!inbox.length && !announcements.length} onClick={() => writeWorkbook('消息中心.xlsx', [{ name: '收件箱', rows: [['状态', '类型', '标题', '内容', '时间'], ...inbox.map((row) => [row.status === 'unread' ? '未读' : '已读', row.messageType, row.title, row.content, row.createdAt])] }, ...(canManage ? [{ name: '公告管理', rows: [['标题', '范围', '状态', '发布时间'], ...announcements.map((row) => [row.title, row.audienceType === 'all' ? '全省' : row.audienceType === 'city' ? '指定地市' : '指定省份', statusLabels[String(row.status)]?.label ?? row.status, row.publishAt])] }] : [])])}>导出 Excel</Button><Button icon={<ReloadOutlined />} onClick={() => { void loadInbox(); void loadManage(); }}>刷新</Button>{canManage && <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>发布公告</Button>}</Space></div>
    <Tabs items={[{ key: 'inbox', label: `消息收件箱${unreadCount ? ` (${unreadCount})` : ''}`, children: <Card size="small"><Table size="small" rowKey={(item) => `${item.source}-${item.id}`} loading={loading} columns={inboxColumns} dataSource={inbox} pagination={{ pageSize: 20 }} onRow={(item) => ({ onDoubleClick: () => void markRead(item) })} locale={{ emptyText: '暂无消息' }} /></Card> }, ...(canManage ? [{ key: 'manage', label: '公告管理', children: <Card size="small"><Table size="small" rowKey={(item) => String(item.id)} loading={manageLoading} columns={manageColumns} dataSource={announcements} pagination={{ pageSize: 20 }} locale={{ emptyText: '暂无公告' }} /></Card> }] : [])]} />
    <Modal title={editingId ? '编辑公告草稿' : '新建公告'} open={modalOpen} confirmLoading={saving} okText="保存草稿" cancelText="取消" onCancel={() => { if (!saving) setModalOpen(false); }} onOk={() => { void form.submit(); }} destroyOnClose>
      <Form form={form} layout="vertical" onFinish={(values) => void saveAnnouncement(values)}>
        <Form.Item name="title" label="公告标题" rules={[{ required: true, message: '请输入公告标题' }]}><Input maxLength={200} /></Form.Item>
        <Form.Item name="content" label="公告内容" rules={[{ required: true, message: '请输入公告内容' }]}><Input.TextArea rows={6} maxLength={5000} showCount /></Form.Item>
        <Form.Item name="linkUrl" label="关联超链接"><Input placeholder="/biz/costs 或 https://example.com" /></Form.Item>
        <Form.Item name="audienceType" label="发布范围" rules={[{ required: true }]}><Select onChange={(value) => { setAudienceType(value); form.setFieldsValue({ provinceId: undefined, cityId: undefined }); }} options={[...(roleCode === 'super_admin' ? [{ value: 'all', label: '全省' }] : []), { value: 'province', label: '指定省份' }, { value: 'city', label: '指定地市' }]} /></Form.Item>
        {audienceType === 'province' && <Form.Item name="provinceId" label="省份" rules={[{ required: true, message: '请选择省份' }]}><Select options={provinceOptions} /></Form.Item>}
        {audienceType === 'city' && <><Form.Item name="provinceId" label="省份" rules={[{ required: true, message: '请选择省份' }]}><Select options={provinceOptions} /></Form.Item><Form.Item name="cityId" label="地市" rules={[{ required: true, message: '请选择地市' }]}><Select options={cityOptions} /></Form.Item></>}
        <Form.Item name="expiresAt" label="失效时间"><Input type="datetime-local" /></Form.Item>
      </Form>
    </Modal>
  </div>;
}
