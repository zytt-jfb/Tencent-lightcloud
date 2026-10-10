/**
 * 消息实体
 * 来源：DDL messages 表
 *
 * 小程序端"消息"tab 数据源
 * - payload_json 可携带结构化附加数据（如提交结果详情）
 */
export interface Message {
  id: number;
  userId: number;
  messageType: import('../enums').MessageType;
  title: string;
  summary: string;
  payloadJson: Record<string, unknown> | null;
  isRead: boolean;
  createdAt: Date;
  readAt: Date | null;
}
