import { BadRequestException, Controller, Get, Param, Query, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { BizAuthGuard } from '../biz-auth/biz-auth.guard';
import { BizAuthUser } from '../biz-auth/biz-auth-user.decorator';
import { BizAuthContext } from '../rbac/rbac.service';
import {
  MaintenanceOverviewService,
  type ExpiryLedgerResult,
  type MaintenanceOverviewResult,
} from './maintenance-overview.service';

const KINDS = ['personnel', 'vehicles', 'generators'] as const;
type Kind = (typeof KINDS)[number];

function assertKind(kind: string): Kind {
  if (!(KINDS as readonly string[]).includes(kind)) throw new BadRequestException(`未知的维护数据类型：${kind}`);
  return kind as Kind;
}

/**
 * 维护管理数据总览 + 筛选项字典。
 * 改造前总览靠前端逐页翻表（38 次请求 / 约 2.7MB）算 4 个数字，现在一次返回。
 */
@Controller('biz/maintenance')
@Public()
@UseGuards(BizAuthGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class MaintenanceOverviewController {
  constructor(private readonly service: MaintenanceOverviewService) {}

  @Get('overview')
  overview(@Query('windowDays') windowDays: string | undefined, @BizAuthUser() auth: BizAuthContext): Promise<MaintenanceOverviewResult> {
    return this.service.build(windowDays === undefined ? undefined : Number(windowDays), auth);
  }

  /**
   * 到期台账：跨三类资产的分页清单。
   * 与 `overview` 共用同一套到期判定（service 内 `compute`），
   * 所以「台账 total」与「总览 counts.pending」在任何筛选条件外天然相等。
   */
  @Get('expiry-ledger')
  expiryLedger(
    @BizAuthUser() auth: BizAuthContext,
    @Query('kind') kind?: string,
    @Query('status') status?: string,
    @Query('windowDays') windowDays?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('orgProvince') orgProvince?: string,
    @Query('orgCity') orgCity?: string,
    @Query('orgRegion') orgRegion?: string,
    @Query('orgCompany') orgCompany?: string,
    @Query('keyword') keyword?: string,
  ): Promise<ExpiryLedgerResult> {
    return this.service.ledger(
      {
        kind,
        status,
        windowDays: windowDays === undefined ? undefined : Number(windowDays),
        page: page === undefined ? undefined : Number(page),
        pageSize: pageSize === undefined ? undefined : Number(pageSize),
        orgProvince,
        orgCity,
        orgRegion,
        orgCompany,
        keyword,
      },
      auth,
    );
  }

  /** 区县 / 地市 / 公司下拉的服务端 distinct（替代原先取「当前页 50 条」的做法）；传省市可按级联收敛 */
  @Get(':kind/facets')
  facets(
    @Param('kind') kind: string,
    @BizAuthUser() auth: BizAuthContext,
    @Query('orgProvince') orgProvince?: string,
    @Query('orgCity') orgCity?: string,
  ) {
    return this.service.facets(assertKind(kind), auth, { orgProvince, orgCity });
  }
}
