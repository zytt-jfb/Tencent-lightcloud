/**
 * 提醒 API
 */
import type { SendRemindersRequest } from '@biz-reporting/shared-types';
import request from '@/utils/request';

/** 手动发送填报提醒 */
export function sendReminders(data: SendRemindersRequest): Promise<{
  successCount: number;
  failCount: number;
  cityCount: number;
  recipientCount: number;
}> {
  return request.post('/admin/reminders/send', data);
}
