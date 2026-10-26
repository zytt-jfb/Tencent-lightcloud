/**
 * Agent 动作工具清单（声明式）
 *
 * 目标：把「该账号权限内的可执行工作」变成助手能列出来、能引导完成的事。
 *
 * 三条硬规则：
 *   1. **写操作绝不由模型直接执行**。模型只负责选动作、抽参数，真正落库要么由用户
 *      点确认后前端调既有接口，要么由后端在拿到明确 id 后执行 —— 两种都不允许
 *      "模型说一句话就把数据改了"。
 *   2. **清单按权限过滤**。没有对应权限的动作不出现在清单里，也不进模型 prompt。
 *   3. **复用既有接口**。每个动作都指向已经存在的业务端点，AI 层不重写任何业务逻辑
 *      （权限、数据范围、事务、审计都还在原处）。
 *
 * 关于 resolve：
 *   大部分写端点的路径里带 `:id`（UUID），而用户嘴里说的是「合同编号」「成本单号」。
 *   所以这些动作标了 resolve，表示**执行前必须先按业务键查出 id**。
 *   定位器尚未实现前，前端只能把它们显示为"需在对应页面操作"，不能假装能一键完成。
 */

export type AgentActionGroup = '合同' | '成本' | '离线完工' | '后评估' | '公告';

/** 需要先解析出记录 id 的定位器类型 */
export type AgentResolverKind = 'contract' | 'cost' | 'completion' | 'assessment';

export interface AgentActionSpec {
  key: string;
  name: string;
  group: AgentActionGroup;
  /** 执行该动作需要的权限点（与既有端点上的 @BizPermissions 一致） */
  permission: string;
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** 既有端点路径，`{id}` 由定位器填充 */
  endpoint: string;
  /** 需要先定位记录时填；null/未填表示路径里没有 id */
  resolve?: { kind: AgentResolverKind; by: string; hint: string };
  /** 需要用户逐项提供的参数（除定位键之外） */
  inputs?: Array<{ name: string; label: string; required?: boolean; hint?: string }>;
  /** 待确认文案：`{name}` 等占位由定位结果填充 */
  confirm: string;
  /** 危险动作（不可撤销）——前端必须二次确认并标红 */
  danger?: boolean;
}

/**
 * 首批清单：只覆盖「日常审批/流转」这条主线，不做全量。
 *
 * 为什么不一次接完 149 个写端点：
 *   · 其中相当一部分是批量/维护类（batch-update、pending-maintenance 行维护），
 *     参数结构复杂，用自然语言描述反而比点页面更麻烦；
 *   · 每个动作都需要定位器 + 确认流程 + 回滚说明，接得越多，出错面越大。
 *   先把审批主线打通、验证体验，再按使用频率扩。
 */
export const AGENT_ACTIONS: readonly AgentActionSpec[] = [
  // ---------------------------- 合同 ----------------------------
  {
    key: 'contract.activate',
    name: '合同生效',
    group: '合同',
    permission: 'operation.contract.update',
    method: 'POST',
    endpoint: '/biz/contracts/{id}/activate',
    resolve: { kind: 'contract', by: '合同编号', hint: '例如「把合同 HT-2026-001 生效」' },
    confirm: '合同「{label}」将被置为生效状态。',
  },
  {
    key: 'contract.void',
    name: '合同作废',
    group: '合同',
    permission: 'operation.contract.void',
    method: 'POST',
    endpoint: '/biz/contracts/{id}/void',
    resolve: { kind: 'contract', by: '合同编号', hint: '例如「作废合同 HT-2026-001」' },
    confirm: '合同「{label}」将被作废，作废后可通过「恢复」找回。',
    danger: true,
  },

  // ---------------------------- 成本 ----------------------------
  {
    key: 'cost.submit',
    name: '成本单提交',
    group: '成本',
    permission: 'operation.cost.submit',
    method: 'POST',
    endpoint: '/biz/costs/{id}/submit',
    resolve: { kind: 'cost', by: '成本单号', hint: '提交后进入审批流，可撤回' },
    confirm: '成本单「{label}」将提交审批。',
  },
  {
    key: 'cost.approve',
    name: '成本单审批通过',
    group: '成本',
    permission: 'operation.cost.approve',
    method: 'POST',
    endpoint: '/biz/costs/{id}/approve',
    resolve: { kind: 'cost', by: '成本单号', hint: '审批通过后不可再由提交人修改' },
    confirm: '成本单「{label}」将被审批通过。',
  },
  {
    key: 'cost.reject',
    name: '成本单驳回',
    group: '成本',
    permission: 'operation.cost.reject',
    method: 'POST',
    endpoint: '/biz/costs/{id}/reject',
    resolve: { kind: 'cost', by: '成本单号', hint: '驳回需要填写原因' },
    inputs: [{ name: 'reason', label: '驳回原因', required: true }],
    confirm: '成本单「{label}」将被驳回，原因：{reason}。',
  },

  // ---------------------------- 离线完工 ----------------------------
  {
    key: 'completion.approve',
    name: '离线完工审批通过',
    group: '离线完工',
    permission: 'operation.completion.approve',
    method: 'POST',
    endpoint: '/biz/offline-completions/{id}/approve',
    resolve: { kind: 'completion', by: '完工单号', hint: '审批通过后计入完工额' },
    confirm: '离线完工单「{label}」将被审批通过。',
  },

  // ---------------------------- 后评估 ----------------------------
  {
    key: 'assessment.submit',
    name: '后评估填报提交',
    group: '后评估',
    permission: 'assessment.entry.submit',
    method: 'POST',
    endpoint: '/biz/assessment/entries/{id}/submit',
    resolve: { kind: 'assessment', by: '项目名称', hint: '提交后进入审核，可撤回' },
    confirm: '后评估填报「{label}」将提交审核。',
  },

  // ---------------------------- 公告（无 id，可直接执行） ----------------------------
  {
    key: 'announcement.create',
    name: '发布公告',
    group: '公告',
    permission: 'operation.announcement.create',
    method: 'POST',
    endpoint: '/biz/announcements',
    inputs: [
      { name: 'title', label: '公告标题', required: true },
      { name: 'content', label: '公告内容', required: true },
    ],
    confirm: '将新建公告「{title}」。注意：这里只创建草稿，发布仍需在公告页面点「发布」。',
  },
];

/** 按用途分组的展示信息（前端渲染清单用） */
export const AGENT_ACTION_GROUPS: readonly AgentActionGroup[] = ['合同', '成本', '离线完工', '后评估', '公告'];
