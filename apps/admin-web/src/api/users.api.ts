/**
 * 用户管理 API（Admin 端）
 * 对应后端端点：
 *   GET   /api/admin/users             — 用户列表
 *   PATCH /api/admin/users/:id/status  — 启用/禁用
 */
import type {
  CreateManagedUserRequest,
  CreateManagedUserResponse,
  ResetManagedUserPasswordResponse,
  UpdateManagedUserRoleRequest,
  UserListItem,
  UserListResponse,
  UpdateUserStatusRequest,
} from '@biz-reporting/shared-types';
import type { Role } from '@biz-reporting/shared-types';
import request from '@/utils/request';

const BASE = '/admin/users';

/** 获取用户列表 */
export function listUsers(): Promise<UserListResponse> {
  return request.get(BASE);
}

export function createUser(data: CreateManagedUserRequest): Promise<CreateManagedUserResponse> {
  return request.post(BASE, data);
}

/** 更新用户状态（启用/禁用） */
export function updateUserStatus(
  userId: number,
  data: UpdateUserStatusRequest,
): Promise<UserListItem> {
  return request.patch(`${BASE}/${userId}/status`, data);
}

export function migrateLegacyRole(
  userId: number,
  data: { targetRole: Role; cityId?: number | null },
): Promise<UserListItem> {
  return request.patch(`${BASE}/${userId}/role`, data);
}

export function updateUserRole(userId: number, data: UpdateManagedUserRoleRequest): Promise<UserListItem> {
  return request.patch(`${BASE}/${userId}/role`, data);
}

export function rebindUserCity(
  userId: number,
  data: { cityId: number },
): Promise<UserListItem> {
  return request.patch(`${BASE}/${userId}/city`, data);
}

export function resetUserPassword(userId: number): Promise<ResetManagedUserPasswordResponse> {
  return request.post(`${BASE}/${userId}/reset-password`);
}
