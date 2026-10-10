/**
 * Admin Web 前端特有类型
 *
 * 后端 DTO 类型统一从 @biz-reporting/shared-types 导入，
 * 本文件仅定义前端特有类型，不重复 DTO。
 */
import type { Role } from '@biz-reporting/shared-types';

/** 侧边栏菜单项 */
export interface MenuItem {
  key: string;
  label: string;
  icon?: React.ReactNode;
  path: string;
}

/** 当前登录用户（前端缓存用，来自 /api/me 响应） */
export interface CurrentUser {
  id: number;
  role: Role | string;
  name: string;
  cityId: number | null;
  cityName: string | null;
  mustChangePassword: boolean;
}

/** 表格分页参数（前端状态用） */
export interface TablePagination {
  page: number;
  pageSize: number;
  total: number;
}
