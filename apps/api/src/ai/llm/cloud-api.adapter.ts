import { LlmDisabledError, type LlmMessage, type LlmProvider } from './llm-provider.interface';

/**
 * 云 API 适配器骨架（默认禁用，且需要**两道开关同时打开**才会实例化）
 *
 *   1. ENABLE_LLM=true
 *   2. AI_CLOUD_ALLOW=true（隐私闸门）
 *
 * 为什么需要第二道闸：
 *   「把内部业务数据发到公网模型」是不可逆的数据出境行为。
 *   只靠一个布尔量太容易误开（复制 .env 时带上、调试时图省事），
 *   所以单独给一个语义明确的开关，任何一次云调用都必须同时满足两个条件。
 */
export class CloudApiAdapter implements LlmProvider {
  readonly name = 'cloud-api';

  constructor(
    private readonly apiKey: string,
    private readonly endpoint = 'https://api.openai.com/v1',
    private readonly model = 'gpt-4o-mini',
    private readonly timeoutMs = 120_000,
    cloudAllowed = false,
  ) {
    if (!cloudAllowed) throw new LlmDisabledError('AI_CLOUD_ALLOW 未开启，拒绝初始化云 API 适配器');
    if (!apiKey) throw new LlmDisabledError('LLM_API_KEY 未配置');
  }

  async chat(messages: readonly LlmMessage[]): Promise<string> {
    const response = await fetch(`${this.endpoint.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.model, messages, temperature: 0 }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error(`LLM HTTP ${response.status}`);
    const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return body.choices?.[0]?.message?.content ?? '';
  }

  async embed(text: string): Promise<number[]> {
    const response = await fetch(`${this.endpoint.replace(/\/$/, '')}/embeddings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: 'text-embedding-3-small', input: text }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error(`LLM embeddings HTTP ${response.status}`);
    const body = (await response.json()) as { data?: Array<{ embedding?: number[] }> };
    return body.data?.[0]?.embedding ?? [];
  }

  async health(): Promise<{ ok: boolean; message: string }> {
    return { ok: Boolean(this.apiKey), message: this.apiKey ? 'configured' : 'missing key' };
  }
}
