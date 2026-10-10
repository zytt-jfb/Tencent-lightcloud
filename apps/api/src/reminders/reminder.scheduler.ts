import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { RemindersService } from './reminders.service';

/**
 * 自动提醒定时任务
 *
 * 每天 09:00（Asia/Shanghai）执行一次。
 *
 * ⚠️ CloudRun scale-to-zero 警告：
 * 此功能依赖定时任务定时触发，如果 CloudRun 实例被缩容到 0，
 * 定时任务将无法执行。部署时必须保证 min instance >= 1。
 *
 * 如果当前 CloudRun 配置为 scale-to-zero，此定时任务不会生效，
 * 需要改为其他方式触发（如外部 cron 调用 HTTP 接口）。
 */
@Injectable()
export class ReminderScheduler {
  private readonly logger = new Logger(ReminderScheduler.name);

  constructor(private readonly remindersService: RemindersService) {}

  /**
   * 每天北京时间 09:00 执行自动提醒
   *
   * cron 表达式：(秒 分 时 日 月 星期)
   * 使用 timeZone: 'Asia/Shanghai'，表达式中的时间即为北京时间
   * 0 0 9 * * * = 每天 09:00:00 北京时间
   */
  @Cron('0 0 9 * * *', {
    name: 'auto-reminder',
    timeZone: 'Asia/Shanghai',
  })
  async handleAutoReminder(): Promise<void> {
    this.logger.log('[AutoReminder] 定时任务触发');
    try {
      const result = await this.remindersService.sendAutoReminders();
      this.logger.log(
        `[AutoReminder] 定时任务完成: ` +
        `成功 ${result.successCount} 条, ` +
        `失败 ${result.failCount} 条, ` +
        `城市 ${result.cityCount} 个`,
      );
    } catch (err) {
      this.logger.error(
        `[AutoReminder] 定时任务异常: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
