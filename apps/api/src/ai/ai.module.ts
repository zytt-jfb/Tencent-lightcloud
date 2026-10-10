import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnnualPackageEntity } from '../packages/annual-package.entity';
import { MonthSnapshotEntity } from '../packages/month-snapshot.entity';
import { ImportJobEntity } from '../ws6/import-job.entity';
import { AiReadonlyController } from './ai-readonly.controller';
import { AiReadonlyService } from './ai-readonly.service';

@Module({
  imports: [TypeOrmModule.forFeature([AnnualPackageEntity, MonthSnapshotEntity, ImportJobEntity])],
  controllers: [AiReadonlyController],
  providers: [AiReadonlyService],
})
export class AiModule {}
