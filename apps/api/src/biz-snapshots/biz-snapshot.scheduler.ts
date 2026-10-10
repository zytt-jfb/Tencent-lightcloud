import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { BizSnapshotService } from './biz-snapshot.service';

/**
 * 快照定时生成任务（系统上下文，无 HTTP 用户）。
 *
 * 动态调度方案（非固定 @Cron）：
 *  - 服务启动时 onModuleInit 读取系统设置中的「自动更新」配置并注册任务；
 *  - 系统设置保存后由控制器调用 reschedule() 重新注册（采用新时间 / 关闭则移除）；
 *  - 任务触发调用 requestBuild(asOf, 'auto')，与手动"更新数据"共用同一幂等锁与并发控制，
 *    不会并发重复全量计算；
 *  - 配置来源始终是 biz_system_settings，服务重启后从设置重新加载，不依赖内存记忆。
 *
 * ⚠️ CloudRun scale-to-zero 注意：若实例缩容到 0，定时任务不会触发。
 * 部署需保证 min instance >= 1；否则改用外部 cron 调用 POST /biz/analysis/snapshot/build。
 */
@Injectable()
export class BizSnapshotScheduler implements OnModuleInit {
  private readonly logger = new Logger(BizSnapshotScheduler.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly snapshots: BizSnapshotService) {}

  async onModuleInit(): Promise<void> {
    await this.reschedule();
  }

  /** 根据系统设置（snapshot_auto_update_enabled / snapshot_auto_update_time）注册或移除定时任务 */
  async reschedule(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    const cfg = await this.snapshots.getAutoUpdateConfig();
    if (!cfg.enabled || !cfg.time || !/^\d{2}:\d{2}$/.test(cfg.time)) {
      this.logger.log('[BizSnapshot] 自动更新未启用或时间无效，未注册定时任务');
      return;
    }
    const [hh, mm] = cfg.time.split(':').map((n) => Number(n));
    const now = new Date();
    const next = new Date(now);
    next.setHours(hh, mm, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    const delay = Math.max(next.getTime() - now.getTime(), 1000);
    this.timer = setTimeout(() => {
      void this.runScheduledBuild();
    }, delay);
    this.logger.log(`[BizSnapshot] 已注册定时任务 time=${cfg.time} next=${next.toISOString()}`);
  }

  private async runScheduledBuild(): Promise<void> {
    try {
      const asOf = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
      const result = await this.snapshots.requestBuild(asOf, 'auto');
      this.logger.log(`[BizSnapshot] 定时触发 run=${result.runId} status=${result.status} asOf=${asOf}`);
    } catch (err) {
      this.logger.error(`[BizSnapshot] 定时任务异常: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      await this.reschedule();
    }
  }
}
