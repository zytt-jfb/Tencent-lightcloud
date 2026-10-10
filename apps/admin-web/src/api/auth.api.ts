/**
 * 认证 API
 * 对应后端端点：POST /api/auth/admin/login, GET /api/me
 */
import type {
  AdminLoginRequest,
  ChangeOwnPasswordRequest,
  ChangeOwnPasswordResponse,
  CityPasswordLoginRequest,
  LoginResponse,
  MeResponse,
} from '@biz-reporting/shared-types';
import axios from 'axios';
import request, { type RequestOptions } from '@/utils/request';

const quietRequest: RequestOptions = { suppressErrorToast: true };

/** 管理员登录 */
export function login(data: AdminLoginRequest): Promise<LoginResponse> {
  return request.post('/auth/admin/login', data);
}

/** 获取当前用户信息 */
export function getMe(): Promise<MeResponse> {
  return request.get('/me');
}

/** 地市用户账号密码登录 */
export function cityLogin(data: CityPasswordLoginRequest): Promise<LoginResponse> {
  return request.post('/auth/city/login', data);
}

/**
 * 统一密码登录入口。后端目前按管理员与地市账号拆分端点，前端仅在认证失败时
 * 尝试第二个端点；网络错误和服务异常不会被掩盖为密码错误。
 */
export async function loginWithPassword(data: AdminLoginRequest): Promise<LoginResponse> {
  try {
    return await request.post('/auth/admin/login', data, quietRequest);
  } catch (error) {
    if (!axios.isAxiosError(error) || ![401, 403].includes(error.response?.status ?? 0)) {
      throw error;
    }
  }

  return request.post('/auth/city/login', data, quietRequest);
}

export function changeOwnPassword(data: ChangeOwnPasswordRequest): Promise<ChangeOwnPasswordResponse> {
  return request.patch('/me/password', data);
}

export function logout(): Promise<{ success: boolean }> {
  return request.post('/auth/logout');
}
