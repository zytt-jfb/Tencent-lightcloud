import { DataSource, IsNull } from 'typeorm';
import { BizContractEntity } from '../contracts/biz-contract.entity';
import { BizContractCityAllocationEntity } from '../contracts/biz-contract-city-allocation.entity';
import { BizOrderRowEntity } from '../orders/biz-order-row.entity';

/** 单个模块快照的载荷：只放首屏需要的东西，列表一律截断到 LIST_LIMIT 条 */
export interface ModuleSnapshotPayload {
  summary: Record<string, unknown>;
  list?: { items: Array<Record<string, unknown>>; total: number };
  charts?: Record<string, unknown>;
  note?: string;
}

export interface ModuleBuilderContext {
  dataSource: DataSource;
  /** 业务日期 YYYY-MM-DD（Asia/Shanghai） */
  asOf: string;
}

export interface ModuleBuilder {
  code: string;
  label: string;
  build(ctx: ModuleBuilderContext): Promise<ModuleSnapshotPayload>;
}

/** 首屏列表固定上限，避免 payload 膨胀 */
export const MODULE_LIST_LIMIT = 50;

const DAY_MS = 24 * 60 * 60 * 1000;

/** 合同概览：合同数/总额/临近到期/已到期 + 最近签订的合同 */
const contractsBuilder: ModuleBuilder = {
  code: 'contracts',
  label: '合同概览',
  async build({ dataSource, asOf }) {
    const contracts = await dataSource.getRepository(BizContractEntity).find({
      where: { deletedAt: IsNull() },
    });
    const allocs = await dataSource.getRepository(BizContractCityAllocationEntity).find({
      where: { status: 'active' },
    });

    const quotaByContract = new Map<string, number>();
    for (const a of allocs) {
      quotaByContract.set(a.contractId, (quotaByContract.get(a.contractId) ?? 0) + Number(a.quotaFen || 0));
    }

    const asOfMs = new Date(`${asOf}T00:00:00+08:00`).getTime();
    const rows = contracts.map((c) => {
      const endDate = c.endDate ? String(c.endDate) : null;
      const endMs = endDate ? new Date(`${endDate}T00:00:00+08:00`).getTime() : null;
      return {
        id: c.id,
        contractNo: c.contractNo,
        contractName: c.contractName,
        provinceId: c.provinceId,
        taxInclusiveAmountFen: Number(c.taxInclusiveAmountFen) || 0,
        status: c.status,
        signedDate: c.signedDate ? String(c.signedDate) : null,
        endDate,
        quotaFen: quotaByContract.get(c.id) ?? 0,
        expired: endMs !== null && endMs < asOfMs,
        expiringIn30Days: endMs !== null && endMs >= asOfMs && endMs - asOfMs <= 30 * DAY_MS,
      };
    });

    rows.sort((a, b) => String(b.signedDate ?? '').localeCompare(String(a.signedDate ?? '')));

    return {
      summary: {
        contractCount: rows.length,
        totalAmountFen: rows.reduce((s, r) => s + r.taxInclusiveAmountFen, 0),
        totalQuotaFen: rows.reduce((s, r) => s + r.quotaFen, 0),
        expiredCount: rows.filter((r) => r.expired).length,
        expiringIn30DaysCount: rows.filter((r) => r.expiringIn30Days).length,
      },
      list: { items: rows.slice(0, MODULE_LIST_LIMIT), total: rows.length },
      note: `按签订日期倒序取前 ${MODULE_LIST_LIMIT} 条`,
    };
  },
};

/** 订单：有效订单数/完工额/毛利 + 近 12 个月趋势 + 最近订单 */
const ordersBuilder: ModuleBuilder = {
  code: 'orders',
  label: '订单管理',
  async build({ dataSource, asOf }) {
    const repo = dataSource.getRepository(BizOrderRowEntity);
    const baseWhere = (qb: ReturnType<typeof repo.createQueryBuilder>) =>
      qb.where('o.isVoid = 0').andWhere('o.isCurrent = 1').andWhere('o.validationStatus = :vs', { vs: 'valid' });

    const agg = await baseWhere(repo.createQueryBuilder('o'))
      .select('COUNT(*)', 'cnt')
      .addSelect('COALESCE(SUM(o.completionAmountFen), 0)', 'completionFen')
      .addSelect('COALESCE(SUM(o.grossProfitFen), 0)', 'grossFen')
      .getRawOne<{ cnt: string; completionFen: string; grossFen: string }>();

    // 以数据中最新业务月份为基准往前推 12 个月。
    // 存量订单可能是历史年份（如库中最新为 2024-10），若按 asOf 推算会得到空趋势。
    const maxRow = await baseWhere(repo.createQueryBuilder('o'))
      .select('MAX(o.businessMonth)', 'maxMonth')
      .getRawOne<{ maxMonth: string | null }>();
    const maxMonth = maxRow?.maxMonth ? String(maxRow.maxMonth).slice(0, 7) : asOf.slice(0, 7);
    const [maxYear, maxMon] = maxMonth.split('-').map(Number);
    const trendStart = new Date(Date.UTC(maxYear, maxMon - 1 - 11, 1));
    const fromMonth = `${trendStart.getUTCFullYear()}-${String(trendStart.getUTCMonth() + 1).padStart(2, '0')}`;
    const trend = await baseWhere(repo.createQueryBuilder('o'))
      .select('SUBSTRING(o.businessMonth, 1, 7)', 'month')
      .addSelect('COALESCE(SUM(o.completionAmountFen), 0)', 'completionFen')
      .andWhere('o.businessMonth >= :fromMonth', { fromMonth })
      .groupBy('SUBSTRING(o.businessMonth, 1, 7)')
      .orderBy('month', 'ASC')
      .getRawMany<{ month: string; completionFen: string }>();

    const latest = await baseWhere(repo.createQueryBuilder('o'))
      .select([
        'o.id',
        'o.businessMonth',
        'o.purchaseOrderNo',
        'o.contractId',
        'o.supplierName',
        'o.completionAmountFen',
        'o.grossProfitFen',
        'o.validationStatus',
      ])
      .orderBy('o.businessMonth', 'DESC')
      .addOrderBy('o.createdAt', 'DESC')
      .take(MODULE_LIST_LIMIT)
      .getMany();

    return {
      summary: {
        validOrderCount: Number(agg?.cnt ?? 0),
        completionFen: Number(agg?.completionFen ?? 0),
        grossProfitFen: Number(agg?.grossFen ?? 0),
      },
      list: {
        items: latest.map((o) => ({
          id: o.id,
          businessMonth: o.businessMonth ?? null,
          purchaseOrderNo: o.purchaseOrderNo ?? null,
          contractId: o.contractId ?? null,
          supplierName: o.supplierName ?? null,
          completionAmountFen: Number(o.completionAmountFen) || 0,
          grossProfitFen: Number(o.grossProfitFen) || 0,
          validationStatus: o.validationStatus,
        })),
        total: Number(agg?.cnt ?? 0),
      },
      charts: { monthlyCompletion: trend.map((t) => ({ month: t.month, completionFen: Number(t.completionFen) || 0 })) },
      note: `近 12 个月趋势 + 最近 ${MODULE_LIST_LIMIT} 条订单`,
    };
  },
};

/** 已注册的模块快照构建器。新增模块只需在此追加一个 builder。 */
export const MODULE_BUILDERS: ModuleBuilder[] = [contractsBuilder, ordersBuilder];

export const MODULE_BUILDER_MAP = new Map(MODULE_BUILDERS.map((b) => [b.code, b]));
