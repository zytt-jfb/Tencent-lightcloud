import { Role } from '@biz-reporting/shared-types';

const CITY_ROUTE_PREFIXES = ['/city/overview', '/city/upload', '/city/data', '/city/versions', '/city/settings', '/compat/city'];
const SYSTEM_ADMIN_ROUTE_PREFIXES = [
  '/admin/dashboard', '/admin/overview', '/admin/city-compare', '/admin/city-data', '/admin/data-intake',
  '/admin/versions', '/admin/contracts', '/admin/settings', '/compat/admin',
];

export function isCityRole(role: string): boolean { return role === Role.CITY_USER; }
export function isAdminRole(role: string): boolean { return role === Role.ROOT_ADMIN || role === Role.SYSTEM_ADMIN; }
export function isRootRole(role: string): boolean { return role === Role.ROOT_ADMIN; }
export function isContractManagerRole(role: string): boolean { return role === Role.CONTRACT_MANAGER; }
export function isSupportedRole(role: string): boolean { return isAdminRole(role) || isContractManagerRole(role) || isCityRole(role); }

export function getRoleHome(role: string): string | null {
  if (isCityRole(role)) return '/city/overview';
  if (isContractManagerRole(role)) return '/admin/contracts';
  if (isAdminRole(role)) return '/admin/dashboard';
  return null;
}

function normalizeRedirect(redirect: string | null): string | null {
  if (!redirect || !redirect.startsWith('/') || redirect.startsWith('//')) return null;
  try {
    const parsed = new URL(redirect, window.location.origin);
    if (parsed.origin !== window.location.origin) return null;
    return `${parsed.pathname}${parsed.search}`;
  } catch { return null; }
}
function matches(path: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`));
}
export function canRoleAccessPath(role: string, path: string): boolean {
  if (isRootRole(role)) return matches(path, [...SYSTEM_ADMIN_ROUTE_PREFIXES, '/system/access-control']);
  if (role === Role.SYSTEM_ADMIN) return matches(path, SYSTEM_ADMIN_ROUTE_PREFIXES);
  if (isContractManagerRole(role)) return matches(path, ['/admin/contracts', '/admin/settings']);
  if (isCityRole(role)) return matches(path, CITY_ROUTE_PREFIXES);
  return false;
}
export function resolvePostLoginPath(role: string, redirect: string | null): string | null {
  const home = getRoleHome(role);
  if (!home) return null;
  const normalized = normalizeRedirect(redirect);
  return normalized && canRoleAccessPath(role, normalized) ? normalized : home;
}
