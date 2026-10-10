import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AnnualPackageEntity } from '../packages/annual-package.entity';
import { MonthSnapshotEntity } from '../packages/month-snapshot.entity';
import { ImportJobEntity } from '../ws6/import-job.entity';
import { AiQueryDto } from './ai-query.dto';

@Injectable()
export class AiReadonlyService {
  constructor(
    @InjectRepository(AnnualPackageEntity)
    private readonly packageRepo: Repository<AnnualPackageEntity>,
    @InjectRepository(MonthSnapshotEntity)
    private readonly snapshotRepo: Repository<MonthSnapshotEntity>,
    @InjectRepository(ImportJobEntity)
    private readonly importJobRepo: Repository<ImportJobEntity>,
  ) {}

  async query(input: AiQueryDto) {
    if (input.tool === 'business_summary') return this.businessSummary(input);
    return this.importAnomalies(input);
  }

  private async businessSummary(input: AiQueryDto) {
    const snapshots = await this.snapshotRepo.find({ where: { reportYear: input.year } });
    const scoped = input.cityId === undefined || input.cityId === null
      ? snapshots
      : snapshots.filter((snapshot) => Number(snapshot.cityId) === Number(input.cityId));
    const cityIds = new Set(scoped.map((snapshot) => Number(snapshot.cityId)));
    return {
      tool: input.tool,
      year: input.year,
      cityId: input.cityId ?? null,
      submittedCityCount: cityIds.size,
      submittedMonthCount: scoped.length,
      latestMonth: scoped.reduce((latest, snapshot) => Math.max(latest, Number(snapshot.belongMonth)), 0),
      note: 'Read-only result generated from submitted month snapshots.',
    };
  }

  private async importAnomalies(input: AiQueryDto) {
    const jobs = await this.importJobRepo.find();
    const scoped = input.cityId === undefined || input.cityId === null
      ? jobs
      : jobs.filter((job) => Number(job.cityId) === Number(input.cityId));
    return {
      tool: input.tool,
      year: input.year,
      cityId: input.cityId ?? null,
      pendingCount: scoped.filter((job) => job.status === 'pending').length,
      failedCount: scoped.filter((job) => job.status === 'failed').length,
      completedCount: scoped.filter((job) => job.status === 'completed').length,
      failedJobs: scoped
        .filter((job) => job.status === 'failed')
        .slice(0, 20)
        .map((job) => ({ id: job.id, cityId: job.cityId, fileName: job.sourceFileName, error: job.errorSummaryJson })),
      note: 'Read-only result generated from import jobs; no business data was changed.',
    };
  }
}
