import { Controller, Get, Query, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { BizAuthGuard } from '../biz-auth/biz-auth.guard';
import { MaintenanceOverviewService, type MaintenanceOverviewResult } from './maintenance-overview.service';

/**
 * 维护管理数据总览聚合接口。
 * 改造前该页面靠前端逐页翻表（38 次请求 / 约 2.7MB）算 4 个数字，现在一次返回。
 */
@Controller('biz/maintenance/overview')
@Public()
@UseGuards(BizAuthGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class MaintenanceOverviewController {
  constructor(private readonly service: MaintenanceOverviewService) {}

  @Get()
  overview(@Query('windowDays') windowDays?: string): Promise<MaintenanceOverviewResult> {
    return this.service.build(windowDays === undefined ? undefined : Number(windowDays));
  }
}
