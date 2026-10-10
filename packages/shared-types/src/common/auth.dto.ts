/**
 * Auth 相关 DTO
 * 来源：OpenAPI YAML — Auth tag + schemas
 */
import { UserBrief } from '../user/user';

/** 管理员登录请求（DEV-003：interface→class，供 ValidationPipe 运行时元数据） */
// F-01 二次纠偏：strictPropertyInitialization 下未初始化属性需 `!` 明确赋值断言（TS2564 修复）。
// 保留 class 运行时元数据（ValidationPipe 依赖），不得改回 interface，不得关闭 strictPropertyInitialization。
export class AdminLoginRequest {
  username!: string;
  password!: string;
}

/** Web 地市账号密码登录请求 */
export class CityPasswordLoginRequest {
  username!: string;
  password!: string;
}

/** 登录统一响应 */
export interface LoginResponse {
  token: string;      // JWT access_token
  user: UserBrief;    // 当前用户简版信息
}

/** 当前用户修改本人密码 */
export interface ChangeOwnPasswordRequest {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export interface ChangeOwnPasswordResponse {
  success: true;
  requiresLogin: true;
}

/** 当前用户详情响应（GET /api/me） */
export interface MeResponse {
  id: number;
  role: import('../enums').Role;
  name: string;
  cityId: number | null;
  cityName: string | null;
  status: import('../enums').UserStatus;
  mustChangePassword: boolean;
}
