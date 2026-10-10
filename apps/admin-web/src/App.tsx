import { lazy, Suspense, useEffect, useState } from 'react';
import { Button, Result, Spin } from 'antd';
import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import AuthGuard from '@/components/AuthGuard';
import BizLayout from '@/components/biz/BizLayout';
import { BizAnalysisOptionsProvider } from '@/components/biz/BizAnalysisOptionsContext';
import AdminLayout from '@/components/AdminLayout';
import { getMe } from '@/api/auth.api';
import { clearToken } from '@/utils/auth';
import { getRoleHome, isAdminRole, isCityRole, isContractManagerRole, isRootRole, isSupportedRole } from '@/auth/role-routing';
import type { CurrentUser } from '@/types';

const Login = lazy(() => import('@/pages/Login'));
const Dashboard = lazy(() => import('@/pages/V3Dashboard'));
const Contracts = lazy(() => import('@/pages/Contracts'));
const Settings = lazy(() => import('@/pages/Settings'));
const CityOverview = lazy(() => import('@/pages/CityOverview'));
const CityEstimate = lazy(() => import('@/pages/V3CityCompare'));
const FactOverview = lazy(() => import('@/pages/FactOverview'));
const Versions = lazy(() => import('@/pages/Versions'));
const AccessControl = lazy(() => import('@/pages/AccessControl'));
const AdminCityDataWorkspace = lazy(() => import('@/pages/V3Workspace').then((module) => ({ default: module.AdminCityDataWorkspace })));
const CityDataWorkspace = lazy(() => import('@/pages/V3Workspace').then((module) => ({ default: module.CityDataWorkspace })));
const DataIntakeWorkspace = lazy(() => import('@/pages/V3Workspace').then((module) => ({ default: module.DataIntakeWorkspace })));
const Packages = lazy(() => import('@/pages/Packages'));
const ImportJobs = lazy(() => import('@/pages/ImportJobs'));
const CityReporting = lazy(() => import('@/pages/CityReporting'));
const BizLogin = lazy(() => import('@/pages/biz/BizLogin'));
const BizPortal = lazy(() => import('@/pages/biz/BizPortal'));
const MaintenanceHome = lazy(() => import('@/pages/biz/maintenance/MaintenanceHome'));
const MaintenanceOverview = lazy(() => import('@/pages/biz/maintenance/MaintenanceOverview'));
const MaintenanceDocuments = lazy(() => import('@/pages/biz/maintenance/MaintenanceDocuments'));
const BizPlaceholder = lazy(() => import('@/pages/biz/BizPlaceholder'));
const BizAdmin = lazy(() => import('@/pages/biz/BizAdmin'));
const BizAuditLogs = lazy(() => import('@/pages/biz/BizAuditLogs'));
const BizContracts = lazy(() => import('@/pages/biz/BizContracts'));
const BizContractOverview = lazy(() => import('@/pages/biz/BizContractOverview'));
const BizFeeRateMaintenance = lazy(() => import('@/pages/biz/BizFeeRateMaintenance'));
const BizOrders = lazy(() => import('@/pages/biz/BizOrders'));
const BizOfflineCompletions = lazy(() => import('@/pages/biz/BizOfflineCompletions'));
const BizCosts = lazy(() => import('@/pages/biz/BizCosts'));
const BizAnalysis = lazy(() => import('@/pages/biz/BizAnalysis'));
const BizAnalysisOverview = lazy(() => import('@/pages/biz/BizAnalysisOverview'));
const BizAnalysisTrend = lazy(() => import('@/pages/biz/BizAnalysisTrend'));
const BizAnalysisCities = lazy(() => import('@/pages/biz/BizAnalysisCities'));
const BizAnalysisCityDetail = lazy(() => import('@/pages/biz/BizAnalysisCityDetail'));
const BizAnalysisOverruns = lazy(() => import('@/pages/biz/BizAnalysisOverruns'));
const BizSettings = lazy(() => import('@/pages/biz/BizSettings'));
const BizMessages = lazy(() => import('@/pages/biz/BizMessages'));
const BizDataDeletion = lazy(() => import('@/pages/biz/BizDataDeletion'));
const BizRegionSettings = lazy(() => import('@/pages/biz/BizRegionSettings'));

function PageLoading() {
  return <div style={{ minHeight: 240, display: 'grid', placeItems: 'center' }}><Spin /></div>;
}
function UnsupportedRole() {
  const navigate = useNavigate();
  return <Result status="403" title="当前账号无可用工作台" subTitle="该账号尚未配置可访问的系统角色，请联系管理员处理。" extra={<Button type="primary" onClick={() => { clearToken(); navigate('/login?reason=unsupported-role', { replace: true }); }}>返回登录</Button>} />;
}
function RoleRoutes({ currentUser }: { currentUser: CurrentUser }) {
  const role = currentUser.role;
  const home = getRoleHome(role) || '/login';
  return <AdminLayout currentUser={currentUser}><Suspense fallback={<PageLoading />}><Routes>
    {isAdminRole(role) && <>
      <Route path="/admin/dashboard" element={<Dashboard />} />
      <Route path="/admin/overview" element={<FactOverview />} />
      <Route path="/admin/city-compare" element={<CityEstimate />} />
      <Route path="/admin/city-data" element={<AdminCityDataWorkspace />} />
      <Route path="/admin/data-intake" element={<DataIntakeWorkspace currentUser={currentUser} />} />
      <Route path="/admin/versions" element={<Versions admin />} />
      <Route path="/admin/contracts" element={<Contracts readOnly={!isRootRole(role)} />} />
      <Route path="/admin/settings" element={<Settings currentUser={currentUser} />} />
      <Route path="/admin/facts" element={<Navigate to="/admin/overview" replace />} />
      <Route path="/admin/city-estimate" element={<Navigate to="/admin/city-compare" replace />} />
      <Route path="/admin/import-jobs" element={<Navigate to="/admin/data-intake" replace />} />
      <Route path="/admin/city-overview" element={<Navigate to="/admin/overview" replace />} />
      <Route path="/admin/city-reporting" element={<Navigate to="/admin/city-data" replace />} />
      <Route path="/admin/city-cost" element={<Navigate to="/admin/city-data" replace />} />
      <Route path="/compat/admin/packages" element={<Packages />} />
      <Route path="/compat/admin/import-jobs" element={<ImportJobs currentUser={currentUser} />} />
    </>}
    {isRootRole(role) && <Route path="/system/access-control" element={<AccessControl />} />}
    {isCityRole(role) && <>
      <Route path="/city/overview" element={<CityOverview />} />
      <Route path="/city/upload" element={<DataIntakeWorkspace currentUser={currentUser} />} />
      <Route path="/city/data" element={<CityDataWorkspace />} />
      <Route path="/city/versions" element={<Versions admin={false} />} />
      <Route path="/city/settings" element={<Settings currentUser={currentUser} />} />
      <Route path="/admin/city-overview" element={<Navigate to="/city/overview" replace />} />
      <Route path="/admin/city-costs" element={<Navigate to="/city/data" replace />} />
      <Route path="/admin/city-orders" element={<Navigate to="/city/data" replace />} />
      <Route path="/admin/city-contracts" element={<Navigate to="/city/data" replace />} />
      <Route path="/admin/import-jobs" element={<Navigate to="/city/upload" replace />} />
      <Route path="/admin/city-reporting" element={<Navigate to="/city/data" replace />} />
      <Route path="/compat/city/reporting" element={<CityReporting view="report" />} />
    </>}
    {isContractManagerRole(role) && <>
      <Route path="/admin/contracts" element={<Contracts />} />
      <Route path="/admin/settings" element={<Settings currentUser={currentUser} />} />
    </>}
    <Route path="*" element={<Navigate to={home} replace />} />
  </Routes></Suspense></AdminLayout>;
}
function ProtectedRoutes() {
  const location = useLocation();
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>();
  useEffect(() => {
    let active = true;
    void getMe().then((user) => { if (active) setCurrentUser(user); }).catch(() => { clearToken(); if (active) setCurrentUser(null); });
    return () => { active = false; };
  }, []);
  if (currentUser === undefined) return <PageLoading />;
  if (currentUser === null) return <Navigate to={`/login?redirect=${encodeURIComponent(`${location.pathname}${location.search}`)}`} replace />;
  if (!isSupportedRole(currentUser.role)) return <UnsupportedRole />;
  const settingsPath = isCityRole(currentUser.role) ? '/city/settings' : '/admin/settings';
  if (currentUser.mustChangePassword) {
    if (location.pathname !== settingsPath) return <Navigate to={`${settingsPath}?required=temporary-password`} replace />;
    return <div style={{ minHeight: '100vh', padding: 24, background: '#f5f7f6' }}><Suspense fallback={<PageLoading />}><Settings currentUser={currentUser} /></Suspense></div>;
  }
  return <RoleRoutes key={currentUser.id} currentUser={currentUser} />;
}
function LegacyBanner({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <div style={{ background: '#fdf0e3', borderBottom: '1px solid #f0d9b5', padding: '4px 16px', fontSize: 12, color: '#9a6b1f' }}>
        旧版界面（已废弃）：仅保留回退访问路径，请使用新系统入口 /#/biz/login
      </div>
      {children}
    </div>
  );
}

export default function App() {
  const protectedRoute = <AuthGuard><ProtectedRoutes /></AuthGuard>;
  return <HashRouter><Routes>
    {/* 默认入口：新基线（biz_）两级门户 */}
    <Route path="/" element={<Navigate to="/biz/login" replace />} />
    <Route path="/biz/login" element={<Suspense fallback={<PageLoading />}><BizLogin /></Suspense>} />
    {/* 共享筛选选项（年度 / 省份 / 地市）提升到 /biz 布局层，供概览、趋势、地市对比、超额、成本复用 */}
    <Route path="/biz" element={<BizAnalysisOptionsProvider><BizLayout /></BizAnalysisOptionsProvider>}>
      <Route index element={<Navigate to="/biz/portal" replace />} />
      <Route path="portal" element={<Suspense fallback={<PageLoading />}><BizPortal /></Suspense>} />
      <Route path="system" element={<Navigate to="/biz/settings" replace />} />
      <Route path="maintenance" element={<Navigate to="/biz/maintenance/overview" replace />} />
      <Route path="maintenance/overview" element={<Suspense fallback={<PageLoading />}><MaintenanceOverview /></Suspense>} />
      <Route path="maintenance/documents" element={<Suspense fallback={<PageLoading />}><MaintenanceDocuments /></Suspense>} />
      <Route path="maintenance/records" element={<Navigate to="/biz/maintenance/personnel" replace />} />
      <Route path="maintenance/personnel" element={<Suspense fallback={<PageLoading />}><MaintenanceHome /></Suspense>} />
      <Route path="maintenance/vehicles" element={<Suspense fallback={<PageLoading />}><MaintenanceHome /></Suspense>} />
      <Route path="maintenance/generators" element={<Suspense fallback={<PageLoading />}><MaintenanceHome /></Suspense>} />
      <Route path="placeholder/:code" element={<Suspense fallback={<PageLoading />}><BizPlaceholder /></Suspense>} />
      <Route path="operation" element={<Suspense fallback={<PageLoading />}><BizContracts /></Suspense>} />
      <Route path="contract-overview" element={<Suspense fallback={<PageLoading />}><BizContractOverview /></Suspense>} />
      <Route path="fee-rates" element={<Suspense fallback={<PageLoading />}><BizFeeRateMaintenance /></Suspense>} />
      <Route path="orders" element={<Suspense fallback={<PageLoading />}><BizOrders /></Suspense>} />
      <Route path="offline-completions" element={<Suspense fallback={<PageLoading />}><BizOfflineCompletions /></Suspense>} />
      <Route path="costs" element={<Suspense fallback={<PageLoading />}><BizCosts /></Suspense>} />
      <Route path="analysis" element={<Suspense fallback={<PageLoading />}><BizAnalysisOverview /></Suspense>} />
      <Route path="analysis/trend" element={<Suspense fallback={<PageLoading />}><BizAnalysisTrend /></Suspense>} />
      <Route path="analysis/cities" element={<Suspense fallback={<PageLoading />}><BizAnalysisCities /></Suspense>} />
      <Route path="analysis/city/:cityId" element={<Suspense fallback={<PageLoading />}><BizAnalysisCityDetail /></Suspense>} />
      <Route path="analysis/overruns" element={<Suspense fallback={<PageLoading />}><BizAnalysisOverruns /></Suspense>} />
      <Route path="settings" element={<Suspense fallback={<PageLoading />}><BizSettings /></Suspense>} />
      <Route path="messages" element={<Suspense fallback={<PageLoading />}><BizMessages /></Suspense>} />
      <Route path="admin" element={<Suspense fallback={<PageLoading />}><BizAdmin /></Suspense>} />
      <Route path="region-settings" element={<Suspense fallback={<PageLoading />}><BizRegionSettings /></Suspense>} />
      <Route path="audit-logs" element={<Suspense fallback={<PageLoading />}><BizAuditLogs /></Suspense>} />
      <Route path="data-delete" element={<Suspense fallback={<PageLoading />}><BizDataDeletion /></Suspense>} />
    </Route>
    {/* 旧版登录（已废弃，保留回退路径） */}
    <Route path="/login" element={<Suspense fallback={<PageLoading />}><LegacyBanner><Login /></LegacyBanner></Suspense>} />
    <Route path="/*" element={<LegacyBanner>{protectedRoute}</LegacyBanner>} />
  </Routes></HashRouter>;
}
