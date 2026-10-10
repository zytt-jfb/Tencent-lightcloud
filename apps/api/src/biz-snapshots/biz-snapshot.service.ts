import { randomUUID } from 'node:crypto';
import { ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { BizAuthContext } from '../rbac/rbac.service';
import { BizAggregateService } from '../biz-aggregates/biz-aggregate.service';
import { BizSnapshotRunEntity, SnapshotStatus } from './biz-snapshot-run.entity';
import { BizSnapshotRegistryEntity } from './biz-snapshot-registry.entity';
import { BizSnapshotMetricEntity } from './biz-snapshot-metric.entity';
import { BizSnapshotAlertEntity } from './biz-snapshot-alert.entity';
import { BizSnapshotContractEntity } from './biz-snapshot-contract.entity';
import { BizSnapshotOverrunEntity } from './biz-snapshot-overrun.entity';
import { BizSnapshotOverrunPeriodEntity } from './biz-snapshot-overrun-period.entity';
import { BizSnapshotContractLedgerEntity } from './biz-snapshot-contract-ledger.entity';
import { BizMonthlyAggregateEntity } from '../aggregates/biz-monthly-aggregate.entity';
import { BizContractEntity } from '../contracts/biz-contract.entity';
import { BizContractCityAllocationEntity } from '../contracts/biz-contract-city-allocation.entity';
import { CityEntity } from '../main-data/city.entity';
import { ProvinceEntity } from '../main-data/province.entity';
import { BizSystemSettingEntity } from '../aggregates/biz-system-setting.entity';
import { BizOrderRowEntity } from '../orders/biz-order-row.entity';
import { BizOfflineCompletionEntity } from '../completions/biz-offline-completion.entity';
import { BizCostEntryEntity } from '../costs/biz-cost-entry.entity';
import {
  Bucket,
  computeInventory,
  isExpiredAt,
  scopeMatch,
  zeroBucket,
} from './snapshot-calc';
import { SNAPSHOT_DDL } from './snapshot-schema';
import { computeEffectiveContractStatus } from '@biz-reporting/shared-types';

export interface DashboardQuery {
  snapshot?: 'latest';
  year?: string;
  months?: string[];
  provinceIds?: string[];
  cityIds?: string[];
}

export interface SnapshotMetadata {
  snapshotId: string | null;
  asOf: string | null;
  status: string | null;
  generatedAt: Date | string | null;
  lastSuccessfulAt: Date | string | null;
}

export interface RunStatus {
  runId: string;
  status: SnapshotStatus;
  asOf: string;
  startedAt: Date | string | null;
  finishedAt: Date | string | null;
  errorMessage: string | null;
}

/**
 * 经营分析快照 / 统一 dashboard 服务。
 *
 * 关键设计（满足数据范围与安全约束）：
 *  - buildSnapshot / requestBuild 为**全局计算**：直接查询 DB，不接收任何用户 BizAuthContext，
 *    因此绝不会把某个用户范围内的结果写成全局快照。
 *  - dashboard 读取时，依据请求用户的 auth.dataScope 过滤省/市维度；
 *    无 ready 快照时才回退实时聚合（status='live'）。
 *  - 生成期间 registry 仍指向旧 ready 快照 → 前端看到的是上一版，绝不返回 building/failed。
 *  - 状态机：building → ready（事务内原子切换 registry）/ failed（registry 不变，旧快照兜底）。
 */
@Injectable()
export class BizSnapshotService implements OnModuleInit {
  private readonly logger = new Logger(BizSnapshotService.name);

  /** 进程内并发锁：按 asOf 去重，防止多个用户点击导致并发全量重算 */
  private readonly buildLocks = new Map<string, { runId: string; promise: Promise<void> }>();

  constructor(
    @InjectRepository(BizSnapshotRunEntity)
    private readonly runRepo: Repository<BizSnapshotRunEntity>,
    @InjectRepository(BizSnapshotRegistryEntity)
    private readonly registryRepo: Repository<BizSnapshotRegistryEntity>,
    @InjectRepository(BizSnapshotMetricEntity)
    private readonly metricRepo: Repository<BizSnapshotMetricEntity>,
    @InjectRepository(BizSnapshotContractEntity)
    private readonly contractSnapRepo: Repository<BizSnapshotContractEntity>,
    @InjectRepository(BizSnapshotOverrunEntity)
    private readonly overrunRepo: Repository<BizSnapshotOverrunEntity>,
    @InjectRepository(BizSnapshotOverrunPeriodEntity)
    private readonly overrunPeriodRepo: Repository<BizSnapshotOverrunPeriodEntity>,
    @InjectRepository(BizSnapshotContractLedgerEntity)
    private readonly ledgerRepo: Repository<BizSnapshotContractLedgerEntity>,
    @InjectRepository(BizSnapshotAlertEntity)
    private readonly alertRepo: Repository<BizSnapshotAlertEntity>,
    @InjectRepository(BizMonthlyAggregateEntity)
    private readonly aggRepo: Repository<BizMonthlyAggregateEntity>,
    @InjectRepository(BizContractEntity)
    private readonly contractRepo: Repository<BizContractEntity>,
    @InjectRepository(BizContractCityAllocationEntity)
    private readonly allocRepo: Repository<BizContractCityAllocationEntity>,
    @InjectRepository(CityEntity)
    private readonly cityRepo: Repository<CityEntity>,
    @InjectRepository(ProvinceEntity)
    private readonly provinceRepo: Repository<ProvinceEntity>,
    @InjectRepository(BizSystemSettingEntity)
    private readonly settingRepo: Repository<BizSystemSettingEntity>,
    @InjectRepository(BizOrderRowEntity)
    private readonly orderRowRepo: Repository<BizOrderRowEntity>,
    @InjectRepository(BizOfflineCompletionEntity)
    private readonly offlineRepo: Repository<BizOfflineCompletionEntity>,
    @InjectRepository(BizCostEntryEntity)
    private readonly costRepo: Repository<BizCostEntryEntity>,
    private readonly dataSource: DataSource,
    private readonly agg: BizAggregateService,
  ) {}

  /** 应用启动时幂等建表（生产 synchronize=false，快照表需显式创建；失败仅记录不阻断启动） */
  async onModuleInit(): Promise<void> {
    try {
      for (const sql of SNAPSHOT_DDL) {
        await this.dataSource.query(sql);
      }
      // 既有快照表（如线上已存在的 biz_snapshot_contracts）需补列，CREATE TABLE IF NOT EXISTS 不会改结构
      await this.ensureContractCompletionColumn();
      this.logger.log('[BizSnapshot] 快照表结构已就绪（CREATE TABLE IF NOT EXISTS）');
    } catch (err) {
      this.logger.error(`[BizSnapshot] 快照表结构初始化失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** 幂等补列：biz_snapshot_contracts.completion_fen（仅新增，不删不改既有列） */
  private async ensureContractCompletionColumn(): Promise<void> {
    try {
      const rows = await this.dataSource.query(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'biz_snapshot_contracts' AND COLUMN_NAME = 'completion_fen'`,
      );
      if (!Array.isArray(rows) || rows.length === 0) {
        await this.dataSource.query(
          `ALTER TABLE biz_snapshot_contracts ADD COLUMN completion_fen BIGINT NOT NULL DEFAULT 0`,
        );
        this.logger.log('[BizSnapshot] 已为 biz_snapshot_contracts 补列 completion_fen');
      }
    } catch (err) {
      this.logger.error(`[BizSnapshot] 补列 completion_fen 失败（可忽略，下次启动重试）: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ================= 手动触发（幂等） =================

  /**
   * 请求一次快照生成（手动"更新数据"接口调用）。
   * 幂等：
   *  - 同一 asOf 已在构建中 → 直接返回已有 runId；
   *  - DB 中已存在 building 任务（定时/其他实例）→ 直接返回；
   *  - 手动请求遇到当天已完成快照时重新计算；自动任务遇到 ready 快照则跳过；
   *  - 否则创建/复用 run 并异步构建（不阻塞 HTTP 请求）。
   */
  async requestBuild(asOf: string, source: 'manual' | 'auto' = 'manual'): Promise<{ runId: string; status: SnapshotStatus }> {
    const inflight = this.buildLocks.get(asOf);
    if (inflight) return { runId: inflight.runId, status: 'building' };

    const existingBuilding = await this.runRepo.findOne({ where: { status: 'building' }, order: { startedAt: 'DESC' } });
    if (existingBuilding) return { runId: existingBuilding.id, status: 'building' };

    // as_of 唯一约束要求同一业务日复用既有记录。手动点击代表明确要求刷新，
    // 而定时任务仍对 ready 快照幂等跳过，避免每天重复全量计算。
    const previousRun = await this.runRepo.findOne({ where: { asOf } });
    if (previousRun?.status === 'ready' && source === 'auto') {
      return { runId: previousRun.id, status: 'ready' };
    }

    const run = previousRun
      ? Object.assign(previousRun, {
          status: 'building' as const,
          source,
          sourceWatermark: `${source}:${new Date().toISOString()}`,
          startedAt: new Date(),
          finishedAt: null,
          errorMessage: null,
        })
      : this.runRepo.create({
          asOf,
          status: 'building',
          source,
          sourceWatermark: `${source}:${new Date().toISOString()}`,
        });
    await this.runRepo.save(run);

    const promise = this.buildSnapshot(run.id, asOf)
      .catch(async (err) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`[snapshot] build failed run=${run.id}: ${msg}`);
        // 失败时置为 failed 并保留错误信息，但绝不改动 registry → 旧 ready 快照继续兜底。
        // 这样下一次 requestBuild 不会因残留 building 而永远无法重算。
        await this.runRepo.update(run.id, { status: 'failed', errorMessage: msg, finishedAt: new Date() });
      })
      .finally(() => {
        this.buildLocks.delete(asOf);
      });
    this.buildLocks.set(asOf, { runId: run.id, promise });

    return { runId: run.id, status: 'building' };
  }

  async getRun(runId: string): Promise<RunStatus | null> {
    const run = await this.runRepo.findOneBy({ id: runId });
    if (!run) return null;
    return {
      runId: run.id,
      status: run.status,
      asOf: run.asOf,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      errorMessage: run.errorMessage,
    };
  }

  /**
   * 顶部状态栏使用的轻量元数据：不返回任何分析数据，只返回快照状态/时间/最近一次任务。
   * - status: 'ready'（存在可用快照）| 'none'（从未生成）
   * - lastRun: 最近一次任务（含 failed/building），供前端区分"更新中/更新失败"状态
   */
  /**
   * 取"有效"注册表行：优先 ready 且指向有效快照的行。
   * 早期版本用 findOneBy({}) 取首行；若 biz_snapshot_registry 存在多行会误取非 ready 旧行，
   * 导致前端误显示"暂未生成统计数据"（尽管另一行确为 ready）。这里优先按 ready 过滤，回退任意最新行。
   */
  private async getEffectiveRegistry(): Promise<BizSnapshotRegistryEntity | null> {
    try {
      const ready = await this.registryRepo.findOne({ where: { status: 'ready' }, order: { lastSuccessfulAt: 'DESC' } });
      if (ready && ready.currentSnapshotId) return ready;
      return this.registryRepo.createQueryBuilder('registry').orderBy('registry.lastSuccessfulAt', 'DESC').limit(1).getOne();
    } catch (err) {
      // 快照表初始化失败时，读接口必须继续使用实时回退，不能把合同概览/分析页变成 500。
      // 生产 MySQL 正常建表时不会进入此分支；本地 SQLite 或发布期间短暂缺表时保持可用。
      this.logger.warn(`[BizSnapshot] 注册表不可用，使用实时回退: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  async snapshotMetadata(): Promise<{
    snapshotId: string | null;
    asOf: string | null;
    status: string;
    generatedAt: Date | string | null;
    lastSuccessfulAt: Date | string | null;
    currentAsOf: string | null;
    lastRun: { runId: string; status: SnapshotStatus; asOf: string; finishedAt: Date | string | null; errorMessage: string | null; source: string | null } | null;
  }> {
    const registry = await this.getEffectiveRegistry();
    const [lastRun, latestReadyRun] = await Promise.all([
      this.runRepo.createQueryBuilder('run').orderBy('run.startedAt', 'DESC').limit(1).getOne(),
      this.runRepo.findOne({ where: { status: 'ready' }, order: { finishedAt: 'DESC' } }),
    ]);
    // 修复/兼容历史 registry 指针丢失或多行不一致：ready run 可由原子构建事务证实，补回当前指针。
    let effectiveRegistry = registry;
    if ((!effectiveRegistry?.currentSnapshotId || effectiveRegistry.status !== 'ready') && latestReadyRun) {
      effectiveRegistry = effectiveRegistry ?? this.registryRepo.create();
      effectiveRegistry.currentSnapshotId = latestReadyRun.id;
      effectiveRegistry.currentAsOf = latestReadyRun.asOf;
      effectiveRegistry.lastSuccessfulAt = latestReadyRun.finishedAt ?? latestReadyRun.startedAt;
      effectiveRegistry.status = 'ready';
      try {
        await this.registryRepo.save(effectiveRegistry);
      } catch (err) {
        this.logger.warn(`[BizSnapshot] 恢复 ready 快照指针失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    const hasReady = !!effectiveRegistry && effectiveRegistry.status === 'ready' && !!effectiveRegistry.currentSnapshotId;
    return {
      snapshotId: hasReady ? effectiveRegistry!.currentSnapshotId! : null,
      asOf: effectiveRegistry?.currentAsOf ?? null,
      status: hasReady ? 'ready' : 'none',
      generatedAt: effectiveRegistry?.lastSuccessfulAt ?? null,
      lastSuccessfulAt: effectiveRegistry?.lastSuccessfulAt ?? null,
      currentAsOf: effectiveRegistry?.currentAsOf ?? null,
      lastRun: lastRun
        ? {
            runId: lastRun.id,
            status: lastRun.status,
            asOf: lastRun.asOf,
            finishedAt: lastRun.finishedAt,
            errorMessage: lastRun.errorMessage,
            source: lastRun.source ?? null,
          }
        : null,
    };
  }

  /** 自动更新配置（从系统设置读取；默认关闭） */
  async getAutoUpdateConfig(): Promise<{ enabled: boolean; time: string | null }> {
    const enabledSetting = await this.settingRepo.findOneBy({ settingKey: 'snapshot_auto_update_enabled' });
    const timeSetting = await this.settingRepo.findOneBy({ settingKey: 'snapshot_auto_update_time' });
    const enabled = enabledSetting ? enabledSetting.settingValue === 'true' : false;
    const time = timeSetting?.settingValue ?? null;
    return { enabled, time };
  }

  // ================= 快照生成（全局，无 auth） =================

  /** 真正执行快照预计算：全局查询 → 事务写入 metrics/contracts/alerts → 原子切换 registry */
  private async buildSnapshot(runId: string, asOf: string): Promise<void> {
    // 历史覆盖：快照覆盖订单/线下完工数据涉及的全部业务月份（而非最近 12 个月）
    const months = await this.allBusinessMonths(asOf);
    const currentYear = asOf.slice(0, 4);

    // ---- 全局参考数据（无任何用户过滤） ----
    const cities = await this.cityRepo.find();
    const provinceByCity = new Map(cities.map((c) => [c.id, c.provinceId]));
    const contracts = await this.contractRepo.find({ where: { deletedAt: IsNull() } });
    const allocs = await this.allocRepo.find({ where: { status: 'active' } });

    const contractById = new Map(contracts.map((c) => [c.id, c]));

    // ---- 经营金额（全部来自明细，覆盖全部历史业务月份；不依赖 biz_monthly_aggregate）----
    const orderAgg = await this.orderRowRepo.createQueryBuilder('o')
      .select('o.cityId', 'cityId')
      .addSelect('o.businessMonth', 'businessMonth')
      .addSelect('SUM(o.completionAmountFen)', 'orderCompletionFen')
      .addSelect('SUM(o.grossProfitFen)', 'grossProfitFen')
      .where('o.isVoid = 0').andWhere('o.isCurrent = 1')
      .andWhere('o.validationStatus = :valid', { valid: 'valid' })
      .andWhere('o.businessMonth IN (:...months)', { months })
      .groupBy('o.cityId').addGroupBy('o.businessMonth')
      .getRawMany();
    const offlineAgg = await this.offlineRepo.createQueryBuilder('f')
      .select('f.cityId', 'cityId')
      .addSelect('f.businessMonth', 'businessMonth')
      .addSelect('SUM(f.amountFen)', 'offlineCompletionFen')
      .addSelect('SUM(f.grossProfitFen)', 'grossProfitFen')
      .where('f.status = :approved', { approved: 'approved' })
      .andWhere('f.businessMonth IN (:...months)', { months })
      .groupBy('f.cityId').addGroupBy('f.businessMonth')
      .getRawMany();
    const costAgg = await this.costRepo.createQueryBuilder('c')
      .select('c.cityId', 'cityId')
      .addSelect('c.businessMonth', 'businessMonth')
      .addSelect('SUM(c.amountFen)', 'costFen')
      .where('c.status = :approved', { approved: 'approved' })
      .andWhere('c.businessMonth IN (:...months)', { months })
      .groupBy('c.cityId').addGroupBy('c.businessMonth')
      .getRawMany();

    const bucket = new Map<string, Bucket>();
    const addBucket = (cityId: string, month: string, patch: Partial<Bucket>): void => {
      const key = `${cityId}|${month}`;
      const b = bucket.get(key) ?? zeroBucket();
      b.orderCompletionFen += patch.orderCompletionFen ?? 0;
      b.offlineCompletionFen += patch.offlineCompletionFen ?? 0;
      b.grossProfitFen += patch.grossProfitFen ?? 0;
      b.costFen += patch.costFen ?? 0;
      bucket.set(key, b);
    };
    for (const r of orderAgg as Array<{ cityId: string; businessMonth: string; orderCompletionFen: string; grossProfitFen: string }>) {
      addBucket(String(r.cityId), String(r.businessMonth), { orderCompletionFen: Number(r.orderCompletionFen) || 0, grossProfitFen: Number(r.grossProfitFen) || 0 });
    }
    for (const r of offlineAgg as Array<{ cityId: string; businessMonth: string; offlineCompletionFen: string; grossProfitFen: string }>) {
      addBucket(String(r.cityId), String(r.businessMonth), { offlineCompletionFen: Number(r.offlineCompletionFen) || 0, grossProfitFen: Number(r.grossProfitFen) || 0 });
    }
    for (const r of costAgg as Array<{ cityId: string; businessMonth: string; costFen?: string; cost_fen?: string; amountFen?: string }>) {
      addBucket(String(r.cityId), String(r.businessMonth), { costFen: Number(r.costFen ?? r.cost_fen ?? r.amountFen) || 0 });
    }
    for (const b of bucket.values()) b.netProfitFen = b.grossProfitFen - b.costFen;

    // ---- 预警完工（全局汇总，不依赖用户范围） ----
    const completionByContract = await this.globalCompletionByContract();
    const warningDays = await this.getWarningDays();
    const warningEndDate = new Date(`${asOf}T00:00:00Z`);
    warningEndDate.setUTCDate(warningEndDate.getUTCDate() + warningDays);
    const warningEnd = warningEndDate.toISOString().slice(0, 10);

    // ---- 组装行 ----
    const metricRows: BizSnapshotMetricEntity[] = [];
    const contractRows: BizSnapshotContractEntity[] = [];
    const alertRows: BizSnapshotAlertEntity[] = [];

    const cityIdsWithAlloc = new Set(allocs.map((a) => a.cityId));
    for (const cityId of cityIdsWithAlloc) {
      const provinceId = provinceByCity.get(cityId) ?? null;
      for (const m of months) {
        const b = bucket.get(`${cityId}|${m}`) ?? zeroBucket();
        metricRows.push(
          this.metricRepo.create({
            snapshotId: runId,
            periodType: 'month',
            periodKey: m,
            provinceId,
            cityId,
            contractCount: 0,
            contractAmountFen: 0,
            completionFen: b.orderCompletionFen + b.offlineCompletionFen,
            orderCompletionFen: b.orderCompletionFen,
            offlineCompletionFen: b.offlineCompletionFen,
            costFen: b.costFen,
            grossProfitFen: b.grossProfitFen,
            netProfitFen: b.netProfitFen,
          }),
        );
      }
      // 'current' 行 = 本年 YTD 合计（经营金额类可累加；合同数/合同额改由 contracts 快照取）
      const ytd = zeroBucket();
      for (const m of months) {
        if (!m.startsWith(currentYear)) continue;
        const b = bucket.get(`${cityId}|${m}`);
        if (b) {
          ytd.orderCompletionFen += b.orderCompletionFen;
          ytd.offlineCompletionFen += b.offlineCompletionFen;
          ytd.grossProfitFen += b.grossProfitFen;
          ytd.costFen += b.costFen;
          ytd.netProfitFen += b.netProfitFen;
        }
      }
      metricRows.push(
        this.metricRepo.create({
          snapshotId: runId,
          periodType: 'current',
          periodKey: 'current',
          provinceId,
          cityId,
          contractCount: 0,
          contractAmountFen: 0,
          completionFen: ytd.orderCompletionFen + ytd.offlineCompletionFen,
          orderCompletionFen: ytd.orderCompletionFen,
          offlineCompletionFen: ytd.offlineCompletionFen,
          costFen: ytd.costFen,
          grossProfitFen: ytd.grossProfitFen,
          netProfitFen: ytd.netProfitFen,
        }),
      );
    }

    // 合同快照：每个（合同 × 活跃地市分配）一行
    for (const a of allocs) {
      const c = contractById.get(a.contractId);
      if (!c) continue;
      contractRows.push(
        this.contractSnapRepo.create({
          snapshotId: runId,
          contractId: a.contractId,
          provinceId: c.provinceId,
          cityId: a.cityId,
          contractAmountFen: Number(c.taxInclusiveAmountFen) || 0,
          quotaFen: Number(a.quotaFen) || 0,
          completionFen: completionByContract.get(a.contractId) ?? 0,
          isExpiredAtAsOf: isExpiredAt(c.endDate, asOf) ? 1 : 0,
        }),
      );
    }

    // 预警快照：每个（合同 × 活跃地市分配）一行；只写入真实预警，normal/none 不写入、不从接口返回
    for (const a of allocs) {
      const c = contractById.get(a.contractId);
      if (!c) continue;
      const amount = Number(c.taxInclusiveAmountFen) || 0;
      const completion = completionByContract.get(a.contractId) ?? 0;
      const progress = amount > 0 ? (completion / amount) * 100 : 0;
      const types: string[] = [];
      if (progress >= 100) types.push('overfull');
      else if (progress >= 90) types.push('nearly_full');
      if (c.endDate) {
        if (c.endDate < asOf) types.push('expired');
        else if (c.endDate <= warningEnd) types.push('expiring');
      }
      // 仅真实预警进入快照；normal/none 不落库
      for (const t of types) {
        alertRows.push(
          this.alertRepo.create({
            snapshotId: runId,
            contractId: a.contractId,
            provinceId: c.provinceId,
            cityId: a.cityId,
            contractNo: c.contractNo,
            contractName: c.contractName,
            alertType: t,
            endDate: c.endDate,
            contractAmountFen: amount,
            completionFen: completion,
            completionProgressPct: Math.round(progress * 100) / 100,
            status: c.status,
          }),
        );
      }
    }

    // ---- 超额快照：合同超额（全局累计完工 > 合同额）+ 经营单位超额（地市累计完工 > 地市总配额） ----
    const cityNameMap = new Map(cities.map((c) => [c.id, c.name]));
    const cityCompletion = new Map<string, number>();
    for (const [key, b] of bucket) {
      const cityId = key.split('|')[0];
      cityCompletion.set(cityId, (cityCompletion.get(cityId) ?? 0) + b.orderCompletionFen + b.offlineCompletionFen);
    }
    const cityQuota = new Map<string, number>();
    for (const a of allocs) cityQuota.set(a.cityId, (cityQuota.get(a.cityId) ?? 0) + (Number(a.quotaFen) || 0));

    const overrunRows: BizSnapshotOverrunEntity[] = [];
    for (const c of contracts) {
      const completion = completionByContract.get(c.id) ?? 0;
      const amount = Number(c.taxInclusiveAmountFen) || 0;
      if (amount > 0 && completion > amount) {
        overrunRows.push(
          this.overrunRepo.create({
            snapshotId: runId,
            type: 'contract',
            contractId: c.id,
            provinceId: c.provinceId,
            cityId: null,
            contractNo: c.contractNo,
            contractName: c.contractName,
            cityName: null,
            completionFen: completion,
            quotaFen: amount,
            overrunFen: completion - amount,
          }),
        );
      }
    }
    for (const [cityId, completion] of cityCompletion) {
      const quota = cityQuota.get(cityId) ?? 0;
      if (quota > 0 && completion > quota) {
        overrunRows.push(
          this.overrunRepo.create({
            snapshotId: runId,
            type: 'city',
            contractId: null,
            provinceId: provinceByCity.get(cityId) ?? null,
            cityId,
            contractNo: null,
            contractName: null,
            cityName: cityNameMap.get(cityId) ?? cityId,
            completionFen: completion,
            quotaFen: quota,
            overrunFen: completion - quota,
          }),
        );
      }
    }

    // ---- 期间超额快照：截至每个 period_key 末的累计完工 vs 额度/合同额 ----
    const compByContractMonthQ = await this.orderRowRepo.createQueryBuilder('o')
      .select('o.contractId', 'contractId')
      .addSelect('o.businessMonth', 'businessMonth')
      .addSelect('SUM(o.completionAmountFen)', 'amount')
      .where('o.isVoid = 0').andWhere('o.isCurrent = 1').andWhere('o.validationStatus = :valid', { valid: 'valid' })
      .groupBy('o.contractId').addGroupBy('o.businessMonth').getRawMany();
    const offByContractMonthQ = await this.offlineRepo.createQueryBuilder('f')
      .select('f.contractId', 'contractId')
      .addSelect('f.businessMonth', 'businessMonth')
      .addSelect('SUM(f.amountFen)', 'amount')
      .where('f.status = :approved', { approved: 'approved' })
      .groupBy('f.contractId').addGroupBy('f.businessMonth').getRawMany();
    const compByContractMonth = new Map<string, Map<string, number>>();
    const addComp = (contractId: string, month: string, amount: number): void => {
      if (!compByContractMonth.has(contractId)) compByContractMonth.set(contractId, new Map());
      const m = compByContractMonth.get(contractId)!;
      m.set(month, (m.get(month) ?? 0) + amount);
    };
    for (const r of compByContractMonthQ as Array<{ contractId: string; businessMonth: string; amount: string }>) addComp(String(r.contractId), String(r.businessMonth), Number(r.amount) || 0);
    for (const r of offByContractMonthQ as Array<{ contractId: string; businessMonth: string; amount: string }>) addComp(String(r.contractId), String(r.businessMonth), Number(r.amount) || 0);

    const overrunPeriodRows: BizSnapshotOverrunPeriodEntity[] = [];
    const pushOverrunPeriod = (row: Partial<BizSnapshotOverrunPeriodEntity> & { snapshotId: string }): void => {
      overrunPeriodRows.push(this.overrunPeriodRepo.create({ id: randomUUID(), ...row } as BizSnapshotOverrunPeriodEntity));
    };
    for (const c of contracts) {
      const amount = Number(c.taxInclusiveAmountFen) || 0;
      if (amount <= 0) continue;
      const byMonth = compByContractMonth.get(c.id);
      if (!byMonth) continue;
      const sortedMonths = [...byMonth.keys()].sort();
      let cumulative = 0;
      for (const m of sortedMonths) {
        cumulative += byMonth.get(m) ?? 0;
        if (cumulative > amount) {
          pushOverrunPeriod({ snapshotId: runId, periodType: 'month', periodKey: m, type: 'contract', contractId: c.id, provinceId: c.provinceId, cityId: null, contractNo: c.contractNo, contractName: c.contractName, cityName: null, completionFen: cumulative, quotaFen: amount, overrunFen: cumulative - amount });
        }
      }
      if (cumulative > amount) {
        pushOverrunPeriod({ snapshotId: runId, periodType: 'current', periodKey: 'current', type: 'contract', contractId: c.id, provinceId: c.provinceId, cityId: null, contractNo: c.contractNo, contractName: c.contractName, cityName: null, completionFen: cumulative, quotaFen: amount, overrunFen: cumulative - amount });
      }
    }
    const cityCompMonth = new Map<string, Map<string, number>>();
    for (const [key, b] of bucket) {
      const cityId = key.split('|')[0];
      const month = key.split('|')[1];
      if (!cityCompMonth.has(cityId)) cityCompMonth.set(cityId, new Map());
      const m = cityCompMonth.get(cityId)!;
      m.set(month, (m.get(month) ?? 0) + b.orderCompletionFen + b.offlineCompletionFen);
    }
    for (const [cityId, byMonth] of cityCompMonth) {
      const quota = cityQuota.get(cityId) ?? 0;
      if (quota <= 0) continue;
      const sortedMonths = [...byMonth.keys()].sort();
      let cumulative = 0;
      for (const m of sortedMonths) {
        cumulative += byMonth.get(m) ?? 0;
        if (cumulative > quota) {
          pushOverrunPeriod({ snapshotId: runId, periodType: 'month', periodKey: m, type: 'city', contractId: null, provinceId: provinceByCity.get(cityId) ?? null, cityId, contractNo: null, contractName: null, cityName: cityNameMap.get(cityId) ?? cityId, completionFen: cumulative, quotaFen: quota, overrunFen: cumulative - quota });
        }
      }
      if (cumulative > quota) {
        pushOverrunPeriod({ snapshotId: runId, periodType: 'current', periodKey: 'current', type: 'city', contractId: null, provinceId: provinceByCity.get(cityId) ?? null, cityId, contractNo: null, contractName: null, cityName: cityNameMap.get(cityId) ?? cityId, completionFen: cumulative, quotaFen: quota, overrunFen: cumulative - quota });
      }
    }

    // ---- 合同台账快照（一合同一行）----
    const ledgerCompletion = await this.globalCompletionByContract();
    const ledgerRows: BizSnapshotContractLedgerEntity[] = [];
    for (const c of contracts) {
      const completion = ledgerCompletion.get(c.id) ?? 0;
      const amount = Number(c.taxInclusiveAmountFen) || 0;
      const progress = amount > 0 ? Math.round((completion / amount) * 10000) / 100 : null;
      ledgerRows.push(
        this.ledgerRepo.create({
          id: randomUUID(),
          snapshotId: runId,
          contractId: c.id,
          contractNo: c.contractNo,
          contractName: c.contractName,
          taxInclusiveAmountFen: amount,
          provinceId: c.provinceId,
          status: c.status,
          signedDate: c.signedDate ?? null,
          startDate: c.startDate ?? null,
          endDate: c.endDate ?? null,
          sourceUploadRecordId: c.sourceImportRecordId ?? null,
          cumulativeCompletionFen: completion,
          completionProgressPct: progress,
        }),
      );
    }

    // ---- 事务写入 + 原子切换 registry ----
    await this.dataSource.transaction(async (mgr) => {
      const mMetric = mgr.getRepository(BizSnapshotMetricEntity);
      const mContract = mgr.getRepository(BizSnapshotContractEntity);
      const mAlert = mgr.getRepository(BizSnapshotAlertEntity);
      const mOverrun = mgr.getRepository(BizSnapshotOverrunEntity);
      const mOverrunPeriod = mgr.getRepository(BizSnapshotOverrunPeriodEntity);
      const mLedger = mgr.getRepository(BizSnapshotContractLedgerEntity);
      const mRun = mgr.getRepository(BizSnapshotRunEntity);
      const mReg = mgr.getRepository(BizSnapshotRegistryEntity);

      await mMetric.delete({ snapshotId: runId });
      await mContract.delete({ snapshotId: runId });
      await mAlert.delete({ snapshotId: runId });
      await mOverrun.delete({ snapshotId: runId });
      await mOverrunPeriod.delete({ snapshotId: runId });
      await mLedger.delete({ snapshotId: runId });
      if (metricRows.length) await mMetric.save(metricRows);
      if (contractRows.length) await mContract.save(contractRows);
      if (alertRows.length) await mAlert.save(alertRows);
      if (overrunRows.length) await mOverrun.save(overrunRows);
      if (overrunPeriodRows.length) await mOverrunPeriod.save(overrunPeriodRows);
      if (ledgerRows.length) await mLedger.save(ledgerRows);

      await mRun.update(runId, { status: 'ready', finishedAt: new Date() });

      let reg = await mReg.createQueryBuilder('registry').limit(1).getOne();
      if (!reg) reg = mReg.create();
      reg.currentSnapshotId = runId;
      reg.currentAsOf = asOf;
      reg.lastSuccessfulAt = new Date();
      reg.status = 'ready';
      await mReg.save(reg);
    });
  }

  private async globalCompletionByContract(): Promise<Map<string, number>> {
    const orderRows = await this.orderRowRepo.createQueryBuilder('o')
      .select('o.contractId', 'contractId')
      .addSelect('SUM(o.completionAmountFen)', 'amount')
      .where('o.isVoid = 0').andWhere('o.isCurrent = 1')
      .andWhere('o.validationStatus = :v', { v: 'valid' })
      .groupBy('o.contractId')
      .getRawMany();
    const offlineRows = await this.offlineRepo.createQueryBuilder('f')
      .select('f.contractId', 'contractId')
      .addSelect('SUM(f.amountFen)', 'amount')
      .where('f.status = :s', { s: 'approved' })
      .groupBy('f.contractId')
      .getRawMany();
    const map = new Map<string, number>();
    for (const r of orderRows as Array<{ contractId: string; amount: string }>) {
      map.set(String(r.contractId), (map.get(String(r.contractId)) ?? 0) + (Number(r.amount) || 0));
    }
    for (const r of offlineRows as Array<{ contractId: string; amount: string }>) {
      map.set(String(r.contractId), (map.get(String(r.contractId)) ?? 0) + (Number(r.amount) || 0));
    }
    return map;
  }

  private async getWarningDays(): Promise<number> {
    const setting = await this.settingRepo.findOneBy({ settingKey: 'contract_expiry_warning_days' });
    const value = setting ? Number(setting.settingValue) : NaN;
    return Number.isFinite(value) ? value : 90;
  }

  /** 全部业务月份（升序）：订单(business_month, valid 且非作废) ∪ 线下完工(business_month, approved) 的去重并集；无数据时回退 [asOf 当月] */
  private async allBusinessMonths(asOf: string): Promise<string[]> {
    const orderMonths = await this.orderRowRepo.createQueryBuilder('o')
      .select('DISTINCT o.businessMonth', 'm')
      .where('o.isVoid = 0').andWhere('o.isCurrent = 1').andWhere('o.validationStatus = :valid', { valid: 'valid' })
      .getRawMany<{ m: string }>();
    const offlineMonths = await this.offlineRepo.createQueryBuilder('f')
      .select('DISTINCT f.businessMonth', 'm')
      .where('f.status = :approved', { approved: 'approved' })
      .getRawMany<{ m: string }>();
    const set = new Set<string>();
    for (const r of orderMonths) if (r.m) set.add(String(r.m));
    for (const r of offlineMonths) if (r.m) set.add(String(r.m));
    const list = [...set].filter((m) => /^\d{4}-\d{2}$/.test(m)).sort();
    return list.length ? list : [asOf.slice(0, 7)];
  }

  // ================= dashboard 读取（按用户范围过滤） =================

  async dashboard(auth: BizAuthContext, q: DashboardQuery): Promise<{
    overview: unknown;
    trend: { items: unknown[] };
    byCity: { items: unknown[] };
    contractAlerts: { items: unknown[] };
    overruns: { items: unknown[] };
    snapshotMetadata: SnapshotMetadata;
  }> {
    const scope = auth.dataScope;
    if (scope.scopeType === 'contract') {
      throw new ForbiddenException('当前账号无经营分析数据范围');
    }

    const registry = await this.getEffectiveRegistry();
    const hasReady = !!registry && registry.status === 'ready' && !!registry.currentSnapshotId;

    if (!hasReady) {
      // 无 ready 快照 → 实时回退（status='live'）；building/failed 绝不返回
      return this.liveFallback(auth, q);
    }

    const snapId = registry!.currentSnapshotId!;
    const [metrics, allContractSnaps, alerts, periodOverruns] = await Promise.all([
      this.metricRepo.findBy({ snapshotId: snapId }),
      this.contractSnapRepo.findBy({ snapshotId: snapId }),
      this.alertRepo.findBy({ snapshotId: snapId }),
      this.overrunPeriodRepo.find({ where: { snapshotId: snapId } }),
    ]);

    // 省份/地市组合筛选（在 auth.dataScope 之上进一步取交集）
    const provinceFilter = q.provinceIds && q.provinceIds.length ? new Set(q.provinceIds) : null;
    const cityFilter = q.cityIds && q.cityIds.length ? new Set(q.cityIds) : null;
    const metricVisible = (provinceId: string | null, cityId: string | null): boolean =>
      (!provinceFilter || (provinceId != null && provinceFilter.has(provinceId))) &&
      (!cityFilter || (cityId != null && cityFilter.has(cityId)));

    const scopedMetrics = metrics.filter((m) => scopeMatch(scope, m.provinceId, m.cityId) && metricVisible(m.provinceId, m.cityId));
    const scopedContractSnaps = allContractSnaps.filter((c) => scopeMatch(scope, c.provinceId, c.cityId) && metricVisible(c.provinceId, c.cityId));
    const contractScopeByContract = new Map(allContractSnaps.map((c) => [c.contractId, c]));

    const cities = await this.cityRepo.find();
    const provinces = await this.provinceRepo.find();
    const cityName = new Map(cities.map((c) => [c.id, c.name]));
    const cityProvince = new Map(cities.map((c) => [c.id, c.provinceId]));
    const cityUnitType = new Map(cities.map((c) => [c.id, c.unitType]));
    const provinceName = new Map(provinces.map((p) => [p.id, p.name]));

    const scopedAlerts = alerts.filter((a) => {
      // #2 防御：快照中可能残留历史 none/normal 行，绝不向预警接口返回
      if (a.alertType === 'none' || a.alertType === 'normal') return false;
      const cc = contractScopeByContract.get(a.contractId);
      return cc ? scopeMatch(scope, cc.provinceId, cc.cityId) : false;
    });
    // 期间超额：按 year/month 过滤；scope + 省份/地市组合筛选取交集
    const scopedOverruns = periodOverruns.filter((o) => {
      let periodOk = false;
      if (q.months && q.months.length) periodOk = o.periodType === 'month' && q.months.includes(o.periodKey);
      else if (q.year) periodOk = o.periodType === 'month' && o.periodKey.startsWith(q.year);
      else periodOk = o.periodType === 'current';
      if (!periodOk) return false;
      const visible = o.type === 'city'
        ? scopeMatch(scope, o.provinceId, o.cityId)
        : (() => { const cc = contractScopeByContract.get(o.contractId!); return cc ? scopeMatch(scope, cc.provinceId, cc.cityId) : false; })();
      if (!visible) return false;
      if (provinceFilter && !(o.provinceId != null && provinceFilter.has(o.provinceId))) return false;
      if (cityFilter) {
        const cid = o.type === 'city' ? o.cityId : (o.contractId ? contractScopeByContract.get(o.contractId)?.cityId ?? null : null);
        if (!(cid != null && cityFilter.has(cid))) return false;
      }
      return true;
    });

    const selected = selectMetrics(scopedMetrics, q);
    const overview = buildOverview(selected, scopedContractSnaps, allContractSnaps);
    const trend = buildTrend(scopedMetrics, q);
    const byCity = buildByCity(scopedMetrics, scopedContractSnaps, allContractSnaps, q, cityName, cityProvince, cityUnitType, provinceName);

    return {
      overview,
      trend: { items: trend },
      byCity: { items: byCity },
      contractAlerts: {
        items: scopedAlerts.map((a) => {
          const asOf = registry!.currentAsOf;
          return {
            contractId: a.contractId,
            contractNo: a.contractNo,
            contractName: a.contractName,
            alertType: a.alertType,
            endDate: a.endDate,
            status: a.status,
            // 有效展示状态：以快照 asOf 为判断基准日，主状态字段不改写
            effectiveStatus: computeEffectiveContractStatus(a.status, a.endDate, asOf),
            statusAsOf: asOf,
            contractAmountFen: a.contractAmountFen,
            completionFen: a.completionFen,
            completionProgressPct: a.completionProgressPct,
            provinceId: a.provinceId,
            cityId: a.cityId,
          };
        }),
      },
      overruns: {
        items: scopedOverruns.map((o) => ({
          type: o.type,
          contractId: o.contractId,
          cityId: o.cityId,
          contractNo: o.contractNo,
          contractName: o.contractName,
          cityName: o.cityName,
          completionFen: o.completionFen,
          quotaFen: o.quotaFen,
          overrunFen: o.overrunFen,
          provinceId: o.provinceId,
        })),
      },
      snapshotMetadata: {
        snapshotId: snapId,
        asOf: registry!.currentAsOf,
        status: 'ready',
        generatedAt: registry!.lastSuccessfulAt,
        lastSuccessfulAt: registry!.lastSuccessfulAt,
      },
    };
  }

  /** 无 ready 快照时的实时回退：多线程筛选（多月 / 多省 / 多地市）也必须做交集过滤。
   *  原实现只在"恰好选中 1 个"时传参，多选会被整体忽略，导致筛选看似无效。 */
  private async liveFallback(auth: BizAuthContext, q: DashboardQuery) {
    const year = q.year;
    const month = q.months && q.months.length === 1 ? q.months[0] : undefined;
    const months = q.months && q.months.length ? q.months : undefined;
    const provinceId = q.provinceIds && q.provinceIds.length === 1 ? q.provinceIds[0] : undefined;
    const provinceIds = q.provinceIds && q.provinceIds.length ? q.provinceIds : undefined;
    const cityId = q.cityIds && q.cityIds.length === 1 ? q.cityIds[0] : undefined;
    const cityIds = q.cityIds && q.cityIds.length ? q.cityIds : undefined;
    const [overview, trend, byCity, contractAlerts, overruns] = await Promise.all([
      this.agg.overview(auth, year, month, cityId, provinceId, cityIds, provinceIds, months),
      this.agg.trend(auth, 12, cityId, year, provinceId, cityIds, provinceIds, months),
      this.agg.byCity(auth, year, month, provinceId, cityIds, provinceIds, months),
      this.agg.analysisAlerts(auth, cityId, provinceId),
      this.agg.overrunList(auth, year, month, cityId, provinceId),
    ]);
    const visibleTrend = q.months?.length ? trend.filter((row) => q.months!.includes(String(row.month))) : trend;
    return {
      overview,
      trend: { items: visibleTrend },
      byCity: { items: byCity },
      contractAlerts: { items: contractAlerts },
      overruns: { items: overruns },
      snapshotMetadata: {
        snapshotId: null,
        asOf: null,
        status: 'live',
        generatedAt: null,
        lastSuccessfulAt: null,
      },
    };
  }

  // ================= 经营单位详情（快照口径，与概览/单位对比同一 ready 快照） =================

  /** 经营单位详情聚合：返回与经营分析概览/单位对比同一 ready 快照下的城市聚合（合同数/合同额/完工/成本/毛利/净利 + 合同明细及累计完工 + 超额汇总）。原始明细（订单/线下/成本）仍由实时接口提供。 */
  async snapshotCityDetail(
    auth: BizAuthContext,
    cityId: string,
    _opts: { year?: string; months?: string[]; categoryCodes?: string[] } = {},
  ): Promise<{
    snapshotId: string | null;
    asOf: string | null;
    status: string;
    city: { id: string; name: string; provinceId: string | null; provinceName: string; unitType: string };
    summary: {
      contractCount: number;
      contractAmountFen: number;
      orderCompletionFen: number;
      offlineCompletionFen: number;
      costFen: number;
      grossProfitFen: number;
      netProfitFen: number;
    } | null;
    contracts: Array<Record<string, unknown>>;
    overruns: Array<Record<string, unknown>>;
  }> {
    const scope = auth.dataScope;
    if (scope.scopeType === 'contract') throw new ForbiddenException('当前账号无经营分析数据范围');
    const city = await this.cityRepo.findOneBy({ id: cityId });
    if (!city) throw new NotFoundException('经营单位不存在');
    if (!scopeMatch(scope, city.provinceId, city.id)) throw new ForbiddenException('当前账号无权查看该经营单位数据');

    const registry = await this.getEffectiveRegistry();
    const hasReady = !!registry && registry.status === 'ready' && !!registry.currentSnapshotId;
    const provinceNameOf = async (pid: string | null) => (pid ? ((await this.provinceRepo.findOneBy({ id: pid }))?.name ?? '-') : '-');
    const baseCity = { id: city.id, name: city.name, provinceId: city.provinceId, provinceName: await provinceNameOf(city.provinceId), unitType: city.unitType ?? 'city' };

    if (!hasReady) {
      return { snapshotId: null, asOf: null, status: 'none', city: baseCity, summary: null, contracts: [], overruns: [] };
    }

    const snapId = registry.currentSnapshotId!;
    const [metrics, contractSnaps, cityOverrun, contracts] = await Promise.all([
      this.metricRepo.find({ where: { snapshotId: snapId, cityId, periodType: 'current' } }),
      this.contractSnapRepo.find({ where: { snapshotId: snapId, cityId } }),
      this.overrunRepo.findOne({ where: { snapshotId: snapId, type: 'city', cityId } }),
      this.contractRepo.find({ where: { deletedAt: IsNull() } }),
    ]);
    const contractById = new Map(contracts.map((c) => [c.id, c]));
    const provinceNames = new Map((await this.provinceRepo.find({ select: { id: true, name: true } })).map((p) => [String(p.id), String(p.name)]));

    const fin = zeroBucket();
    for (const m of metrics) {
      const completion = metricCompletion(m);
      fin.orderCompletionFen += completion.order;
      fin.offlineCompletionFen += completion.offline;
      fin.costFen += fenValue(m.costFen);
      fin.grossProfitFen += fenValue(m.grossProfitFen);
      fin.netProfitFen += fenValue(m.netProfitFen);
    }

    let contractCount = 0;
    let contractAmountFen = 0;
    const contractOut: Array<Record<string, unknown>> = [];
    const snapAsOf = registry.currentAsOf; // 快照判断基准日：快照页一律用快照 asOf，不用客户端当日
    for (const s of contractSnaps) {
      const c = contractById.get(s.contractId);
      if (!c) continue;
      contractCount += 1;
      contractAmountFen += Number(s.contractAmountFen) || 0;
      const cumulative = Number(s.completionFen) || 0;
      const quota = Number(s.quotaFen) || 0;
      const remaining = quota - cumulative;
      contractOut.push({
        id: c.id,
        contractNo: c.contractNo,
        contractName: c.contractName,
        provinceId: c.provinceId,
        provinceName: provinceNames.get(c.provinceId) ?? '-',
        cityName: city.name,
        unitType: city.unitType ?? 'city',
        taxInclusiveAmountFen: Number(c.taxInclusiveAmountFen) || 0,
        status: c.status,
        // 有效展示状态：以快照 asOf 判断到期（status 主状态字段不改写）
        effectiveStatus: computeEffectiveContractStatus(c.status, c.endDate, snapAsOf),
        statusAsOf: snapAsOf,
        signedDate: c.signedDate ?? null,
        endDate: c.endDate ?? null,
        quotaFen: quota,
        cumulativeCompletionFen: Math.round(cumulative),
        remainingFen: Math.round(remaining),
        overrunStatus: remaining < 0 ? 'overrun' : 'ok',
      });
    }

    const summary = {
      contractCount,
      contractAmountFen,
      orderCompletionFen: fin.orderCompletionFen,
      offlineCompletionFen: fin.offlineCompletionFen,
      costFen: fin.costFen,
      grossProfitFen: fin.grossProfitFen,
      netProfitFen: fin.netProfitFen,
    };

    const overruns = cityOverrun
      ? [
          {
            type: cityOverrun.type,
            contractId: cityOverrun.contractId,
            cityId: cityOverrun.cityId,
            contractNo: cityOverrun.contractNo,
            contractName: cityOverrun.contractName,
            cityName: cityOverrun.cityName,
            completionFen: cityOverrun.completionFen,
            quotaFen: cityOverrun.quotaFen,
            overrunFen: cityOverrun.overrunFen,
          },
        ]
      : [];

    return {
      snapshotId: snapId,
      asOf: registry.currentAsOf,
      status: 'ready',
      city: baseCity,
      summary,
      contracts: contractOut,
      overruns,
    };
  }

  /** 合同预警（真实预警，不含 normal/none）：供经营单位详情/合同详情 Drawer 展示 */
  async contractAlerts(contractId: string): Promise<{ items: Array<Record<string, unknown>> }> {
    const registry = await this.getEffectiveRegistry();
    const hasReady = !!registry && registry.status === 'ready' && !!registry.currentSnapshotId;
    if (!hasReady) return { items: [] };
    const rows = await this.alertRepo.find({ where: { snapshotId: registry.currentSnapshotId!, contractId } });
    const asOf = registry.currentAsOf;
    // #3 防御：快照中可能残留历史 none/normal 行，绝不向预警接口返回（与 dashboard 保持一致）
    return {
      items: rows
        .filter((a) => a.alertType !== 'none' && a.alertType !== 'normal')
        .map((a) => ({
          alertType: a.alertType,
          endDate: a.endDate,
          contractAmountFen: a.contractAmountFen,
          completionFen: a.completionFen,
          completionProgressPct: a.completionProgressPct,
          status: a.status,
          // 有效展示状态：以快照 asOf 判断到期
          effectiveStatus: computeEffectiveContractStatus(a.status, a.endDate, asOf),
          statusAsOf: asOf,
        })),
    };
  }

  /**
   * 合同概览（快照口径，"一合同一行"）：服务端分页 + 关键词/省份/地市/状态/日期筛选。
   * 与经营分析快照同一 ready 快照（built 与切换在同一事务）；无 ready 快照时实时回退 status='live'，不出现空白页。
   *
   * 范围过滤：
   *  - 合同范围（合同管理员）：可查看全部合同台账，不开放经营分析指标
   *  - 省范围：直接按 ledger.provinceId IN (...)
   *  - 市范围（含筛选参数 cityId）：经 biz_contract_city_allocations 反查 contractId 后 IN 过滤
   *    （合同台账仅存 provinceId，不存 cityId，故必须反查）
   *  - 所有范围过滤均在 auth.dataScope 之上取交集，绝不信任请求参数
   */
  async contractsLedger(
    auth: BizAuthContext,
    params: {
      page?: number;
      pageSize?: number;
      keyword?: string;
      provinceId?: string;
      cityId?: string;
      status?: string;
      startDate?: string;
      endDate?: string;
    },
  ): Promise<{
    items: Array<Record<string, unknown>>;
    total: number;
    page: number;
    pageSize: number;
    snapshotMetadata: SnapshotMetadata;
  }> {
    const scope = auth.dataScope;

    const registry = await this.getEffectiveRegistry();
    const hasReady = !!registry && registry.status === 'ready' && !!registry.currentSnapshotId;

    const page = Math.max(1, Math.floor(Number(params.page) || 1));
    const pageSize = Math.min(200, Math.max(1, Math.floor(Number(params.pageSize) || 20)));

    if (!hasReady) {
      return this.contractsLedgerLive(auth, params, page, pageSize);
    }

    const snapId = registry!.currentSnapshotId!;
    const qb = this.ledgerRepo.createQueryBuilder('l');
    qb.andWhere('l.snapshotId = :snap', { snap: snapId });

    if (scope.scopeType === 'province' && scope.provinceIds.length > 0) {
      qb.andWhere('l.provinceId IN (:...pids)', { pids: scope.provinceIds });
    }
    const cityAllowed = await this.cityScopeContractIds(scope, params.cityId);
    if (cityAllowed !== null) {
      if (cityAllowed.size === 0) {
        return { items: [], total: 0, page, pageSize, snapshotMetadata: this.readyMeta(snapId, registry!) };
      }
      qb.andWhere('l.contractId IN (:...ids)', { ids: [...cityAllowed] });
    }

    if (params.keyword) {
      qb.andWhere('(l.contractNo LIKE :kw OR l.contractName LIKE :kw)', { kw: `%${params.keyword}%` });
    }
    if (params.provinceId) {
      qb.andWhere('l.provinceId = :pid', { pid: params.provinceId });
    }
    if (params.status) {
      // 状态筛选采用"有效展示状态"口径：active=执行中(未到期)、expired=已到期(active且已过期)、
      // completed/voided/draft 等按主状态直筛。不改写数据库 status，靠 end_date 与快照 asOf 推导。
      const st = (params.status || '').trim().toLowerCase();
      const asOf = registry!.currentAsOf;
      this.applyEffectiveStatusFilter(qb, 'l', st, asOf);
    }
    if (params.startDate) {
      qb.andWhere('(l.signedDate >= :sd OR l.startDate >= :sd OR l.endDate >= :sd)', { sd: params.startDate });
    }
    if (params.endDate) {
      qb.andWhere('(l.signedDate <= :ed OR l.startDate <= :ed OR l.endDate <= :ed)', { ed: params.endDate });
    }

    const [rows, total] = await qb
      .orderBy('l.contractNo', 'ASC')
      .addOrderBy('l.contractId', 'ASC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();
    const provinceNames = await this.provinceNameMap();

    const items = rows.map((r) => {
      const asOf = registry!.currentAsOf; // 快照台账：一律以快照 asOf 判断到期
      return {
        id: r.id,
        contractId: r.contractId,
        contractNo: r.contractNo,
        contractName: r.contractName,
        taxInclusiveAmountFen: r.taxInclusiveAmountFen,
        provinceId: r.provinceId,
        provinceName: r.provinceId ? (provinceNames.get(r.provinceId) ?? null) : null,
        status: r.status,
        effectiveStatus: computeEffectiveContractStatus(r.status, r.endDate, asOf),
        statusAsOf: asOf,
        signedDate: r.signedDate,
        startDate: r.startDate,
        endDate: r.endDate,
        sourceUploadRecordId: r.sourceUploadRecordId,
        cumulativeCompletionFen: r.cumulativeCompletionFen,
        completionProgressPct: r.completionProgressPct,
      };
    });

    return {
      items,
      total,
      page,
      pageSize,
      snapshotMetadata: this.readyMeta(snapId, registry!),
    };
  }

  /** 无 ready 快照时的合同概览实时回退：直接读 biz_contracts（按范围/筛选过滤），累计完工复用 globalCompletionByContract()。 */
  private async contractsLedgerLive(
    auth: BizAuthContext,
    params: {
      page?: number;
      pageSize?: number;
      keyword?: string;
      provinceId?: string;
      cityId?: string;
      status?: string;
      startDate?: string;
      endDate?: string;
    },
    page: number,
    pageSize: number,
  ): Promise<{
    items: Array<Record<string, unknown>>;
    total: number;
    page: number;
    pageSize: number;
    snapshotMetadata: SnapshotMetadata;
  }> {
    const scope = auth.dataScope;
    const qb = this.contractRepo.createQueryBuilder('c');

    if (scope.scopeType === 'province' && scope.provinceIds.length > 0) {
      qb.andWhere('c.provinceId IN (:...pids)', { pids: scope.provinceIds });
    }
    const cityAllowed = await this.cityScopeContractIds(scope, params.cityId);
    if (cityAllowed !== null) {
      if (cityAllowed.size === 0) {
        return { items: [], total: 0, page, pageSize, snapshotMetadata: this.liveMeta() };
      }
      qb.andWhere('c.id IN (:...ids)', { ids: [...cityAllowed] });
    }

    if (params.keyword) {
      qb.andWhere('(c.contractNo LIKE :kw OR c.contractName LIKE :kw)', { kw: `%${params.keyword}%` });
    }
    if (params.provinceId) {
      qb.andWhere('c.provinceId = :pid', { pid: params.provinceId });
    }
    if (params.status) {
      // 实时回退：以服务端当日为判断基准日的"有效展示状态"筛选
      const st = (params.status || '').trim().toLowerCase();
      const liveAsOf = new Date().toISOString().slice(0, 10);
      this.applyEffectiveStatusFilter(qb, 'c', st, liveAsOf);
    }
    if (params.startDate) {
      qb.andWhere('(c.signedDate >= :sd OR c.startDate >= :sd OR c.endDate >= :sd)', { sd: params.startDate });
    }
    if (params.endDate) {
      qb.andWhere('(c.signedDate <= :ed OR c.startDate <= :ed OR c.endDate <= :ed)', { ed: params.endDate });
    }

    const contracts = await qb
      .orderBy('c.contractNo', 'ASC')
      .addOrderBy('c.id', 'ASC')
      .getMany();
    const completion = await this.globalCompletionByContract();
    const provinceNames = await this.provinceNameMap();
    // 实时回退（无 ready 快照）：以服务端当日为判断基准日（YYYY-MM-DD，避免客户端时区偏差）
    const liveAsOf = new Date().toISOString().slice(0, 10);

    const mapped = contracts.map((c) => {
      const amount = Number(c.taxInclusiveAmountFen) || 0;
      const comp = completion.get(c.id) ?? 0;
      const progress = amount > 0 ? Math.round((comp / amount) * 10000) / 100 : null;
      return {
        id: c.id,
        contractId: c.id,
        contractNo: c.contractNo,
        contractName: c.contractName,
        taxInclusiveAmountFen: amount,
        provinceId: c.provinceId,
        provinceName: c.provinceId ? (provinceNames.get(c.provinceId) ?? null) : null,
        status: c.status,
        effectiveStatus: computeEffectiveContractStatus(c.status, c.endDate, liveAsOf),
        statusAsOf: liveAsOf,
        signedDate: c.signedDate ?? null,
        startDate: c.startDate ?? null,
        endDate: c.endDate ?? null,
        sourceUploadRecordId: c.sourceImportRecordId ?? null,
        cumulativeCompletionFen: comp,
        completionProgressPct: progress,
      };
    });

    const total = mapped.length;
    const items = mapped.slice((page - 1) * pageSize, page * pageSize);
    return { items, total, page, pageSize, snapshotMetadata: this.liveMeta() };
  }

  private async provinceNameMap(): Promise<Map<string, string>> {
    const provinces = await this.provinceRepo.find({ select: { id: true, name: true } });
    return new Map(provinces.map((p) => [String(p.id), String(p.name)]));
  }

  /** 计算"当前用户范围 + cityId 筛选"下可见的合同 id 集合；无市范围约束返回 null。 */
  private async cityScopeContractIds(scope: BizAuthContext['dataScope'], cityIdFilter?: string): Promise<Set<string> | null> {
    let set: Set<string> | null = null;
    if (scope.scopeType === 'city' && (scope.cityIds?.length || scope.cityId)) {
      const cityIds = scope.cityIds?.length ? scope.cityIds : (scope.cityId ? [scope.cityId] : []);
      const sets = await Promise.all(cityIds.map((id) => this.contractIdsByCity(id)));
      set = new Set(sets.flatMap((s) => [...s]));
    }
    if (cityIdFilter) {
      const filterSet = await this.contractIdsByCity(cityIdFilter);
      set = set ? new Set([...set].filter((id) => filterSet.has(id))) : filterSet;
    }
    return set;
  }

  private async contractIdsByCity(cityId: string): Promise<Set<string>> {
    const rows = await this.allocRepo.find({ where: { cityId } });
    return new Set(rows.map((a) => a.contractId));
  }

  /**
   * 把"有效展示状态"筛选翻译为 SQL 条件（主状态 + 到期推导），不改写数据库 status。
   *  - active 执行中：主状态 active 且（end_date 为空 或 end_date >= asOf，到期当天仍算执行中）
   *  - expired 已到期：主状态 active 且 end_date 非空 且 end_date < asOf
   *  - completed/voided/draft/cancelled/其它：主状态直筛（含数据库里已标 expired 的兼容主状态）
   * @param col 表别名（如 'l' / 'c'）
   */
  private applyEffectiveStatusFilter<T extends import('typeorm').ObjectLiteral>(
    qb: import('typeorm').SelectQueryBuilder<T>,
    col: string,
    status: string,
    asOf: string | null | undefined,
  ): void {
    if (status === 'expired') {
      // 已到期 = active 主状态且已过到期日（快照口径用快照 asOf；asOf 为空则按当日推导）
      const ref = asOf ?? new Date().toISOString().slice(0, 10);
      qb.andWhere(`${col}.status = 'active' AND ${col}.end_date IS NOT NULL AND ${col}.end_date < :asOfExp`, { asOfExp: ref });
      return;
    }
    if (status === 'active') {
      // 执行中 = active 主状态 且 未到期（end_date 为空 或 到期日 >= asOf）
      if (asOf) {
        qb.andWhere(`${col}.status = 'active' AND (${col}.end_date IS NULL OR ${col}.end_date >= :asOfAct)`, { asOfAct: asOf });
      } else {
        qb.andWhere(`${col}.status = 'active'`);
      }
      return;
    }
    // completed / voided / draft / cancelled / 其它：按主状态直筛
    qb.andWhere(`${col}.status = :st`, { st: status });
  }

  private readyMeta(snapId: string, registry: BizSnapshotRegistryEntity): SnapshotMetadata {
    return {
      snapshotId: snapId,
      asOf: registry.currentAsOf,
      status: 'ready',
      generatedAt: registry.lastSuccessfulAt,
      lastSuccessfulAt: registry.lastSuccessfulAt,
    };
  }

  private liveMeta(): SnapshotMetadata {
    return { snapshotId: null, asOf: null, status: 'live', generatedAt: null, lastSuccessfulAt: null };
  }

}

// ================= 纯函数（dashboard 组装） =================

function selectMetrics(
  metrics: BizSnapshotMetricEntity[],
  q: DashboardQuery,
): BizSnapshotMetricEntity[] {
  if (q.months && q.months.length) {
    const set = new Set(q.months);
    return metrics.filter((m) => m.periodType === 'month' && set.has(m.periodKey));
  }
  if (q.year) {
    return metrics.filter((m) => m.periodType === 'month' && m.periodKey.startsWith(q.year!));
  }
  return metrics.filter((m) => m.periodType === 'current');
}

function buildOverview(
  selected: BizSnapshotMetricEntity[],
  scopedContractSnaps: BizSnapshotContractEntity[],
  allContractSnaps: BizSnapshotContractEntity[],
) {
  const fin = zeroBucket();
  for (const m of selected) {
    const completion = metricCompletion(m);
    fin.orderCompletionFen += completion.order;
    fin.offlineCompletionFen += completion.offline;
    fin.grossProfitFen += fenValue(m.grossProfitFen);
    fin.costFen += fenValue(m.costFen);
    fin.netProfitFen += fenValue(m.netProfitFen);
  }
  const inv = computeInventory(
    scopedContractSnaps as Parameters<typeof computeInventory>[0],
    allContractSnaps as Parameters<typeof computeInventory>[1],
  );
  return {
    orderCompletionFen: fin.orderCompletionFen,
    offlineCompletionFen: fin.offlineCompletionFen,
    grossProfitFen: fin.grossProfitFen,
    costFen: fin.costFen,
    netProfitFen: fin.netProfitFen,
    contractCount: inv.count,
    totalContractAmountFen: inv.amountFen,
    totalCompletionFen: fin.orderCompletionFen + fin.offlineCompletionFen,
    monthCount: new Set(selected.map((m) => m.periodKey)).size,
  };
}

/**
 * 趋势：按 YYYY-MM 聚合求和。
 *
 * 修复说明（月度趋势"选年度后没有折线"的根因）：
 * scopedMetrics 中同一个 YYYY-MM 通常存在多行（不同地市 / 省份各一行），
 * 原实现逐行 map，会把同一个月输出成多个数据点；前端以 month 为 key 建 Map 时
 * 后者覆盖前者，最终只保留最后一行地市的金额，趋势严重失真甚至全为 0，
 * 表现为"选择年度后折线不显示"。
 * 因此必须先按 periodKey 汇总求和，保证每个 YYYY-MM 只有一个数据点。
 */
function buildTrend(scopedMetrics: BizSnapshotMetricEntity[], q: DashboardQuery) {
  const buckets = new Map<string, ReturnType<typeof zeroBucket>>();
  for (const m of scopedMetrics) {
    if (m.periodType !== 'month') continue;
    if (q.year && !m.periodKey.startsWith(q.year)) continue;
    if (q.months?.length && !q.months.includes(m.periodKey)) continue;
    const bucket = buckets.get(m.periodKey) ?? zeroBucket();
    const completion = metricCompletion(m);
    bucket.orderCompletionFen += completion.order;
    bucket.offlineCompletionFen += completion.offline;
    bucket.grossProfitFen += fenValue(m.grossProfitFen);
    bucket.costFen += fenValue(m.costFen);
    bucket.netProfitFen += fenValue(m.netProfitFen);
    buckets.set(m.periodKey, bucket);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, bucket]) => ({
      month,
      orderCompletionFen: bucket.orderCompletionFen,
      offlineCompletionFen: bucket.offlineCompletionFen,
      grossProfitFen: bucket.grossProfitFen,
      costFen: bucket.costFen,
      netProfitFen: bucket.netProfitFen,
    }));
}

function buildByCity(
  scopedMetrics: BizSnapshotMetricEntity[],
  scopedContractSnaps: BizSnapshotContractEntity[],
  allContractSnaps: BizSnapshotContractEntity[],
  q: DashboardQuery,
  cityName: Map<string, string>,
  cityProvince: Map<string, string>,
  cityUnitType: Map<string, string>,
  provinceName: Map<string, string>,
) {
  const selected = selectMetrics(scopedMetrics, q);
  const byCityFin = new Map<string, Bucket>();
  for (const m of selected) {
    if (m.cityId == null) continue;
    const b = byCityFin.get(m.cityId) ?? zeroBucket();
    const completion = metricCompletion(m);
    b.orderCompletionFen += completion.order;
    b.offlineCompletionFen += completion.offline;
    b.grossProfitFen += fenValue(m.grossProfitFen);
    b.costFen += fenValue(m.costFen);
    b.netProfitFen += fenValue(m.netProfitFen);
    byCityFin.set(m.cityId, b);
  }
  const out: Array<Record<string, unknown>> = [];
  for (const [cityId, fin] of byCityFin) {
    const cityContractSnaps = scopedContractSnaps.filter((c) => c.cityId === cityId);
    const inv = computeInventory(
      cityContractSnaps as Parameters<typeof computeInventory>[0],
      allContractSnaps as Parameters<typeof computeInventory>[1],
    );
    const provinceId = cityProvince.get(cityId) ?? null;
    out.push({
      cityId,
      cityName: cityName.get(cityId) ?? cityId,
      provinceId,
      provinceName: provinceId ? (provinceName.get(provinceId) ?? '-') : '-',
      unitType: cityUnitType.get(cityId) ?? 'city',
      contractCount: inv.count,
      contractAmountFen: inv.amountFen,
      orderCompletionFen: fin.orderCompletionFen,
      offlineCompletionFen: fin.offlineCompletionFen,
      grossProfitFen: fin.grossProfitFen,
      costFen: fin.costFen,
      netProfitFen: fin.netProfitFen,
      completionFen: fin.orderCompletionFen + fin.offlineCompletionFen,
    });
  }
  return out;
}

/** MySQL BIGINT values may arrive as strings; never let undefined/NaN poison the aggregate. */
function fenValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function metricCompletion(metric: BizSnapshotMetricEntity): { order: number; offline: number } {
  const order = fenValue(metric.orderCompletionFen);
  const offline = fenValue(metric.offlineCompletionFen);
  // Compatibility with snapshots produced before the split completion columns existed.
  if (order === 0 && offline === 0) {
    const combined = fenValue(metric.completionFen);
    if (combined !== 0) return { order: combined, offline: 0 };
  }
  return { order, offline };
}
