import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, Between } from 'typeorm';
import { MessageEntity } from './message.entity';
import { ReminderLogEntity } from './reminder-log.entity';
import { UserEntity } from '../users/user.entity';
import { CityEntity } from '../cities/city.entity';
import { AnnualPackageEntity } from '../packages/annual-package.entity';
import { MonthSnapshotEntity } from '../packages/month-snapshot.entity';
import { MessageType, ReminderTriggerType, ReminderSendStatus, Role } from '@biz-reporting/shared-types';
import type { SendRemindersRequest } from '@biz-reporting/shared-types';

/**
 * 提醒发送结果
 */
export interface SendResult {
  successCount: number;
  failCount: number;
  cityCount: number;
  recipientCount: number;
}

/**
 * 单城市-单用户的发送日志上下文
 */
interface CityUserSendInput {
  cityId: number;
  cityName: string;
  user: UserEntity;
  year: number;
  month: number;
  triggerType: string;
  senderUserId: number | null;
}

@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name);

  constructor(
    @InjectRepository(MessageEntity)
    private readonly messageRepo: Repository<MessageEntity>,
    @InjectRepository(ReminderLogEntity)
    private readonly reminderLogRepo: Repository<ReminderLogEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(CityEntity)
    private readonly cityRepo: Repository<CityEntity>,
    @InjectRepository(AnnualPackageEntity)
    private readonly packageRepo: Repository<AnnualPackageEntity>,
    @InjectRepository(MonthSnapshotEntity)
    private readonly snapshotRepo: Repository<MonthSnapshotEntity>,
  ) {}

  // ============================================================
  // 手动发送（管理员 UI 触发）
  // ============================================================

  /**
   * 管理员手动发送填报提醒
   *
   * 向指定城市的 city_user 发送消息，记录发送日志。
   * 复用核心发送方法，triggerType=MANUAL。
   */
  async sendReminders(
    dto: SendRemindersRequest,
    senderUserId: number,
  ): Promise<SendResult> {
    const cities = await this.cityRepo.find({
      where: { id: In(dto.cityIds) },
    });
    const cityMap = new Map(cities.map((c) => [c.id, c]));

    const recipients = await this.userRepo.find({
      where: { cityId: In(dto.cityIds), role: Role.CITY_USER },
    });

    const recipientsByCity = new Map<number, UserEntity[]>();
    for (const user of recipients) {
      if (user.cityId === null) continue;
      const cityId = Number(user.cityId);
      const list = recipientsByCity.get(cityId) || [];
      list.push(user);
      recipientsByCity.set(cityId, list);
    }

    let successCount = 0;
    let failCount = 0;
    let cityCount = 0;

    for (const cityId of dto.cityIds) {
      const city = cityMap.get(cityId);
      const cityName = city?.name ?? `城市#${cityId}`;
      const cityUsers = recipientsByCity.get(cityId);

      if (!cityUsers || cityUsers.length === 0) continue;
      cityCount++;

      for (const user of cityUsers) {
        const input: CityUserSendInput = {
          cityId,
          cityName,
          user,
          year: dto.year,
          month: dto.month,
          triggerType: ReminderTriggerType.MANUAL,
          senderUserId,
        };

        const ok = await this.sendToUser(input);
        if (ok) successCount++;
        else failCount++;
      }
    }

    return {
      successCount,
      failCount,
      cityCount,
      recipientCount: recipients.length,
    };
  }

  // ============================================================
  // 自动发送（定时任务触发）
  // ============================================================

  /**
   * 自动发送当前月填报提醒
   *
   * 规则：
   * - 只处理当前年+当前月
   * - 只提醒当前月尚未提交的城市
   * - 已提交的城市绝对不发
   * - 每天只发一次（幂等）
   * - 不创建年度包
   * - 无 city_user 的城市跳过，不写假日志
   */
  async sendAutoReminders(): Promise<SendResult> {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    this.logger.log(`[AutoReminder] 开始扫描: ${year}年${month}月`);

    // 1. 查询当年所有有年度包的城市
    const packages = await this.packageRepo.find({
      where: { reportYear: year },
      select: ['cityId'],
    });
    const allPackageCityIds = [...new Set(packages.map((p) => p.cityId))];

    if (allPackageCityIds.length === 0) {
      this.logger.log('[AutoReminder] 当年无年度包，跳过');
      return { successCount: 0, failCount: 0, cityCount: 0, recipientCount: 0 };
    }

    // 2. 查询当前月已提交的城市
    const submittedSnapshots = await this.snapshotRepo.find({
      where: {
        cityId: In(allPackageCityIds),
        reportYear: year,
        belongMonth: month,
      },
      select: ['cityId'],
    });
    const submittedCityIds = new Set(submittedSnapshots.map((s) => s.cityId));

    // 3. 未提交的城市 = 有包但无当月快照
    const unsubmittedCityIds = allPackageCityIds.filter(
      (id) => !submittedCityIds.has(id),
    );

    if (unsubmittedCityIds.length === 0) {
      this.logger.log('[AutoReminder] 所有城市已提交，无需提醒');
      return { successCount: 0, failCount: 0, cityCount: 0, recipientCount: 0 };
    }

    // 4. 查询城市名称
    const cities = await this.cityRepo.find({
      where: { id: In(unsubmittedCityIds) },
    });
    const cityMap = new Map(cities.map((c) => [c.id, c]));

    // 5. 查询这些城市下的 city_user
    const recipients = await this.userRepo.find({
      where: { cityId: In(unsubmittedCityIds), role: Role.CITY_USER },
    });

    const recipientsByCity = new Map<number, UserEntity[]>();
    for (const user of recipients) {
      if (user.cityId === null) continue;
      const cityId = Number(user.cityId);
      const list = recipientsByCity.get(cityId) || [];
      list.push(user);
      recipientsByCity.set(cityId, list);
    }

    let successCount = 0;
    let failCount = 0;
    let cityCount = 0;

    for (const cityId of unsubmittedCityIds) {
      const city = cityMap.get(cityId);
      const cityName = city?.name ?? `城市#${cityId}`;
      const cityUsers = recipientsByCity.get(cityId);

      if (!cityUsers || cityUsers.length === 0) {
        // 无用户，跳过（不写假日志）
        continue;
      }
      cityCount++;

      for (const user of cityUsers) {
        // 幂等检查：同一天内是否已发过自动提醒
        const alreadySent = await this.hasAutoReminderBeenSentToday(
          user.id,
          year,
          month,
        );
        if (alreadySent) {
          continue;
        }

        const input: CityUserSendInput = {
          cityId,
          cityName,
          user,
          year,
          month,
          triggerType: ReminderTriggerType.AUTO,
          senderUserId: null,
        };

        const ok = await this.sendToUser(input);
        if (ok) successCount++;
        else failCount++;
      }
    }

    this.logger.log(
      `[AutoReminder] 完成: 成功${successCount} 失败${failCount} 城市${cityCount}`,
    );
    return { successCount, failCount, cityCount, recipientCount: recipients.length };
  }

  // ============================================================
  // 核心发送方法（手动/自动共用）
  // ============================================================

  /**
   * 向单个用户发送一条提醒（写 message + reminder_log）
   * 发送失败时记录失败日志，不抛异常
   *
   * @returns true=成功 false=失败
   */
  private async sendToUser(input: CityUserSendInput): Promise<boolean> {
    try {
      const msg = this.messageRepo.create({
        userId: input.user.id,
        messageType: MessageType.REMINDER,
        title: `${input.year}年${input.month}月填报提醒`,
        summary: `请及时完成${input.year}年${input.month}月的经营数据填报。`,
        payloadJson: {
          year: input.year,
          month: input.month,
          cityId: input.cityId,
          cityName: input.cityName,
          triggerType: input.triggerType,
        },
        isRead: 0,
        readAt: null,
      });
      await this.messageRepo.save(msg);

      const log = this.reminderLogRepo.create({
        cityId: input.cityId,
        reportYear: input.year,
        belongMonth: input.month,
        triggerType: input.triggerType,
        recipientUserId: input.user.id,
        senderUserId: input.senderUserId,
        status: ReminderSendStatus.SENT,
        sentAt: new Date(),
      });
      await this.reminderLogRepo.save(log);

      return true;
    } catch (err) {
      this.logger.error(
        `[sendToUser] 发送失败: city=${input.cityId} user=${input.user.id}: ${err instanceof Error ? err.message : String(err)}`,
      );

      // 写失败日志
      try {
        const log = this.reminderLogRepo.create({
          cityId: input.cityId,
          reportYear: input.year,
          belongMonth: input.month,
          triggerType: input.triggerType,
          recipientUserId: input.user.id,
          senderUserId: input.senderUserId,
          status: ReminderSendStatus.FAILED,
          sentAt: null,
        });
        await this.reminderLogRepo.save(log);
      } catch {
        // 日志写入也失败时静默，不影响主流程
      }

      return false;
    }
  }

  /**
   * 幂等检查：同一天内是否已给该用户发送过自动提醒
   *
   * 检查 reminder_logs 中是否存在：
   * - 同一用户 + 同年 + 同月
   * - trigger_type = 'auto'
   * - status = 'sent'
   * - created_at 在今天范围内
   */
  private async hasAutoReminderBeenSentToday(
    userId: number,
    year: number,
    month: number,
  ): Promise<boolean> {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    const count = await this.reminderLogRepo.count({
      where: {
        recipientUserId: userId,
        reportYear: year,
        belongMonth: month,
        triggerType: ReminderTriggerType.AUTO,
        status: ReminderSendStatus.SENT,
        createdAt: Between(startOfDay, endOfDay),
      },
    });

    return count > 0;
  }

  // ============================================================
  // 用户消息查询
  // ============================================================

  /** 获取用户的消息列表（按时间倒序） */
  async getUserMessages(userId: number): Promise<MessageEntity[]> {
    return this.messageRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  /** 获取用户未读消息数 */
  async getUnreadCount(userId: number): Promise<number> {
    return this.messageRepo.count({
      where: { userId, isRead: 0 },
    });
  }

  /** 标记消息为已读 */
  async markAsRead(messageId: number, userId: number): Promise<{ success: boolean; isRead: boolean }> {
    const msg = await this.messageRepo.findOne({
      where: { id: messageId, userId },
    });
    if (!msg) {
      throw new NotFoundException(`消息 #${messageId} 不存在或不属于当前用户`);
    }

    if (msg.isRead === 1) {
      return { success: true, isRead: true };
    }

    msg.isRead = 1;
    msg.readAt = new Date();
    await this.messageRepo.save(msg);
    return { success: true, isRead: true };
  }
}
