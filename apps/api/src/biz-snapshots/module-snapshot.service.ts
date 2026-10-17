import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { BizModuleSnapshotEntity } from './biz-module-snapshot.entity';
import { MODULE_BUILDERS, MODULE_BUILDER_MAP, type ModuleSnapshotPayload } from './module-snapshot.builders';

export type ModuleSnapshotState = 'ready' | 'stale' | 'missing' | 'failed';

export interface ModuleSnapshotStatus {
  code: string;
  label: string;
  asOf: string | null;
  builtAt: string | null;
  status: ModuleSnapshotState;
  /** 超过 TTL 即视为过期，前端据此回落实时查询 */
  stale: boolean;
  buildMs: number | null;
  rowCount: number;
  sizeBytes: number;
  error: string | null;
}

export interface ModuleSnapshotView extends ModuleSnapshotStatus {
  payload: ModuleSnapshotPayload | null;
}

/** 快照有效期：超过 24 小时标记 stale，页面应回落实时查询而不是展示旧数据 */
const SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * 通用模块快照服务。
 * - 每个模块一个 builder（见 module-snapshot.builders.ts），串行构建，单模块失败不影响其他模块
 * - payload 只存首屏数据；读取时返回 stale 标识，由调用方决定是否回落实时
 * - 与经营分析的 biz_snapshot_* 体系并行，互不依赖
 */
@Injectable()
export class ModuleSnapshotService {
  private readonly logger = new Logger(ModuleSnapshotService.name);
  /** 防重入：同一模块不允许并发构建（单实例部署足够） */
  private readonly inFlight = new Set<string>();

  constructor(
    @InjectRepository(BizModuleSnapshotEntity)
    private readonly repo: Repository<BizModuleSnapshotEntity>,
    private readonly dataSource: DataSource,
  ) {}

  /** 业务日期（Asia/Shanghai），与快照调度器口径一致 */
  static todayCst(): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }

  /** 构建单个模块；失败写 failed 记录但不抛出，避免拖垮整批 */
  async buildOne(code: string, asOf: string): Promise<ModuleSnapshotStatus> {
    const builder = MODULE_BUILDER_MAP.get(code);
    if (!builder) throw new NotFoundException(`未知模块: ${code}`);
    if (this.inFlight.has(code)) {
      return this.toStatus(code, await this.repo.findOne({ where: { moduleCode: code, asOf } }));
    }

    this.inFlight.add(code);
    const startedAt = Date.now();
    try {
      const payload = await builder.build({ dataSource: this.dataSource, asOf });
      const json = JSON.stringify(payload);
      await this.persist(code, asOf, {
        status: 'ready',
        payloadJson: json,
        rowCount: payload.list?.total ?? 0,
        sizeBytes: Buffer.byteLength(json, 'utf8'),
        buildMs: Date.now() - startedAt,
        errorMessage: null,
      });
      this.logger.log(`[ModuleSnapshot] ${code} 构建完成 ms=${Date.now() - startedAt} bytes=${Buffer.byteLength(json, 'utf8')}`);
      return this.toStatus(code, await this.repo.findOne({ where: { moduleCode: code, asOf } }));
    } catch (err) {
      const message = (err instanceof Error ? err.message : String(err)).slice(0, 2000);
      this.logger.error(`[ModuleSnapshot] ${code} 构建失败: ${message}`);
      await this.persist(code, asOf, {
        status: 'failed',
        payloadJson: '{}',
        rowCount: 0,
        sizeBytes: 0,
        buildMs: Date.now() - startedAt,
        errorMessage: message,
      });
      return this.toStatus(code, await this.repo.findOne({ where: { moduleCode: code, asOf } }));
    } finally {
      this.inFlight.delete(code);
    }
  }

  /** 串行构建全部（或指定）模块 */
  async buildAll(asOf: string, codes?: string[]): Promise<ModuleSnapshotStatus[]> {
    const targets = codes?.length ? codes : MODULE_BUILDERS.map((b) => b.code);
    const results: ModuleSnapshotStatus[] = [];
    for (const code of targets) {
      if (!MODULE_BUILDER_MAP.has(code)) continue;
      results.push(await this.buildOne(code, asOf));
    }
    return results;
  }

  /** 读取模块快照（最近一次 ready）；过期会标记 stale，但仍返回 payload 供调用方判断 */
  async get(code: string): Promise<ModuleSnapshotView> {
    if (!MODULE_BUILDER_MAP.has(code)) throw new NotFoundException(`未知模块: ${code}`);
    const row = await this.repo.findOne({
      where: { moduleCode: code, status: 'ready' },
      order: { builtAt: 'DESC' },
    });
    let payload: ModuleSnapshotPayload | null = null;
    if (row) {
      try {
        payload = JSON.parse(row.payloadJson) as ModuleSnapshotPayload;
      } catch {
        payload = null;
      }
    }
    return { ...this.toStatus(code, row), payload };
  }

  /** 全部模块状态（无记录为 missing） */
  async list(): Promise<ModuleSnapshotStatus[]> {
    const rows = await this.repo.find({ order: { builtAt: 'DESC' } });
    const latest = new Map<string, BizModuleSnapshotEntity>();
    for (const row of rows) if (!latest.has(row.moduleCode)) latest.set(row.moduleCode, row);
    return MODULE_BUILDERS.map((b) => this.toStatus(b.code, latest.get(b.code) ?? null));
  }

  private async persist(
    code: string,
    asOf: string,
    patch: Pick<BizModuleSnapshotEntity, 'status' | 'payloadJson' | 'rowCount' | 'sizeBytes' | 'buildMs' | 'errorMessage'>,
  ): Promise<void> {
    const existing = await this.repo.findOne({ where: { moduleCode: code, asOf } });
    const entity = existing ?? this.repo.create({ id: randomUUID(), moduleCode: code, asOf });
    entity.status = patch.status;
    entity.payloadJson = patch.payloadJson;
    entity.rowCount = patch.rowCount;
    entity.sizeBytes = patch.sizeBytes;
    entity.buildMs = patch.buildMs;
    entity.errorMessage = patch.errorMessage;
    entity.builtAt = new Date();
    await this.repo.save(entity);
  }

  private toStatus(code: string, row: BizModuleSnapshotEntity | null): ModuleSnapshotStatus {
    const label = MODULE_BUILDER_MAP.get(code)?.label ?? code;
    if (!row) {
      return {
        code, label, asOf: null, builtAt: null, status: 'missing',
        stale: true, buildMs: null, rowCount: 0, sizeBytes: 0, error: null,
      };
    }
    const builtAt = row.builtAt instanceof Date ? row.builtAt : new Date(row.builtAt);
    const validTime = Number.isFinite(builtAt.getTime());
    const stale = !validTime || Date.now() - builtAt.getTime() > SNAPSHOT_TTL_MS;
    let status: ModuleSnapshotState;
    if (row.status === 'failed') status = 'failed';
    else if (stale) status = 'stale';
    else status = 'ready';
    return {
      code,
      label,
      asOf: row.asOf ? String(row.asOf) : null,
      builtAt: validTime ? builtAt.toISOString() : null,
      status,
      stale,
      buildMs: row.buildMs ?? null,
      rowCount: row.rowCount ?? 0,
      sizeBytes: row.sizeBytes ?? 0,
      error: row.errorMessage ?? null,
    };
  }
}
