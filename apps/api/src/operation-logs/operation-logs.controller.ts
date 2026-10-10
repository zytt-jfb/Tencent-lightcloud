import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiQuery, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Permission, Role } from '@biz-reporting/shared-types';
import { Permissions } from '../common/decorators/permissions.decorator';
import { OperationLogsService } from './operation-logs.service';
import { OperationLogListRequest } from '@biz-reporting/shared-types';

@ApiTags('OperationLogs')
@Controller('admin/operation-logs')
@Permissions(Permission.OPERATION_LOGS_READ)
export class OperationLogsController {
  constructor(private readonly service: OperationLogsService) {}

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SYSTEM_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List operation logs' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiQuery({ name: 'actionType', required: false, type: String })
  @ApiQuery({ name: 'targetType', required: false, type: String })
  @ApiQuery({ name: 'operatorUserId', required: false, type: Number })
  @ApiQuery({ name: 'cityId', required: false, type: Number })
  @ApiQuery({ name: 'dateFrom', required: false, type: String })
  @ApiQuery({ name: 'dateTo', required: false, type: String })
  async list(@Query() query: OperationLogListRequest) {
    return this.service.list(query);
  }
}
