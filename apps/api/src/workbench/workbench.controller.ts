import { BadRequestException, Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { BizAuthGuard } from '../biz-auth/biz-auth.guard';
import { BizAuthUser } from '../biz-auth/biz-auth-user.decorator';
import { BizAuthContext } from '../rbac/rbac.service';
import { WorkbenchService } from './workbench.service';

/**
 * 工作台聚合 API
 *
 * GET /biz/workbench —— 待办 + 最近动态，一次往返拿全。
 *
 * 为什么不在前端并发打 5 个模块接口：那样每次进工作台要发 5～8 个请求，
 * 且权限判定分散在前端；这里由服务端按 permissionCodes 决定算哪几项，
 * 地市算本市、省级算全省（各 service 的数据范围自动生效），前端只负责渲染。
 *
 * 注意：这里刻意不加 @BizPermissions —— 工作台是登录后的落地页，
 * 任何账号都要能打开；看不到任何待办的账号会看到一个只有功能地图的页面，
 * 而不是 403。各项数字的权限在 service 里逐项判断。
 */
@Controller('biz/workbench')
@Public()
@UseGuards(BizAuthGuard)
export class WorkbenchController {
  constructor(private readonly service: WorkbenchService) {}

  @Get()
  load(@BizAuthUser() auth: BizAuthContext) {
    return this.service.load(auth);
  }

  /**
   * 当前用户的界面偏好（待办类别）。
   * 不加额外权限：任何人都能读写自己的偏好；userId 只取 auth，不接受请求参数。
   */
  @Get('preferences')
  getPreferences(@BizAuthUser() auth: BizAuthContext) {
    return this.service.getTodoPreference(auth);
  }

  /** 保存待办类别偏好；todoKeys = null 表示恢复默认（删除该行） */
  @Put('preferences')
  setPreferences(@BizAuthUser() auth: BizAuthContext, @Body() body: { todoKeys?: string[] | null }) {
    if (!body || !Object.prototype.hasOwnProperty.call(body, 'todoKeys')) {
      throw new BadRequestException('缺少 todoKeys');
    }
    return this.service.setTodoPreference(auth, body.todoKeys ?? null);
  }
}
