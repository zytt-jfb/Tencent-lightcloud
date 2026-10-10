import { Permission, Role } from '../enums';

const COMMON = [Permission.ME_READ, Permission.ME_PASSWORD_UPDATE, Permission.AUTH_LOGOUT, Permission.EXPORT_AUDIT] as const;

export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = Object.freeze({
  [Role.ROOT_ADMIN]: Object.freeze(Object.values(Permission)),
  [Role.CONTRACT_MANAGER]: Object.freeze([
    ...COMMON,
    Permission.CITIES_READ,
    Permission.CONTRACTS_READ,
    Permission.CONTRACTS_CREATE,
    Permission.CONTRACTS_UPDATE,
    Permission.CONTRACTS_SOFT_DELETE,
    Permission.CONTRACT_ALLOCATIONS_READ,
    Permission.CONTRACT_ALLOCATIONS_CREATE,
    Permission.CONTRACT_ALLOCATIONS_UPDATE,
    Permission.CONTRACT_ALLOCATIONS_DELETE,
  ]),
  [Role.SYSTEM_ADMIN]: Object.freeze([
    ...COMMON,
    Permission.CITIES_READ,
    Permission.CITIES_MANAGE,
    Permission.CONTRACTS_READ,
    Permission.CONTRACT_ALLOCATIONS_READ,
    Permission.DASHBOARD_READ,
    Permission.PROVINCE_OPERATIONS,
    Permission.PROVINCE_FACTS_READ,
    Permission.EXPORT_PROVINCE,
    Permission.OPERATION_LOGS_READ,
  ]),
  [Role.CITY_USER]: Object.freeze([
    ...COMMON,
    Permission.CITIES_READ,
    Permission.CITY_DATA_READ,
    Permission.CITY_DATA_WRITE,
    Permission.CITY_IMPORT,
    Permission.EXPORT_CITY,
  ]),
});

export function permissionsForRole(role: Role | string): readonly Permission[] {
  return ROLE_PERMISSIONS[role as Role] ?? [];
}

export function roleHasPermission(role: Role | string, permission: Permission): boolean {
  return permissionsForRole(role).includes(permission);
}
