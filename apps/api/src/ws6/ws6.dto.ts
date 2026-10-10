import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import {
  ExportMode,
  ExportScopeType,
  RecalcRetryMode,
  SnapshotRange,
} from '@biz-reporting/shared-types';

export class ConfirmImportRequestDto {
  @IsBoolean()
  confirmOverwrite!: boolean;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  cityId?: number | null;

  @IsOptional()
  @IsInt()
  @Min(2000)
  @Max(2100)
  @Type(() => Number)
  reportYear?: number | null;
}

export class CreateExportJobRequestDto {
  @IsEnum(ExportMode)
  exportMode!: ExportMode;

  @IsEnum(ExportScopeType)
  scopeType!: ExportScopeType;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  cityId?: number | null;

  @IsInt()
  @Min(2000)
  @Max(2100)
  @Type(() => Number)
  reportYear!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  @Type(() => Number)
  belongMonth?: number | null;

  @IsOptional()
  @IsEnum(SnapshotRange)
  snapshotRange?: SnapshotRange | null;
}

export class RetryRecalcTaskRequestDto {
  @IsEnum(RecalcRetryMode)
  retryMode!: RecalcRetryMode;
}

const IMPORT_JOB_TYPES = ['contract', 'city_reporting', 'city_cost'] as const;
const IMPORT_JOB_STATUSES = [
  'pending',
  'processing',
  'previewed',
  'completed',
  'failed',
  'cancelled',
] as const;

export class ImportJobListQueryDto {
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  cityId?: number;

  @IsOptional()
  @IsInt()
  @Min(2000)
  @Max(2100)
  @Type(() => Number)
  reportYear?: number;

  @IsOptional()
  @IsIn(IMPORT_JOB_TYPES)
  jobType?: string;

  @IsOptional()
  @IsIn(IMPORT_JOB_STATUSES)
  status?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  pageSize = 20;
}
