import {
  Body, Controller, Delete, Get, Post, Query, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BizAuthGuard } from '../biz-auth/biz-auth.guard';
import { BizAuthUser } from '../biz-auth/biz-auth-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { BizAuthContext } from '../rbac/rbac.service';
import { AiService } from './ai.service';
import { AiChatDto, AiFeedbackDto, AiRecentQueryDto, AiReportDto } from './dto/ai-chat.dto';

/**
 * 内部 AI 助手 API（查数 / 报告 / 问答）
 *
 * 路径前缀由 main.ts 的 setGlobalPrefix('api') 提供，对外是 /api/biz/ai/*。
 *
 * 为什么用 @Public() + BizAuthGuard 这套组合，而不是 @Roles()：
 *   本系统的账号体系分「平台角色」和「业务角色」两套，AI 的权限判定必须走业务侧
 *   的 permissionCodes + dataScope（BizAuthContext）。@Public() 只是跳过全局的旧 JWT 守卫，
 *   真正的鉴权由 BizAuthGuard 完成，未登录仍然拿不到 request.bizAuth、会直接 401。
 *
 * 为什么没有 SSE：
 *   规则主路的查询通常在百毫秒级返回，流式只会增加连接占用与前端复杂度；
 *   2C2G 上一条长连接的开销比一次快查询更贵。
 */
@ApiTags('Biz - AI assistant')
@ApiBearerAuth()
@Controller('biz/ai')
@Public()
@UseGuards(BizAuthGuard)
export class AiController {
  constructor(private readonly service: AiService) {}

  @Post('chat')
  @ApiOperation({ summary: '自然语言查数（意图匹配 → 预置 SQL → 图表 + 文字）' })
  chat(@BizAuthUser() auth: BizAuthContext, @Body() dto: AiChatDto) {
    return this.service.chat(auth, dto);
  }

  @Post('report')
  @ApiOperation({ summary: '按意图生成报告（前端功能清单点选用）' })
  report(@BizAuthUser() auth: BizAuthContext, @Body() dto: AiReportDto) {
    return this.service.report(auth, dto);
  }

  @Get('intents')
  @ApiOperation({ summary: '当前账号可用的功能清单（无权限的不会返回）' })
  intents(@BizAuthUser() auth: BizAuthContext) {
    return this.service.intents(auth);
  }

  @Get('import-types')
  @ApiOperation({ summary: '批量导入类型清单（独立导入权限 + 模块写权限双闸过滤）' })
  importTypes(@BizAuthUser() auth: BizAuthContext) {
    return this.service.importTypes(auth);
  }

  @Get('actions')
  @ApiOperation({ summary: 'Agent 动作清单（按账号权限过滤的写操作）' })
  actions(@BizAuthUser() auth: BizAuthContext) {
    return this.service.actions(auth);
  }

  @Post('feedback')
  @ApiOperation({ summary: '对一次查询结果反馈（有用/没用）' })
  feedback(@BizAuthUser() auth: BizAuthContext, @Body() dto: AiFeedbackDto) {
    return this.service.feedback(auth, dto);
  }

  @Get('status')
  @ApiOperation({ summary: '组件自检（仅超管）：只读库/本地库/LLM/并发/意图' })
  status(@BizAuthUser() auth: BizAuthContext) {
    return this.service.status(auth);
  }

  @Get('events')
  @ApiOperation({ summary: '最近问答审计（仅超管）' })
  events(@BizAuthUser() auth: BizAuthContext, @Query() query: AiRecentQueryDto) {
    return this.service.recent(auth, query.limit ?? 20);
  }

  @Get('insights')
  @ApiOperation({ summary: '运营洞察（仅超管）：未命中问句、错误分布、规则/模型占比' })
  insights(@BizAuthUser() auth: BizAuthContext, @Query('days') days?: string) {
    return this.service.insights(auth, Number(days) || 30);
  }

  // ---------------------------- 知识库（RAG） ----------------------------

  @Get('knowledge/sources')
  @ApiOperation({ summary: '知识库来源清单（仅超管）' })
  knowledgeSources(@BizAuthUser() auth: BizAuthContext) {
    return this.service.knowledgeSources(auth);
  }

  /**
   * 入库：.md / .txt / .xlsx，切块后整体替换同名来源（幂等，重复上传不会重复累积）。
   * 用 memoryStorage 而不是落盘：文件上限 10MB，直接进内存解析，避免容器里留垃圾文件。
   */
  @Post('knowledge/upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  @ApiOperation({ summary: '上传知识库文件并入库（仅超管）' })
  knowledgeUpload(@BizAuthUser() auth: BizAuthContext, @UploadedFile() file: Express.Multer.File) {
    return this.service.knowledgeUpload(auth, file);
  }

  @Delete('knowledge/sources')
  @ApiOperation({ summary: '删除一个知识库来源及其全部片段（仅超管）' })
  knowledgeDelete(@BizAuthUser() auth: BizAuthContext, @Query('sourcePath') sourcePath: string) {
    return this.service.knowledgeDelete(auth, sourcePath);
  }
}
