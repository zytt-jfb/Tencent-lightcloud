import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AppService } from './app.service';
import { Public } from './common/decorators/public.decorator';

@ApiTags('System')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @Public()
  @ApiOperation({ summary: '健康检查 / API 首页' })
  getHealth() {
    return this.appService.getHealth();
  }

  @Get('health/live')
  @Public()
  @ApiOperation({ summary: '进程存活探针' })
  getLiveness() {
    return this.appService.getLiveness();
  }

  @Get('health/ready')
  @Public()
  @ApiOperation({ summary: '数据库与事实源存储就绪探针' })
  getReadiness() {
    return this.appService.getReadiness();
  }
}

