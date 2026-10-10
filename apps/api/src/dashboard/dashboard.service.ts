import { Injectable } from '@nestjs/common';
import type {
  AdminBusinessSummaryItem,
  AdminBusinessSummaryResponse,
  DashboardStats,
  FactAggregateResponse,
} from '@biz-reporting/shared-types';
import { V3_METRIC_SOURCE_MANIFEST } from '@biz-reporting/shared-types';
import { FactsService } from '../facts/facts.service';

const SYSTEM_ACTOR = { userId: 0, role: 'system_admin', cityId: null };

@Injectable()
export class DashboardService {
  constructor(private readonly facts: FactsService) {}

  async getStats(year: number, month: number): Promise<DashboardStats> {
    const aggregate = await this.facts.aggregate({ year, month }, SYSTEM_ACTOR, true);
    return {
      cityCount: aggregate.cities?.length ?? 0,
      contractCount: aggregate.items.length,
      completionAmount: aggregate.totals.completionAmount,
      acceptanceAmount: aggregate.totals.acceptanceAmount,
      invoiceAmount: aggregate.totals.invoiceAmount,
      orderAmount: aggregate.totals.orderAmount,
      actualCost: aggregate.totals.actualCost,
      grossProfit: aggregate.totals.grossProfit,
      actualNetProfit: aggregate.totals.actualNetProfit,
      formulaVersion: aggregate.formulaVersion,
    };
  }

  async getBusinessSummary(year: number): Promise<AdminBusinessSummaryResponse> {
    const aggregate = await this.facts.aggregate({ year }, SYSTEM_ACTOR, true);
    const items = (aggregate.cities ?? []).map((city): AdminBusinessSummaryItem => {
      const totals = city.totals;
      const costRate = this.ratio(totals.actualCost, totals.completionAmount);
      const costIncomeRate = this.ratio(totals.actualCost, totals.grossProfit);
      const netProfitRate = this.ratio(totals.actualNetProfit, totals.completionAmount);
      return {
        cityId: city.cityId,
        cityName: city.cityName,
        dataStatus: city.dataMonthCount === 0 ? 'empty' : city.dataMonthCount >= 12 ? 'current' : 'partial',
        completionTotal: totals.completionAmount,
        acceptanceTotal: totals.acceptanceAmount,
        invoiceTotal: totals.invoiceAmount,
        orderTotal: totals.orderAmount,
        orderGrossProfit: totals.grossProfit,
        costTotal: totals.actualCost,
        costRate,
        costIncomeRate,
        netProfit: totals.actualNetProfit,
        netProfitRate,
        submittedMonthCount: city.dataMonthCount,
        contractCount: city.contractCount,
      };
    });

    return {
      year,
      formulaVersion: aggregate.formulaVersion,
      dataSources: V3_METRIC_SOURCE_MANIFEST.dashboard,
      items,
      totals: this.calculateTotals(items, aggregate),
    };
  }

  private calculateTotals(items: AdminBusinessSummaryItem[], aggregate: FactAggregateResponse): AdminBusinessSummaryResponse['totals'] {
    const totals = aggregate.totals;
    return {
      completionTotal: totals.completionAmount,
      acceptanceTotal: totals.acceptanceAmount,
      invoiceTotal: totals.invoiceAmount,
      orderTotal: totals.orderAmount,
      orderGrossProfit: totals.grossProfit,
      costTotal: totals.actualCost,
      netProfit: totals.actualNetProfit,
      costRate: this.ratio(totals.actualCost, totals.completionAmount),
      costIncomeRate: this.ratio(totals.actualCost, totals.grossProfit),
      netProfitRate: this.ratio(totals.actualNetProfit, totals.completionAmount),
      cityCount: items.length,
      submittedMonthCount: items.reduce((sum, item) => sum + item.submittedMonthCount, 0),
      contractCount: items.reduce((sum, item) => sum + item.contractCount, 0),
    };
  }

  private ratio(numerator: number, denominator: number): number {
    return denominator === 0 ? 0 : numerator / denominator;
  }
}
