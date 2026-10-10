import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

/**
 * E-03：Request ID 中间件（PG-R6/PG-R12）
 * - 验证/生成最大 64 字符 request ID（非法字符剔除后截断；缺失则生成 req-<uuid>）。
 * - 响应回传 X-Request-Id。
 * - requestId 挂到 req.requestId，供日志拦截器与业务（登录审计等）复用。
 */
export const MAX_REQUEST_ID_LENGTH = 64;
export const REQUEST_ID_HEADER = 'x-request-id';

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const raw = req.headers[REQUEST_ID_HEADER];
    const incoming = typeof raw === 'string' ? raw : '';
    const sanitized = incoming.replace(/[^A-Za-z0-9._-]/g, '').slice(0, MAX_REQUEST_ID_LENGTH);
    const requestId = sanitized.length > 0 ? sanitized : `req-${randomUUID().slice(0, 32)}`;
    (req as Request & { requestId?: string }).requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    next();
  }
}
