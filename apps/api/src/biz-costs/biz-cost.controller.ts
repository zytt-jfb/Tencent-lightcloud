import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { BizAuthGuard } from '../biz-auth/biz-auth.guard';
import { BizPermissionsGuard } from '../biz-auth/biz-permissions.guard';
import { BizPermissions } from '../biz-auth/biz-permissions.decorator';
import { BizAuthUser } from '../biz-auth/biz-auth-user.decorator';
import { BizAuthContext } from '../rbac/rbac.service';
import { BizCostService, CostEntryDto, MonthlyCostDto, MonthlyReturnDto } from './biz-cost.service';
import { BizPermissionCode } from '@biz-reporting/shared-types';

/**
 * 地市成本 API（不关联合同）
 * 提交即生效；operation.cost.reject 权限用于管理员退回已生效记录。
 */
@Controller('biz/costs')
@Public()
@UseGuards(BizAuthGuard, BizPermissionsGuard)
export class BizCostController {
  constructor(private readonly service: BizCostService) {}

  @Get()
  @BizPermissions(BizPermissionCode.OPERATION_COST_READ)
  async list(
    @BizAuthUser() auth: BizAuthContext,
    @Query('cityId') cityId?: string,
    @Query('status') status?: string,
    @Query('businessMonth') businessMonth?: string,
    @Query('year') year?: string,
    @Query('categoryCode') categoryCode?: string,
  ) {
    return { items: await this.service.list(auth, { cityId, status, businessMonth, year, categoryCode }) };
  }

  @Get('categories/list')
  @BizPermissions(BizPermissionCode.OPERATION_COST_READ)
  async categories() {
    return { items: await this.service.listCategories() };
  }

  @Get(':id')
  @BizPermissions(BizPermissionCode.OPERATION_COST_READ)
  async detail(@BizAuthUser() auth: BizAuthContext, @Param('id') id: string) {
    return this.service.detail(auth, id);
  }

  @Post()
  @BizPermissions(BizPermissionCode.OPERATION_COST_CREATE)
  async create(@BizAuthUser() auth: BizAuthContext, @Body() dto: CostEntryDto) {
    return this.service.create(auth, dto);
  }

  @Post('monthly')
  @BizPermissions(BizPermissionCode.OPERATION_COST_CREATE)
  async saveMonthly(@BizAuthUser() auth: BizAuthContext, @Body() dto: MonthlyCostDto) {
    return this.service.saveMonthly(auth, dto);
  }

  @Post('monthly/return')
  @BizPermissions(BizPermissionCode.OPERATION_COST_REJECT)
  async returnMonthly(@BizAuthUser() auth: BizAuthContext, @Body() dto: MonthlyReturnDto) {
    return this.service.returnMonthly(auth, dto);
  }

  @Patch(':id')
  @BizPermissions(BizPermissionCode.OPERATION_COST_CREATE)
  async update(@BizAuthUser() auth: BizAuthContext, @Param('id') id: string, @Body() dto: Partial<CostEntryDto>) {
    return this.service.update(auth, id, dto);
  }

  @Post(':id/submit')
  @BizPermissions(BizPermissionCode.OPERATION_COST_SUBMIT)
  async submit(@BizAuthUser() auth: BizAuthContext, @Param('id') id: string) {
    return this.service.submit(auth, id);
  }

  @Post(':id/withdraw')
  @BizPermissions(BizPermissionCode.OPERATION_COST_SUBMIT)
  async withdraw(@BizAuthUser() auth: BizAuthContext, @Param('id') id: string) {
    return this.service.withdraw(auth, id);
  }

  @Post(':id/approve')
  @BizPermissions(BizPermissionCode.OPERATION_COST_APPROVE)
  async approve(@BizAuthUser() auth: BizAuthContext, @Param('id') id: string) {
    return this.service.approve(auth, id);
  }

  @Post(':id/reject')
  @BizPermissions(BizPermissionCode.OPERATION_COST_REJECT)
  async reject(@BizAuthUser() auth: BizAuthContext, @Param('id') id: string, @Body() body: { comment?: string }) {
    return this.service.reject(auth, id, body?.comment ?? '');
  }

  @Post(':id/void')
  @BizPermissions(BizPermissionCode.OPERATION_COST_VOID)
  async voidItem(@BizAuthUser() auth: BizAuthContext, @Param('id') id: string, @Body() body: { reason?: string }) {
    return this.service.voidItem(auth, id, body?.reason ?? '');
  }

  @Post(':id/restore')
  @BizPermissions(BizPermissionCode.OPERATION_COST_VOID)
  async restoreItem(@BizAuthUser() auth: BizAuthContext, @Param('id') id: string) {
    return this.service.restoreItem(auth, id);
  }
}
