import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BizAuthContext } from '../rbac/rbac.service';
import { MaintenanceOverviewService } from '../maintenance/maintenance-overview.service';
import { BizAssessmentsEntryService } from '../biz-assessments/biz-assessments-entry.service';
import { BizCostService } from '../biz-costs/biz-cost.service';
import { BizOfflineCompletionService } from '../biz-completions/biz-offline-completion.service';
import { BizCommunicationService } from '../biz-communications/biz-communication.service';
import { BizOperationLogEntity } from '../operation-logs/biz-operation-log.entity';
import { BizUserPreferenceEntity } from './biz-user-preference.entity';

/** 与维护总览默认的「临期窗口」保持一致，否则工作台说 30 天、台账说 60 天 */
const WORKBENCH_WINDOW_DAYS = 30;
const ACTIVITY_LIMIT = 5;

/** 待办展示偏好的存储键与取值上限；可选项必须与 load() 里实际产出的 todo.key 一致 */
const TODO_PREF_KEY = 'workbench.todo_keys';
const TODO_PREF_MAX = 4;
const TODO_KEYS = new Set([
  'maintenance-expiry',
  'assessment-entry-draft',
  'cost-draft',
  'completion-draft',
  'message-unread',
]);

export type WorkbenchTodoLevel = 'danger' | 'warning' | 'info';

export interface WorkbenchTodoDetail {
  label: string;
  value: number;
}

export interface WorkbenchTodo {
  key: string;
  label: string;
  /** 一句话说明，例如「30 天内到期 88 条」 */
  description: string;
  /** null = 这一项算不出来（接口异常/无数据范围）；前端显示「—」，不能显示 0 */
  count: number | null;
  level: WorkbenchTodoLevel;
  /** 点击跳转地址 */
  link: string;
  detail: WorkbenchTodoDetail[];
}

export interface WorkbenchActivity {
  id: string;
  actionType: string;
  /** 中文动作名；未收录的动作原样显示 actionType，便于发现新动作 */
  label: string;
  targetType: string;
  resultStatus: string;
  createdAt: string;
}

export interface WorkbenchResult {
  today: string;
  windowDays: number;
  todos: WorkbenchTodo[];
  activities: WorkbenchActivity[];
}

/** 操作日志里的 action_type 是自由字符串，这里只做展示层翻译，不参与任何业务判断 */
const ACTION_LABEL: Record<string, string> = {
  'auth.login.success': '登录系统',
  'user.change_own_password': '修改密码',
  'cost.create': '保存成本草稿',
  'cost.update': '修改成本',
  'cost.submit': '提交成本',
  'cost.withdraw': '撤回成本',
  'cost.approve': '审批通过成本',
  'cost.reject': '退回成本',
  'cost.void': '作废成本',
  'cost.restore': '恢复成本',
  'offline_completion.create': '新建线下完工',
  'offline_completion.update': '修改线下完工',
  'offline_completion.submit': '提交线下完工',
  'offline_completion.withdraw': '撤回线下完工',
  'offline_completion.approve': '审批通过完工',
  'offline_completion.reject': '退回完工',
  'offline_completion.void': '作废完工',
  'offline_completion.restore': '恢复完工',
  'assessment.entry.create': '新建后评估填报',
  'assessment.entry.update': '修改后评估填报',
  'assessment.entry.submit': '提交后评估填报',
  'assessment.entry.withdraw': '撤回后评估填报',
  'assessment.entry.return': '退回后评估填报',
  'assessment.entry.void': '作废后评估填报',
  'assessment.entry.delete': '删除后评估填报',
  'assessment.import.commit': '导入后评估数据',
  'assessment.import.delete': '删除导入批次',
  'announcement.create': '创建公告',
  'announcement.publish': '发布公告',
  'announcement.withdraw': '撤回公告',
};

/** 上海时区的今天（YYYY-MM-DD）；服务端容器时区不一定是东八区，不能直接 toISOString */
function shanghaiToday(): string {
  const shifted = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

/**
 * 工作台聚合服务
 *
 * 设计约束：
 * 1. 不重写任何统计口径 —— 待办数字全部来自各模块已有的 service 方法。
 *    维护复用 MaintenanceOverviewService.build()（与总览/台账同源），
 *    成本/完工/后评估复用各自 list() 的数据范围收敛，消息复用 listInbox() 的未读判断。
 * 2. 按权限决定算哪几项 —— 没权限的模块连查询都不发，也不返回空卡片。
 * 3. 单项失败不影响整体 —— 每项独立降级为 count=null，前端显示「—」。
 *    绝不能把「算不出来」渲染成 0，那会让人以为待办已经清空。
 */
@Injectable()
export class WorkbenchService {
  constructor(
    private readonly maintenance: MaintenanceOverviewService,
    private readonly assessments: BizAssessmentsEntryService,
    private readonly costs: BizCostService,
    private readonly completions: BizOfflineCompletionService,
    private readonly communications: BizCommunicationService,
    @InjectRepository(BizOperationLogEntity) private readonly logRepo: Repository<BizOperationLogEntity>,
    @InjectRepository(BizUserPreferenceEntity) private readonly prefRepo: Repository<BizUserPreferenceEntity>,
  ) {}

  /** 把异常收敛成 null，避免一个模块挂掉让整页空白 */
  private async safe<T>(task: Promise<T>): Promise<T | null> {
    try {
      return await task;
    } catch {
      return null;
    }
  }

  async load(auth: BizAuthContext): Promise<WorkbenchResult> {
    const allow = (code: string) => auth.isSuperAdmin || auth.permissionCodes.has(code);
    const allowAny = (...codes: string[]) => auth.isSuperAdmin || codes.some((code) => auth.permissionCodes.has(code));

    const tasks: Array<Promise<WorkbenchTodo>> = [];
    // 总览/台账用「人员进入 或 资产进入」任一放行，工作台同口径
    if (allowAny('maintenance.personnel.enter', 'maintenance.asset.enter')) tasks.push(this.maintenanceTodo(auth));
    if (allow('assessment.entry.read')) tasks.push(this.assessmentTodo(auth));
    if (allow('operation.cost.read')) tasks.push(this.costTodo(auth));
    if (allow('operation.completion.read')) tasks.push(this.completionTodo(auth));
    if (allow('operation.message.read')) tasks.push(this.messageTodo(auth));

    const [todos, activities] = await Promise.all([
      Promise.all(tasks),
      this.safe(this.recentActivities(auth)),
    ]);

    return {
      today: shanghaiToday(),
      windowDays: WORKBENCH_WINDOW_DAYS,
      todos,
      activities: activities ?? [],
    };
  }

  // ================= 用户偏好（每人一份，跨设备） =================

  /**
   * 读取当前用户的工作台待办偏好。
   * 返回 null = 从未设置过 → 前端按默认（后端顺序前 4 个）展示。
   * 存储值里混入未知 key（类别下线/改名）时静默过滤，不让一条脏数据卡住整页。
   */
  async getTodoPreference(auth: BizAuthContext): Promise<{ todoKeys: string[] | null }> {
    const row = await this.prefRepo.findOneBy({ userId: auth.userId, prefKey: TODO_PREF_KEY });
    if (!row) return { todoKeys: null };
    try {
      const parsed: unknown = JSON.parse(row.prefValue);
      if (!Array.isArray(parsed)) return { todoKeys: null };
      return {
        todoKeys: parsed
          .filter((key): key is string => typeof key === 'string' && TODO_KEYS.has(key))
          .slice(0, TODO_PREF_MAX),
      };
    } catch {
      return { todoKeys: null };
    }
  }

  /**
   * 写入偏好。todoKeys = null 表示恢复默认（删行，而不是存空数组，
   * 这样「没设置过」和「一个都不选」在语义上能区分）。
   * 服务端再校验一次：只接受已知类别、去重、最多 4 个——前端限制可以被绕过。
   */
  async setTodoPreference(auth: BizAuthContext, todoKeys: string[] | null): Promise<{ todoKeys: string[] | null }> {
    if (todoKeys === null) {
      await this.prefRepo.delete({ userId: auth.userId, prefKey: TODO_PREF_KEY });
      return { todoKeys: null };
    }
    if (!Array.isArray(todoKeys)) throw new BadRequestException('todoKeys 必须是数组或 null');
    const normalized = [...new Set(todoKeys.filter((key) => typeof key === 'string' && TODO_KEYS.has(key)))]
      .slice(0, TODO_PREF_MAX);
    await this.prefRepo.upsert(
      { userId: auth.userId, prefKey: TODO_PREF_KEY, prefValue: JSON.stringify(normalized) },
      ['userId', 'prefKey'],
    );
    return { todoKeys: normalized };
  }

  /** 证照/保险到期：数字必须与「到期台账」顶部的 4 张卡一致 */
  private async maintenanceTodo(auth: BizAuthContext): Promise<WorkbenchTodo> {
    const overview = await this.safe(this.maintenance.build(WORKBENCH_WINDOW_DAYS, auth));
    if (!overview) {
      return {
        key: 'maintenance-expiry', label: '证照与保险到期', description: '暂时无法统计',
        count: null, level: 'info', link: '/biz/maintenance/expiry', detail: [],
      };
    }
    const { expired, dueSoon, anomaly } = overview.counts;
    const total = expired + dueSoon + anomaly;
    // 数据质量告警：这些记录的地市匹配不上字典，地市账号永远看不到，但需要有人去修
    const unrecognized = (overview.unrecognizedCities ?? []).reduce((sum, item) => sum + item.count, 0);
    const detail = [
      { label: '已过期', value: expired },
      { label: `${overview.windowDays} 天内到期`, value: dueSoon },
      { label: '日期异常', value: anomaly },
    ];
    if (unrecognized > 0) detail.push({ label: '地市无法归属', value: unrecognized });
    return {
      key: 'maintenance-expiry',
      label: '证照与保险到期',
      description: total === 0
        ? `${overview.windowDays} 天内没有到期事项${unrecognized > 0 ? `，但有 ${unrecognized} 条记录地市匹配不上字典` : ''}`
        : `已过期 ${expired} 条 · ${overview.windowDays} 天内到期 ${dueSoon} 条${anomaly > 0 ? ` · 日期异常 ${anomaly} 条` : ''}${unrecognized > 0 ? ` · 地市无法归属 ${unrecognized} 条` : ''}`,
      count: total,
      // 有过期就是红，只有临期/异常是黄，都没有才是灰
      level: expired > 0 ? 'danger' : total > 0 ? 'warning' : 'info',
      link: unrecognized > 0 ? '/biz/maintenance/overview' : '/biz/maintenance/expiry',
      detail,
    };
  }

  /** 后评估线下填报：草稿 + 被退回，都算「我还得动手」 */
  private async assessmentTodo(auth: BizAuthContext): Promise<WorkbenchTodo> {
    const [draft, returned] = await Promise.all([
      this.safe(this.assessments.list(auth, { status: 'draft' })),
      this.safe(this.assessments.list(auth, { status: 'returned' })),
    ]);
    const count = draft === null || returned === null ? null : draft.length + returned.length;
    return {
      key: 'assessment-entry-draft',
      label: '后评估待提交',
      description: count === null
        ? '暂时无法统计'
        : `草稿 ${draft?.length ?? 0} 条 · 被退回 ${returned?.length ?? 0} 条`,
      count,
      level: (returned?.length ?? 0) > 0 ? 'warning' : 'info',
      link: '/biz/engineering/assessment/entry',
      detail: [
        { label: '草稿', value: draft?.length ?? 0 },
        { label: '被退回', value: returned?.length ?? 0 },
      ],
    };
  }

  /** 地市成本：草稿 + 已退回（这两种状态才可编辑/可提交） */
  private async costTodo(auth: BizAuthContext): Promise<WorkbenchTodo> {
    const [draft, rejected] = await Promise.all([
      this.safe(this.costs.list(auth, { status: 'draft', pageSize: 1 })),
      this.safe(this.costs.list(auth, { status: 'rejected', pageSize: 1 })),
    ]);
    // list 现在返回 { items, total, ... }：用 total 计数，pageSize=1 避免为了计数把整表拉回来
    const draftCount = draft?.total ?? null;
    const rejectedCount = rejected?.total ?? null;
    const count = draftCount === null || rejectedCount === null ? null : draftCount + rejectedCount;
    return {
      key: 'cost-draft',
      label: '成本待提交',
      description: count === null
        ? '暂时无法统计'
        : `草稿 ${draftCount ?? 0} 条 · 被退回 ${rejectedCount ?? 0} 条`,
      count,
      level: (rejectedCount ?? 0) > 0 ? 'warning' : 'info',
      link: '/biz/costs',
      detail: [
        { label: '草稿', value: draftCount ?? 0 },
        { label: '被退回', value: rejectedCount ?? 0 },
      ],
    };
  }

  /** 线下完工：同成本口径 */
  private async completionTodo(auth: BizAuthContext): Promise<WorkbenchTodo> {
    const [draft, rejected] = await Promise.all([
      this.safe(this.completions.list(auth, { status: 'draft', pageSize: 1 })),
      this.safe(this.completions.list(auth, { status: 'rejected', pageSize: 1 })),
    ]);
    const draftCount = draft?.total ?? null;
    const rejectedCount = rejected?.total ?? null;
    const count = draftCount === null || rejectedCount === null ? null : draftCount + rejectedCount;
    return {
      key: 'completion-draft',
      label: '完工待提交',
      description: count === null
        ? '暂时无法统计'
        : `草稿 ${draftCount ?? 0} 条 · 被退回 ${rejectedCount ?? 0} 条`,
      count,
      level: (rejectedCount ?? 0) > 0 ? 'warning' : 'info',
      link: '/biz/offline-completions',
      detail: [
        { label: '草稿', value: draftCount ?? 0 },
        { label: '被退回', value: rejectedCount ?? 0 },
      ],
    };
  }

  /** 未读消息：直接复用 listInbox 的未读口径，不另写「什么算未读」 */
  private async messageTodo(auth: BizAuthContext): Promise<WorkbenchTodo> {
    const inbox = await this.safe(this.communications.listInbox(auth));
    return {
      key: 'message-unread',
      label: '未读消息',
      description: inbox === null ? '暂时无法统计' : inbox.unreadCount === 0 ? '没有未读消息' : '公告与系统通知',
      count: inbox === null ? null : inbox.unreadCount,
      level: 'info',
      link: '/biz/messages',
      detail: [],
    };
  }

  /**
   * 最近动态：只看自己的操作。
   * 不查别人的日志——工作台是「我的」页面，把别人的审批记录混进来会让人误以为是自己做的。
   */
  private async recentActivities(auth: BizAuthContext): Promise<WorkbenchActivity[]> {
    const logs = await this.logRepo.find({
      where: { operatorUserId: auth.userId },
      order: { createdAt: 'DESC' },
      take: ACTIVITY_LIMIT,
    });
    return logs.map((log) => ({
      id: log.id,
      actionType: log.actionType,
      label: ACTION_LABEL[log.actionType] ?? log.actionType,
      targetType: log.targetType,
      resultStatus: log.resultStatus,
      createdAt: log.createdAt.toISOString(),
    }));
  }
}
