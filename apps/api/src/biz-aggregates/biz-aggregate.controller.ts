import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { BizAuthGuard } from '../biz-auth/biz-auth.guard';
import { BizPermissionsGuard } from '../biz-auth/biz-permissions.guard';
import { BizPermissions } from '../biz-auth/biz-permissions.decorator';
import { BizAuthUser } from '../biz-auth/biz-auth-user.decorator';
import { BizAuthContext } from '../rbac/rbac.service';
import { BizAggregateService, RecalcScope } from './biz-aggregate.service';
import { BizSnapshotService } from '../biz-snapshots/biz-snapshot.service';
import { BizSnapshotScheduler } from '../biz-snapshots/biz-snapshot.scheduler';
import { BizPermissionCode } from '@biz-reporting/shared-types';

/**
 * 汇总/分析/设置 API（新基线 M6）
 * 汇总重算：super_admin/admin（operation.settings.manage 系权限缺失时以 contract/order 权限替代）
 */
@Controller('biz')
@Public()
@UseGuards(BizAuthGuard, BizPermissionsGuard)
export class BizAggregateController {
  constructor(
    private readonly service: BizAggregateService,
    private readonly snapshots: BizSnapshotService,
    private readonly scheduler: BizSnapshotScheduler,
  ) {}

  // ---- 汇总重算 ----
  @Post('aggregates/recalc')
  @BizPermissions(BizPermissionCode.OPERATION_CONTRACT_UPDATE)
  async recalc(@BizAuthUser() auth: BizAuthContext, @Body() body: { scope?: RecalcScope; confirmAll?: boolean }) {
    const result = await this.service.recalc(auth, body?.scope ?? {}, Boolean(body?.confirmAll));
    return { ok: true, ...result };
  }

  @Get('aggregates/failures')
  @BizPermissions(BizPermissionCode.OPERATION_CONTRACT_UPDATE)
  async failures(@BizAuthUser() auth: BizAuthContext) {
    return { items: await this.service.listFailures(auth) };
  }

  // ---- 一致性核对（只告警） ----
  @Post('aggregates/check')
  @BizPermissions(BizPermissionCode.OPERATION_CONTRACT_UPDATE)
  async check(@BizAuthUser() auth: BizAuthContext) {
    const warnings = await this.service.checkConsistency(auth);
    return { ok: true, warnings, warningCount: warnings.length };
  }

  // ---- 分析聚合 ----
  @Get('analysis/overview')
  @BizPermissions(BizPermissionCode.OPERATION_ANALYSIS_READ)
  async overview(@BizAuthUser() auth: BizAuthContext, @Query('year') year?: string, @Query('month') month?: string, @Query('provinceId') provinceId?: string, @Query('cityId') cityId?: string) {
    return this.service.overview(auth, year, month, cityId, provinceId);
  }

  @Get('analysis/trend')
  @BizPermissions(BizPermissionCode.OPERATION_ANALYSIS_READ)
  async trend(@BizAuthUser() auth: BizAuthContext, @Query('limit') limit?: string, @Query('cityId') cityId?: string, @Query('year') year?: string, @Query('provinceId') provinceId?: string) {
    return { items: await this.service.trend(auth, Number(limit) || 12, cityId, year, provinceId) };
  }

  @Get('analysis/by-city')
  @BizPermissions(BizPermissionCode.OPERATION_ANALYSIS_READ)
  async byCity(@BizAuthUser() auth: BizAuthContext, @Query('year') year?: string, @Query('month') month?: string, @Query('provinceId') provinceId?: string) {
    return { items: await this.service.byCity(auth, year, month, provinceId) };
  }

  @Get('analysis/alerts')
  @BizPermissions(BizPermissionCode.OPERATION_ANALYSIS_READ)
  async analysisAlerts(@BizAuthUser() auth: BizAuthContext, @Query('cityId') cityId?: string, @Query('provinceId') provinceId?: string) {
    return { items: await this.service.analysisAlerts(auth, cityId, provinceId) };
  }

  @Get('analysis/overrun-list')
  @BizPermissions(BizPermissionCode.OPERATION_ANALYSIS_READ)
  async overrunList(@BizAuthUser() auth: BizAuthContext, @Query('year') year?: string, @Query('month') month?: string, @Query('provinceId') provinceId?: string, @Query('cityId') cityId?: string) {
    return { items: await this.service.overrunList(auth, year, month, cityId, provinceId) };
  }

  @Get('analysis/years')
  @BizPermissions(BizPermissionCode.OPERATION_ANALYSIS_READ)
  async years(@BizAuthUser() auth: BizAuthContext) {
    return { items: await this.service.availableYears(auth) };
  }

  @Get('analysis/city/:cityId')
  @BizPermissions(BizPermissionCode.OPERATION_ANALYSIS_READ)
  async cityDetail(
    @BizAuthUser() auth: BizAuthContext,
    @Param('cityId') cityId: string,
    @Query('year') year?: string,
    @Query('months') months?: string,
    @Query('categoryCodes') categoryCodes?: string,
  ) {
    return this.service.cityDetail(auth, cityId, {
      year,
      months: typeof months === 'string' && months ? months.split(',').filter(Boolean) : [],
      categoryCodes: typeof categoryCodes === 'string' && categoryCodes ? categoryCodes.split(',').filter(Boolean) : [],
    });
  }

  /** 经营单位详情（快照口径，与概览/单位对比/预警同一 ready 快照；无 ready 快照时 status='none'） */
  @Get('analysis/city/:cityId/snapshot')
  @BizPermissions(BizPermissionCode.OPERATION_ANALYSIS_READ)
  async cityDetailSnapshot(@BizAuthUser() auth: BizAuthContext, @Param('cityId') cityId: string) {
    return this.snapshots.snapshotCityDetail(auth, cityId);
  }

  // ---- 统一 dashboard（一次返回 overview/trend/byCity/alerts + 快照元数据；快照未生成时回退实时聚合）----
  @Get('analysis/dashboard')
  @BizPermissions(BizPermissionCode.OPERATION_ANALYSIS_READ)
  async dashboard(
    @BizAuthUser() auth: BizAuthContext,
    @Query('year') year?: string,
    @Query('months') months?: string,
    @Query('provinceIds') provinceIds?: string,
    @Query('cityIds') cityIds?: string,
  ) {
    return this.snapshots.dashboard(auth, {
      year,
      months: typeof months === 'string' && months ? months.split(',').filter(Boolean) : [],
      provinceIds: typeof provinceIds === 'string' && provinceIds ? provinceIds.split(',').filter(Boolean) : [],
      cityIds: typeof cityIds === 'string' && cityIds ? cityIds.split(',').filter(Boolean) : [],
    });
  }

  /** 合同概览（快照口径，一合同一行）：服务端分页 + 关键词/省份/地市/状态/日期筛选；无 ready 快照时实时回退 status='live' */
  @Get('analysis/contracts')
  @BizPermissions(BizPermissionCode.OPERATION_CONTRACT_READ)
  async contracts(
    @BizAuthUser() auth: BizAuthContext,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('keyword') keyword?: string,
    @Query('provinceId') provinceId?: string,
    @Query('cityId') cityId?: string,
    @Query('status') status?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.snapshots.contractsLedger(auth, {
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      keyword,
      provinceId,
      cityId,
      status,
      startDate,
      endDate,
    });
  }

  // ---- 快照手动更新（幂等；沿用现有经营分析读权限，不新增权限码） ----
  @Post('analysis/snapshot/build')
  @BizPermissions(BizPermissionCode.OPERATION_ANALYSIS_READ)
  async buildSnapshot(
    @BizAuthUser() auth: BizAuthContext,
    @Body() body?: { asOf?: string },
  ) {
    // 业务日期按中国时区确定，避免 UTC 凌晨仍落在前一业务日。
    const asOf = body?.asOf && /^\d{4}-\d{2}-\d{2}$/.test(body.asOf)
      ? body.asOf
      : new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const result = await this.snapshots.requestBuild(asOf);
    return { ok: true, ...result, asOf };
  }

  @Get('analysis/snapshot/status')
  @BizPermissions(BizPermissionCode.OPERATION_ANALYSIS_READ)
  async snapshotStatus(@Query('runId') runId?: string) {
    if (!runId) return { ok: true, run: null };
    const run = await this.snapshots.getRun(runId);
    return { ok: true, run };
  }

  /** 轻量快照元数据（供顶部状态栏轮询）：不含任何分析数据，返回状态/时间/最近一次任务 */
  @Get('analysis/snapshot/metadata')
  @BizPermissions(BizPermissionCode.OPERATION_ANALYSIS_READ)
  async snapshotMetadata() {
    return this.snapshots.snapshotMetadata();
  }

  // ---- 系统设置（DEV-055） ----
  @Get('settings')
  @BizPermissions(BizPermissionCode.OPERATION_SETTINGS_READ)
  async listSettings() {
    return { items: await this.service.listSettings() };
  }

  @Put('settings/:key')
  @BizPermissions(BizPermissionCode.OPERATION_SETTINGS_MANAGE)
  async updateSetting(@BizAuthUser() auth: BizAuthContext, @Param('key') key: string, @Body() body: { value: string }) {
    await this.service.updateSetting(auth, key, body.value);
    // 保存后重新加载自动更新调度（动态时间 / 启停），不残留旧 Cron
    await this.scheduler.reschedule();
    return { ok: true };
  }
}
