import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { FactSourceFileStorageService } from './facts/fact-source-file-storage.service';

export interface LivenessResult {
  name: string;
  status: 'live';
  timestamp: string;
}

export interface ReadinessResult {
  status: 'ready';
  checks: { database: 'up'; storage: 'up' };
  timestamp: string;
}

/** E-02：readiness 依赖探针结果（稳定依赖码，不泄露连接信息） */
type DependencyState = 'up' | 'timeout' | 'dependency_error';

interface ReadinessChecks {
  database: DependencyState;
  storage: DependencyState;
}

const READINESS_CACHE_MS = 5000;
const READINESS_TIMEOUT_MS = 2000;
const READINESS_DEPS_TIMEOUT = 'READINESS_DEPS_TIMEOUT';

@Injectable()
export class AppService {
  private readinessCache: { checks: ReadinessChecks; at: number } | null = null;
  private readinessInflight: Promise<ReadinessChecks> | null = null;

  constructor(
    private readonly dataSource: DataSource,
    private readonly factSourceStorage: FactSourceFileStorageService,
  ) {}

  getLiveness(): LivenessResult {
    return {
      name: '经营单元上报系统 API',
      status: 'live',
      timestamp: new Date().toISOString(),
    };
  }

  getHealth(): LivenessResult {
    return this.getLiveness();
  }

  async getReadiness(): Promise<ReadinessResult> {
    const now = Date.now();
    // E-02：结果缓存 5 秒——并发 100 次 ready 只触发一次受控依赖检查
    if (this.readinessCache && now - this.readinessCache.at < READINESS_CACHE_MS) {
      if (this.readinessCache.checks.database !== 'up' || this.readinessCache.checks.storage !== 'up') {
        throw new ServiceUnavailableException({
          status: 'not_ready',
          checks: this.readinessCache.checks,
          timestamp: new Date().toISOString(),
        });
      }
      return {
        status: 'ready',
        checks: { database: 'up', storage: 'up' },
        timestamp: new Date().toISOString(),
      };
    }

    // E-02：in-flight 去重 + 结果缓存——并发请求共享同一次受控依赖检查
    const checks = await (this.readinessInflight ??= this.probeDependencies().finally(() => {
      this.readinessInflight = null;
    }));
    this.readinessCache = { checks, at: Date.now() };

    if (checks.database !== 'up' || checks.storage !== 'up') {
      throw new ServiceUnavailableException({
        status: 'not_ready',
        checks,
        timestamp: new Date().toISOString(),
      });
    }
    return {
      status: 'ready',
      checks: { database: 'up', storage: 'up' },
      timestamp: new Date().toISOString(),
    };
  }

  /** E-02：DB/storage 各 2 秒超时；空 catch 改稳定 dependency code；unknown type guard。 */
  private async probeDependencies(): Promise<ReadinessChecks> {
    const withTimeout = async (probe: Promise<unknown>): Promise<void> => {
      await Promise.race([
        probe,
        new Promise<never>((_resolve, reject) => {
          setTimeout(() => reject(new Error(READINESS_DEPS_TIMEOUT)), READINESS_TIMEOUT_MS);
        }),
      ]);
    };

    const toState = (error: unknown): DependencyState => {
      if (error instanceof Error && error.message === READINESS_DEPS_TIMEOUT) return 'timeout';
      return 'dependency_error';
    };

    let database: DependencyState = 'dependency_error';
    let storage: DependencyState = 'dependency_error';
    try {
      await withTimeout(this.dataSource.query('SELECT 1'));
      database = 'up';
    } catch (error: unknown) {
      database = toState(error);
    }
    try {
      await withTimeout(this.factSourceStorage.assertReadable());
      storage = 'up';
    } catch (error: unknown) {
      storage = toState(error);
    }
    return { database, storage };
  }
}



