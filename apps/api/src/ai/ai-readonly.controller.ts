import { Body, Controller, Post, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@biz-reporting/shared-types';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AiQueryDto } from './ai-query.dto';
import { AiReadonlyService } from './ai-readonly.service';

@ApiTags('Admin - Readonly assistant')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SYSTEM_ADMIN)
@Controller('admin/ai')
export class AiReadonlyController {
  constructor(private readonly service: AiReadonlyService) {}

  @Post('query')
  @ApiOperation({ summary: 'Run a whitelisted read-only assistant tool' })
  query(@Body() input: AiQueryDto, @Request() _req: Express.Request) {
    return this.service.query(input);
  }
}
