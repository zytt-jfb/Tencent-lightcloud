import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Empty, Result, Skeleton, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import axios from 'axios';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { bizMe, type BizMeResult } from '@/api/biz.api';
import { bizWorkbench, type WorkbenchResult } from '@/api/workbench.api';
import { NAV_GROUPS, NAV_MODULES, ROLE_LABEL, visibleLeaves } from '@/components/biz/biz-navigation';
import { clearBizToken } from '@/utils/biz-auth';
import { clearBizPermissionCache } from '@/utils/biz-permission';

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

/**
 * 工作台（登录后的落地页）
 *
 * 回答两件事：
 *   ① 我今天要做什么 —— 待办指标条（一行铺开，状态色区分紧急度）
 *   ② 我权限内的功能在哪 —— 功能目录（按模块分组，链接式而非按钮堆）
 *
 * 视觉上刻意复用 v3 设计语言（--v3-* 变量、4px 圆角、13px 卡头、tabular-nums），
 * 与经营概览等业务页保持同一套节奏；工作台脱离 BizLayout 渲染，故整页壳层自带。
 *
 * 两个功能约束不变：
 *   · 入口清单来自 biz-navigation，与侧栏同一份数据
 *   · 待办数字由服务端按权限计算，算不出来显示「—」，绝不显示 0
 */
export default function BizWorkbench() {
  const navigate = useNavigate();
  const [me, setMe] = useState<BizMeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [workbench, setWorkbench] = useState<WorkbenchResult | null>(null);
  const [todoLoading, setTodoLoading] = useState(true);

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
          <div className="v3-head-actions">
            <Button icon={<ReloadOutlined />} onClick={() => void loadTodos()} loading={todoLoading}>刷新待办</Button>
            <Button onClick={logout}>退出</Button>
          </div>
        </div>
      </header>

      <main className="wb-main">
        {/* ② 待办：一行指标条，先出骨架，不阻塞下方功能目录 */}
        <section>
          <div className="wb-section-head">
            <h2 className="wb-section-title">待办事项</h2>
            <span className="wb-section-meta">
              {todoLoading ? '统计中…' : workbench ? '按当前权限统计' : '统计失败'}
            </span>
          </div>

          {todoLoading ? (
            <div className="v3-panel" style={{ padding: 16 }}><Skeleton active paragraph={{ rows: 1 }} title={false} /></div>
          ) : !workbench ? (
            <Alert
              type="warning"
              showIcon
              message="待办统计加载失败"
              description="下方功能入口不受影响，可以正常进入各模块；也可以点右上角「刷新待办」重试。"
            />
          ) : todos.length === 0 ? (
            <div className="v3-panel" style={{ padding: '22px 16px', textAlign: 'center' }}>
              <Text type="secondary" style={{ fontSize: 12 }}>当前角色没有配置待办统计项</Text>
            </div>
          ) : (
            <div className="wb-todo-strip">
              {todos.map((todo) => {
                // 全为 0 时用后端给的自然语句（「30 天内没有到期事项」），
                // 有内容时才展开「草稿 2 · 被退回 1」这种明细
                const note = todo.count === 0
                  ? todo.description
                  : todo.detail.length > 0
                    ? todo.detail.map((item) => `${item.label} ${item.value}`).join(' · ')
                    : todo.description;
                const valueClass = todo.count === null
                  ? ' is-empty'
                  : todo.count === 0 ? ' is-zero' : '';
                return (
                  <button
                    key={todo.key}
                    type="button"
                    className={`wb-todo is-${todo.level}`}
                    onClick={() => navigate(todo.link)}
                  >
                    <span className="wb-todo-label">{todo.label}</span>
                    <span className={`wb-todo-value${valueClass}`}>
                      {todo.count === null ? '—' : todo.count}
                    </span>
                    <span className="wb-todo-note" title={note}>{note}</span>
                  </button>
                );
              })}
            </div>
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
      </main>
    </div>
  );
}
