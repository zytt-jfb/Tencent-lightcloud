import { Injectable } from '@nestjs/common';
import { LlmDisabledError, type LlmChatOptions, type LlmMessage, type LlmProvider } from './llm-provider.interface';

/**
 * 禁用态替身
 *
 * 它的存在本身就是「不变量」的证据：
 *   ENABLE_LLM=false 时容器里注入的就是这个对象，它只有方法签名、没有任何网络代码。
 *   验收里「进程无任何外联」因此可以被单测直接断言：
 *   把 globalThis.fetch 替换成会 throw 的桩，然后调用 chat()，只要没触发抓取就说明无外联。
 */
@Injectable()
export class NullLlmProvider implements LlmProvider {
  readonly name = 'disabled';

  async chat(_messages: readonly LlmMessage[], _options?: LlmChatOptions): Promise<string> {
    throw new LlmDisabledError();
  }

  async embed(_text: string): Promise<number[]> {
    throw new LlmDisabledError();
  }

  async health(): Promise<{ ok: boolean; message: string }> {
    return { ok: true, message: 'disabled' };
  }
}
