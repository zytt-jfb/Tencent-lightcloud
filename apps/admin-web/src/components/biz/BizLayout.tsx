import { BizPermissionCode } from '@/utils/biz-permission-code';
import { useCallback, useEffect, useState } from 'react';
import { Avatar, Button, Drawer, Dropdown, Form, Input, Layout, Menu, Modal, Result, Space, Spin, Typography, message, type MenuProps } from 'antd';
import {
  BarChartOutlined, FileTextOutlined, InboxOutlined, HomeOutlined, KeyOutlined, TeamOutlined,
  UserOutlined, WalletOutlined, MenuOutlined, SafetyCertificateOutlined,
} from '@ant-design/icons';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { bizChangeOwnPassword, bizMe, bizMessageList, type BizSnapshotMetadata } from '@/api/biz.api';
import BizSnapshotProvider, { useBizSnapshot } from '@/components/biz/BizSnapshotContext';
import { NAV_PATHS, ROLE_LABEL, parentMenuKeyOfPath, visibleLeaves, type NavGroupCode, type NavLeaf } from '@/components/biz/biz-navigation';
import { clearBizToken } from '@/utils/biz-auth';
import { clearBizPermissionCache } from '@/utils/biz-permission';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

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

/**
 * 菜单入口统一从 biz-navigation 取，这里只负责「怎么排」。
 * 权限过滤（含 superOnly / hideForRoles / 多权限任一满足）在配置文件里，侧栏与工作台共用同一套判定。
 */
function toMenuItem(leaf: NavLeaf): { key: string; label: string; icon?: React.ReactNode } {
  return { key: leaf.key, label: leaf.label, icon: leaf.icon };
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
    let active = true;
    bizMe().then((user) => { if (active) setMe(user); }).catch((error: unknown) => {
      const status = (error as { response?: { status?: number } }).response?.status;
      if (status === 401) {
        clearBizToken();
        clearBizPermissionCache();
        navigate('/biz/login', { replace: true });
      } else if (active) {
        message.error(status === 403 ? '当前账号未配置业务角色或权限，请联系管理员' : '读取账号信息失败，请稍后重试');
      }
    });
    return () => { active = false; };
  }, [navigate]);

  useEffect(() => {
    if (!me?.permissions?.includes(BizPermissionCode.OPERATION_MESSAGE_READ) && me?.roleCode !== 'super_admin') return;
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

  // 当前账号可见的全部入口（权限判定在 biz-navigation.canSeeLeaf，工作台页共用同一函数）
  const navLeaves = visibleLeaves(permSet, isSuper, me?.roleCode);
  const leavesIn = (groups: NavGroupCode[]) => navLeaves.filter((leaf) => groups.includes(leaf.group));

  const systemItems: NonNullable<MenuProps['items']> = leavesIn(['system']).map(toMenuItem);
  // 未读数是运行态，配置文件里保持静态 label，这里按需补上数字
  const messageItems: NonNullable<MenuProps['items']> = leavesIn(['message']).map((leaf) => ({
    ...toMenuItem(leaf),
    label: unreadCount > 0 ? `${leaf.label} (${unreadCount})` : leaf.label,
  }));
  // 智能助手是顶层叶子，任何登录账号都能进（能查什么由后端定）
  const assistantItems: NonNullable<MenuProps['items']> = leavesIn(['assistant']).map(toMenuItem);

  const analysisItems = leavesIn(['analysis']).map(toMenuItem);
  const contractItems = leavesIn(['contract']).map(toMenuItem);
  const costItems = leavesIn(['cost']).map(toMenuItem);
  const completionItems = leavesIn(['completion']).map(toMenuItem);
  // 工程管理：一级抽屉「后评估管理」，下辖概览 / 数据导入 / 线下填报
  const assessmentItems = leavesIn(['assessment']).map(toMenuItem);
  const engineeringItems: NonNullable<MenuProps['items']> = assessmentItems.length > 0
    ? [{ key: 'assessment', label: '后评估管理', icon: <SafetyCertificateOutlined />, children: assessmentItems }]
    : [];

  const businessItems: NonNullable<MenuProps['items']> = [
    ...(analysisItems.length > 0 ? [{ key: 'biz-analysis', label: '经营管理', icon: <BarChartOutlined />, children: analysisItems }] : []),
    ...(contractItems.length > 0 ? [{ key: 'biz-contract', label: '合同管理', icon: <FileTextOutlined />, children: contractItems }] : []),
    ...(costItems.length > 0 ? [{ key: 'biz-cost', label: '成本管理', icon: <WalletOutlined />, children: costItems }] : []),
    ...(completionItems.length > 0 ? [{ key: 'biz-completion', label: '完工管理', icon: <TeamOutlined />, children: completionItems }] : []),
  ];
  const menuItems: MenuProps['items'] = [
    ...assistantItems,
    ...messageItems,
    ...businessItems,
  ];
  const isEngineeringModule = location.pathname.startsWith('/biz/engineering') || location.pathname.startsWith('/biz/placeholder/engineering');
  const isMaintenanceModule = location.pathname.startsWith('/biz/maintenance') || location.pathname.startsWith('/biz/performance');
  // 智能助手是独立模块：标题、侧栏、守卫都单独判，否则会落到「经营管理」分支，
  // 侧栏出现一堆与助手无关的入口，标题也显示错的模块名。
  const isAiModule = location.pathname === '/biz/ai' || location.pathname.startsWith('/biz/ai/');
  const isSystemModule = ['/biz/settings', '/biz/admin', '/biz/region-settings', '/biz/audit-logs', '/biz/data-delete'].some(path => location.pathname === path || location.pathname.startsWith(`${path}/`));
  const moduleName = isEngineeringModule ? '工程管理' : isMaintenanceModule ? '维护管理' : isSystemModule ? '系统设置' : isAiModule ? '智能助手' : '经营管理';
  /**
   * 维护管理侧栏：总览 / 到期台账 / 人员是顶层叶子，车辆油机收进「资产管理」，
   * 月度分数与绩效上传收进「月度考核」。
   * 总览与到期台账用「人员进入 或 资产进入」任一放行（后端同口径），否则 contract_manager
   * 会看到一个点进去就 403 的入口。
   */
  const maintenanceCoreItems = leavesIn(['maintenance-core']).map(toMenuItem);
  const assetMenuItems = leavesIn(['maintenance-assets']).map(toMenuItem);
  const performanceMenuItems = leavesIn(['performance']).map(toMenuItem);
  const standaloneMaintenanceItems: NonNullable<MenuProps['items']> = [
    ...maintenanceCoreItems,
    ...(assetMenuItems.length > 0 ? [{ key: 'maintenance-assets', label: '资产管理', icon: <InboxOutlined />, children: assetMenuItems }] : []),
    ...(performanceMenuItems.length > 0 ? [{ key: 'performance', label: '月度考核', icon: <BarChartOutlined />, children: performanceMenuItems }] : []),
  ];
  // 移动端与桌面端保持同一层级，避免两种导航结构产生不同入口。
  const mobileMenuItems: MenuProps['items'] = [
    ...assistantItems,
    ...messageItems,
    ...businessItems,
  ];

  // 叶子路由必须优先于父路由匹配；NAV_PATHS 已按路径长度倒序，
  // 否则 /biz/analysis/trend 会被 /biz/analysis 抢占，未列出的路由还会错误回退为“合同上传”。
  const selectedKey = NAV_PATHS.find((path) => location.pathname === path || location.pathname.startsWith(`${path}/`));
  // 分组 → 父菜单 key 的映射也在配置文件里，顶层叶子（总览/台账/人员）返回 undefined，不会顺带弹开无关分组
  const activeGroupKey = parentMenuKeyOfPath(location.pathname);
  const [openKeys, setOpenKeys] = useState<string[]>([]);
  /**
   * 只在「路由切到另一个分组」时自动展开该分组。
   * 不能像早先那样把 activeGroupKey 并进渲染值（visibleOpenKeys = state ∪ activeGroupKey）：
   * 那样用户点收起时，onOpenChange 会把 key 从 state 里删掉，但下一次渲染又被并回来，
   * 表现就是箭头点了没反应。现在收起状态完全由 state 决定，路由变化才补展开。
   */
  useEffect(() => {
    if (!activeGroupKey) return;
    setOpenKeys((prev) => (prev.includes(activeGroupKey) ? prev : [...prev, activeGroupKey]));
  }, [activeGroupKey]);

  // 工作台（原一级门户）是登录后的落地页，全屏呈现，进入具体模块后才显示业务侧栏。
  const isModulePortal = location.pathname === '/biz/portal';

  const menu = (
    <Menu
      className="biz-navigation"
      mode="inline"
      theme="dark"
      style={{ borderInlineEnd: 'none' }}
      selectedKeys={selectedKey ? [String(selectedKey)] : []}
      items={isSystemModule ? systemItems : isEngineeringModule ? engineeringItems : isMaintenanceModule ? standaloneMaintenanceItems : (isMobile ? mobileMenuItems : menuItems)}
      openKeys={isMobile ? undefined : openKeys}
      onOpenChange={isMobile ? undefined : (keys) => setOpenKeys(keys as string[])}
      onClick={({ key }) => { if (String(key).startsWith('/biz/')) navigate(String(key)); if (isMobile) setMobileOpen(false); }}
    />
  );

  if (isModulePortal) return <Outlet />;
  if (!me) return <div style={{ padding: 48, textAlign: 'center' }}><Spin /></div>;
  const modulePermission = isSystemModule ? BizPermissionCode.PORTAL_SYSTEM_ENTER : isEngineeringModule ? BizPermissionCode.PORTAL_ENGINEERING_ENTER : isMaintenanceModule ? BizPermissionCode.PORTAL_MAINTENANCE_ENTER
    : location.pathname === '/biz/placeholder/engineering' ? BizPermissionCode.PORTAL_ENGINEERING_ENTER
      : /^\/biz\/(operation|analysis|contract-overview|fee-rates|orders|offline-completions|costs)(\/|$)/.test(location.pathname) ? BizPermissionCode.MAINTENANCE_OPERATION_ENTER : undefined;
  if (me && modulePermission && !isSuper && !permSet.has(modulePermission)) {
    return <Result status="403" title="没有访问该模块的权限" extra={<Button onClick={() => navigate('/biz/portal')}>返回工作台</Button>} />;
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
            <Button type="text" icon={<HomeOutlined />} onClick={() => navigate('/biz/portal')}>工作台</Button>
          </Space>
          {!isMaintenanceModule && !isSystemModule && !isEngineeringModule && !isAiModule && <SnapshotStatusBar />}
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
        destroyOnHidden
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
