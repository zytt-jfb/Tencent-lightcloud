/**
 * Token 存取工具
 * 登录态存储到 localStorage，供 request.ts 和 AuthGuard 使用
 */

const TOKEN_KEY = 'admin_token';
const REMEMBERED_USERNAME_KEY = 'remembered_login_username';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export function isAuthenticated(): boolean {
  return !!getToken();
}

export function getRememberedUsername(): string {
  return localStorage.getItem(REMEMBERED_USERNAME_KEY) || '';
}

export function setRememberedUsername(username: string | null): void {
  const normalized = username?.trim();
  if (normalized) {
    localStorage.setItem(REMEMBERED_USERNAME_KEY, normalized);
  } else {
    localStorage.removeItem(REMEMBERED_USERNAME_KEY);
  }
}
