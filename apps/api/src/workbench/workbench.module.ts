import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkbenchController } from './workbench.controller';
import { WorkbenchService } from './workbench.service';
import { MaintenanceModule } from '../maintenance/maintenance.module';
import { BizAssessmentsModule } from '../biz-assessments/biz-assessments.module';
import { BizCostsModule } from '../biz-costs/biz-costs.module';
import { BizCompletionsModule } from '../biz-completions/biz-completions.module';
import { BizCommunicationsModule } from '../biz-communications/biz-communications.module';
import { BizOperationLogEntity } from '../operation-logs/biz-operation-log.entity';

/**
 * 工作台模块：只做聚合，不落新表、不加迁移。
 * 依赖的 5 个模块都以 service 形式导出，待办数字全部来自它们已有的口径。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([BizOperationLogEntity]),
    MaintenanceModule,
    BizAssessmentsModule,
    BizCostsModule,
    BizCompletionsModule,
    BizCommunicationsModule,
  ],
  controllers: [WorkbenchController],
  providers: [WorkbenchService],
})
export class WorkbenchModule {}
