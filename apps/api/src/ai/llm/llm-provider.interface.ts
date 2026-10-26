/**
 * 大模型可插拔接口（默认禁用，本模块一期不接任何真实模型）
 *
 * 为什么先定接口：
 *   将来（二期）无论接本地 Ollama 还是云 API，ai.service 的调用点都只有 `chat()` 一处，
 *   换供应商不改业务代码；同时「禁用时不外联」这件事有了明确的类型边界 ——
 *   ENABLE_LLM=false 时注入的是 NullLlmProvider，它没有任何网络能力。
 */

export type LlmRole = 'system' | 'user' | 'assistant';

export interface LlmMessage {
  role: LlmRole;
  content: string;
}

/**
 * 单次调用参数（全部可选，不传则用 provider 自身的默认值）
 *
 * 存在的理由：本模块的 LLM 只做「选工具」和「选措辞」两件事，
 * 两者对响应格式、推理强度、超时的要求完全不同 ——
 * 路由要 JSON、要 low effort、要 8 秒内返回；措辞可以慢一点但也要 JSON。
 * 用一个全局配置糊住，必然有一边不合适。
 */
export interface LlmChatOptions {
  /** 要求模型只输出 JSON 对象（OpenAI 兼容 response_format） */
  jsonMode?: boolean;
  /** 推理强度：路由这类短任务用 low，能省掉一大半 reasoning token */
  effort?: 'low' | 'high' | 'max';
  /** 输出 token 上限；不设时由服务端默认 */
  maxTokens?: number;
  /** 覆盖本次调用的超时（毫秒）；路由必须短超时，不能等默认的 120 秒 */
  timeoutMs?: number;
  /**
   * 本次调用的最大尝试次数（含首次）。
   * 注意这直接影响用户等待上限：总耗时 ≈ attempts × timeoutMs + 退避。
   * 路由这类"失败就降级"的任务必须给 1，否则 8s×3 会变成 25s 的转圈。
   */
  maxAttempts?: number;
}

export interface LlmProvider {
  readonly name: string;
  chat(messages: readonly LlmMessage[], options?: LlmChatOptions): Promise<string>;
  embed(text: string): Promise<number[]>;
  health(): Promise<{ ok: boolean; message: string }>;
}

/** 调用被禁用/未配置时抛出：调用方据此返回「功能未启用」而不是 500 */
export class LlmDisabledError extends Error {
  constructor(message = 'AI 大模型未启用（ENABLE_LLM=false）') {
    super(message);
    this.name = 'LlmDisabledError';
  }
}

/** 熔断打开时抛出 */
export class LlmCircuitOpenError extends Error {
  constructor(message = '大模型调用已熔断，稍后再试') {
    super(message);
    this.name = 'LlmCircuitOpenError';
  }
}
