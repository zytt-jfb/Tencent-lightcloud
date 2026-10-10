import { Controller, Get, Post, Param, Request, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RemindersService } from './reminders.service';
import type { Express } from 'express';

interface AuthenticatedRequest extends Express.Request {
  user: { userId: number; role: string; cityId: number | null };
}

@ApiTags('Messages')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('messages')
export class MessagesController {
  constructor(private readonly remindersService: RemindersService) {}

  @Get()
  @ApiOperation({ summary: '获取当前用户消息列表' })
  async list(@Request() req: AuthenticatedRequest) {
    const messages = await this.remindersService.getUserMessages(req.user.userId);
    const unreadCount = await this.remindersService.getUnreadCount(req.user.userId);
    return { messages, unreadCount };
  }

  @Get('unread-count')
  @ApiOperation({ summary: '获取未读消息数' })
  async unreadCount(@Request() req: AuthenticatedRequest) {
    const count = await this.remindersService.getUnreadCount(req.user.userId);
    return { unreadCount: count };
  }

  @Post(':id/read')
  @ApiOperation({ summary: '标记消息已读' })
  async markRead(
    @Param('id') id: number,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.remindersService.markAsRead(id, req.user.userId);
  }
}
