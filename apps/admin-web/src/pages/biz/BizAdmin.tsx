import { BizPermissionCode } from '@/utils/biz-permission-code';
import { useCallback, useEffect, useState } from 'react';
import { Spin } from 'antd';
import { useBizPermission } from '@/utils/biz-permission';
import { Alert, Badge, Button, Card, Drawer, Form, Input, Modal, Segmented, Select, Space, Table, Tag, Tooltip, Typography, message } from 'antd';
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
  engineeringEntry: '工程管理', maintenanceEntry: '维护管理', operationEntry: '经营管理', systemEntry: '系统设置',
  home: '经营首页', analysis: '经营分析', contract: '合同管理', order: '订单管理',
  maintenance: '维护管理',
  completion: '线下完工', cost: '地市成本', user: '用户管理', settings: '系统设置',
  module: '模块管理', role: '角色管理', region: '省市设置',
  announcement: '公告发布', message: '消息中心',
  assessment: '工程管理',
  performance: '维护管理 / 月度考核',
  assistant: '智能助手 / 批量导入',
  operationHome: '经营管理 / 首页', operationAnalysis: '经营管理 / 数据分析', operationContract: '经营管理 / 合同管理', operationOrder: '经营管理 / 订单管理', operationCompletion: '经营管理 / 完工管理', operationCost: '经营管理 / 成本管理',
  systemMessage: '系统设置 / 消息中心', systemAnnouncement: '系统设置 / 公告管理', systemUser: '系统设置 / 账号与权限', systemSettings: '系统设置 / 参数设置', systemRegion: '系统设置 / 省市设置',
};
const MODULE_DESCRIPTION: Record<string, string> = {
  engineeringEntry: '一个开关同时控制工程管理的入口与业务权限',
  maintenanceEntry: '一个开关同时控制维护管理的入口与业务权限',
  operationEntry: '独立控制经营管理模块的入口；各子模块权限在下方分别配置',
  systemEntry: '独立控制全局系统设置的入口；各子模块权限在下方分别配置',
  assessment: '后评估概览、数据导入和线下填报（含模块入口）',
  operationHome: '经营管理首页和数据入口', operationAnalysis: '经营概览、趋势、地市对比和超额清单', operationContract: '合同查看、上传、分配和费率维护', operationOrder: '订单上传、维护、作废和导出', operationCompletion: '线下完工填报、提交和审核', operationCost: '地市成本填报、退回和导出',
  systemMessage: '系统消息和公告查看', systemAnnouncement: '公告编制、发布和撤回', systemUser: '账号、角色、权限和数据范围', systemSettings: '全局参数及预警设置', systemRegion: '省份和地市字典管理',
  home: '门户首页和经营入口', analysis: '经营概览、趋势、地市对比和超额清单', contract: '合同查看、上传、分配和费率维护', order: '订单上传、待维护、作废和导出',
  completion: '线下完工填报、提交和审核', cost: '地市成本填报、退回和导出', user: '账号创建、停用、密码和数据范围', settings: '系统参数和预警设置',
  module: '业务模块入口配置', role: '角色与账号权限配置', region: '省份与地市字典的新增、修改和删除',
  maintenance: '人员、车辆、油机维护数据与月度考核（含模块入口）',
  assistant: '批量导入人员、车辆、油机与各模块台账，需单独授权',
  announcement: '公告草稿、发布、撤回和范围管理', message: '流程消息、公告查看和已读处理',
};
type PermissionItem = { code: string; name: string; action: string };
type PermissionGroup = { key: string; label: string; description: string; permissions: PermissionItem[] };

type ModuleLevel = 'none' | 'read' | 'edit';

const LEVEL_OPTIONS: Array<{ value: ModuleLevel; label: string }> = [
  { value: 'none', label: '无权限' },
  { value: 'read', label: '可查看' },
  { value: 'edit', label: '可操作' },
];

/**
 * 抽屉内的两级结构：模块开关 → 模块内功能。
 * groupKeys[0] 是模块门禁组，其余是模块内可单独细调的功能组。
 * 为什么不继续平铺：13 个组平铺时「入口权限」和「业务权限」混在一起，
 * 管理员看不出哪个开关代表整个模块，于是出现「以为没开、实际能进」。
 */
const MODULE_SECTIONS: Array<{ key: string; label: string; description: string; groupKeys: string[] }> = [
  { key: 'maintenance', label: '维护管理', description: '人员、车辆、油机、月度考核', groupKeys: ['maintenance'] },
  { key: 'assessment', label: '工程管理', description: '后评估概览、数据导入、线下填报', groupKeys: ['assessment'] },
  { key: 'operationEntry', label: '经营管理', description: '经营分析、合同、订单、成本、完工', groupKeys: ['operationEntry', 'operationHome', 'operationAnalysis', 'operationContract', 'operationOrder', 'operationCompletion', 'operationCost'] },
  { key: 'systemEntry', label: '系统设置', description: '账号权限、参数、省市字典、消息公告', groupKeys: ['systemEntry', 'systemUser', 'systemSettings', 'systemRegion', 'systemMessage', 'systemAnnouncement'] },
];


function buildPermissionGroups(rows: Array<Record<string, unknown>>): PermissionGroup[] {
  const groups = new Map<string, PermissionItem[]>();
  for (const row of rows) {
    const code = String(row.code ?? '');
    // 注意：不再跳过 maintenance.asset.enter / maintenance.personnel.enter。
    // 原先这两个入口权限被硬编码排除，导致无法给单个账号开维护入口例外，
    // 临时授权只能改角色默认权限（影响同角色所有人）。现在它们归入「维护管理」分组，
    // 与其它维护权限一样可按账号配置。
    const match = /^(?:operation\.)?([^.]+)\./.exec(code);
    if (!match) continue;
    const entryGroups: Record<string, string> = {
      // 模块入口权限并入对应业务模块组：一个模块只出一个开关。
      // 关掉这个开关会连 portal.*.enter 一起写 deny，模块才真正不可见；
      // 拆成「××入口」和「××」两组时，管理员只关业务组、入口还开着，
      // 就会出现「界面显示未开启、账号仍能进入该模块」——这正是历史上权限混淆的来源。
      [BizPermissionCode.PORTAL_ENGINEERING_ENTER]: 'assessment',
      [BizPermissionCode.PORTAL_MAINTENANCE_ENTER]: 'maintenance',
      [BizPermissionCode.MAINTENANCE_OPERATION_ENTER]: 'operationEntry',
      [BizPermissionCode.PORTAL_SYSTEM_ENTER]: 'systemEntry',
    };
    const operationGroups: Record<string, string> = { analysis: 'operationAnalysis', contract: 'operationContract', order: 'operationOrder', completion: 'operationCompletion', cost: 'operationCost', home: 'operationHome', message: 'systemMessage', announcement: 'systemAnnouncement', user: 'systemUser', role: 'systemUser', module: 'systemUser', settings: 'systemSettings', region: 'systemRegion', performance: 'maintenance' };
    const key = entryGroups[code] ?? operationGroups[match[1]] ?? match[1];
    const list = groups.get(key) ?? [];
    list.push({ code, name: String(row.name ?? code), action: String(row.action ?? '') });
    groups.set(key, list);
  }
  // 字典里没有 portal.system.enter 时也保留「系统设置」开关，避免整组消失
  if (!groups.has('systemEntry')) {
    groups.set('systemEntry', [{ code: BizPermissionCode.PORTAL_SYSTEM_ENTER, name: '系统设置入口', action: 'enter' }]);
  }
  const portalOrder = ['assessment', 'maintenance', 'operationEntry', 'systemEntry'];
  return Array.from(groups.entries()).map(([key, permissions]) => ({ key, label: MODULE_LABEL[key] ?? key, description: MODULE_DESCRIPTION[key] ?? '该业务模块的访问和操作权限', permissions })).sort((a, b) => {
    const ai = portalOrder.indexOf(a.key); const bi = portalOrder.indexOf(b.key);
    if (ai >= 0 || bi >= 0) return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    return a.label.localeCompare(b.label, 'zh-CN');
  });
}

export default function BizAdmin() {
  const canManage = useBizPermission(BizPermissionCode.OPERATION_USER_MANAGE);
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
  const [scopeRoles, setScopeRoles] = useState<string[]>([]);
  const [scopeSaving, setScopeSaving] = useState(false);
  const [contractScopeText, setContractScopeText] = useState('');
  const permissionGroups = buildPermissionGroups(permissionRows);
  const groupByKey = new Map(permissionGroups.map((group) => [group.key, group]));

  /** 模块开关取门禁组（groupKeys[0]）的级别；维护/工程是单组模块，门禁即全部 */
  const levelOf = (key: string): ModuleLevel => moduleLevels[key] ?? 'none';
  const levelOfSection = (section: typeof MODULE_SECTIONS[number]): ModuleLevel => levelOf(section.groupKeys[0]);
  /** 改模块开关 = 把该模块下所有功能组一起设为同一级别（子项仍可再细调） */
  const setSectionLevel = (section: typeof MODULE_SECTIONS[number], level: ModuleLevel) => {
    setModuleLevels((prev) => {
      const next = { ...prev };
      for (const key of section.groupKeys) next[key] = level;
      return next;
    });
  };
  const openedSections = MODULE_SECTIONS.filter((section) => levelOfSection(section) !== 'none').length;
  const noneGroupCount = permissionGroups.filter((group) => levelOf(group.key) === 'none').length;
  const permUser = users.find((user) => String(user.id) === permUserId);

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
    // 角色也在这里配置：建号之后仍可改角色（原先只能建号时选一次），且支持多角色
    setScopeRoles(access.roles.map((item) => String(item.roleCode)));
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
      await bizAdminSetUserAccess(scopeUserId, scopeRoles, grants);
      message.success('角色与数据范围已保存，下次请求生效');
      setScopeOpen(false);
      void load();
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { message?: string } } }).response?.data?.message;
      message.error(detail ?? '数据范围保存失败');
    } finally { setScopeSaving(false); }
  };

  const onSavePermissions = async () => {
    if (!permDetail || permDetail.roleCode === 'super_admin') return;
    setPermSaving(true);
    try {
      /**
       * 只持久化「与角色默认不一致」的组，一致的交回角色默认。
       *
       * 旧实现会把字典里**全部**权限点都写成 allow/deny 快照：
       *   · 快照生成后新增的权限点不在里面，改角色默认也压不住，出现「显示没开却能用」；
       *   · 一次保存就在库里落下上百条 deny，把角色本来有的权限整片压掉，事后无法从界面看出原因。
       * 现在按组比对目标级别与角色默认级别，一致就不写例外，顺便清掉该组的历史遗留。
       */
      const baseSet = new Set(permDetail.base);
      const baseLevelOf = (group: typeof permissionGroups[number]): 'none' | 'read' | 'edit' => {
        const readable = group.permissions.some((permission) => (permission.action === 'read' || permission.action === 'enter') && baseSet.has(permission.code));
        const writable = group.permissions.some((permission) => permission.action !== 'read' && permission.action !== 'enter' && baseSet.has(permission.code));
        return writable ? 'edit' : readable ? 'read' : 'none';
      };
      const handledCodes = new Set(permissionGroups.flatMap((group) => group.permissions.map((permission) => permission.code)));
      const generated = permissionGroups.flatMap((group) => {
        const level = moduleLevels[group.key] ?? 'none';
        if (level === baseLevelOf(group)) return [];
        return group.permissions.map((permission) => ({
          permissionCode: permission.code,
          effect: (level === 'none' || (level === 'read' && permission.action !== 'read' && permission.action !== 'enter')) ? 'deny' as const : 'allow' as const,
        }));
      });
      // 字典里已不存在的历史权限码原样保留，不做静默清理
      const preserved = permDetail.overrides.filter((item) => !handledCodes.has(item.permissionCode));
      if (!permUserId) return;
      await bizAdminSetOverrides(permUserId, [...preserved, ...generated]);
      message.success(`模块权限已保存（写入 ${generated.length} 条例外，其余沿用角色默认），下次登录生效`);
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
          <Button size="small" onClick={() => { void onViewScope(String(row.id)); }}>角色/范围</Button>
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
        destroyOnHidden
      >
        <p>重置后旧会话将立即失效。新密码至少 6 位，请在下方输入。</p>
        <Form form={resetForm} layout="vertical" onFinish={onSubmitResetPassword}>
          <Form.Item name="password" label="新密码" rules={[{ required: true, min: 6, message: '密码至少 6 位' }]}>
            <Input.Password autoComplete="new-password" placeholder="请输入新密码" />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title="模块权限"
        open={permOpen}
        onClose={() => setPermOpen(false)}
        width={720}
        extra={<Space><Button disabled={!permDetail || permDetail.roleCode === 'super_admin'} onClick={restoreRoleDefaults}>恢复角色默认</Button><Button type="primary" loading={permSaving} onClick={() => { void onSavePermissions(); }}>保存权限</Button></Space>}
      >
        {permDetail && (
          <div className="perm-drawer">
            <div className="perm-drawer-head">
              <Space size={8} wrap>
                <Text type="secondary">账号</Text>
                <Text strong>{String(permUser?.username ?? '—')}</Text>
                <Tag color="blue">{ROLE_LABEL[permDetail.roleCode] ?? permDetail.roleCode}</Tag>
              </Space>
              <Text type="secondary" className="perm-drawer-summary">
                已开启 {openedSections}/{MODULE_SECTIONS.length} 个模块 · {noneGroupCount} 项功能无权限
              </Text>
            </div>

            <div className="perm-tip">
              无权限＝入口与菜单隐藏、接口拒绝；可查看＝只看数据；可操作＝可新增/修改/提交。保存后该账号下次登录生效。
            </div>

            <div className="perm-section-title">模块开关</div>
            <div className="perm-module-list">
              {MODULE_SECTIONS.map((section) => (
                <div key={section.key} className={`perm-module-row${levelOfSection(section) === 'none' ? ' is-off' : ''}`}>
                  <div className="perm-row-main">
                    <span className="perm-row-label">{section.label}</span>
                    <span className="perm-row-desc">{section.description}</span>
                  </div>
                  <Segmented
                    size="small"
                    value={permDetail.roleCode === 'super_admin' ? 'edit' : levelOfSection(section)}
                    disabled={permDetail.roleCode === 'super_admin'}
                    options={LEVEL_OPTIONS}
                    onChange={(value) => setSectionLevel(section, value as ModuleLevel)}
                  />
                </div>
              ))}
            </div>

            {MODULE_SECTIONS.filter((section) => section.groupKeys.length > 1).map((section) => (
              <div key={section.key} className="perm-children">
                <div className="perm-section-title">{section.label} · 功能细调</div>
                <div className="perm-module-list">
                  {section.groupKeys.slice(1).map((groupKey) => {
                    const group = groupByKey.get(groupKey);
                    if (!group) return null;
                    const shortLabel = group.label.includes('/') ? (group.label.split('/').pop() ?? group.label).trim() : group.label;
                    return (
                      <div key={groupKey} className={`perm-row${levelOf(groupKey) === 'none' ? ' is-off' : ''}`}>
                        <div className="perm-row-main">
                          <span className="perm-row-label">{shortLabel}</span>
                          <span className="perm-row-desc">{group.description}</span>
                        </div>
                        <Segmented
                          size="small"
                          value={permDetail.roleCode === 'super_admin' ? 'edit' : levelOf(groupKey)}
                          disabled={permDetail.roleCode === 'super_admin'}
                          options={LEVEL_OPTIONS}
                          onChange={(value) => setModuleLevels((prev) => ({ ...prev, [groupKey]: value as ModuleLevel }))}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* 智能助手不属于四大模块，单独成组：组内只有一个动作码（execute），
                所以只给「无权限 / 可操作」两档 —— 三档里的「可查看」会被保存逻辑解释成 deny，
                管理员选了反而关上，是个陷阱。 */}
            {groupByKey.has('assistant') && (
              <div className="perm-children">
                <div className="perm-section-title">智能助手 · 功能细调</div>
                <div className="perm-module-list">
                  <div className={`perm-row${levelOf('assistant') === 'none' ? ' is-off' : ''}`}>
                    <div className="perm-row-main">
                      <span className="perm-row-label">批量导入</span>
                      <span className="perm-row-desc">
                        人员、车辆、油机与各模块台账的批量导入。需单独授权，且与该模块的写权限同时具备才可用。
                      </span>
                    </div>
                    <Segmented
                      size="small"
                      value={permDetail.roleCode === 'super_admin' ? 'edit' : levelOf('assistant')}
                      disabled={permDetail.roleCode === 'super_admin'}
                      options={[{ value: 'none', label: '无权限' }, { value: 'edit', label: '可操作' }]}
                      onChange={(value) => setModuleLevels((prev) => ({ ...prev, assistant: value as ModuleLevel }))}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </Drawer>

      <Drawer title="角色与数据范围" open={scopeOpen} onClose={() => setScopeOpen(false)} width={520} extra={<Button type="primary" loading={scopeSaving} onClick={() => { void onSaveScope(); }}>保存</Button>}>
        {scopeRoles.includes('super_admin')
          ? <Result status="info" title="超级管理员账号" subTitle="角色与数据范围由系统内置，不可修改。" />
          : <>
            <Alert type="info" showIcon message="范围是授权并集，请只选择该账号实际负责的对象；角色可多选，保存后下次请求生效" style={{ marginBottom: 16 }} />
            <Form layout="vertical">
              <Form.Item label="角色" extra="可多选；第一个为主角色（决定账号列表里显示的角色）。原先建号后不能改角色，且保存范围会把多角色覆盖成单角色，现已修复。">
                <Select mode="multiple" value={scopeRoles} onChange={setScopeRoles} options={roles.filter((item) => item.code !== 'super_admin').map((item) => ({ value: item.code, label: item.name }))} />
              </Form.Item>
              <Form.Item label="范围类型"><Select value={scopeType} onChange={(value) => { setScopeType(value); setScopeTargets([]); }} options={[{ value: 'all', label: '全部省份和地市' }, { value: 'province', label: '指定省份' }, { value: 'city', label: '指定地市' }, { value: 'contract', label: '指定合同' }]} /></Form.Item>
              {scopeType === 'province' && <Form.Item label="省份"><Select mode="multiple" value={scopeTargets} onChange={setScopeTargets} options={provinces.map((item) => ({ value: item.id, label: item.name }))} /></Form.Item>}
              {scopeType === 'city' && <Form.Item label="经营单位"><Select mode="multiple" value={scopeTargets} onChange={setScopeTargets} options={cities.map((item) => ({ value: item.id, label: item.name }))} /></Form.Item>}
              {scopeType === 'contract' && <Form.Item label="合同 ID" extra="每行一个合同 ID"><Input.TextArea rows={8} value={contractScopeText} onChange={(event) => setContractScopeText(event.target.value)} placeholder="请输入合同 ID" /></Form.Item>}
            </Form>
          </>}
      </Drawer>
    </div>
  );
}
