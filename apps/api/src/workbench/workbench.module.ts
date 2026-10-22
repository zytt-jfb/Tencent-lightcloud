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
import { BizUserPreferenceEntity } from './biz-user-preference.entity';

/**
 * 工作台模块：以聚合为主，不重写各模块统计口径。
 * 依赖的 5 个模块都以 service 形式导出，待办数字全部来自它们已有的口径。
 *
 * 唯一自有存储：biz_user_preferences（迁移 048），
 * 存放「每人一份」的界面偏好（当前是待办类别选择），不影响任何授权判断。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([BizOperationLogEntity, BizUserPreferenceEntity]),
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
