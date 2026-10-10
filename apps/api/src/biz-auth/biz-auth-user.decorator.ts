import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { BizAuthContext } from '../rbac/rbac.service';

/** 从 request.bizAuth 提取当前 biz 用户上下文 */
export const BizAuthUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): BizAuthContext => {
    const request = ctx.switchToHttp().getRequest();
    return request.bizAuth as BizAuthContext;
  },
);
