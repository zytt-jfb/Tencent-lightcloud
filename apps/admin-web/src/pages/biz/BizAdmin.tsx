import { useCallback, useEffect, useState } from 'react';
import { Spin } from 'antd';
import { useBizPermission } from '@/utils/biz-permission';
import { Alert, Badge, Button, Card, Drawer, Form, Input, Modal, Select, Space, Table, Tag, Typography, message } from 'antd';
import { DownloadOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { exportPageRows } from '@/utils/page-export-core';
import { Result } from 'antd';
import {
  bizAdminCreateUser, bizAdminListUsers, bizAdminSetUserStatus, bizAdminResetPassword,
  bizAdminGetUserPermissions, bizAdminSetOverrides, bizAdminRoles, bizAdminPermissions, bizAdminCities, bizAdminProvinces,
  bizAdminGetUserAccess, bizAdminSetUserAccess,
} from '@/api/biz.api';

const { Title, Text } = Typography;

const ROLE_LABEL: Record<string, string> = {
  super_admin: '超级管理员', admin: '省级运营管理员', contract_manager: '合同管理员', city_user: '地市用户',
};

const MODULE_LABEL: Record<string, string> = {
  engineeringEntry: '工程管理入口', maintenanceEntry: '维护管理入口', operationEntry: '经营管理入口', systemEntry: '系统设置入口',
  home: '经营首页', analysis: '经营分析', contract: '合同管理', order: '订单管理',
  completion: '线下完工', cost: '地市成本', user: '用户管理', settings: '系统设置',
  module: '模块管理', role: '角色管理', region: '省市设置',
  announcement: '公告发布', message: '消息中心',
  operationHome: '经营管理 / 首页', operationAnalysis: '经营管理 / 数据分析', operationContract: '经营管理 / 合同管理', operationOrder: '经营管理 / 订单管理', operationCompletion: '经营管理 / 完工管理', operationCost: '经营管理 / 成本管理',
  systemMessage: '系统设置 / 消息中心', systemAnnouncement: '系统设置 / 公告管理', systemUser: '系统设置 / 账号与权限', systemSettings: '系统设置 / 参数设置', systemRegion: '系统设置 / 省市设置',
};
const MODULE_DESCRIPTION: Record<string, string> = {
  engineeringEntry: '独立控制工程管理模块的可见性和访问权限',
  maintenanceEntry: '独立控制维护管理模块的可见性和访问权限',
  operationEntry: '独立控制经营管理模块的可见性和访问权限',
  systemEntry: '独立控制全局系统设置模块的可见性和访问权限',
  operationHome: '经营管理首页和数据入口', operationAnalysis: '经营概览、趋势、地市对比和超额清单', operationContract: '合同查看、上传、分配和费率维护', operationOrder: '订单上传、维护、作废和导出', operationCompletion: '线下完工填报、提交和审核', operationCost: '地市成本填报、退回和导出',
  systemMessage: '系统消息和公告查看', systemAnnouncement: '公告编制、发布和撤回', systemUser: '账号、角色、权限和数据范围', systemSettings: '全局参数及预警设置', systemRegion: '省份和地市字典管理',
  home: '门户首页和经营入口', analysis: '经营概览、趋势、地市对比和超额清单', contract: '合同查看、上传、分配和费率维护', order: '订单上传、待维护、作废和导出',
  completion: '线下完工填报、提交和审核', cost: '地市成本填报、退回和导出', user: '账号创建、停用、密码和数据范围', settings: '系统参数和预警设置',
  module: '业务模块入口配置', role: '角色与账号权限配置', region: '省份与地市字典的新增、修改和删除',
  announcement: '公告草稿、发布、撤回和范围管理', message: '流程消息、公告查看和已读处理',
};
const PORTAL_GROUPS = new Set(['engineeringEntry', 'maintenanceEntry', 'operationEntry', 'systemEntry']);

type PermissionItem = { code: string; name: string; action: string };

type PermissionGroup = { key: string; label: string; description: string; permissions: PermissionItem[] };

function buildPermissionGroups(rows: Array<Record<string, unknown>>): PermissionGroup[] {
  const groups = new Map<string, PermissionItem[]>();
  for (const row of rows) {
    const code = String(row.code ?? '');
    if (['maintenance.asset.enter', 'maintenance.personnel.enter'].includes(code)) continue;
    const match = /^(?:operation\.)?([^.]+)\./.exec(code);
    if (!match) continue;
    const entryGroups: Record<string, string> = { 'portal.engineering.enter': 'engineeringEntry', 'portal.maintenance.enter': 'maintenanceEntry', 'maintenance.operation.enter': 'operationEntry' };
    const operationGroups: Record<string, string> = { analysis: 'operationAnalysis', contract: 'operationContract', order: 'operationOrder', completion: 'operationCompletion', cost: 'operationCost', home: 'operationHome', message: 'systemMessage', announcement: 'systemAnnouncement', user: 'systemUser', role: 'systemUser', module: 'systemUser', settings: 'systemSettings', region: 'systemRegion' };
    const key = entryGroups[code] ?? operationGroups[match[1]] ?? match[1];
    const list = groups.get(key) ?? [];
    list.push({ code, name: String(row.name ?? code), action: String(row.action ?? '') });
    groups.set(key, list);
  }
  groups.set('systemEntry', [{ code: 'portal.system.enter', name: '系统设置入口', action: 'enter' }]);
  const portalOrder = ['engineeringEntry', 'maintenanceEntry', 'operationEntry', 'systemEntry'];
  return Array.from(groups.entries()).map(([key, permissions]) => ({ key, label: MODULE_LABEL[key] ?? key, description: MODULE_DESCRIPTION[key] ?? '该业务模块的访问和操作权限', permissions })).sort((a, b) => {
    const ai = portalOrder.indexOf(a.key); const bi = portalOrder.indexOf(b.key);
    if (ai >= 0 || bi >= 0) return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    return a.label.localeCompare(b.label, 'zh-CN');
  });
}

export default function BizAdmin() {
  const canManage = useBizPermission('operation.user.manage');
  const [users, setUsers] = useState<Array<Record<string, unknown>>>([]);
  const [roles, setRoles] = useState<Array<{ code: string; name: string }>>([]);
  const [cities, setCities] = useState<Array<{ id: string; name: string; provinceId: string }>>([]);
  const [provinces, setProvinces] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetUserId, setResetUserId] = useState<string | null>(null);
  const [resetLoading, setResetLoading] = useState(false);
  const [permOpen, setPermOpen] = useState(false);
  const [permDetail, setPermDetail] = useState<{ roleCode: string; base: string[]; effective: string[]; overrides: Array<{ permissionCode: string; effect: 'allow' | 'deny' }> } | null>(null);
  const [permUserId, setPermUserId] = useState<string | null>(null);
  const [moduleLevels, setModuleLevels] = useState<Record<string, 'none' | 'read' | 'edit'>>({});
  const [permSaving, setPermSaving] = useState(false);
  const [form] = Form.useForm();
  const [resetForm] = Form.useForm<{ password: string }>();
  const [createRole, setCreateRole] = useState<string>('admin');
  const [permissionRows, setPermissionRows] = useState<Array<Record<string, unknown>>>([]);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [scopeUserId, setScopeUserId] = useState<string | null>(null);
  const [scopeType, setScopeType] = useState<'all' | 'province' | 'city' | 'contract'>('all');
  const [scopeTargets, setScopeTargets] = useState<string[]>([]);
  const [scopeSaving, setScopeSaving] = useState(false);
  const [contractScopeText, setContractScopeText] = useState('');
  const permissionGroups = buildPermissionGroups(permissionRows);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [u, r, c, p] = await Promise.all([bizAdminListUsers(), bizAdminRoles(), bizAdminCities(), bizAdminProvinces()]);
      setUsers(u.items);
      setRoles(r.items.map((x) => ({ code: String(x.code), name: String(x.name) })));
      setCities(c.items.map((x) => ({ id: String(x.id), name: String(x.name), provinceId: String(x.provinceId) })));
      setProvinces(p.items.map((x) => ({ id: String(x.id), name: String(x.name) })));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDict = useCallback(async () => {
    const perms = await bizAdminPermissions();
    setPermissionRows(perms.items as Array<Record<string, unknown>>);
  }, []);

  useEffect(() => { void loadDict(); }, [loadDict]);

  useEffect(() => { void load(); }, [load]);

  const onCreate = async (values: Record<string, unknown>) => {
    try {
      await bizAdminCreateUser(values as { username: string; password: string; name: string; roleCode: string; cityIds?: string[] | null });
      message.success('账号已创建');
      setCreateOpen(false);
      form.resetFields();
      void load();
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
      message.error(Array.isArray(detail) ? detail.join('；') : (detail ?? '创建失败'));
    }
  };

  const onToggle = async (id: string, status: string) => {
    try {
      await bizAdminSetUserStatus(id, status === 'enabled' ? 'disabled' : 'enabled');
      message.success('已更新');
      void load();
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { message?: string } } }).response?.data?.message;
      message.error(detail ?? '操作失败');
    }
  };

  const onResetPassword = async (id: string) => {
    resetForm.resetFields();
    setResetUserId(id);
    setResetOpen(true);
  };

  const onSubmitResetPassword = async ({ password }: { password: string }) => {
    if (!resetUserId) return;
    setResetLoading(true);
    try {
      await bizAdminResetPassword(resetUserId, password);
      message.success('密码已重置，请使用新密码重新登录');
      setResetOpen(false);
      setResetUserId(null);
      void load();
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { message?: string } } }).response?.data?.message;
      message.error(detail ?? '重置密码失败，请稍后重试');
    } finally {
      setResetLoading(false);
    }
  };

  const onViewPerm = async (id: string) => {
    const detail = await bizAdminGetUserPermissions(id);
    setPermDetail(detail);
    setPermUserId(id);
    const effective = new Set(detail.effective);
    const levels: Record<string, 'none' | 'read' | 'edit'> = {};
    for (const group of permissionGroups) {
      const readable = group.permissions.some((permission) => (permission.action === 'read' || permission.action === 'enter') && effective.has(permission.code));
      const writable = group.permissions.some((permission) => permission.action !== 'read' && permission.action !== 'enter' && effective.has(permission.code));
      levels[group.key] = writable ? 'edit' : readable ? 'read' : 'none';
    }
    setModuleLevels(levels);
    setPermOpen(true);
  };

  const onViewScope = async (id: string) => {
    const access = await bizAdminGetUserAccess(id);
    const grant = access.grants.find((item) => item.effect !== 'deny') ?? access.grants[0];
    setScopeUserId(id);
    setScopeType(grant?.scopeType ?? 'all');
    setScopeTargets(access.grants.filter((item) => item.scopeType === grant?.scopeType && item.targetId).map((item) => String(item.targetId)));
    setContractScopeText(access.grants.filter((item) => item.scopeType === 'contract' && item.targetId).map((item) => String(item.targetId)).join('\n'));
    setScopeOpen(true);
  };

  const onSaveScope = async () => {
    if (!scopeUserId) return;
    setScopeSaving(true);
    try {
      const ids = scopeType === 'contract'
        ? contractScopeText.split(/[\s,，\n]+/).map((item) => item.trim()).filter(Boolean)
        : scopeTargets;
      const grants = scopeType === 'all' ? [{ scopeType: 'all' as const, targetId: null }] : ids.map((targetId) => ({ scopeType, targetId }));
      await bizAdminSetUserAccess(scopeUserId, [String(users.find((row) => String(row.id) === scopeUserId)?.roleCode ?? 'admin')], grants);
      message.success('数据范围已保存，下次请求生效');
      setScopeOpen(false);
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { message?: string } } }).response?.data?.message;
      message.error(detail ?? '数据范围保存失败');
    } finally { setScopeSaving(false); }
  };

  const onSavePermissions = async () => {
    if (!permDetail || permDetail.roleCode === 'super_admin') return;
    setPermSaving(true);
    try {
      const generated = permissionGroups.flatMap((group) => {
        const level = moduleLevels[group.key] ?? 'none';
        return group.permissions.map((permission) => ({
          permissionCode: permission.code,
          effect: (level === 'none' || (level === 'read' && permission.action !== 'read' && permission.action !== 'enter')) ? 'deny' as const : 'allow' as const,
        }));
      });
      const generatedCodes = new Set(generated.map((item) => item.permissionCode));
      const preserved = permDetail.overrides.filter((item) => !generatedCodes.has(item.permissionCode));
      if (!permUserId) return;
      await bizAdminSetOverrides(permUserId, [...preserved, ...generated]);
      message.success('模块权限已保存，下次登录生效');
      setPermOpen(false);
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { message?: string } } }).response?.data?.message;
      message.error(detail ?? '模块权限保存失败');
    } finally {
      setPermSaving(false);
    }
  };

  const restoreRoleDefaults = () => {
    if (!permDetail || permDetail.roleCode === 'super_admin') return;
    const base = new Set(permDetail.base);
    const levels: Record<string, 'none' | 'read' | 'edit'> = {};
    for (const group of permissionGroups) {
      const readable = group.permissions.some((permission) => (permission.action === 'read' || permission.action === 'enter') && base.has(permission.code));
      const writable = group.permissions.some((permission) => permission.action !== 'read' && permission.action !== 'enter' && base.has(permission.code));
      levels[group.key] = writable ? 'edit' : readable ? 'read' : 'none';
    }
    setModuleLevels(levels);
    message.info('已载入角色默认权限，请确认后点击保存权限');
  };

  const columns = [
    { title: '账号', dataIndex: 'username', key: 'username' },
    { title: '姓名', dataIndex: 'name', key: 'name' },
    { title: '角色', dataIndex: 'roleCode', key: 'roleCode', render: (v: string) => <Tag color="blue">{ROLE_LABEL[v] ?? v}</Tag> },
    { title: '状态', dataIndex: 'status', key: 'status', render: (v: string) => <Badge status={v === 'enabled' ? 'success' : 'error'} text={v === 'enabled' ? '启用' : '停用'} /> },
    {
      title: '操作', key: 'action', width: 260,
      render: (_: unknown, row: Record<string, unknown>) => (
        <Space wrap>
          <Button size="small" onClick={() => onViewPerm(String(row.id))}>权限</Button>
          <Button size="small" onClick={() => { void onViewScope(String(row.id)); }}>范围</Button>
          <Button size="small" danger={row.status === 'enabled'} onClick={() => onToggle(String(row.id), String(row.status))}>
            {row.status === 'enabled' ? '停用' : '启用'}
          </Button>
          <Button size="small" onClick={() => onResetPassword(String(row.id))}>重置密码</Button>
        </Space>
      ),
    },
  ];

  if (canManage === null) return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><Spin /></div>;
  if (!canManage) return <Result status="403" title="无权限访问" subTitle="账号与权限管理仅 super_admin 可操作。" />;

  return (
    <div className="v3-content">
      <div className="v3-page-head">
        <div className="v3-page-titles">
          <Title level={4} style={{ margin: 0 }}>账号与权限管理</Title>
        </div>
        <div className="v3-page-head-actions">
          <Button icon={<DownloadOutlined />} disabled={!users.length} onClick={() => exportPageRows('账号权限', users.map(({ username, name, roleCode, status, cityId }) => ({ username, name, roleCode: ROLE_LABEL[String(roleCode)] ?? roleCode, status: status === 'enabled' ? '启用' : '停用', cityId })), '当前账号列表', ['username', 'name', 'roleCode', 'status', 'cityId'])}>导出 Excel</Button><Button icon={<ReloadOutlined />} onClick={() => { void load(); void loadDict(); }}>刷新</Button><Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>新建账号</Button>
        </div>
      </div>
      <Card title="用户管理">
        <Table scroll={{ x: 'max-content' }} rowKey={(r) => String(r.id)} loading={loading} columns={columns} dataSource={users} pagination={{ pageSize: 10 }} />
      </Card>

      <Drawer title="新建账号" open={createOpen} onClose={() => setCreateOpen(false)} width={420}>
        <Form form={form} layout="vertical" onFinish={onCreate} initialValues={{ roleCode: 'admin' }}>
          <Form.Item name="username" label="账号" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="password" label="初始密码" rules={[{ required: true, min: 6, message: '密码最低 6 位' }]}><Input.Password /></Form.Item>
          <Form.Item name="name" label="姓名" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="roleCode" label="角色" rules={[{ required: true }]}>
            <Select onChange={(v) => setCreateRole(String(v))} options={roles.filter((r) => r.code !== 'super_admin').map((r) => ({ value: r.code, label: r.name }))} />
          </Form.Item>
          <Form.Item name="cityIds" label="绑定地市" extra={createRole === 'city_user' ? '地市用户至少选择一个地市（可多选）' : '仅地市用户需要'}>
            <Select mode="multiple" allowClear placeholder="选择地市（可多选）" options={cities.map((c) => ({ value: c.id, label: c.name }))} />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>创建</Button>
        </Form>
      </Drawer>

      <Modal
        title="重置密码"
        open={resetOpen}
        confirmLoading={resetLoading}
        okText="确认重置"
        cancelText="取消"
        onCancel={() => { setResetOpen(false); setResetUserId(null); }}
        onOk={() => { void resetForm.validateFields().then(onSubmitResetPassword).catch(() => undefined); }}
        destroyOnClose
      >
        <p>重置后旧会话将立即失效。新密码至少 6 位，请在下方输入。</p>
        <Form form={resetForm} layout="vertical" onFinish={onSubmitResetPassword}>
          <Form.Item name="password" label="新密码" rules={[{ required: true, min: 6, message: '密码至少 6 位' }]}>
            <Input.Password autoComplete="new-password" placeholder="请输入新密码" />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer title="模块权限" open={permOpen} onClose={() => setPermOpen(false)} width={680} extra={<Space><Button disabled={!permDetail || permDetail.roleCode === 'super_admin'} onClick={restoreRoleDefaults}>恢复角色默认</Button><Button type="primary" loading={permSaving} onClick={() => { void onSavePermissions(); }}>保存权限</Button></Space>}>
        {permDetail && (
          <div>
            <p><b>角色：</b>{ROLE_LABEL[permDetail.roleCode] ?? permDetail.roleCode}</p>
            <Alert
              type="info"
              showIcon
              message="权限级别说明"
              description="无权访问：门户入口和菜单隐藏，接口拒绝；可进入/查看：允许进入门户或查看数据；可操作：在查看基础上增加新增、修改、提交、审核或发布等操作。门户入口的“可进入/查看”不会授予业务数据权限，业务功能仍需单独配置。保存后，账号下次登录生效。"
              style={{ marginBottom: 16 }}
            />
            <Table
              size="small"
              pagination={false}
              rowKey="key"
              dataSource={permissionGroups}
              columns={[
                { title: '功能分类', key: 'label', width: 260, render: (_: unknown, row: PermissionGroup) => <Space direction="vertical" size={0}><Space size={4}><Tag color={PORTAL_GROUPS.has(row.key) ? 'purple' : 'blue'}>{PORTAL_GROUPS.has(row.key) ? '门户入口' : '业务功能'}</Tag><Text strong>{row.label}</Text></Space><Text type="secondary" style={{ fontSize: 12 }}>{row.description}</Text></Space> },
                { title: '当前级别', key: 'level', width: 150, render: (_: unknown, row: PermissionGroup) => (
                  <Select
                    value={permDetail.roleCode === 'super_admin' ? (PORTAL_GROUPS.has(row.key) ? 'read' : 'edit') : (moduleLevels[row.key] ?? 'none')}
                    disabled={permDetail.roleCode === 'super_admin'}
                    style={{ width: 130 }}
                    options={PORTAL_GROUPS.has(row.key) ? [{ value: 'none', label: '无权访问' }, { value: 'read', label: '可进入' }] : [{ value: 'none', label: '无权访问' }, { value: 'read', label: '可查看' }, { value: 'edit', label: '可操作' }]}
                    onChange={(value: 'none' | 'read' | 'edit') => setModuleLevels((prev) => ({ ...prev, [row.key]: value }))}
                  />
                ) },
              ]}
            />
          </div>
        )}
      </Drawer>

      <Drawer title="数据范围" open={scopeOpen} onClose={() => setScopeOpen(false)} width={520} extra={<Button type="primary" loading={scopeSaving} onClick={() => { void onSaveScope(); }}>保存范围</Button>}>
        <Alert type="info" showIcon message="范围是授权并集，请只选择该账号实际负责的对象" style={{ marginBottom: 16 }} />
        <Form layout="vertical">
          <Form.Item label="范围类型"><Select value={scopeType} onChange={(value) => { setScopeType(value); setScopeTargets([]); }} options={[{ value: 'all', label: '全部省份和地市' }, { value: 'province', label: '指定省份' }, { value: 'city', label: '指定地市' }, { value: 'contract', label: '指定合同' }]} /></Form.Item>
          {scopeType === 'province' && <Form.Item label="省份"><Select mode="multiple" value={scopeTargets} onChange={setScopeTargets} options={provinces.map((item) => ({ value: item.id, label: item.name }))} /></Form.Item>}
          {scopeType === 'city' && <Form.Item label="经营单位"><Select mode="multiple" value={scopeTargets} onChange={setScopeTargets} options={cities.map((item) => ({ value: item.id, label: item.name }))} /></Form.Item>}
          {scopeType === 'contract' && <Form.Item label="合同 ID" extra="每行一个合同 ID"><Input.TextArea rows={8} value={contractScopeText} onChange={(event) => setContractScopeText(event.target.value)} placeholder="请输入合同 ID" /></Form.Item>}
        </Form>
      </Drawer>
    </div>
  );
}
