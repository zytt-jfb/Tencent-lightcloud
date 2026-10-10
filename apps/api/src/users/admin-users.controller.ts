import { Body, Controller, Get, Param, Patch, Post, Query, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  CreateManagedUserRequest,
  CreateManagedUserResponse,
  PaginationParams,
  Permission,
  RebindUserCityRequest,
  ResetManagedUserPasswordResponse,
  UpdateManagedUserRoleRequest,
  UpdateUserStatusRequest,
  UserListItem,
  UserListResponse,
} from '@biz-reporting/shared-types';
import { Permissions } from '../common/decorators/permissions.decorator';
import { AccountSecurityService, SecurityActor } from './account-security.service';
import { UsersService } from './users.service';

interface AuthenticatedRequest extends Express.Request { user: SecurityActor }

@ApiTags('Admin - 用户管理')
@ApiBearerAuth()
@Controller('admin/users')
@Permissions(Permission.ACCOUNTS_READ)
export class AdminUsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly security: AccountSecurityService,
  ) {}

  @Get()
  list(@Query() params: PaginationParams): Promise<UserListResponse> {
    return this.usersService.list(params);
  }

  @Post()
  @Permissions(Permission.ACCOUNTS_CREATE)
  create(@Request() req: AuthenticatedRequest, @Body() dto: CreateManagedUserRequest): Promise<CreateManagedUserResponse> {
    return this.security.createAccount(dto, req.user);
  }

  @Patch(':userId/status')
  @Permissions(Permission.ACCOUNTS_UPDATE)
  updateStatus(@Request() req: AuthenticatedRequest, @Param('userId') userId: string, @Body() dto: UpdateUserStatusRequest): Promise<UserListItem> {
    return this.security.updateStatus(Number(userId), dto.status, req.user);
  }

  @Patch(':userId/role')
  @Permissions(Permission.ACCOUNTS_UPDATE)
  updateRole(@Request() req: AuthenticatedRequest, @Param('userId') userId: string, @Body() dto: UpdateManagedUserRoleRequest): Promise<UserListItem> {
    return this.security.updateRole(Number(userId), dto, req.user);
  }

  @Patch(':userId/city')
  @Permissions(Permission.ACCOUNTS_UPDATE)
  updateCity(@Request() req: AuthenticatedRequest, @Param('userId') userId: string, @Body() dto: RebindUserCityRequest): Promise<UserListItem> {
    return this.security.updateCity(Number(userId), dto.cityId, req.user);
  }

  @Post(':userId/reset-password')
  @Permissions(Permission.ACCOUNTS_RESET_PASSWORD)
  resetPassword(@Request() req: AuthenticatedRequest, @Param('userId') userId: string): Promise<ResetManagedUserPasswordResponse> {
    return this.security.resetPassword(Number(userId), req.user);
  }
}
