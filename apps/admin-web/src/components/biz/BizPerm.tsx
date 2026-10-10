import type { ReactNode } from 'react';
import { useBizPermission } from '@/utils/biz-permission';

/**
 * 前端权限包装组件：无权限时不渲染 children（仅展示控制）。
 * 后端权限守卫仍是最终授权边界；本组件只负责隐藏无权限的按钮/菜单。
 */
export default function BizPerm({ code, children, fallback = null }: { code: string; children: ReactNode; fallback?: ReactNode }) {
  const allowed = useBizPermission(code);
  return <>{allowed ? children : fallback}</>;
}
