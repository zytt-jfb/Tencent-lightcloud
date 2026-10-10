import { IsString, Length, MinLength, MaxLength } from 'class-validator';
import type {
  AdminLoginRequest as SharedAdminLoginRequest,
  CityPasswordLoginRequest as SharedCityPasswordLoginRequest,
} from '@biz-reporting/shared-types';

/**
 * 本地 class DTO：实现 shared 接口并附加 class-validator 长度校验，
 * 让全局 ValidationPipe（main.ts）恢复生效（DEV-003）。
 * - 使用 `implements`（非 extends）避免 TS2612 属性覆盖冲突；`import type` 避免 TS1362 值导入。
 * - 密码不 trim；字段长度：username 1-100、password 8-128。
 */
export class AdminLoginRequest implements SharedAdminLoginRequest {
  @IsString()
  @Length(1, 100)
  username: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;
}

export class CityPasswordLoginRequest implements SharedCityPasswordLoginRequest {
  @IsString()
  @Length(1, 100)
  username: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;
}
