import { useCallback, useEffect, useState } from 'react';
import { Avatar, Button, Drawer, Dropdown, Form, Input, Layout, Menu, Modal, Result, Space, Spin, Typography, message, type MenuProps } from 'antd';
import {
  ApartmentOutlined, BarChartOutlined, FileTextOutlined, InboxOutlined, SettingOutlined,
  BellOutlined, DeleteOutlined, HomeOutlined, KeyOutlined, TeamOutlined, UserOutlined, WalletOutlined, MenuOutlined,
} from '@ant-design/icons';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { bizChangeOwnPassword, bizMe, bizMessageList, type BizSnapshotMetadata } from '@/api/biz.api';
import BizSnapshotProvider, { useBizSnapshot } from '@/components/biz/BizSnapshotContext';
import { clearBizToken } from '@/utils/biz-auth';
import { clearBizPermissionCache } from '@/utils/biz-permission';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

const ROLE_LABEL: Record<string, string> = {
  super_admin: '超级管理员', admin: '省级运营管理员', contract_manager: '合同管理员', city_user: '地市用户',
};

/** 顶部经营分析快照状态栏：单一"更新数据"入口 + 状态文案（不暴露技术术语/堆栈） */
function fmtShort(value: string | null | undefined): string {
  if (!value) return '';
  // 仅日期（如数据所属日 currentAsOf，后端 date 类型）：直接按原值展示，不施加时区转换，避免 UTC→北京时间 +8 偏移误显示 08:00。
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (isDateOnly) return value;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  // 时间戳（generatedAt / lastSuccessfulAt）：后端返回 UTC(ISO Z)，统一按北京时间(Asia/Shanghai)展示，不受浏览器时区影响。
  const p = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d).reduce<Record<string, string>>((acc, x) => { acc[x.type] = x.value; return acc; }, {});
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/** ready 状态的展示时间：优先生成时间，回退到最近成功时间 / 数据所属日（避免生成时间缺失时显示空白） */
function metaUpdateTime(meta: BizSnapshotMetadata | null): string | null {
  return meta?.generatedAt ?? meta?.lastSuccessfulAt ?? meta?.currentAsOf ?? null;
}

function SnapshotStatusBar() {
  const { meta, building, requestUpdate } = useBizSnapshot();
  const lastRunStatus = meta?.lastRun?.status;
  const hasReady = !!meta?.snapshotId;
  const updateTime = metaUpdateTime(meta);
  let text: React.ReactNode;
  if (building) {
    text = <Text type="secondary">数据更新中，当前展示 {fmtShort(meta?.currentAsOf ?? meta?.lastSuccessfulAt ?? meta?.generatedAt)} 的数据</Text>;
  } else if (lastRunStatus === 'failed') {
    text = hasReady
      ? <Text type="danger">更新失败，当前展示 {fmtShort(meta?.currentAsOf ?? meta?.lastSuccessfulAt)} 的数据</Text>
      : <Text type="danger">最近更新失败，请重新更新数据</Text>;
  } else if (hasReady) {
    text = updateTime
      ? <Text type="secondary">数据已于 {fmtShort(updateTime)} 更新</Text>
      : <Text type="secondary">数据已更新</Text>;
  } else if (meta?.status === 'live') {
    text = <Text type="secondary">当前使用实时数据</Text>;
  } else {
    text = <Text type="secondary">暂未生成统计数据</Text>;
  }
  return (
    <Space size={8}>
      <span>{text}</span>
      <Button size="small" type="primary" onClick={() => void requestUpdate()} disabled={building}>
        {building ? '更新中' : '更新数据'}
      </Button>
    </Space>
  );
}

/** 按权限码过滤菜单（super_admin 通配）；hideForRoles 指定的角色无论如何都不显示该菜单 */
type PermissionMenuItem = { key: string; label: string; icon?: React.ReactNode; permission?: string; hideForRoles?: string[] };

function filterByPermission(items: PermissionMenuItem[], permissions: Set<string>, isSuper: boolean, roleCode?: string): NonNullable<MenuProps['items']> {
  return items
    .filter((i) => !i.permission || isSuper || permissions.has(i.permission))
    .filter((i) => !i.hideForRoles?.length || !roleCode || !i.hideForRoles.includes(roleCode))
    .map(({ permission: _permission, hideForRoles: _hideForRoles, ...item }) => item);
}

/** 新基线统一布局：顶部用户 + 侧边菜单（经营管理六入口 + 系统管理） */
export default function BizLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [me, setMe] = useState<{ username: string; roleCode: string; permissions: string[] } | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordForm] = Form.useForm<{ currentPassword: string; newPassword: string; confirmPassword: string }>();
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    bizMe().then(setMe).catch(() => { clearBizToken(); clearBizPermissionCache(); navigate('/biz/login'); });
  }, [navigate]);

  useEffect(() => {
    if (!me?.permissions?.includes('operation.message.read') && me?.roleCode !== 'super_admin') return;
    void bizMessageList().then((result) => setUnreadCount(result.unreadCount)).catch(() => undefined);
  }, [me]);

  const permissions = useCallback(() => new Set(me?.permissions ?? []), [me]);
  const isSuper = me?.roleCode === 'super_admin';
  const permSet = permissions();

  const submitPasswordChange = async (values: { currentPassword: string; newPassword: string; confirmPassword: string }) => {
    setPasswordSaving(true);
    try {
      await bizChangeOwnPassword(values);
      message.success('密码修改成功，请重新登录');
      setPasswordOpen(false);
      passwordForm.resetFields();
      clearBizToken();
      clearBizPermissionCache();
      navigate('/biz/login', { replace: true });
    } catch (error: unknown) {
      const responseMessage = (error as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
      message.error(Array.isArray(responseMessage) ? responseMessage.join('；') : (responseMessage ?? '密码修改失败'));
    } finally {
      setPasswordSaving(false);
    }
  };

  const systemItems = filterByPermission([
    { key: '/biz/settings', label: '系统设置', icon: <SettingOutlined />, permission: 'operation.settings.read' },
    { key: '/biz/admin', label: '权限管理', icon: <ApartmentOutlined />, permission: 'operation.user.manage' },
    { key: '/biz/region-settings', label: '省市设置', icon: <ApartmentOutlined />, permission: 'operation.region.manage' },
    { key: '/biz/audit-logs', label: '审计日志', icon: <FileTextOutlined />, permission: 'operation.user.manage' },
    ...(isSuper ? [{ key: '/biz/data-delete', label: '数据删除', icon: <DeleteOutlined /> }] : []),
  ], permSet, isSuper, me?.roleCode);
  const messageItems = filterByPermission([
    { key: '/biz/messages', label: unreadCount > 0 ? `消息中心 (${unreadCount})` : '消息中心', icon: <BellOutlined />, permission: 'operation.message.read' },
  ], permSet, isSuper, me?.roleCode);

  const analysisItems = filterByPermission([
    { key: '/biz/analysis', label: '经营概览', icon: <BarChartOutlined />, permission: 'operation.analysis.read' },
    { key: '/biz/analysis/trend', label: '月度趋势', icon: <BarChartOutlined />, permission: 'operation.analysis.read' },
    { key: '/biz/analysis/cities', label: '地市对比', icon: <ApartmentOutlined />, permission: 'operation.analysis.read' },
    { key: '/biz/analysis/overruns', label: '超额清单', icon: <WalletOutlined />, permission: 'operation.analysis.read' },
  ], permSet, isSuper, me?.roleCode);
  const contractItems = filterByPermission([
    { key: '/biz/contract-overview', label: '合同概览', icon: <FileTextOutlined />, permission: 'operation.contract.read' },
    { key: '/biz/operation', label: '合同上传', icon: <FileTextOutlined />, permission: 'operation.contract.read', hideForRoles: ['city_user'] },
    { key: '/biz/fee-rates', label: '管理费率', icon: <WalletOutlined />, permission: 'operation.contract.read', hideForRoles: ['city_user'] },
  ], permSet, isSuper, me?.roleCode);
  const costItems = filterByPermission([
    { key: '/biz/costs', label: '地市成本', icon: <WalletOutlined />, permission: 'operation.cost.read' },
  ], permSet, isSuper, me?.roleCode);
  const completionItems = filterByPermission([
    { key: '/biz/orders', label: '订单管理', icon: <InboxOutlined />, permission: 'operation.order.upload' },
    { key: '/biz/offline-completions', label: '线下完工', icon: <TeamOutlined />, permission: 'operation.completion.read' },
  ], permSet, isSuper, me?.roleCode);
  const maintenanceItems: NonNullable<MenuProps['items']> = [
    { key: '/biz/maintenance/personnel', label: '人员管理', icon: <TeamOutlined /> },
    { key: '/biz/maintenance/vehicles', label: '资产管理', icon: <InboxOutlined /> },
    { key: '/biz/maintenance/generators', label: '油机管理', icon: <SettingOutlined /> },
  ];

  const businessItems: NonNullable<MenuProps['items']> = [
    ...(analysisItems.length > 0 ? [{ key: 'biz-analysis', label: '经营管理', icon: <BarChartOutlined />, children: analysisItems }] : []),
    ...(contractItems.length > 0 ? [{ key: 'biz-contract', label: '合同管理', icon: <FileTextOutlined />, children: contractItems }] : []),
    ...(costItems.length > 0 ? [{ key: 'biz-cost', label: '成本管理', icon: <WalletOutlined />, children: costItems }] : []),
    ...(completionItems.length > 0 ? [{ key: 'biz-completion', label: '完工管理', icon: <TeamOutlined />, children: completionItems }] : []),
  ];
  const menuItems: MenuProps['items'] = [
    ...messageItems,
    ...businessItems,
  ];
  const isMaintenanceModule = location.pathname.startsWith('/biz/maintenance');
  const isSystemModule = ['/biz/settings', '/biz/admin', '/biz/region-settings', '/biz/audit-logs', '/biz/data-delete'].some(path => location.pathname === path || location.pathname.startsWith(`${path}/`));
  const moduleName = isMaintenanceModule ? '维护管理' : isSystemModule ? '系统设置' : '经营管理';
  const standaloneMaintenanceItems: MenuProps['items'] = [
    { key: '/biz/maintenance/overview', label: '数据总览', icon: <BarChartOutlined /> },
    { key: '/biz/maintenance/documents', label: '资料管理', icon: <FileTextOutlined /> },
    { key: '/biz/maintenance/personnel', label: '人员管理', icon: <TeamOutlined /> },
    { key: 'maintenance-assets', label: '资产管理', icon: <InboxOutlined />, children: [
      { key: '/biz/maintenance/vehicles', label: '车辆管理', icon: <InboxOutlined /> },
      { key: '/biz/maintenance/generators', label: '油机管理', icon: <SettingOutlined /> },
    ] },
  ];
  // 移动端与桌面端保持同一层级，避免两种导航结构产生不同入口。
  const mobileMenuItems: MenuProps['items'] = [
    ...messageItems,
    ...businessItems,
  ];

  // 叶子路由必须优先于父路由匹配；此前 /biz/analysis/trend 会被 /biz/analysis 抢占，
  // 其他未列出的路由还会错误回退为“合同上传”。
  const navigationPaths = [
    '/biz/analysis/overruns', '/biz/analysis/cities', '/biz/analysis/trend', '/biz/analysis',
    '/biz/contract-overview', '/biz/fee-rates', '/biz/operation', '/biz/offline-completions', '/biz/orders',
    '/biz/costs', '/biz/messages', '/biz/settings', '/biz/admin', '/biz/region-settings', '/biz/audit-logs', '/biz/data-delete',
    '/biz/maintenance/overview', '/biz/maintenance/documents', '/biz/maintenance/personnel', '/biz/maintenance/vehicles', '/biz/maintenance/generators',
  ];
  const selectedKey = navigationPaths.find((path) => location.pathname === path || location.pathname.startsWith(`${path}/`));
  const activeGroupKey = location.pathname.startsWith('/biz/analysis')
    ? 'biz-analysis'
    : location.pathname.startsWith('/biz/operation') || location.pathname.startsWith('/biz/contract-overview')
      || location.pathname.startsWith('/biz/fee-rates')
      ? 'biz-contract'
    : location.pathname.startsWith('/biz/costs')
      ? 'biz-cost'
      : location.pathname.startsWith('/biz/orders') || location.pathname.startsWith('/biz/offline-completions')
        ? 'biz-completion'
        : location.pathname.startsWith('/biz/maintenance')
          ? 'maintenance-assets'
        : undefined;
  const [openKeys, setOpenKeys] = useState<string[]>([]);
  const visibleOpenKeys = [...new Set([...openKeys, ...(activeGroupKey ? [activeGroupKey] : [])])];

  // 一级、二级门户独立呈现模块卡片，进入具体模块后才显示业务侧栏。
  const isModulePortal = location.pathname === '/biz/portal';

  const menu = (
    <Menu
      className="biz-navigation"
      mode="inline"
      theme="dark"
      style={{ borderInlineEnd: 'none' }}
      selectedKeys={selectedKey ? [String(selectedKey)] : []}
      items={isMaintenanceModule ? standaloneMaintenanceItems : isSystemModule ? systemItems : (isMobile ? mobileMenuItems : menuItems)}
      openKeys={isMobile ? undefined : visibleOpenKeys}
      onOpenChange={isMobile ? undefined : (keys) => setOpenKeys(keys as string[])}
      onClick={({ key }) => { if (String(key).startsWith('/biz/')) navigate(String(key)); if (isMobile) setMobileOpen(false); }}
    />
  );

  if (isModulePortal) return <Outlet />;
  if (!me) return <div style={{ padding: 48, textAlign: 'center' }}><Spin /></div>;
  const modulePermission = isSystemModule ? 'portal.system.enter' : isMaintenanceModule ? 'portal.maintenance.enter'
    : location.pathname === '/biz/placeholder/engineering' ? 'portal.engineering.enter'
      : /^\/biz\/(operation|analysis|contract-overview|fee-rates|orders|offline-completions|costs)(\/|$)/.test(location.pathname) ? 'maintenance.operation.enter' : undefined;
  if (me && modulePermission && !isSuper && !permSet.has(modulePermission)) {
    return <Result status="403" title="没有访问该模块的权限" extra={<Button onClick={() => navigate('/biz/portal')}>返回门户</Button>} />;
  }

  return (
    <BizSnapshotProvider>
      <Layout style={{ minHeight: '100vh' }}>
      {!isMobile && (
        <Sider collapsible collapsed={collapsed} onCollapse={setCollapsed} width={200} style={{ position: 'sticky', top: 0, height: '100vh' }}>
          <div className="biz-sider-brand">
            <img className="biz-sider-logo" src={`${import.meta.env.BASE_URL}logo.jpg`} alt="中屹技术" />
            {!collapsed && <span className="biz-sider-name">{moduleName}</span>}
          </div>
          {menu}
        </Sider>
      )}
      <Layout>
        <Header className="biz-header" style={{ background: '#fff', padding: '0 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e8edf0', height: 48, lineHeight: '48px' }}>
          <Space>
            {isMobile && <Button type="text" icon={<MenuOutlined />} onClick={() => setMobileOpen(true)} />}
            {isMobile && <Text strong>{moduleName}</Text>}
            <Button type="text" icon={<HomeOutlined />} onClick={() => navigate('/biz/portal')}>门户首页</Button>
          </Space>
          {!isMaintenanceModule && !isSystemModule && <SnapshotStatusBar />}
          <Dropdown
            menu={{ items: [
              { key: 'password', icon: <KeyOutlined />, label: '修改密码', onClick: () => setPasswordOpen(true) },
              { type: 'divider' as const },
              { key: 'logout', label: '退出登录', onClick: () => { clearBizToken(); clearBizPermissionCache(); navigate('/biz/login'); } },
            ] }}
          >
            <Space style={{ cursor: 'pointer' }}>
              <Avatar size="small" icon={<UserOutlined />} style={{ background: '#2f9e62' }} />
              <Text>{me?.username ?? ''}</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>{me ? ROLE_LABEL[me.roleCode] ?? me.roleCode : ''}</Text>
            </Space>
          </Dropdown>
        </Header>
        <Content style={{ margin: 0, minHeight: 'calc(100vh - 48px)' }}>
          <Outlet />
        </Content>
      </Layout>
      <Drawer
        className="biz-mobile-drawer"
        placement="left"
        open={isMobile && mobileOpen}
        onClose={() => setMobileOpen(false)}
        width={240}
        styles={{ body: { padding: 0, background: '#001529' } }}
      >
        <div style={{ padding: 16, fontWeight: 600, color: '#fff' }}>{moduleName}</div>
        {menu}
      </Drawer>
      <Modal
        title="修改密码"
        open={passwordOpen}
        confirmLoading={passwordSaving}
        okText="确认修改"
        cancelText="取消"
        onCancel={() => { if (!passwordSaving) { setPasswordOpen(false); passwordForm.resetFields(); } }}
        onOk={() => { void passwordForm.submit(); }}
        destroyOnClose
      >
        <Form form={passwordForm} layout="vertical" onFinish={(values) => { void submitPasswordChange(values); }}>
          <Form.Item name="currentPassword" label="原密码" rules={[{ required: true, message: '请输入原密码' }]}>
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Form.Item name="newPassword" label="新密码" rules={[{ required: true, min: 8, max: 128, message: '新密码长度必须为 8-128 位' }]}>
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item name="confirmPassword" label="确认新密码" dependencies={['newPassword']} rules={[{ required: true, message: '请再次输入新密码' }, ({ getFieldValue }) => ({ validator(_, value) { return !value || getFieldValue('newPassword') === value ? Promise.resolve() : Promise.reject(new Error('两次输入的新密码不一致')); } })]}>
            <Input.Password autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>
      </Layout>
    </BizSnapshotProvider>
  );
}
