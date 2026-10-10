import { ForbiddenException } from '@nestjs/common';
import { Role } from '@biz-reporting/shared-types';

export interface RequestUserScope {
  userId: number;
  role: Role | string;
  cityId: number | null;
}

export function isSystemAdmin(user: RequestUserScope): boolean {
  return user.role === Role.SYSTEM_ADMIN || user.role === Role.ROOT_ADMIN;
}

export function assertCityScope(user: RequestUserScope, resourceCityId: number | null): void {
  if (isSystemAdmin(user)) return;

  if (
    user.role !== Role.CITY_USER ||
    user.cityId === null ||
    resourceCityId === null ||
    Number(user.cityId) !== Number(resourceCityId)
  ) {
    throw new ForbiddenException('无权访问其他地市数据');
  }
}

// ============================================================
// 地市端导入作业（/api/city/import-jobs）专用权限判定。
// 纯函数：无副作用、可单测；身份链以 job 自身绑定的 city_id / operator 为准。
// 返回统一的中文业务错误文案，便于前后端一致展示与 403 断言。
// ============================================================

export const CITY_IMPORT_ACCESS_ERRORS = {
  UNSUPPORTED_JOB_TYPE: '该导入任务类型不支持地市端操作',
  NOT_CITY_USER: '仅地市用户可执行地市端导入操作',
  CITY_MISMATCH: '无权访问其他地市数据',
  OPERATOR_MISMATCH: '无权访问其他用户的导入任务',
} as const;

export interface CityImportAccessInput {
  /** 当前登录用户角色 */
  userRole: Role | string;
  /** 当前登录用户 ID */
  userId: number;
  /** 当前登录用户所属地市 ID */
  userCityId: number | null;
  /** 目标作业类型 */
  jobType: string;
  /** 目标作业绑定的地市 ID */
  jobCityId: number | null;
  /** 目标作业的创建者（operator）用户 ID */
  jobOperatorUserId: number;
  /** 允许的地市端作业类型白名单 */
  allowedJobTypes: readonly string[];
}

export type CityImportAccessResult = { ok: true } | { ok: false; reason: string };

/**
 * 判定地市用户是否有权操作某个地市端导入作业。
 * 规则（全部满足才放行）：
 *  1. 作业类型必须在地市端白名单内；
 *  2. 当前用户必须是 city_user；
 *  3. 用户地市与作业地市一致；
 *  4. 作业 operator 必须是当前用户本人。
 * 注意：地市端导入作业不对系统管理员开放（系统管理员走后台管理导入路径）。
 */
export function checkCityImportAccess(input: CityImportAccessInput): CityImportAccessResult {
  const { userRole, userId, userCityId, jobType, jobCityId, jobOperatorUserId, allowedJobTypes } = input;

  if (!allowedJobTypes.includes(jobType)) {
    return { ok: false, reason: CITY_IMPORT_ACCESS_ERRORS.UNSUPPORTED_JOB_TYPE };
  }
  if (userRole !== Role.CITY_USER) {
    return { ok: false, reason: CITY_IMPORT_ACCESS_ERRORS.NOT_CITY_USER };
  }
  if (
    userCityId === null ||
    jobCityId === null ||
    Number(userCityId) !== Number(jobCityId)
  ) {
    return { ok: false, reason: CITY_IMPORT_ACCESS_ERRORS.CITY_MISMATCH };
  }
  if (Number(jobOperatorUserId) !== Number(userId)) {
    return { ok: false, reason: CITY_IMPORT_ACCESS_ERRORS.OPERATOR_MISMATCH };
  }
  return { ok: true };
}
