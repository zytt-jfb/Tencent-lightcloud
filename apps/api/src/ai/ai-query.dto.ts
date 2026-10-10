import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export const AI_READ_ONLY_TOOLS = ['business_summary', 'import_anomalies'] as const;
export type AiReadOnlyTool = typeof AI_READ_ONLY_TOOLS[number];

export class AiQueryDto {
  @IsIn(AI_READ_ONLY_TOOLS)
  tool!: AiReadOnlyTool;

  @IsInt()
  @Min(2000)
  @Max(2100)
  @Type(() => Number)
  year!: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  cityId?: number | null;
}
