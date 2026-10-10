import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import type {
  MaintenanceListQuery,
  MaintenancePersonnelListResponse,
} from '@biz-reporting/shared-types';
import { MaintenancePersonnelService } from './personnel.service';
import { CreatePersonnelDto, UpdatePersonnelDto } from './personnel.dto';
import { Public } from '../../common/decorators/public.decorator';
import { BizAuthGuard } from '../../biz-auth/biz-auth.guard';

@Controller('biz/maintenance/personnel')
@Public()
@UseGuards(BizAuthGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class MaintenancePersonnelController {
  constructor(private readonly service: MaintenancePersonnelService) {}

  @Get()
  list(@Query() query: MaintenanceListQuery): Promise<MaintenancePersonnelListResponse> {
    return this.service.list(query);
  }

  @Post() create(@Body() dto: CreatePersonnelDto) { return this.service.create(dto); }
  @Patch(':id') update(@Param('id') id: string, @Body() dto: UpdatePersonnelDto) { return this.service.update(id, dto); }
  @Delete(':id') remove(@Param('id') id: string) { return this.service.remove(id); }
}


