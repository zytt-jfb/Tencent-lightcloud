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
  if (query.orgProvince) qb.andWhere(`${alias}.orgProvince = :orgProvince`, { orgProvince: query.orgProvince });
  if (query.orgCompany) qb.andWhere(`${alias}.orgCompany = :orgCompany`, { orgCompany: query.orgCompany });
  if (query.orgRegion) qb.andWhere(`${alias}.orgRegion = :orgRegion`, { orgRegion: query.orgRegion });
  if (query.status) qb.andWhere(`${alias}.status = :status`, { status: query.status });
  return qb;
}
export function requireText(value: unknown, label: string): string { const text = String(value ?? '').trim(); if (!text) throw new BadRequestException(`${label}不能为空`); return text; }
export function idOr404<T extends { id: string }>(item: T | null, label: string): T { if (!item) throw new NotFoundException(`${label}不存在`); return item; }
export function newId() { return randomUUID(); }
export function conflict(error: unknown): never { if ((error as { code?: string })?.code === 'ER_DUP_ENTRY' || (error as { code?: string })?.code === 'SQLITE_CONSTRAINT_UNIQUE') throw new ConflictException('业务编号已存在'); throw error; }
