import { useMemo, useState, type ReactNode } from 'react';
import { Button, Dropdown } from 'antd';
import {
  AuditOutlined,
  BarChartOutlined,
  CloudUploadOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  FileSearchOutlined,
  FileTextOutlined,
  LogoutOutlined,
  MenuOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  SwapOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useLocation, useNavigate } from 'react-router-dom';
import { clearToken } from '@/utils/auth';
import { logout } from '@/api/auth.api';
import { isCityRole, isContractManagerRole, isRootRole } from '@/auth/role-routing';
import type { CurrentUser } from '@/types';
import { navigateWithV3Context } from '@/utils/v3-context';
import V3ContextBar from '@/components/V3ContextBar';

interface NavItem {
  key: string;
  label: string;
  icon: ReactNode;
  path: string;
  query?: string;
}

const adminItems: NavItem[] = [
  { key: '/admin/dashboard', label: '经营仪表盘', icon: <DashboardOutlined />, path: '/admin/dashboard' },
  { key: '/admin/overview', label: '工作总览', icon: <BarChartOutlined />, path: '/admin/overview' },
  { key: '/admin/city-compare', label: '地市测算', icon: <SwapOutlined />, path: '/admin/city-compare' },
  { key: '/admin/city-data', label: '地市数据', icon: <DatabaseOutlined />, path: '/admin/city-data' },
  { key: '/admin/contracts', label: '合同管理', icon: <FileTextOutlined />, path: '/admin/contracts' },
  { key: '/admin/data-intake', label: '数据接入', icon: <CloudUploadOutlined />, path: '/admin/data-intake' },
  { key: '/admin/versions', label: '版本与审计', icon: <AuditOutlined />, path: '/admin/versions' },
  { key: '/system/access-control', label: '账号与权限', icon: <SafetyCertificateOutlined />, path: '/system/access-control' },
  { key: '/admin/settings', label: '系统设置', icon: <SettingOutlined />, path: '/admin/settings' },
];

const cityItems: NavItem[] = [
  { key: '/city/overview', label: '本地市总览', icon: <DashboardOutlined />, path: '/city/overview' },
  { key: '/city/data?view=summary', label: '本地市数据', icon: <DatabaseOutlined />, path: '/city/data', query: 'view=summary' },
  { key: '/city/data?view=contracts', label: '本地合同', icon: <FileTextOutlined />, path: '/city/data', query: 'view=contracts' },
  { key: '/city/data?view=costs', label: '本地市成本', icon: <FileSearchOutlined />, path: '/city/data', query: 'view=costs' },
  { key: '/city/data?view=orders', label: '本地市订单', icon: <SwapOutlined />, path: '/city/data', query: 'view=orders' },
  { key: '/city/upload', label: '数据接入与历史', icon: <CloudUploadOutlined />, path: '/city/upload' },
  { key: '/city/versions', label: '版本与审计', icon: <AuditOutlined />, path: '/city/versions' },
  { key: '/city/settings', label: '用户设置', icon: <SettingOutlined />, path: '/city/settings' },
];

const contractItems: NavItem[] = [
  { key: '/admin/contracts', label: '合同管理', icon: <FileTextOutlined />, path: '/admin/contracts' },
  { key: '/admin/settings', label: '用户设置', icon: <SettingOutlined />, path: '/admin/settings' },
];

function isSelected(item: NavItem, pathname: string, search: string): boolean {
  if (pathname !== item.path) return false;
  if (!item.query) return true;
  return new URLSearchParams(search).get('view') === new URLSearchParams(item.query).get('view');
}

export default function AdminLayout({ children, currentUser }: { children: ReactNode; currentUser: CurrentUser }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const items = isCityRole(currentUser.role) ? cityItems : isContractManagerRole(currentUser.role) ? contractItems : adminItems.filter((item) => isRootRole(currentUser.role) || item.key !== '/system/access-control');
  const allItems = useMemo(() => [...adminItems, ...cityItems, ...contractItems], []);
  const currentItem = allItems.find((item) => isSelected(item, location.pathname, location.search));

  const handleLogout = () => {
    void logout().finally(() => {
      clearToken();
      navigate('/login', { replace: true });
    });
  };

  const navigateMenu = (item: NavItem) => {
    const target = item.query ? `${item.path}?${item.query}` : item.path;
    navigate(navigateWithV3Context(target, location.search));
    setMobileOpen(false);
  };

  return (
    <div className="v3-shell">
      <aside className={`v3-sidebar${mobileOpen ? ' is-open' : ''}`} aria-label="主导航">
        <div className="v3-brand">
          <img src={`${import.meta.env.BASE_URL}logo.jpg`} alt="中屹技术有限公司" />
          <div className="v3-brand-copy">
            <strong>经营数据中台</strong>
            <span>{isCityRole(currentUser.role) ? '地市经营工作台' : '经营协同 · 数据治理'}</span>
          </div>
        </div>
        <nav className="v3-nav">
          <div className="v3-nav-group">
            <div className="v3-nav-heading">工作台</div>
            {items.slice(0, isCityRole(currentUser.role) ? 6 : items.length).map((item) => (
              <button key={item.key} className={`v3-nav-link${isSelected(item, location.pathname, location.search) ? ' is-active' : ''}`} onClick={() => navigateMenu(item)} type="button">
                {item.icon}<span>{item.label}</span>
              </button>
            ))}
          </div>
          {isCityRole(currentUser.role) && (
            <div className="v3-nav-group">
              <div className="v3-nav-heading">系统</div>
              {items.slice(6).map((item) => (
                <button key={item.key} className={`v3-nav-link${isSelected(item, location.pathname, location.search) ? ' is-active' : ''}`} onClick={() => navigateMenu(item)} type="button">
                  {item.icon}<span>{item.label}</span>
                </button>
              ))}
            </div>
          )}
        </nav>
        <div className="v3-sidebar-footer">
          <div className="v3-user-badge"><UserOutlined /></div>
          <div className="v3-sidebar-user"><strong>{currentUser.name}</strong><span>{isCityRole(currentUser.role) ? currentUser.cityName || '地市账号' : '平台管理员'}</span></div>
          <Button className="v3-sidebar-logout" type="text" icon={<LogoutOutlined />} aria-label="退出登录" onClick={handleLogout} />
        </div>
      </aside>
      {mobileOpen && <button className="v3-sidebar-backdrop" aria-label="关闭导航" type="button" onClick={() => setMobileOpen(false)} />}
      <div className="v3-main">
        <header className="v3-topbar">
          <div className="v3-topbar-left">
            <Button className="v3-menu-toggle" type="text" icon={<MenuOutlined />} aria-label="打开导航" onClick={() => setMobileOpen(true)} />
            <div className="v3-topbar-title"><span className="v3-topbar-scope">{isCityRole(currentUser.role) ? '地市工作区' : '省级工作区'}</span><span className="v3-topbar-divider"> / </span><span className="v3-topbar-page">{currentItem?.label || '工作台'}</span></div>
          </div>
          <Dropdown menu={{ items: [{ key: 'logout', icon: <LogoutOutlined />, label: '退出登录', onClick: handleLogout }] }} trigger={['click']}>
            <button className="v3-topbar-user" type="button" aria-label="打开用户菜单">
              <span className="v3-role-tag">{isCityRole(currentUser.role) ? currentUser.cityName || '地市账号' : '平台管理员'}</span>
              <UserOutlined />
              <span className="v3-topbar-name">{currentUser.name}</span>
            </button>
          </Dropdown>
        </header>
        <div className="v3-context-wrap"><V3ContextBar currentUser={currentUser} /></div>
        <main className="v3-content">{children}</main>
      </div>
    </div>
  );
}
