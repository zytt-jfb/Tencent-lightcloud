import { Module } from '@nestjs/common';
import { FactsModule } from '../facts/facts.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [FactsModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
