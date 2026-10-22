import { LlmDisabledError, type LlmMessage, type LlmProvider } from './llm-provider.interface';

/**
 * 本地 Ollama 适配器骨架（二期才用，当前 ENABLE_LLM=false 时**不会实例化**）
 *
 * 约束（二期接真实模型时必须复核）：
 *   · 只允许指向内网/本机地址（127.0.0.1 或内网段），禁止公网域名；
 *   · 默认模型 qwen2.5:3b-instruct-q4_K_M（2C2G 云机不跑，靠飞牛侧推理）；
 *   · 断线/超时由 llm-client 统一重试与熔断，这里只负责单次请求。
 */
export class LocalOllamaAdapter implements LlmProvider {
  readonly name = 'local-ollama';

  constructor(
    private readonly baseUrl: string,
    private readonly model = 'qwen2.5:3b-instruct-q4_K_M',
    private readonly timeoutMs = 120_000,
  ) {
    if (!baseUrl) throw new LlmDisabledError('OLLAMA_BASE_URL 未配置');
    // 防御：即使有人把公网地址填进来也拒绝启动（数据不出自有资产）
    if (!/^http:\/\/(127\.0\.0\.1|localhost|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(baseUrl)) {
      throw new LlmDisabledError(`OLLAMA_BASE_URL 必须是内网/本机地址，当前=${baseUrl}`);
    }
  }

  async chat(messages: readonly LlmMessage[]): Promise<string> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: this.model, messages, stream: false }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
    const body = (await response.json()) as { message?: { content?: string } };
    return body.message?.content ?? '';
  }

  async embed(text: string): Promise<number[]> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/api/embeddings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'nomic-embed-text', prompt: text }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error(`Ollama embeddings HTTP ${response.status}`);
    const body = (await response.json()) as { embedding?: number[] };
    return body.embedding ?? [];
  }

  async health(): Promise<{ ok: boolean; message: string }> {
    try {
      const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/api/tags`, {
        signal: AbortSignal.timeout(3_000),
      });
      return { ok: response.ok, message: `HTTP ${response.status}` };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }
}
