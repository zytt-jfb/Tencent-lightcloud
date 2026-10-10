/**
 * Mock 数据定义
 *
 * 【约束 1】所有 mock 数据严格对齐 @biz-reporting/shared-types
 * 字段名、类型、枚举值与后端 DTO 逐一对照，不自创字段。
 *
 * 涉及的共享类型（全量导入路径）：
 * - Contract           (contract/contract.ts)
 * - UserListItem        (user/user.dto.ts)
 * - UserListResponse    (user/user.dto.ts)
 * - MeResponse          (common/auth.dto.ts)
 * - LoginResponse       (common/auth.dto.ts)
 * - UserBrief           (user/user.ts)
 * - PaginatedResponse   (common/base.ts)
 * - DashboardStats      (common/dashboard.dto.ts) — 联调过渡版
 * - Role, UserStatus     (enums/index.ts)
 */
import type {
  Contract,
  UserListItem,
  UserListResponse,
  LoginResponse,
  MeResponse,
  UserBrief,
  PaginatedResponse,
  DashboardStats,
} from '@biz-reporting/shared-types';
import { Role, UserStatus } from '@biz-reporting/shared-types';

/* ============================================================
   认证 / 用户 Mock 数据
   ============================================================ */

export const mockUserBrief: UserBrief = {
  id: 1,
  role: Role.SYSTEM_ADMIN,
  name: '系统管理员',
  cityId: null,
  mustChangePassword: false,
};

export const mockMeResponse: MeResponse = {
  id: 1,
  role: Role.SYSTEM_ADMIN,
  name: '系统管理员',
  cityId: null,
  cityName: null,
  status: UserStatus.ENABLED,
  mustChangePassword: false,
};

export const mockLoginResponse: LoginResponse = {
  token: 'mock-jwt-token-admin-2026',
  user: mockUserBrief,
};
export interface MockLoginAccount {
  username: string;
  password: string;
  loginResponse: LoginResponse;
  meResponse: MeResponse;
}

export const mockLoginAccounts: Record<string, MockLoginAccount> = {
  'oa-admin': {
    username: 'oa-admin',
    password: 'oa-admin-2026',
    loginResponse: {
      token: 'mock-jwt-token-oa-admin-2026',
      user: { id: 1, role: Role.SYSTEM_ADMIN, name: '\u7cfb\u7edf\u7ba1\u7406\u5458', cityId: null, mustChangePassword: false },
    },
    meResponse: {
      id: 1,
      role: Role.SYSTEM_ADMIN,
      name: '\u7cfb\u7edf\u7ba1\u7406\u5458',
      cityId: null,
      cityName: null,
      status: UserStatus.ENABLED,
      mustChangePassword: false,
    },
  },
  'city-zibo': {
    username: 'city-zibo',
    password: 'city-zibo-2026',
    loginResponse: {
      token: 'mock-jwt-token-city-zibo-2026',
      user: { id: 2, role: Role.CITY_USER, name: '\u6dc4\u535a\u586b\u62a5\u5458', cityId: 1, mustChangePassword: false },
    },
    meResponse: {
      id: 2,
      role: Role.CITY_USER,
      name: '\u6dc4\u535a\u586b\u62a5\u5458',
      cityId: 1,
      cityName: '\u6dc4\u535a',
      status: UserStatus.ENABLED,
      mustChangePassword: false,
    },
  },
  'city-jinan': {
    username: 'city-jinan',
    password: 'city-jinan-2026',
    loginResponse: {
      token: 'mock-jwt-token-city-jinan-2026',
      user: { id: 3, role: Role.CITY_USER, name: '\u6d4e\u5357\u586b\u62a5\u5458', cityId: 2, mustChangePassword: false },
    },
    meResponse: {
      id: 3,
      role: Role.CITY_USER,
      name: '\u6d4e\u5357\u586b\u62a5\u5458',
      cityId: 2,
      cityName: '\u6d4e\u5357',
      status: UserStatus.ENABLED,
      mustChangePassword: false,
    },
  },
  'city-disabled': {
    username: 'city-disabled',
    password: 'city-disabled-2026',
    loginResponse: {
      token: 'mock-jwt-token-city-disabled-2026',
      user: { id: 4, role: Role.CITY_USER, name: '\u5fb7\u5dde\u586b\u62a5\u5458', cityId: 3, mustChangePassword: false },
    },
    meResponse: {
      id: 4,
      role: Role.CITY_USER,
      name: '\u5fb7\u5dde\u586b\u62a5\u5458',
      cityId: 3,
      cityName: '\u5fb7\u5dde',
      status: UserStatus.DISABLED,
      mustChangePassword: false,
    },
  },
};

/* ============================================================
   合同（Contract）Mock 数据
   字段对照 contract/contract.ts：
     id, contractCode, contractName, contractAmount, rate,
     accumulatedOrderAmount, accumulatedInvoiceAmount,
     signDate, expireDate, isDeleted, deletedAt,
     createdBy, updatedBy, createdAt, updatedAt
   ============================================================ */

const now = new Date().toISOString();

export const mockContracts: Contract[] = [
  {
    id: 1,
    contractCode: 'HT-2026-001',
    contractName: '淄博通信铁塔维护合同',
    contractAmount: 500000,
    rate: 0.03,
    accumulatedOrderAmount: 120000,
    accumulatedInvoiceAmount: 95000,
    signDate: new Date('2026-01-15'),
    expireDate: new Date('2027-01-14'),
    isDeleted: false,
    deletedAt: null,
    createdBy: 1,
    updatedBy: 1,
    createdAt: new Date('2026-01-10T08:00:00Z'),
    updatedAt: new Date('2026-06-01T10:30:00Z'),
  },
  {
    id: 2,
    contractCode: 'HT-2026-002',
    contractName: '菏泽城区网络覆盖合同',
    contractAmount: 380000,
    rate: 0.025,
    accumulatedOrderAmount: 95000,
    accumulatedInvoiceAmount: 72000,
    signDate: new Date('2026-02-01'),
    expireDate: new Date('2027-01-31'),
    isDeleted: false,
    deletedAt: null,
    createdBy: 1,
    updatedBy: 1,
    createdAt: new Date('2026-02-01T09:00:00Z'),
    updatedAt: new Date('2026-05-20T14:00:00Z'),
  },
  {
    id: 3,
    contractCode: 'HT-2026-003',
    contractName: '德州通信设备采购合同',
    contractAmount: 620000,
    rate: 0.04,
    accumulatedOrderAmount: 210000,
    accumulatedInvoiceAmount: 180000,
    signDate: new Date('2026-03-10'),
    expireDate: new Date('2027-03-09'),
    isDeleted: false,
    deletedAt: null,
    createdBy: 1,
    updatedBy: 1,
    createdAt: new Date('2026-03-10T10:00:00Z'),
    updatedAt: new Date('2026-06-05T08:00:00Z'),
  },
  {
    id: 4,
    contractCode: 'HT-2026-004',
    contractName: '泰安基站建设总包合同',
    contractAmount: 850000,
    rate: 0.035,
    accumulatedOrderAmount: 350000,
    accumulatedInvoiceAmount: 290000,
    signDate: new Date('2026-01-20'),
    expireDate: new Date('2027-07-19'),
    isDeleted: false,
    deletedAt: null,
    createdBy: 1,
    updatedBy: 1,
    createdAt: new Date('2026-01-20T07:30:00Z'),
    updatedAt: new Date('2026-06-08T16:00:00Z'),
  },
  {
    id: 5,
    contractCode: 'HT-2026-005',
    contractName: '临沂光缆敷设工程合同',
    contractAmount: 450000,
    rate: 0.028,
    accumulatedOrderAmount: 88000,
    accumulatedInvoiceAmount: 65000,
    signDate: new Date('2026-04-01'),
    expireDate: new Date('2028-03-31'),
    isDeleted: false,
    deletedAt: null,
    createdBy: 1,
    updatedBy: 1,
    createdAt: new Date('2026-04-01T11:00:00Z'),
    updatedAt: new Date('2026-06-10T09:00:00Z'),
  },
  {
    id: 6,
    contractCode: 'HT-2025-010',
    contractName: '青岛数据中心维护合同(已删除)',
    contractAmount: 300000,
    rate: 0.03,
    accumulatedOrderAmount: 300000,
    accumulatedInvoiceAmount: 300000,
    signDate: new Date('2025-06-01'),
    expireDate: new Date('2026-05-31'),
    isDeleted: true,
    deletedAt: new Date('2026-03-01T00:00:00Z'),
    createdBy: 1,
    updatedBy: 1,
    createdAt: new Date('2025-06-01T08:00:00Z'),
    updatedAt: new Date('2026-03-01T00:00:00Z'),
  },
  {
    id: 7,
    contractCode: 'HT-2026-006',
    contractName: '潍坊通信管道共建合同',
    contractAmount: 560000,
    rate: 0.032,
    accumulatedOrderAmount: 168000,
    accumulatedInvoiceAmount: 125000,
    signDate: new Date('2026-02-15'),
    expireDate: new Date('2027-08-14'),
    isDeleted: false,
    deletedAt: null,
    createdBy: 1,
    updatedBy: 1,
    createdAt: new Date('2026-02-15T09:30:00Z'),
    updatedAt: new Date('2026-06-03T13:00:00Z'),
  },
  {
    id: 8,
    contractCode: 'HT-2026-007',
    contractName: '烟台5G基站配套合同',
    contractAmount: 720000,
    rate: 0.038,
    accumulatedOrderAmount: 275000,
    accumulatedInvoiceAmount: 240000,
    signDate: new Date('2026-03-20'),
    expireDate: new Date('2027-09-19'),
    isDeleted: false,
    deletedAt: null,
    createdBy: 1,
    updatedBy: 1,
    createdAt: new Date('2026-03-20T08:00:00Z'),
    updatedAt: new Date('2026-06-07T11:30:00Z'),
  },
];

/* ============================================================
   用户列表（UserListItem）Mock 数据
   字段对照 user/user.dto.ts：
     id, role, name, cityId, cityName, status, registerAt, lastLoginAt
   ============================================================ */

export const mockUserList: UserListItem[] = [
  {
    id: 1, role: Role.SYSTEM_ADMIN, name: '系统管理员',
    cityId: null, cityName: null, status: UserStatus.ENABLED,
    registerAt: '2025-01-01T00:00:00Z', lastLoginAt: now, mustChangePassword: false,
  },
  {
    id: 2, role: Role.CITY_USER, name: '淄博填报员',
    cityId: 1, cityName: '淄博', status: UserStatus.ENABLED,
    registerAt: '2026-01-10T08:30:00Z', lastLoginAt: '2026-06-10T08:15:00Z', mustChangePassword: false,
  },
  {
    id: 3, role: Role.CITY_USER, name: '菏泽填报员',
    cityId: 2, cityName: '菏泽', status: UserStatus.ENABLED,
    registerAt: '2026-01-12T09:00:00Z', lastLoginAt: '2026-06-09T17:40:00Z', mustChangePassword: false,
  },
  {
    id: 4, role: Role.CITY_USER, name: '德州填报员',
    cityId: 3, cityName: '德州', status: UserStatus.ENABLED,
    registerAt: '2026-02-01T10:00:00Z', lastLoginAt: '2026-06-10T07:30:00Z', mustChangePassword: false,
  },
  {
    id: 5, role: Role.CITY_USER, name: '泰安填报员',
    cityId: 4, cityName: '泰安', status: UserStatus.DISABLED,
    registerAt: '2026-03-05T14:00:00Z', lastLoginAt: '2026-05-20T11:20:00Z', mustChangePassword: false,
  },
  {
    id: 6, role: Role.CITY_USER, name: '临沂填报员',
    cityId: 5, cityName: '临沂', status: UserStatus.ENABLED,
    registerAt: '2026-04-10T08:00:00Z', lastLoginAt: '2026-06-08T16:45:00Z', mustChangePassword: false,
  },
];

export const mockUserListResponse: UserListResponse = {
  items: mockUserList,
};

/* ============================================================
   仪表盘（DashboardStats）Mock 数据
   字段对齐 shared-types common/dashboard.dto.ts（联调过渡版）
   ============================================================ */

export const mockDashboardStats: DashboardStats = {
  cityCount: 10,
  contractCount: 7,
  completionAmount: 0,
  acceptanceAmount: 0,
  invoiceAmount: 0,
  orderAmount: 0,
  actualCost: 0,
  grossProfit: 0,
  actualNetProfit: 0,
  formulaVersion: 'facts-v1',
};

/* ============================================================
   分页工具函数
   ============================================================ */

export function buildPaginatedResponse<T>(
  items: T[],
  page: number = 1,
  pageSize: number = 20,
): PaginatedResponse<T> {
  const start = (page - 1) * pageSize;
  const paged = items.slice(start, start + pageSize);
  return {
    items: paged,
    total: items.length,
    page,
    pageSize,
  };
}
