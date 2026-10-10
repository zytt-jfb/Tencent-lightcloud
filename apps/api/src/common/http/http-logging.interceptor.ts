import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import type { Request, Response } from 'express';

/**
 * E-03：脱敏结构化 HTTP 日志拦截器（PG-R6/PG-R12）
 * - 日志字段严格限定：method、route、status、duration、requestId、userId、cityId。
 * - 禁止记录：Authorization、Cookie、body、完整 query（含 openid/name/password 等）。
 * - 异常路径同样记录（含 requestId），保证可追溯。
 */

interface LoggableRequest extends Request {
  requestId?: string;
  user?: { userId?: number; cityId?: number | null };
}

@Injectable()
export class HttpLoggingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<LoggableRequest>();
    const res = http.getResponse<Response>();
    const startedAt = Date.now();

    const requestId = req.requestId ?? 'unknown';
    const method = req.method ?? '';
    const route = (req.route && req.route.path) || `${req.baseUrl || ''}${req.path || ''}` || 'unknown';
    const userId = req.user?.userId ?? null;
    const cityId = req.user?.cityId ?? null;

    return next.handle().pipe(
      tap({
        next: () => {
          this.writeLog(requestId, method, route, res.statusCode, Date.now() - startedAt, userId, cityId);
        },
        error: (err: unknown) => {
          const status = (err && typeof err === 'object' && 'status' in err && typeof (err as { status?: unknown }).status === 'number')
            ? (err as { status: number }).status
            : 500;
          this.writeLog(requestId, method, route, status, Date.now() - startedAt, userId, cityId);
        },
      }),
    );
  }

  /** 结构化单行 JSON 日志（字段白名单，无 body/header/query）。 */
  private writeLog(
    requestId: string,
    method: string,
    route: string,
    status: number,
    durationMs: number,
    userId: number | null,
    cityId: number | null,
  ): void {
    const entry = {
      type: 'http',
      requestId,
      method,
      route,
      status,
      durationMs,
      userId,
      cityId,
      timestamp: new Date().toISOString(),
    };
    console.log(JSON.stringify(entry));
  }
}
