import type { ReactNode } from 'react';
import type { BizPermissionCodeValue } from '@biz-reporting/shared-types';
import { useBizPermission } from '@/utils/biz-permission';

/**
 * 前端权限包装组件：无权限时不渲染 children（仅展示控制）。
 * 后端权限守卫仍是最终授权边界；本组件只负责隐藏无权限的按钮/菜单。
 * code 收窄为 BizPermissionCodeValue：写错权限码编译期即报错。
 */
export default function BizPerm({ code, children, fallback = null }: { code: BizPermissionCodeValue; children: ReactNode; fallback?: ReactNode }) {
  const allowed = useBizPermission(code);
  return <>{allowed ? children : fallback}</>;
}
