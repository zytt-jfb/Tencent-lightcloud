import {
  LlmDisabledError,
  type LlmChatOptions,
  type LlmMessage,
  type LlmProvider,
} from './llm-provider.interface';

/**
 * 云 API 适配器（OpenAI 兼容协议）
 *
 * 默认禁用，且需要**两道开关同时打开**才会实例化：
 *   1. ENABLE_LLM=true
 *   2. AI_CLOUD_ALLOW=true（隐私闸门）
 *
 * 为什么需要第二道闸：
 *   「把内部业务数据发到公网模型」是不可逆的数据出境行为。
 *   只靠一个布尔量太容易误开（复制 .env 时带上、调试时图省事），
 *   所以单独给一个语义明确的开关，任何一次云调用都必须同时满足两个条件。
 *
 * 兼容性说明（实测于 DeepSeek V4.1-Flash，2026-10）：
 *   · `response_format: {type:'json_object'}` 可用，但**要求 prompt 里出现 "json" 字样**，
 *     否则直接 400（invalid_request_error）。调用方忘了写，这里补一句兜住。
 *   · `reasoning_effort: low|high|max` 被接受；推理模型的思考过程在
 *     `choices[0].message.reasoning_content` 里，**只取 content**，
 *     推理过程不回显、不落库、不计入飞轮。
 */
export class CloudApiAdapter implements LlmProvider {
  readonly name = 'cloud-api';

  constructor(
    private readonly apiKey: string,
    private readonly endpoint = 'https://api.openai.com/v1',
    private readonly model = 'deepseek-flash',
    private readonly timeoutMs = 120_000,
    cloudAllowed = false,
  ) {
    if (!cloudAllowed) throw new LlmDisabledError('AI_CLOUD_ALLOW 未开启，拒绝初始化云 API 适配器');
    if (!apiKey) throw new LlmDisabledError('LLM_API_KEY 未配置');
  }

  /**
   * json_object 模式的前置条件：messages 里必须出现 "json"。
   * 与其让调用方记住，不如在适配器里补 —— 少一次线上 400。
   */
  private withJsonHint(messages: readonly LlmMessage[], jsonMode?: boolean): LlmMessage[] {
    const list = messages.map((item) => ({ ...item }));
    if (!jsonMode) return list;
    const hasHint = list.some((item) => /json/i.test(item.content));
    if (hasHint) return list;
    const last = list[list.length - 1];
    if (last) last.content = `${last.content}\n\n以上内容请以 json 对象输出。`;
    return list;
  }

  async chat(messages: readonly LlmMessage[], options: LlmChatOptions = {}): Promise<string> {
    const payload: Record<string, unknown> = {
      model: this.model,
      // 路由/措辞都是确定任务，temperature 固定 0，避免同一个问题两次给不同工具
      temperature: 0,
      messages: this.withJsonHint(messages, options.jsonMode),
    };
    if (options.jsonMode) payload.response_format = { type: 'json_object' };
    if (options.effort) payload.reasoning_effort = options.effort;
    if (options.maxTokens) payload.max_tokens = options.maxTokens;

    const response = await fetch(`${this.endpoint.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(options.timeoutMs ?? this.timeoutMs),
    });
    if (!response.ok) {
      // 把上游错误体带出来：400 的原因（prompt 缺 json 字样、模型名不对）比状态码本身有用得多
      const detail = await response.text().catch(() => '');
      throw new Error(`LLM HTTP ${response.status} ${detail.slice(0, 200)}`);
    }
    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
    };
    return body.choices?.[0]?.message?.content ?? '';
  }

  /**
   * 向量接口暂按 OpenAI 的 text-embedding-3-small 写死。
   * 注意：DeepSeek 的 /models 里**没有 embedding 模型**，换成 DeepSeek 时这个方法不可用。
   * 当前 RAG 未启用（chunks=0），不阻塞主流程；接知识库之前必须先确认供应商。
   */
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
