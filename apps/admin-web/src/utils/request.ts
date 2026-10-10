/**
 * Axios 单例 - 所有 API 请求的唯一入口
 *
 * 职责：
 * 1. 自动附加 Authorization header
 * 2. 401 响应时自动跳转登录页
 * 3. 统一错误 toast 提示
 * 4. 响应数据解包（返回 res.data）
 */
import axios, { AxiosError, type AxiosRequestConfig } from 'axios';
import { message } from 'antd';
import { getToken, clearToken } from './auth';

const BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

const request = axios.create({
  baseURL: BASE_URL,
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
});

const AUTH_TOAST_KEY = 'auth-expired';
const REQUEST_ERROR_TOAST_KEY = 'request-error';
const TEMPORARY_PASSWORD_MESSAGE = '\u4e34\u65f6\u5bc6\u7801';
let authRedirectStarted = false;

export interface RequestOptions extends AxiosRequestConfig {
  suppressErrorToast?: boolean;
}

function userFacingError(messageText: string | undefined, status: number): string {
  const normalized = messageText?.trim();
  if (normalized && /[\u4e00-\u9fff]/.test(normalized) && !/[A-Za-z]/.test(normalized)) {
    return normalized;
  }
  if (status === 403) return '当前账号没有执行此操作的权限';
  if (status === 404) return '请求的内容不存在';
  return '请求失败，请稍后重试';
}

export function isAuthFailure(error: unknown): boolean {
  return axios.isAxiosError(error) && (error.response?.status === 401 || isTemporaryPasswordFailure(error));
}

export function showRequestError(error: unknown, content: string): void {
  if (isAuthFailure(error) || isLoginRoute() || authRedirectStarted) return;
  message.error({ key: REQUEST_ERROR_TOAST_KEY, content });
}

export function isTemporaryPasswordFailure(error: unknown): boolean {
  if (!axios.isAxiosError(error) || error.response?.status !== 403) return false;
  const serverMessage = error.response.data?.message;
  return typeof serverMessage === 'string' && serverMessage.includes(TEMPORARY_PASSWORD_MESSAGE);
}

export function resetAuthErrorState(): void {
  authRedirectStarted = false;
  message.destroy();
}

function isLoginRoute(): boolean {
  return window.location.hash.includes('/login');
}

function isPasswordSettingsRoute(): boolean {
  const path = window.location.hash.replace(/^#/, '').split('?')[0];
  return path === '/admin/settings' || path === '/city/settings';
}

function redirectToPasswordSettings(): void {
  if (isLoginRoute() || isPasswordSettingsRoute() || authRedirectStarted) return;
  authRedirectStarted = true;
  const currentPath = window.location.hash.replace(/^#/, '').split('?')[0];
  const target = currentPath.startsWith('/city/') ? '/city/settings' : '/admin/settings';
  window.location.hash = `${target}?required=temporary-password`;
}

// ---- 请求拦截器 ----
request.interceptors.request.use(
  (config) => {
    const token = getToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

// ---- 响应拦截器 ----
request.interceptors.response.use(
  (response) => {
    // Axios 成功响应 (2xx)，直接返回 data（业务层不再需要解包）
    return response.data;
  },
  (error: AxiosError<{ message?: string }>) => {
    const suppressErrorToast = (error.config as RequestOptions | undefined)?.suppressErrorToast;
    if (error.response) {
      const status = error.response.status;
      const serverMsg = error.response.data?.message;

      if (status === 401) {
        clearToken();
        const currentRoute = window.location.hash.replace(/^#/, '') || '/';
        const onLoginPage = isLoginRoute();
        if (!onLoginPage && !authRedirectStarted) {
          authRedirectStarted = true;
          message.destroy();
          window.location.hash = '#/login?redirect=' + encodeURIComponent(currentRoute);
          if (!suppressErrorToast) message.error({ key: AUTH_TOAST_KEY, content: '登录已过期，请重新登录' });
        }
      } else if (isTemporaryPasswordFailure(error)) {
        message.destroy();
        redirectToPasswordSettings();
      } else if (status === 409) {
        // Structured fact-version conflicts are handled by the page's reload dialog.
      } else if (!suppressErrorToast && !isLoginRoute()) {
        message.error({ key: REQUEST_ERROR_TOAST_KEY, content: userFacingError(serverMsg, status) });
      }
    } else if (!suppressErrorToast && !isLoginRoute()) {
      message.error({ key: REQUEST_ERROR_TOAST_KEY, content: '网络连接异常，请检查网络' });
    }

    return Promise.reject(error);
  },
);

/**
 * 统一的 multipart/form-data 上传封装。
 * 复用 axios 单例：自动附加 Authorization、统一 401 跳转与中文错误提示。
 * axios v1 检测到 FormData 时会自动改写 Content-Type 并补全 boundary。
 */
export function postForm<T = unknown>(url: string, formData: FormData): Promise<T> {
  return request.post(url, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
}

/**
 * 统一的二进制下载封装（走 axios 单例，携带 Authorization）。
 */
export function getBlob(url: string, params?: Record<string, unknown>): Promise<Blob> {
  return request.get(url, { params, responseType: 'blob' });
}

export default request;
