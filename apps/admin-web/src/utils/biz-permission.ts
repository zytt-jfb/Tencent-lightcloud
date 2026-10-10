import { useEffect, useState } from 'react';
import { bizMe } from '@/api/biz.api';
import { getBizToken } from '@/utils/biz-auth';

/** me 权限缓存（模块级；登录/刷新时刷新，前端仅控制展示与交互） */
let cachedPermissions: { isSuper: boolean; codes: Set<string>; tokenFingerprint: string } | null = null;
let cacheLoadedAt = 0;
const CACHE_TTL = 60_000;

/** 当前会话指纹：token 尾 16 位。登出/切换账号后 token 变化 → 缓存立即失效，避免跨账号污染 */
function currentFingerprint(): string {
  const token = getBizToken();
  return token ? `token:${token.slice(-16)}` : 'anonymous';
}

/** 显式清空权限缓存（登录成功/登出时调用；token 指纹机制为兜底） */
export function clearBizPermissionCache(): void {
  cachedPermissions = null;
  cacheLoadedAt = 0;
}

export async function loadBizPermissions(force = false): Promise<{ isSuper: boolean; codes: Set<string> }> {
  const fingerprint = currentFingerprint();
  if (!force && cachedPermissions && cachedPermissions.tokenFingerprint === fingerprint && Date.now() - cacheLoadedAt < CACHE_TTL) {
    return cachedPermissions;
  }
  try {
    const me = await bizMe();
    cachedPermissions = {
      isSuper: me.roleCode === 'super_admin',
      codes: new Set(me.permissions ?? []),
      tokenFingerprint: fingerprint,
    };
    cacheLoadedAt = Date.now();
  } catch {
    cachedPermissions = { isSuper: false, codes: new Set(), tokenFingerprint: fingerprint };
  }
  return cachedPermissions;
}

/** 组件内权限判断（前端展示控制；后端守卫为最终授权边界）。返回 null 表示加载中。 */
export function useBizPermission(code: string): boolean | null {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => {
    void loadBizPermissions().then((p) => setAllowed(p.isSuper || p.codes.has(code)));
  }, [code]);
  return allowed;
}
