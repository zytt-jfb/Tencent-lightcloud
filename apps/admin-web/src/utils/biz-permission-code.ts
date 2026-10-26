/**
 * 权限码常量（前端唯一入口）。
 *
 * 为什么要有这一层：权限码原本在前端 20+ 处写字面量（'operation.cost.read' 这种），
 * 与后端 BizPermissionCode 没有任何编译期关联 —— 拼错一个字母不会报错，
 * 运行时只表现成「入口莫名其妙不显示」或「按钮点下去 403」，极难排查。
 * 这里从 @biz-reporting/shared-types 原样再导出，让前后端共用同一份定义：
 * 后端改了码名，前端立刻编译失败，而不是线上才发现的权限漏洞。
 *
 * 用法：
 *   import { BizPermissionCode } from '@/utils/biz-permission-code';
 *   const canRead = useBizPermission(BizPermissionCode.OPERATION_COST_READ);
 */
export { BizPermissionCode } from '@biz-reporting/shared-types';
export type { BizPermissionCodeValue } from '@biz-reporting/shared-types';

/**
 * 门户域：模块入口判定的唯一维度。
 * 前端不再自己按 pathname 猜「该模块要不要 portal.*.enter」，
 * 而是拿后端 /biz/auth/me 返回的 modules 直接比对。
 */
export { PortalDomain } from '@biz-reporting/shared-types';
export type { PortalDomainValue } from '@biz-reporting/shared-types';
