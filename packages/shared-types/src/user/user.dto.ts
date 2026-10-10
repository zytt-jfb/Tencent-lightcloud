/**
 * 用户管理 DTO
 * 来源：OpenAPI YAML — AdminUsers tag
 */

/** 用户列表项 */
export interface UserListItem {
  id: number;
  role: import('../enums').Role;
  name: string;
  cityId: number | null;
  cityName: string | null;
  status: import('../enums').UserStatus;
  registerAt: string;       // ISO date-time
  lastLoginAt: string | null;
  mustChangePassword: boolean;
}

/** 用户列表响应 */
export interface UserListResponse {
  items: UserListItem[];
  total?: number;
  page?: number;
  pageSize?: number;
}

/** 更新用户状态请求（启用/禁用） */
export interface UpdateUserStatusRequest {
  status: import('../enums').UserStatus;
}

/** 重新绑定城市用户到其他城市 */
export interface RebindUserCityRequest {
  cityId: number;
}

export interface CreateManagedUserRequest {
  username: string;
  name: string;
  role: import('../enums').Role;
  cityId?: number | null;
}

export interface CreateManagedUserResponse {
  user: UserListItem;
  temporaryPassword: string;
}

export interface UpdateManagedUserRoleRequest {
  role: import('../enums').Role;
  cityId?: number | null;
}

export interface ResetManagedUserPasswordResponse {
  userId: number;
  temporaryPassword: string;
}

export interface ExportAuditRequest {
  pageName: string;
  scopeLabel: string;
  filters: Record<string, string | number | boolean | null | undefined>;
  rowCount: number;
  result: 'success' | 'failed';
  fileName?: string;
  errorCode?: string;
}
