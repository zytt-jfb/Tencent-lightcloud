import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { BizSnapshotService } from './biz-snapshot.service';
import { ModuleSnapshotService } from './module-snapshot.service';

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

  constructor(
    private readonly snapshots: BizSnapshotService,
    private readonly moduleSnapshots: ModuleSnapshotService,
  ) {}

  async onModuleInit(): Promise<void> {
    // 容器重启/发布中断会把正在构建的任务留在 building 状态，先释放再注册，避免阻塞当天定时构建
    const released = await this.snapshots.releaseStaleBuilds();
    if (released > 0) this.logger.warn(`[BizSnapshot] 启动时释放了 ${released} 个僵尸构建任务`);
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
    // 显式按 Asia/Shanghai（UTC+8，无夏令时）计算，不依赖容器 TZ。
    // 历史问题：原先用 setHours 依赖进程本地时区，容器为 UTC 时 "03:00" 被当成 UTC 03:00，
    // 实际在北京时间 11:00 触发（生产 run 记录全部落在 11:00:00 即为此因）。
    const CST_OFFSET_MS = 8 * 60 * 60 * 1000;
    const nowCstMs = Date.now() + CST_OFFSET_MS;
    const nextCst = new Date(nowCstMs);
    nextCst.setUTCHours(hh, mm, 0, 0);
    if (nextCst.getTime() <= nowCstMs) nextCst.setUTCDate(nextCst.getUTCDate() + 1);
    const nextUtcMs = nextCst.getTime() - CST_OFFSET_MS;
    const delay = Math.max(nextUtcMs - Date.now(), 1000);
    this.timer = setTimeout(() => {
      void this.runScheduledBuild();
    }, delay);
    const nextText = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(nextUtcMs));
    this.logger.log(`[BizSnapshot] 已注册定时任务 time=${cfg.time}（Asia/Shanghai）next=${nextText}`);
  }

  private async runScheduledBuild(): Promise<void> {
    const asOf = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    try {
      // 经营分析与模块快照相互独立：任一失败都不能阻止另一批构建
      try {
        const result = await this.snapshots.requestBuild(asOf, 'auto');
        this.logger.log(`[BizSnapshot] 定时触发 run=${result.runId} status=${result.status} asOf=${asOf}`);
      } catch (err) {
        this.logger.error(`[BizSnapshot] 定时任务异常: ${err instanceof Error ? err.message : String(err)}`);
      }
      try {
        const statuses = await this.moduleSnapshots.buildAll(asOf);
        const ok = statuses.filter((s) => s.status === 'ready').length;
        this.logger.log(`[ModuleSnapshot] 定时构建完成 ${ok}/${statuses.length} asOf=${asOf}`);
      } catch (err) {
        this.logger.error(`[ModuleSnapshot] 定时构建异常: ${err instanceof Error ? err.message : String(err)}`);
      }
    } finally {
      await this.reschedule();
    }
  }
}
