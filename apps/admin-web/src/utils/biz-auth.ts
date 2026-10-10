/** biz 会话 token 存取（独立 key，与旧体系 token 分开） */
const BIZ_TOKEN_KEY = 'biz_access_token';

export function getBizToken(): string | null {
  return localStorage.getItem(BIZ_TOKEN_KEY);
}

export function setBizToken(token: string): void {
  localStorage.setItem(BIZ_TOKEN_KEY, token);
}

export function clearBizToken(): void {
  localStorage.removeItem(BIZ_TOKEN_KEY);
}
