import { Controller, Post, Body, Request, UseGuards, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '@biz-reporting/shared-types';
import { RemindersService } from './reminders.service';
import type { Express } from 'express';
import type { SendRemindersRequest } from '@biz-reporting/shared-types';

interface AuthenticatedRequest extends Express.Request {
  user: { userId: number; role: string; cityId: number | null };
}

@ApiTags('Admin - Reminders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SYSTEM_ADMIN)
@Controller('admin/reminders')
export class AdminRemindersController {
  constructor(private readonly remindersService: RemindersService) {}

  @Post('send')
  @ApiOperation({ summary: '手动发送填报提醒' })
  async send(
    @Body() dto: SendRemindersRequest,
    @Request() req: AuthenticatedRequest,
  ) {
    if (!dto.year || dto.year < 2000 || dto.year > 2100) {
      throw new BadRequestException('year 必须在 2000-2100 之间');
    }
    if (!dto.month || dto.month < 1 || dto.month > 12) {
      throw new BadRequestException('month 必须在 1-12 之间');
    }
    if (!dto.cityIds || dto.cityIds.length === 0) {
      throw new BadRequestException('至少选择一个城市');
    }

    return this.remindersService.sendReminders(dto, req.user.userId);
  }
}
