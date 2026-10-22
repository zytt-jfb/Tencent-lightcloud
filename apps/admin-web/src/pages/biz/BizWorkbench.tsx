import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Empty, Result, Skeleton, Tabs, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import axios from 'axios';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { bizMe, type BizMeResult } from '@/api/biz.api';
import { bizWorkbench, type WorkbenchResult, type WorkbenchSummary } from '@/api/workbench.api';
import { NAV_GROUPS, NAV_MODULES, ROLE_LABEL, visibleLeaves } from '@/components/biz/biz-navigation';
import { clearBizToken } from '@/utils/biz-auth';
import { clearBizPermissionCache } from '@/utils/biz-permission';
import { BizPermissionCode } from '@/utils/biz-permission-code';
import MaintenanceOverview from '@/pages/biz/maintenance/MaintenanceOverview';
import BizAnalysisOverview from '@/pages/biz/BizAnalysisOverview';
import AssessmentOverview from '@/pages/biz/engineering/AssessmentOverview';
import { BizSnapshotProvider } from '@/components/biz/BizSnapshotContext';

const { Text } = Typography;

const SCOPE_LABEL: Record<string, string> = {
  city: '本市数据',
  province: '全省数据',
  contract: '合同范围数据',
  all: '全部数据',
};

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return '凌晨好';
  if (hour < 12) return '上午好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

/**
 * 顶部中间的日期/时间/星期。
 * 单独成组件：秒级刷新只重渲染这一小块，不带着整页（待办、功能目录）一起重算。
 * 「上午好」仍由 greeting() 在整页渲染时算，两者可能跨整点短暂不一致，属可接受范围。
 */
function WorkbenchClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    <div className="wb-clock">
      <div className="wb-clock-date">
        {now.getFullYear()}年{now.getMonth() + 1}月{now.getDate()}日
        <span className="wb-clock-week">{WEEKDAYS[now.getDay()]}</span>
      </div>
      <div className="wb-clock-time">{pad(now.getHours())}:{pad(now.getMinutes())}:{pad(now.getSeconds())}</div>
    </div>
  );
}

/**
 * 工作台（登录后的落地页）
 *
 * 回答三件事：
 *   ① 我管的盘子现在什么样 —— 数据摘要三张卡（合同即将到期 / 证照保险到期 / 后评估分数排名）
 *   ② 我还得动手做什么 —— 精简待办条，只列非零项，全为零时整行不出现
 *   ③ 我权限内的功能在哪 —— 功能目录（按模块分组，链接式而非按钮堆）
 *
 * 为什么摘要在前、待办在后：省级角色进系统先看盘面（风险/合规/绩效），
 * 再看自己欠了什么；摘要卡没有待办时也照样有信息量，待办全为零时则不占版面。
 *
 * 视觉上刻意复用 v3 设计语言（--v3-* 变量、4px 圆角、13px 卡头、tabular-nums），
 * 与经营概览等业务页保持同一套节奏；工作台脱离 BizLayout 渲染，故整页壳层自带。
 *
 * 两个功能约束不变：
 *   · 入口清单来自 biz-navigation，与侧栏同一份数据
 *   · 所有数字由服务端按权限与数据范围计算，某块无权限或算不出来 → 该卡不渲染，绝不显示 0
 */
export default function BizWorkbench() {
  const navigate = useNavigate();
  const [me, setMe] = useState<BizMeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [workbench, setWorkbench] = useState<WorkbenchResult | null>(null);
  const [todoLoading, setTodoLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('home');

  const loadTodos = useCallback(() => {
    setTodoLoading(true);
    return bizWorkbench()
      .then((data) => setWorkbench(data))
      // 待办统计失败不影响页面本身：功能地图只依赖权限，照样能用
      .catch(() => setWorkbench(null))
      .finally(() => setTodoLoading(false));
  }, []);

  useEffect(() => {
    let active = true;
    bizMe()
      .then((user) => { if (active) setMe(user); })
      .catch((err: unknown) => {
        if (!active) return;
        const status = axios.isAxiosError(err) ? err.response?.status : undefined;
        if (status === 401) {
          clearBizToken();
          clearBizPermissionCache();
          setError('登录已失效，请重新登录');
        } else if (status === 403) {
          setError('当前账号未配置业务角色或权限，请联系管理员');
        } else {
          setError('读取账号信息失败，请稍后重试');
        }
      });
    void loadTodos();
    return () => { active = false; };
  }, [loadTodos]);

  const permissions = useMemo(() => new Set(me?.permissions ?? []), [me]);
  const isSuper = me?.roleCode === 'super_admin';

  /**
   * 概览标签的可见性与侧栏/工作台入口同口径：
   * 维护概览要能进人员或资产（046 之后 contract_manager 两者都没有 → 不显示）；
   * 工程概览看后评估概览权限；经营概览看经营分析权限。
   * 三个标签各自独立，缺哪个就不显示哪个，不做「有模块入口就全展示」。
   */
  const canMaintenanceOverview = isSuper
    || permissions.has(BizPermissionCode.MAINTENANCE_PERSONNEL_ENTER)
    || permissions.has(BizPermissionCode.MAINTENANCE_ASSET_ENTER);
  const canAssessmentOverview = isSuper || permissions.has(BizPermissionCode.ASSESSMENT_OVERVIEW_READ);
  const canAnalysisOverview = isSuper || permissions.has(BizPermissionCode.OPERATION_ANALYSIS_READ);

  /** 权限内的全部叶子入口，按「模块 → 分组」排布；空分组不渲染 */
  const modules = useMemo(() => {
    const leaves = visibleLeaves(permissions, isSuper, me?.roleCode);
    return NAV_MODULES
      .map((module) => ({
        ...module,
        groups: NAV_GROUPS
          .filter((group) => group.module === module.code)
          .map((group) => ({ ...group, leaves: leaves.filter((leaf) => leaf.group === group.code) }))
          .filter((group) => group.leaves.length > 0),
      }))
      .filter((module) => module.groups.length > 0);
  }, [permissions, isSuper, me?.roleCode]);

  const totalLeaves = modules.reduce((sum, module) => sum + module.groups.reduce((n, group) => n + group.leaves.length, 0), 0);
  const todos = workbench?.todos ?? [];
  const activities = workbench?.activities ?? [];

  // 首屏三块盘面：null = 无该项权限或该块统计失败，对应卡片不渲染（不显示 0）
  const summary: WorkbenchSummary | null = workbench?.summary ?? null;
  // 精简待办：只留真正非零的项；全为零时整行不出现，不占版面
  const activeTodos = todos.filter((todo) => todo.count !== null && todo.count > 0);

  const logout = () => {
    clearBizToken();
    clearBizPermissionCache();
    navigate('/biz/login', { replace: true });
  };

  if (error) {
    return (
      <Result
        status={error.includes('失效') ? '403' : 'warning'}
        title={error}
        extra={<Button type="primary" onClick={logout}>返回登录</Button>}
      />
    );
  }

  return (
    <div className="wb-page">
      {/* ① 头部：整页无侧栏，这里负责「我是谁 / 看的是什么范围」 */}
      <header className="wb-header">
        <div className="wb-header-inner">
          <div>
            <div className="v3-eyebrow">工作台</div>
            <h1 className="wb-greeting">{greeting()}{me ? `，${me.username}` : ''}</h1>
            <div className="wb-subline">
              {me && <span className="v3-role-tag">{ROLE_LABEL[me.roleCode] ?? me.roleCode}</span>}
              <span>{SCOPE_LABEL[me?.dataScope?.scopeType ?? ''] ?? '数据范围未配置'}</span>
              {workbench?.today && <span>· 统计基准日 {workbench.today}</span>}
            </div>
          </div>
          <WorkbenchClock />
          <div className="v3-head-actions">
            <Button icon={<ReloadOutlined />} onClick={() => void loadTodos()} loading={todoLoading}>刷新待办</Button>
            <Button onClick={logout}>退出</Button>
          </div>
        </div>
      </header>

      <main className="wb-main">
        <BizSnapshotProvider>
        <Tabs
          className="wb-tabs"
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            {
              key: 'home',
              label: '工作台',
              children: (
                <>
        {/* ② 数据摘要 + 精简待办：先出骨架，不阻塞下方功能目录 */}
        <section>
          <div className="wb-section-head">
            <h2 className="wb-section-title">数据摘要</h2>
            <div className="wb-section-tools">
              <span className="wb-section-meta">
                {todoLoading ? '统计中…' : workbench ? '按当前权限统计' : '统计失败'}
              </span>
              <Button icon={<ReloadOutlined />} onClick={() => void loadTodos()} loading={todoLoading}>刷新</Button>
            </div>
          </div>

          {todoLoading ? (
            <div className="v3-panel" style={{ padding: 16 }}><Skeleton active paragraph={{ rows: 2 }} title={false} /></div>
          ) : !workbench ? (
            <Alert
              type="warning"
              showIcon
              message="数据摘要加载失败"
              description="下方功能入口不受影响，可以正常进入各模块；也可以点右上角「刷新」重试。"
            />
          ) : (
            <>
              {summary && (summary.contract || summary.maintenance || summary.assessment) ? (
                <div className="wb-summary-grid">
                  {summary.contract && (
                    <button
                      type="button"
                      className={`wb-summary is-${summary.contract.expiringCount > 0 ? 'warning' : 'info'}`}
                      onClick={() => navigate('/biz/contract-overview')}
                    >
                      <span className="wb-summary-head">
                        <span className="wb-summary-label">合同即将到期</span>
                        <span className="wb-summary-flag">经营</span>
                      </span>
                      <span className="wb-summary-value">
                        {summary.contract.expiringCount}
                        <span className="wb-summary-unit">份</span>
                      </span>
                      <span className="wb-summary-note">
                        {summary.contract.windowDays} 天内到期 · 不含已到期
                        {summary.contract.abnormalCount > 0 ? ` · ${summary.contract.abnormalCount} 份到期日异常` : ''}
                      </span>
                    </button>
                  )}

                  {summary.maintenance && (
                    <button
                      type="button"
                      className={`wb-summary is-${summary.maintenance.expired > 0 ? 'danger' : summary.maintenance.dueSoon > 0 ? 'warning' : 'info'}`}
                      onClick={() => navigate('/biz/maintenance/expiry')}
                    >
                      <span className="wb-summary-head">
                        <span className="wb-summary-label">证照与保险到期</span>
                        <span className="wb-summary-flag">维护</span>
                      </span>
                      <span className="wb-summary-value">
                        {summary.maintenance.expired + summary.maintenance.dueSoon}
                        <span className="wb-summary-unit">条</span>
                      </span>
                      <span className="wb-summary-kinds">
                        {summary.maintenance.kinds.map((kind) => (
                          <span key={kind.kind} className="wb-summary-kind">
                            <span className="wb-summary-kind-label">{kind.label}</span>
                            <span className="wb-summary-kind-value">{kind.expired + kind.dueSoon}</span>
                          </span>
                        ))}
                      </span>
                      <span className="wb-summary-note">
                        已过期 {summary.maintenance.expired} · {summary.maintenance.windowDays} 天内到期 {summary.maintenance.dueSoon}
                      </span>
                    </button>
                  )}

                  {summary.assessment && (
                    <button
                      type="button"
                      className="wb-summary is-info"
                      onClick={() => navigate('/biz/engineering/assessment/detail')}
                    >
                      <span className="wb-summary-head">
                        <span className="wb-summary-label">后评估分数与排名</span>
                        <span className="wb-summary-flag">工程</span>
                      </span>
                      <span className="wb-summary-value">
                        {summary.assessment.monthAvgScore === null
                          ? '—'
                          : summary.assessment.monthAvgScore.toFixed(2)}
                        <span className="wb-summary-unit">分</span>
                      </span>
                      <span className="wb-summary-note">
                        {summary.assessment.avgMonthRank === null
                          ? '暂无相对排名'
                          : `平均第 ${summary.assessment.avgMonthRank.toFixed(1)} 名 · ${summary.assessment.rankedProjectCount}/${summary.assessment.projectCount} 个项目`}
                      </span>
                      <span className="wb-summary-foot">
                        {summary.assessment.month ?? '—'} · {summary.assessment.supplier}
                      </span>
                    </button>
                  )}
                </div>
              ) : (
                <div className="v3-panel" style={{ padding: '22px 16px', textAlign: 'center' }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    当前角色没有可展示的数据摘要（需要合同、维护或后评估的查看权限）
                  </Text>
                </div>
              )}

              {/* 待办只保留非零项：摘要管「盘子怎么样」，这里只管「我还欠什么」，全为零就整行不出现 */}
              {activeTodos.length > 0 && (
                <div className="wb-todo-strip is-compact">
                  {activeTodos.map((todo) => {
                    const note = todo.detail.length > 0
                      ? todo.detail.map((item) => `${item.label} ${item.value}`).join(' · ')
                      : todo.description;
                    return (
                      <button
                        key={todo.key}
                        type="button"
                        className={`wb-todo is-${todo.level}`}
                        onClick={() => navigate(todo.link)}
                      >
                        <span className="wb-todo-label">{todo.label}</span>
                        <span className="wb-todo-value">{todo.count}</span>
                        <span className="wb-todo-note" title={note}>{note}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </section>

        {/* ③ 功能目录 + 右栏（动态 / 账号信息） */}
        <div className="v3-panel-grid" style={{ marginTop: 16 }}>
          <div className="v3-panel">
            <div className="v3-panel-head">
              <h2>我的功能</h2>
              <span className="wb-section-meta">共 {totalLeaves} 个入口</span>
            </div>
            {modules.length === 0 ? (
              <div className="v3-empty">
                当前账号没有任何功能入口权限，请联系管理员在「权限管理」里配置角色权限。
              </div>
            ) : (
              <div className="wb-catalog">
                {modules.map((module) => {
                  const leaves = module.groups.flatMap((group) => group.leaves);
                  // 单入口模块（消息中心）整块可点，避免标题和入口都写「消息中心」
                  const isSingle = leaves.length === 1;
                  return (
                    <div
                      key={module.code}
                      className={`wb-module${isSingle ? ' is-single' : ''}`}
                      onClick={isSingle ? () => navigate(leaves[0].key) : undefined}
                      role={isSingle ? 'button' : undefined}
                      tabIndex={isSingle ? 0 : undefined}
                      onKeyDown={isSingle ? (event) => { if (event.key === 'Enter' || event.key === ' ') navigate(leaves[0].key); } : undefined}
                    >
                      <div className="wb-module-head">
                        <span className="wb-module-icon">{module.icon}</span>
                        <span className="wb-module-name">{module.label}</span>
                        <span className="wb-module-tail">
                          {isSingle && <span className="wb-module-enter">进入 ›</span>}
                          <span className="wb-module-count">{leaves.length}</span>
                        </span>
                      </div>
                      {/* 分组标签无条件渲染：单分组的模块也占住左列，各模块链接才能左对齐 */}
                      {!isSingle && module.groups.map((group) => (
                        <div key={group.code} className="wb-row">
                          <span className="wb-row-label">{group.workbenchLabel ?? group.label}</span>
                          <span className="wb-links">
                            {group.leaves.map((leaf) => (
                              <button
                                key={leaf.key}
                                type="button"
                                className="wb-link"
                                onClick={() => navigate(leaf.key)}
                              >
                                {leaf.label}
                              </button>
                            ))}
                          </span>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="wb-stack">
            <div className="v3-panel">
              <div className="v3-panel-head">
                <h2>最近动态</h2>
                <span className="wb-section-meta">仅本人操作</span>
              </div>
              <div className="v3-panel-body" style={{ padding: '8px 14px 10px' }}>
                {todoLoading ? (
                  <Skeleton active paragraph={{ rows: 2 }} title={false} />
                ) : activities.length === 0 ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<Text type="secondary" style={{ fontSize: 12 }}>暂无操作记录</Text>} />
                ) : (
                  <div className="wb-timeline">
                    {activities.map((activity) => (
                      <div key={activity.id} className={`wb-act${activity.resultStatus !== 'success' ? ' is-failed' : ''}`}>
                        <span className="wb-act-text">{activity.label}</span>
                        <span className="wb-act-time">{dayjs(activity.createdAt).format('MM-DD HH:mm')}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="v3-panel">
              <div className="v3-panel-head"><h2>账号信息</h2></div>
              <div className="v3-panel-body">
                <div className="wb-meta">
                  <div className="wb-meta-row">
                    <span className="wb-meta-key">登录账号</span>
                    <span className="wb-meta-val">{me?.username ?? '—'}</span>
                  </div>
                  <div className="wb-meta-row">
                    <span className="wb-meta-key">角色</span>
                    <span className="wb-meta-val">{me ? ROLE_LABEL[me.roleCode] ?? me.roleCode : '—'}</span>
                  </div>
                  <div className="wb-meta-row">
                    <span className="wb-meta-key">数据范围</span>
                    <span className="wb-meta-val">{SCOPE_LABEL[me?.dataScope?.scopeType ?? ''] ?? '未配置'}</span>
                  </div>
                  <div className="wb-meta-row">
                    <span className="wb-meta-key">可用入口</span>
                    <span className="wb-meta-val">{totalLeaves} 个</span>
                  </div>
                  <div className="wb-meta-row">
                    <span className="wb-meta-key">待办类别</span>
                    <span className="wb-meta-val">{workbench ? `${todos.length} 项` : '—'}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
                </>
              ),
            },
            ...(canMaintenanceOverview ? [{ key: 'maintenance-overview', label: '维护概览', children: activeTab === 'maintenance-overview' ? <MaintenanceOverview /> : null }] : []),
            ...(canAssessmentOverview ? [{ key: 'assessment-overview', label: '工程概览', children: activeTab === 'assessment-overview' ? <AssessmentOverview /> : null }] : []),
            ...(canAnalysisOverview ? [{ key: 'analysis-overview', label: '经营概览', children: activeTab === 'analysis-overview' ? <BizAnalysisOverview /> : null }] : []),
          ]}
        />
        </BizSnapshotProvider>
      </main>
    </div>
  );
}
