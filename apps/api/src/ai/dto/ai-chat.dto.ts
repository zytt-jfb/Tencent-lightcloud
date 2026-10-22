import { Type } from 'class-transformer';
import { IsIn, IsInt, IsObject, IsOptional, IsString, Length, Max, Min } from 'class-validator';

/** 对话式提问：一句话，长度上限 500（再长就不是「查数」而是写小作文了） */
export class AiChatDto {
  @IsString()
  @Length(1, 500, { message: '问题长度需在 1~500 字之间' })
  question!: string;
}

/**
 * 指定意图生成报告（前端「功能清单」点选时用）。
 * params 只允许 intent 声明过的键，值只能是字符串/数字 ——
 * 服务端会再过滤一次，避免有人塞 `order by` 之类的字符串进来（虽然参数化本身也防注入）。
 */
export class AiReportDto {
  @IsString()
  @Length(1, 80)
  intentId!: string;

  @IsOptional()
  @IsObject()
  params?: Record<string, string | number>;
}

export class AiFeedbackDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  eventId!: number;

  @IsIn(['up', 'down'])
  feedback!: 'up' | 'down';

  @IsOptional()
  @IsString()
  @Length(0, 500)
  note?: string;
}

export class AiRecentQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
