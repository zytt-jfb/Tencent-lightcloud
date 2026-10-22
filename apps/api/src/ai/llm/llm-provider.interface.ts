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

export interface LlmProvider {
  readonly name: string;
  chat(messages: readonly LlmMessage[]): Promise<string>;
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
