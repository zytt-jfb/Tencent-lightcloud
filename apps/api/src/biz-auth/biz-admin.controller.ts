import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { BizAuthGuard } from './biz-auth.guard';
import { BizPermissionsGuard } from './biz-permissions.guard';
import { BizPermissions } from './biz-permissions.decorator';
import { BizAuthContext } from '../rbac/rbac.service';
import { BizOperationLogEntity } from '../operation-logs/biz-operation-log.entity';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { BizAuthUser } from './biz-auth-user.decorator';
import { BizAdminService, CreateUserDto, PermissionOverrideInput, DataScopeInput, ProvinceInput, CityInput, ScopeGrantInput } from './biz-admin.service';
import { BizPermissionCode, PlatformRole } from '@biz-reporting/shared-types';
import { DataSource } from 'typeorm';

/**
 * 账号与权限管理 API（新基线，仅 super_admin；基线 02 TABLE 3）
 * 停用/重置密码 → authVersion+1 使旧会话立即失效；权限变更在账号下次登录时生效。
 */
@Controller('biz/admin')
@Public()
@UseGuards(BizAuthGuard, BizPermissionsGuard)
export class BizAdminController {
  constructor(
    private readonly adminService: BizAdminService,
    @InjectRepository(BizOperationLogEntity)
    private readonly opLogRepo: Repository<BizOperationLogEntity>,
    private readonly dataSource: DataSource,
  ) {}

  // ---- 用户 ----
  @Get('users')
  @BizPermissions(BizPermissionCode.OPERATION_USER_MANAGE)
  async listUsers(@BizAuthUser() auth: BizAuthContext) {
    const users = await this.adminService.listUsers();
    return {
      items: users.map(({ passwordHash: _ph, ...user }) => user),
    };
  }

  @Post('users')
  @BizPermissions(BizPermissionCode.OPERATION_USER_MANAGE)
  async createUser(@BizAuthUser() auth: BizAuthContext, @Body() dto: CreateUserDto) {
    const user = await this.adminService.createUser(auth.userId, dto);
    const { passwordHash: _ph, ...rest } = user;
    return rest;
  }

  @Patch('users/:id/status')
  @BizPermissions(BizPermissionCode.OPERATION_USER_MANAGE)
  async setUserStatus(
    @BizAuthUser() auth: BizAuthContext,
    @Param('id') userId: string,
    @Body() body: { status: 'enabled' | 'disabled' },
  ) {
    return this.adminService.setUserStatus(auth.userId, userId, body.status);
  }

  @Post('users/:id/reset-password')
  @BizPermissions(BizPermissionCode.OPERATION_USER_MANAGE)
  async resetPassword(
    @BizAuthUser() auth: BizAuthContext,
    @Param('id') userId: string,
    @Body() body: { newPassword: string },
  ) {
    if (!body.newPassword || body.newPassword.length < 6) {
      return { ok: false, error: '密码最低 6 位' };
    }
    await this.adminService.resetPassword(auth.userId, userId, body.newPassword);
    return { ok: true };
  }

  @Get('users/:id/permissions')
  @BizPermissions(BizPermissionCode.OPERATION_ROLE_MANAGE)
  async getUserPermissions(@Param('id') userId: string) {
    return this.adminService.getUserEffectivePermissions(userId);
  }

  @Put('users/:id/permission-overrides')
  @BizPermissions(BizPermissionCode.OPERATION_ROLE_MANAGE)
  async setOverrides(
    @BizAuthUser() auth: BizAuthContext,
    @Param('id') userId: string,
    @Body() body: { overrides: PermissionOverrideInput[] },
  ) {
    await this.adminService.setPermissionOverrides(auth.userId, userId, body.overrides ?? []);
    return { ok: true };
  }

  @Put('users/:id/data-scopes')
  @BizPermissions(BizPermissionCode.OPERATION_USER_MANAGE)
  async setDataScopes(
    @BizAuthUser() auth: BizAuthContext,
    @Param('id') userId: string,
    @Body() body: { scopes: DataScopeInput[] },
  ) {
    await this.adminService.setDataScopes(auth.userId, userId, body.scopes ?? []);
    return { ok: true };
  }

  @Get('users/:id/access')
  @BizPermissions(BizPermissionCode.OPERATION_USER_MANAGE)
  async getUserAccess(@Param('id') userId: string) {
    return this.adminService.getUserAccess(userId);
  }

  @Put('users/:id/access')
  @BizPermissions(BizPermissionCode.OPERATION_USER_MANAGE)
  async setUserAccess(
    @BizAuthUser() auth: BizAuthContext,
    @Param('id') userId: string,
    @Body() body: { roles?: string[]; grants?: ScopeGrantInput[] },
  ) {
    await this.adminService.setUserAccess(auth.userId, userId, body.roles ?? [], body.grants ?? []);
    return { ok: true };
  }

  // ---- 字典 ----
  // M8（DEV-066）：操作审计日志（super_admin/admin）
  @Get('operation-logs')
  @BizPermissions(BizPermissionCode.OPERATION_USER_MANAGE)
  async operationLogs(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('limit') limit?: string,
    @Query('actionType') actionType?: string,
    @Query('targetType') targetType?: string,
    @Query('operatorUserId') operatorUserId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    const currentPage = Math.max(1, Number(page) || 1);
    const currentPageSize = Math.min(100, Math.max(1, Number(pageSize) || Math.min(Number(limit) || 20, 100)));
    const qb = this.opLogRepo.createQueryBuilder('l')
      .leftJoin('biz_users', 'u', 'u.id = l.operator_user_id')
      .leftJoin('biz_cities', 'c', 'c.id = u.city_id')
      .select([
        'l.id AS id',
        'l.operator_user_id AS operatorUserId',
        'l.action_type AS actionType',
        'l.target_type AS targetType',
        'l.target_id AS targetId',
        'l.result_status AS resultStatus',
        'l.summary_before AS summaryBefore',
        'l.summary_after AS summaryAfter',
        'l.batch_id AS batchId',
        'l.error_message AS errorMessage',
        'l.created_at AS createdAt',
        'u.username AS username',
        'u.name AS operatorName',
        'u.role_code AS roleCode',
        'u.city_id AS cityId',
        'c.name AS cityName',
      ])
      .where('u.role_code <> :superRole', { superRole: 'super_admin' });
    if (actionType) qb.andWhere('l.action_type = :actionType', { actionType });
    if (targetType) qb.andWhere('l.target_type = :targetType', { targetType });
    if (operatorUserId) qb.andWhere('l.operator_user_id = :operatorUserId', { operatorUserId });
    if (dateFrom) qb.andWhere('l.created_at >= :dateFrom', { dateFrom: new Date(dateFrom) });
    if (dateTo) qb.andWhere('l.created_at <= :dateTo', { dateTo: new Date(dateTo) });
    const total = await qb.getCount();
    const items = await qb
      .orderBy('l.created_at', 'DESC')
      .skip((currentPage - 1) * currentPageSize)
      .take(currentPageSize)
      .getRawMany();
    const targetIdsByType = new Map<string, string[]>();
    for (const item of items as Array<{ targetType?: string; targetId?: string }>) {
      const type = String(item.targetType ?? '');
      const id = String(item.targetId ?? '');
      if (!type || !id) continue;
      targetIdsByType.set(type, [...(targetIdsByType.get(type) ?? []), id]);
    }
    const displayByKey = new Map<string, string>();
    const loadDisplay = async (targetType: string, table: string, valueColumn: string, label: string) => {
      const ids = [...new Set(targetIdsByType.get(targetType) ?? [])];
      if (!ids.length) return;
      const placeholders = ids.map(() => '?').join(',');
      const rows = await this.dataSource.query(`SELECT id, ${valueColumn} AS value FROM ${table} WHERE id IN (${placeholders})`, ids) as Array<{ id: string; value: unknown }>;
      for (const row of rows) displayByKey.set(`${targetType}:${row.id}`, `${label}：${String(row.value ?? row.id)}`);
    };
    await Promise.all([
      loadDisplay('contract', 'biz_contracts', 'contract_no', '合同'),
      loadDisplay('order_row', 'biz_order_rows', 'col_03', '订单'),
      loadDisplay('order_batch', 'biz_order_import_batches', 'filename', '订单批次'),
      loadDisplay('user', 'biz_users', 'username', '账号'),
      loadDisplay('city', 'biz_cities', 'name', '经营单位'),
      loadDisplay('province', 'biz_provinces', 'name', '省份'),
      loadDisplay('announcement', 'biz_announcements', 'title', '公告'),
      loadDisplay('contract_import_record', 'biz_contract_import_records', 'filename', '合同上传记录'),
    ]);
    const costIds = [...new Set(targetIdsByType.get('cost_entry') ?? [])];
    if (costIds.length) {
      const placeholders = costIds.map(() => '?').join(',');
      const rows = await this.dataSource.query(`SELECT e.id, c.name AS city_name, e.business_month, e.category_code FROM biz_cost_entries e LEFT JOIN biz_cities c ON c.id = e.city_id WHERE e.id IN (${placeholders})`, costIds) as Array<{ id: string; city_name?: string; business_month?: string; category_code?: string }>;
      for (const row of rows) displayByKey.set(`cost_entry:${row.id}`, `成本：${row.city_name ?? '-'} ${row.business_month ?? '-'} ${row.category_code ?? '-'}`);
    }
    const enrichedItems = (items as Array<Record<string, unknown>>).map((item) => ({
      ...item,
      targetDisplay: displayByKey.get(`${String(item.targetType ?? '')}:${String(item.targetId ?? '')}`) ?? `${String(item.targetType ?? '对象')}：${String(item.targetId ?? '-')}`,
    }));
    return { items: enrichedItems, total, page: currentPage, pageSize: currentPageSize };
  }

  @Get('roles')
  @BizPermissions(BizPermissionCode.OPERATION_ROLE_MANAGE)
  async roles() {
    return { items: await this.adminService.listRoles() };
  }

  @Get('modules')
  @BizPermissions(BizPermissionCode.OPERATION_MODULE_MANAGE)
  async modules() {
    return { items: await this.adminService.listModules() };
  }

  @Get('permissions')
  @BizPermissions(BizPermissionCode.OPERATION_ROLE_MANAGE)
  async permissions() {
    return { items: await this.adminService.listPermissions() };
  }

  @Get('provinces')
  @BizPermissions(BizPermissionCode.OPERATION_USER_MANAGE)
  async provinces() {
    return { items: await this.adminService.listProvinces() };
  }

  @Post('provinces')
  @BizPermissions(BizPermissionCode.OPERATION_REGION_MANAGE)
  async createProvince(@BizAuthUser() auth: BizAuthContext, @Body() body: ProvinceInput) { return this.adminService.createProvince(auth.userId, body); }

  @Patch('provinces/:id')
  @BizPermissions(BizPermissionCode.OPERATION_REGION_MANAGE)
  async updateProvince(@BizAuthUser() auth: BizAuthContext, @Param('id') id: string, @Body() body: Partial<ProvinceInput>) { return this.adminService.updateProvince(auth.userId, id, body); }

  @Delete('provinces/:id')
  @BizPermissions(BizPermissionCode.OPERATION_REGION_MANAGE)
  async deleteProvince(@BizAuthUser() auth: BizAuthContext, @Param('id') id: string) { await this.adminService.deleteProvince(auth.userId, id); return { ok: true }; }

  @Get('cities')
  @BizPermissions(BizPermissionCode.OPERATION_USER_MANAGE)
  async cities(@Query('provinceId') provinceId?: string) {
    return { items: await this.adminService.listCities(provinceId) };
  }

  @Post('cities')
  @BizPermissions(BizPermissionCode.OPERATION_REGION_MANAGE)
  async createCity(@BizAuthUser() auth: BizAuthContext, @Body() body: CityInput) { return this.adminService.createCity(auth.userId, body); }

  @Patch('cities/:id')
  @BizPermissions(BizPermissionCode.OPERATION_REGION_MANAGE)
  async updateCity(@BizAuthUser() auth: BizAuthContext, @Param('id') id: string, @Body() body: Partial<CityInput>) { return this.adminService.updateCity(auth.userId, id, body); }

  @Delete('cities/:id')
  @BizPermissions(BizPermissionCode.OPERATION_REGION_MANAGE)
  async deleteCity(@BizAuthUser() auth: BizAuthContext, @Param('id') id: string) { await this.adminService.deleteCity(auth.userId, id); return { ok: true }; }
}
