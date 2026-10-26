import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnnualPackageEntity } from '../packages/annual-package.entity';
import { MonthSnapshotEntity } from '../packages/month-snapshot.entity';
import { ImportJobEntity } from '../ws6/import-job.entity';
import { CityEntity } from '../main-data/city.entity';
import { MaintenanceModule } from '../maintenance/maintenance.module';
import { AiReadonlyController } from './ai-readonly.controller';
import { AiReadonlyService } from './ai-readonly.service';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { ScopeGuardService } from './auth/scope-guard.service';
import { AI_SEMAPHORE_TOKEN, Semaphore, parseConcurrency } from './concurrency/semaphore';
import { FlywheelService } from './flywheel/flywheel.service';
import { MaintenanceExpiryHandler } from './handlers/maintenance-expiry.handler';
import { IntentRouterService } from './llm/intent-router.service';
import { IntentRegistry } from './intents/intent-registry';
import { LlmClientService } from './llm/llm-client.service';
import { RagService } from './rag/rag.service';
import { ReportService } from './report/report.service';
import { ReadonlyDataSource } from './sql/readonly-datasource';
import { SqlAgentService } from './sql/sql-agent.service';
import { SqliteStore } from './sql/sqlite.store';

/**
 * AI 模块（内部专用：查数 / 报告 / 问答）
 *
 * 组成：
 *   · AiReadonlyController —— 历史遗留的「白名单只读工具」，仅超管，保留不动
 *   · AiController —— 新的规则主路（chat / report / intents / feedback / status）
 *
 * 所有基座 provider 都是「懒初始化」或「无 IO 构造」的：
 *   SqliteStore（本地库）、ReadonlyDataSource（只读 MySQL 池）、Semaphore（并发闸）、
 *   IntentRegistry（启动期静态校验）、LLM（默认禁用为 NullLlmProvider）。
 *   任何一环没配好都只影响 AI 接口的返回，不会让 API 启动失败 ——
 *   AI 是附加能力，不能因为它把主业务一起拖死。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([AnnualPackageEntity, MonthSnapshotEntity, ImportJobEntity, CityEntity]),
    // 到期清单这类工具必须复用维护模块的判定口径（VARCHAR 脏日期只能在应用层解析），
    // 所以 AI 模块依赖 MaintenanceModule。单向依赖：维护模块不认识 AI。
    MaintenanceModule,
  ],
  controllers: [AiReadonlyController, AiController],
  providers: [
    AiReadonlyService,
    SqliteStore,
    ReadonlyDataSource,
    IntentRegistry,
    ScopeGuardService,
    SqlAgentService,
    ReportService,
    FlywheelService,
    RagService,
    LlmClientService,
    IntentRouterService,
    MaintenanceExpiryHandler,
    AiService,
    {
      // 并发上限来自 MAX_CONCURRENCY；用工厂 provider 而不是在 Semaphore 内部读 env，
      // 这样 Semaphore 本身是纯类，单测可以直接 new Semaphore(2) 无副作用。
      provide: AI_SEMAPHORE_TOKEN,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new Semaphore(parseConcurrency(config.get<string>('MAX_CONCURRENCY'))),
    },
  ],
  exports: [SqliteStore, ReadonlyDataSource, AI_SEMAPHORE_TOKEN, RagService],
})
export class AiModule {}
