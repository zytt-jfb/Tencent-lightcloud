import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { DataSource } from 'typeorm';
import { AuthLoginRateLimitEntity } from './auth-login-rate-limit.entity';
import { AuthSecurityEventEntity } from './auth-security-event.entity';

export type LoginRouteKey = 'admin_login' | 'city_login' | 'biz_login';
export type LoginOutcome = 'success' | 'failed' | 'blocked';

export interface LoginSecurityContext {
  ip: string;
  requestId: string;
}

export interface LoginAuditDetails {
  route: LoginRouteKey;
  subject: string;
  context: LoginSecurityContext;
  outcome: LoginOutcome;
  reasonCode: string;
  /** 旧体系为自增 number；biz 用户为 UUID string（M2 起） */
  userId?: number | string | null;
  cityId?: number | null;
}

/** 账号被限流锁定（第 5 次失败后 blocked_until 生效）。调用方映射为通用 401/429，不暴露细节。 */
export class LoginSecurityBlockedError extends Error {
  readonly reasonCode = 'ACCOUNT_RATE_BLOCKED';

  constructor() {
    super('ACCOUNT_RATE_BLOCKED');
    this.name = 'LoginSecurityBlockedError';
  }
}

const DEFAULT_WINDOW_MS = 900_000;
const DEFAULT_MAX_FAILURES = 5;
const DEFAULT_BLOCK_MS = 900_000;

/**
 * 登录安全服务：账号哈希桶 + 并发窗口 + 锁定 + 审计事件。
 *
 * 实现规则（design.md 6.3）：
 * - subject_hash = HMAC-SHA256(AUTH_SECURITY_HMAC_KEY, route + '\0' + normalizedSubject)
 * - ip_hash      = HMAC-SHA256(AUTH_SECURITY_HMAC_KEY, 'ip\0' + normalizedIp)
 * - 原始 subject/IP 只在当前请求内存中存在，不写库、不写日志。
 * - 数据库事务 + pessimistic_write 锁定哈希桶（内存账号锁禁止）。
 * - 超过窗口先清零；第 5 次失败设置 blocked_until=now+15m；成功清计数。
 * - 审计写失败 → 503 稳定错误码（失败关闭），不得静默跳过。
 */
@Injectable()
export class LoginSecurityService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  private get hmacKey(): string {
    const key = this.config.get<string>('AUTH_SECURITY_HMAC_KEY', '');
    if (!key) throw new ServiceUnavailableException('AUTH_SECURITY_HMAC_KEY_REQUIRED');
    return key;
  }

  private get windowMs(): number {
    return Number(this.config.get<string>('AUTH_ACCOUNT_WINDOW_MS', String(DEFAULT_WINDOW_MS))) || DEFAULT_WINDOW_MS;
  }

  private get maxFailures(): number {
    return Number(this.config.get<string>('AUTH_ACCOUNT_MAX_FAILURES', String(DEFAULT_MAX_FAILURES))) || DEFAULT_MAX_FAILURES;
  }

  private get blockMs(): number {
    return Number(this.config.get<string>('AUTH_ACCOUNT_BLOCK_MS', String(DEFAULT_BLOCK_MS))) || DEFAULT_BLOCK_MS;
  }

  normalizeSubject(subject: string): string {
    const normalized = typeof subject === 'string' ? subject.trim() : '';
    if (!normalized) throw new BadRequestException('INVALID_LOGIN_SUBJECT');
    return normalized;
  }

  normalizeIp(ip: string): string {
    const normalized = typeof ip === 'string' ? ip.trim() : '';
    if (!normalized) throw new BadRequestException('INVALID_LOGIN_IP');
    return normalized;
  }

  /** subject_hash = HMAC-SHA256(key, route + '\0' + normalizedSubject) */
  hashSubject(route: LoginRouteKey, subject: string): string {
    return createHmac('sha256', this.hmacKey)
      .update(`${route}\0${this.normalizeSubject(subject)}`)
      .digest('hex');
  }

  /** ip_hash = HMAC-SHA256(key, 'ip\0' + normalizedIp) */
  hashIp(ip: string): string {
    return createHmac('sha256', this.hmacKey)
      .update(`ip\0${this.normalizeIp(ip)}`)
      .digest('hex');
  }

  /** 数据库事务 + pessimistic_write 锁定哈希桶。MySQL 使用 FOR UPDATE；sqlite 单连接本身串行化写入，驱动不支持锁，跳过。 */
  private writeLock(): { mode: 'pessimistic_write' } | undefined {
    const type = this.dataSource.options.type;
    if (type === 'better-sqlite3' || type === 'sqlite') return undefined;
    return { mode: 'pessimistic_write' };
  }

  /** 检查账号是否被锁定。未锁定 resolve；已锁定抛 LoginSecurityBlockedError。 */
  async assertAllowed(route: LoginRouteKey, subject: string): Promise<void> {
    const subjectHash = this.hashSubject(route, subject);
    const lock = this.writeLock();
    await this.dataSource.transaction(async (manager) => {
      const bucket = await manager.findOne(AuthLoginRateLimitEntity, {
        where: { routeKey: route, subjectHash },
        ...(lock ? { lock } : {}),
      });
      if (bucket?.blockedUntil && bucket.blockedUntil.getTime() > Date.now()) {
        throw new LoginSecurityBlockedError();
      }
    });
  }

  /** 失败：事务内更新哈希桶 + 写审计事件。审计写失败 → 503，禁止静默成功。 */
  async recordFailure(details: LoginAuditDetails): Promise<void> {
    const subjectHash = this.hashSubject(details.route, details.subject);
    const ipHash = this.hashIp(details.context.ip);
    const windowMs = this.windowMs;
    const maxFailures = this.maxFailures;
    const blockMs = this.blockMs;
    const lock = this.writeLock();
    try {
      await this.dataSource.transaction(async (manager) => {
        const now = new Date();
        let bucket = await manager.findOne(AuthLoginRateLimitEntity, {
          where: { routeKey: details.route, subjectHash },
          ...(lock ? { lock } : {}),
        });
        if (!bucket) {
          bucket = manager.create(AuthLoginRateLimitEntity, {
            routeKey: details.route,
            subjectHash,
            windowStartedAt: now,
            attemptCount: 1,
            blockedUntil: null,
          });
        } else if (now.getTime() - bucket.windowStartedAt.getTime() >= windowMs) {
          // 窗口过期先清零，本次失败作为窗口内第一次
          bucket.windowStartedAt = now;
          bucket.attemptCount = 1;
          bucket.blockedUntil = null;
        } else {
          bucket.attemptCount += 1;
          if (bucket.attemptCount >= maxFailures) {
            bucket.blockedUntil = new Date(now.getTime() + blockMs);
          }
        }
        await manager.save(bucket);
        await manager.save(manager.create(AuthSecurityEventEntity, {
          eventType: 'login_failure',
          outcome: details.outcome,
          routeKey: details.route,
          subjectHash,
          ipHash,
          // 旧审计表 user_id 为 BIGINT（旧体系自增主键）；biz 用户 UUID string 不写入该列，
          // 审计主体已由 subjectHash（HMAC 用户名哈希）保留。
          userId: typeof details.userId === 'string' ? null : (details.userId ?? null),
          cityId: details.cityId ?? null,
          reasonCode: details.reasonCode,
          requestId: details.context.requestId,
        }));
      });
    } catch (error: unknown) {
      if (error instanceof LoginSecurityBlockedError) throw error;
      throw new ServiceUnavailableException('AUTH_AUDIT_WRITE_FAILED');
    }
  }

  /** 成功：清桶（计数归零、解除锁定）并保留审计事件。审计写失败 → 503。 */
  async recordSuccess(details: LoginAuditDetails): Promise<void> {
    const subjectHash = this.hashSubject(details.route, details.subject);
    const ipHash = this.hashIp(details.context.ip);
    const lock = this.writeLock();
    try {
      await this.dataSource.transaction(async (manager) => {
        const bucket = await manager.findOne(AuthLoginRateLimitEntity, {
          where: { routeKey: details.route, subjectHash },
          ...(lock ? { lock } : {}),
        });
        if (bucket) {
          bucket.attemptCount = 0;
          bucket.blockedUntil = null;
          await manager.save(bucket);
        }
        await manager.save(manager.create(AuthSecurityEventEntity, {
          eventType: 'login_success',
          outcome: details.outcome,
          routeKey: details.route,
          subjectHash,
          ipHash,
          userId: typeof details.userId === 'string' ? null : (details.userId ?? null),
          cityId: details.cityId ?? null,
          reasonCode: details.reasonCode,
          requestId: details.context.requestId,
        }));
      });
    } catch (error: unknown) {
      if (error instanceof LoginSecurityBlockedError) throw error;
      throw new ServiceUnavailableException('AUTH_AUDIT_WRITE_FAILED');
    }
  }

  /** 被锁请求的审计（blocked）。审计写失败 → 503。 */
  async recordBlocked(details: LoginAuditDetails): Promise<void> {
    const subjectHash = this.hashSubject(details.route, details.subject);
    const ipHash = this.hashIp(details.context.ip);
    try {
      await this.dataSource.transaction(async (manager) => {
        await manager.save(manager.create(AuthSecurityEventEntity, {
          eventType: 'login_blocked',
          outcome: details.outcome,
          routeKey: details.route,
          subjectHash,
          ipHash,
          userId: typeof details.userId === 'string' ? null : (details.userId ?? null),
          cityId: details.cityId ?? null,
          reasonCode: details.reasonCode || 'ACCOUNT_RATE_BLOCKED',
          requestId: details.context.requestId,
        }));
      });
    } catch (error: unknown) {
      if (error instanceof LoginSecurityBlockedError) throw error;
      throw new ServiceUnavailableException('AUTH_AUDIT_WRITE_FAILED');
    }
  }
}
