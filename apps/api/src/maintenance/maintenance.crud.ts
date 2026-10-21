import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Repository, SelectQueryBuilder } from 'typeorm';
import type { MaintenanceListQuery } from '@biz-reporting/shared-types';

export function pageOf(query: MaintenanceListQuery) {
  return { page: Math.max(1, Number(query.page) || 1), pageSize: Math.min(100, Math.max(1, Number(query.pageSize) || 20)) };
}
export function baseQuery<T extends object>(repo: Repository<T>, alias: string, query: MaintenanceListQuery): SelectQueryBuilder<T> {
  const qb = repo.createQueryBuilder(alias).where(`${alias}.deletedAt IS NULL`);
  if (query.keyword?.trim()) qb.andWhere(`(${alias}.name LIKE :keyword OR ${alias}.personnelCode LIKE :keyword OR ${alias}.plateNumber LIKE :keyword OR ${alias}.generatorCode LIKE :keyword OR ${alias}.account LIKE :keyword)`, { keyword: `%${query.keyword.trim()}%` });
  if (query.orgProvince) qb.andWhere(`${alias}.orgProvince LIKE :orgProvince`, { orgProvince: `%${query.orgProvince}%` });
  if (query.orgCity) qb.andWhere(`${alias}.orgCity LIKE :orgCity`, { orgCity: `%${query.orgCity}%` });
  if (query.orgCompany) qb.andWhere(`${alias}.orgCompany LIKE :orgCompany`, { orgCompany: `%${query.orgCompany}%` });
  if (query.orgRegion) qb.andWhere(`${alias}.orgRegion LIKE :orgRegion`, { orgRegion: `%${query.orgRegion}%` });
  if (query.status) qb.andWhere(`${alias}.status = :status`, { status: query.status });
  return qb;
}
export function requireText(value: unknown, label: string): string { const text = String(value ?? '').trim(); if (!text) throw new BadRequestException(`${label}不能为空`); return text; }
export function idOr404<T extends { id: string }>(item: T | null, label: string): T { if (!item) throw new NotFoundException(`${label}不存在`); return item; }
export function newId() { return randomUUID(); }
export function conflict(error: unknown): never { if ((error as { code?: string })?.code === 'ER_DUP_ENTRY' || (error as { code?: string })?.code === 'SQLITE_CONSTRAINT_UNIQUE') throw new ConflictException('业务编号已存在'); throw error; }

/**
 * 敏感字段掩码。
 * 与权限点 maintenance.sensitive.read 配套：未授权账号在列表/详情里看到的是掩码，
 * 授权账号（默认只给 admin）看明文。
 */
export const MASK = '****';

export function maskIdCard(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return text;
  if (text.length <= 8) return MASK;
  return `${text.slice(0, 4)}${MASK}${text.slice(-4)}`;
}

export function maskMobile(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return text;
  if (text.length <= 4) return MASK;
  if (text.length <= 7) return `${text.slice(0, 2)}${MASK}`;
  return `${text.slice(0, 3)}${MASK}${text.slice(-4)}`;
}

/** 前端回传的字段如果还是掩码，说明用户没权限看到明文，也不能用它覆盖库里的真值 */
export function isMaskedValue(value: unknown): boolean {
  return typeof value === 'string' && value.includes(MASK);
}
