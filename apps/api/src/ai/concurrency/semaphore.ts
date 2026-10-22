import { Injectable } from '@nestjs/common';

/** 并发已满时抛出；controller 映射为 429，提示稍后再试而不是 500 */
export class AiBusyError extends Error {
  constructor(message = 'AI 查询并发已满，请稍后重试') {
    super(message);
    this.name = 'AiBusyError';
  }
}

export const AI_SEMAPHORE_TOKEN = 'AI_SEMAPHORE_TOKEN';

/**
 * 内存信号量（不引 Redis / 消息队列，2C2G 机器不允许再加中间件）
 *
 * 为什么必须限并发：
 *   单次 AI 查询会占用 1 个只读 MySQL 连接 + 一段时间的事件循环。
 *   只读池只有 2 个连接，若并发请求不限，第 3 个开始就全部排在驱动队列里，
 *   超时报警全堆在一起，用户看到的是「一起卡死」而不是「部分稍候」。
 *   这里给出「前 N 个立刻跑、后面排一小队、超过队列直接快速失败」的行为。
 *
 * 语义：FIFO，释放时若有人在等则把名额直接转交（active 不变），否则 active--。
 */
@Injectable()
export class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(
    private readonly limit: number,
    private readonly maxQueue = 50,
  ) {}

  get stats(): { active: number; queued: number; limit: number } {
    return { active: this.active, queued: this.waiters.length, limit: this.limit };
  }

  /** 获取一个名额，返回幂等的释放函数 */
  async acquire(): Promise<() => void> {
    if (this.active < this.limit) {
      this.active += 1;
      return this.releaser();
    }
    if (this.waiters.length >= this.maxQueue) throw new AiBusyError();
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    // 被唤醒时名额已由释放方转交，active 不再自增
    return this.releaser();
  }

  private releaser(): () => void {
    let released = false;
    return () => {
      // 幂等：调用方可能同时写在 try 的 finally 与 catch 里，重复释放会把名额凭空放大
      if (released) return;
      released = true;
      const next = this.waiters.shift();
      if (next) next();
      else this.active = Math.max(0, this.active - 1);
    };
  }
}

/** 把环境变量解析成合法并发数：非法值回退默认值，且夹在 1~8 之间 */
export function parseConcurrency(raw: string | undefined): number {
  const parsed = Number.parseInt(String(raw ?? '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 8) return 2;
  return parsed;
}
