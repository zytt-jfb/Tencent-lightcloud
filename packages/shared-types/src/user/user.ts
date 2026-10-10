/**
 * 用户实体
 * 来源：DDL users 表
 *
 * 双角色体系：
 * - system_admin: username + password_hash 非空, openid 为空
 * - city_user: openid 非空, 绑定 city_id
 */
export interface User {
  id: number;
  role: import('../enums').Role;
  name: string;
  cityId: number | null;
  openid: string | null;
  username: string | null;
  passwordHash: string | null; // 前端永远不接收此字段
  status: import('../enums').UserStatus;
  authVersion: number;
  mustChangePassword: boolean;
  registerAt: Date;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** 前端安全用户简版（不含 password_hash 等） */
export interface UserBrief {
  id: number;
  role: import('../enums').Role;
  name: string;
  cityId: number | null;
  mustChangePassword: boolean;
}
