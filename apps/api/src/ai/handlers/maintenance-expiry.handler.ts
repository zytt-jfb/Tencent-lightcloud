import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { BizPermissionCode } from '@biz-reporting/shared-types';
import type { BizAuthContext } from '../../rbac/rbac.service';
import { MaintenanceOverviewService, type MaintenanceReminder } from '../../maintenance/maintenance-overview.service';
import type { IntentColumnSpec } from '../intents/intent.types';

/**
 * 证照 / 保险到期清单（人员 · 车辆 · 油机）
 *
 * 为什么不用 SQL 写这个工具：
 *   三个到期字段全是 VARCHAR，生产库里混着「无」「长期」「2027-14-01」这类脏值。
 *   在 SQL 里做字符串比较会把它们当成零日期，直接算成"已过期"——
 *   工作台那一侧就是为了这个原因才把判定放在应用层（parseLooseDate）。
 *   这里复用 MaintenanceOverviewService.build()，与工作台/到期台账**同一份口径**，
 *   不重写判定，避免出现「AI 说 42 条、页面说 39 条」这种对不上的情况。
 *
 * 权限：
 *   人员类看 maintenance.personnel.enter，车辆/油机看 maintenance.asset.enter。
 *   只持有一类权限时，即便问「全部」，也只返回有权限的那一类 —— 不报错，但绝不越权。
 *   指定的类别没有权限则明确 403，告诉用户缺哪个权限，而不是返回一个空表让人以为没数据。
 */

/** 单次最多返回多少行（前端表格 + 消息气泡，再多就没人看了） */
const MAX_ROWS = 200;

export interface HandlerResult {
  chart: null;
  table: { columns: IntentColumnSpec[]; rows: Array<Record<string, unknown>> };
  summary: string;
  truncated: boolean;
  rowCount: number;
  /** 范围描述：带上类别，否则前端导出的文件名分不清是人员还是车辆 */
  scopeLabel: string;
}

type AssetKind = 'personnel' | 'vehicles' | 'generators';

const COLUMNS: IntentColumnSpec[] = [
  { key: 'category', label: '类别' },
  { key: 'name', label: '名称' },
  { key: 'item', label: '到期项' },
  { key: 'date', label: '到期日', kind: 'date' },
  { key: 'status', label: '状态' },
  { key: 'days', label: '剩余天数', kind: 'number' },
  { key: 'region', label: '所属组织' },
];

const KIND_LABEL: Record<AssetKind, string> = { personnel: '人员', vehicles: '车辆', generators: '油机' };

@Injectable()
export class MaintenanceExpiryHandler {
  private readonly logger = new Logger(MaintenanceExpiryHandler.name);

  constructor(private readonly overview: MaintenanceOverviewService) {}

  async run(
    auth: BizAuthContext,
    params: Record<string, string | number | null>,
    options: { overrideCity?: string | null } = {},
  ): Promise<HandlerResult> {
    // 到期清单走的是业务 service 的固定范围，没有地市下钻能力。
    // 问句里出现地市名时必须明说做不到 —— 静默返回全部授权地市是"答案与问句不符"，
    // 用户会以为看的是济南的，实际是全省。
    if (options.overrideCity) {
      throw new BadRequestException(
        `到期清单不支持按「${options.overrideCity}」下钻，请到「维护管理 → 到期台账」按地市筛选`,
      );
    }

    const canPersonnel = auth.isSuperAdmin || auth.permissionCodes.has(BizPermissionCode.MAINTENANCE_PERSONNEL_ENTER);
    const canAsset = auth.isSuperAdmin || auth.permissionCodes.has(BizPermissionCode.MAINTENANCE_ASSET_ENTER);

    const requested = (params.kind as AssetKind | 'all' | null) ?? 'all';
    const windowDays = clampWindow(params.windowDays);

    // 指定类别时先校验权限：缺权限要明说，不能静默过滤成空表
    if (requested === 'personnel' && !canPersonnel) {
      throw new ForbiddenException('当前账号没有人员台账的查看权限（需要 maintenance.personnel.enter）');
    }
    if ((requested === 'vehicles' || requested === 'generators') && !canAsset) {
      throw new ForbiddenException('当前账号没有资产台账的查看权限（需要 maintenance.asset.enter）');
    }
    if (!canPersonnel && !canAsset) {
      throw new ForbiddenException('当前账号没有维护台账的查看权限');
    }

    const allowedKinds = new Set<AssetKind>();
    if (canPersonnel) allowedKinds.add('personnel');
    if (canAsset) {
      allowedKinds.add('vehicles');
      allowedKinds.add('generators');
    }

    const wanted: AssetKind[] = requested === 'all' ? [...allowedKinds] : [requested as AssetKind];

    // build() 内部按账号数据范围（省/市/区县）过滤；这里把类别也传进去，
    // 只问车辆时不白扫人员与油机（每类都是一次全表扫 + 应用层日期解析）
    const overview = await this.overview.build(windowDays, auth, wanted);
    const scoped = overview.reminders.filter((item) => wanted.includes(item.kind as AssetKind));

    const expired = scoped.filter((item) => !item.invalidDate && (item.days ?? 0) < 0).length;
    const dueSoon = scoped.filter((item) => !item.invalidDate && (item.days ?? 0) >= 0).length;
    const anomaly = scoped.filter((item) => item.invalidDate).length;

    const rows = scoped.slice(0, MAX_ROWS).map((item) => this.toRow(item));

    return {
      chart: null,
      table: { columns: COLUMNS, rows },
      summary: this.buildSummary({ requested, wanted, windowDays, total: scoped.length, expired, dueSoon, anomaly, top: scoped[0] }),
      truncated: scoped.length > MAX_ROWS,
      rowCount: scoped.length,
      scopeLabel: `${wanted.map((kind) => KIND_LABEL[kind]).join('+')} · 本账号范围`,
    };
  }

  private toRow(item: MaintenanceReminder): Record<string, unknown> {
    return {
      category: item.category,
      name: item.name,
      item: item.title,
      // 日期异常行保留原始文本，让用户一眼看出是「无」还是「2027-14-01」，而不是显示空白
      date: item.date,
      status: item.invalidDate ? '日期异常' : (item.days ?? 0) < 0 ? '已过期' : '即将到期',
      days: item.days,
      region: item.region,
    };
  }

  private buildSummary(input: {
    requested: string;
    wanted: AssetKind[];
    windowDays: number;
    total: number;
    expired: number;
    dueSoon: number;
    anomaly: number;
    top?: MaintenanceReminder;
  }): string {
    const scopeText = input.requested === 'all'
      ? input.wanted.map((kind) => KIND_LABEL[kind]).join('、')
      : KIND_LABEL[input.requested as AssetKind] ?? input.requested;

    if (input.total === 0) {
      return `${scopeText}在未来 ${input.windowDays} 天内没有到期的证照或保险记录。`;
    }

    const parts = [
      `${scopeText}在未来 ${input.windowDays} 天内共有 ${input.total} 条到期记录`,
      `已过期 ${input.expired} 条、即将到期 ${input.dueSoon} 条`,
    ];
    if (input.anomaly > 0) parts.push(`日期无法解析 ${input.anomaly} 条（需人工修正）`);

    const top = input.top;
    const head = top && !top.invalidDate && top.days !== null
      ? `最紧急的是 ${top.name} 的「${top.title}」（${top.date}，${top.days < 0 ? `已过期 ${Math.abs(top.days)} 天` : `还有 ${top.days} 天`}）。`
      : '';

    return `${parts.join('，')}。${head}`;
  }
}

/** 窗口天数：默认 30（与工作台一致），夹在 1~3650 之间 */
function clampWindow(value: string | number | null | undefined): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return 30;
  return Math.min(3650, Math.max(1, parsed));
}
