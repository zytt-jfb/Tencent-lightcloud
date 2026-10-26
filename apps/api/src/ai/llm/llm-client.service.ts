import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CloudApiAdapter } from './cloud-api.adapter';
import { LocalOllamaAdapter } from './local-ollama.adapter';
import {
  LlmCircuitOpenError,
  LlmDisabledError,
  type LlmChatOptions,
  type LlmMessage,
  type LlmProvider,
} from './llm-provider.interface';
import { NullLlmProvider } from './null-llm.provider';

/** 连续失败多少次打开熔断 */
const FAILURE_THRESHOLD = 5;
/** 熔断打开后多久允许试探 */
const OPEN_COOLDOWN_MS = 60_000;
/** 总尝试次数（含首次） */
const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 500;

/**
 * 大模型客户端（默认禁用）
 *
 * 职责：把「是否启用、用哪个 provider、失败了怎么办」收在一个地方。
 *   · ENABLE_LLM != 'true' → 注入 NullLlmProvider，**连 provider 构造都不执行**
 *     （所以 OLLAMA_BASE_URL / LLM_API_KEY 即使填了也不会碰网络）；
 *   · 启用但配置不全 → 记 error 并降级为 NullLlmProvider，而不是让 API 起不来；
 *   · 超时/重试/熔断在这里统一处理，adapter 只负责单次请求。
 */
@Injectable()
export class LlmClientService {
  private readonly logger = new Logger(LlmClientService.name);
  private readonly provider: LlmProvider;
  private readonly enabled: boolean;
  private readonly timeoutMs: number;
  /** 供 /ai/status 显示「到底在用哪个模型」，避免线上排查时只能猜 */
  private readonly modelName: string;
  private consecutiveFailures = 0;
  private openedAt = 0;

  constructor(private readonly config: ConfigService) {
    this.enabled = String(this.config.get<string>('ENABLE_LLM') ?? 'false').toLowerCase() === 'true';
    this.modelName = (this.config.get<string>('LLM_MODEL') ?? '').trim() || 'deepseek-flash';
    const timeout = Number.parseInt(String(this.config.get<string>('LLM_TIMEOUT_MS') ?? ''), 10);
    this.timeoutMs = Number.isFinite(timeout) && timeout > 0 ? timeout : 120_000;

    if (!this.enabled) {
      this.provider = new NullLlmProvider();
      this.logger.log('AI_LLM_DISABLED provider=null（未初始化任何真实适配器）');
      return;
    }
    this.provider = this.buildProvider();
  }

  private buildProvider(): LlmProvider {
    try {
      const kind = (this.config.get<string>('LLM_PROVIDER') ?? 'local-ollama').trim();
      if (kind === 'cloud-api') {
        const allow = String(this.config.get<string>('AI_CLOUD_ALLOW') ?? 'false').toLowerCase() === 'true';
        return new CloudApiAdapter(
          this.config.get<string>('LLM_API_KEY') ?? '',
          this.config.get<string>('LLM_BASE_URL') ?? 'https://api.openai.com/v1',
          this.config.get<string>('LLM_MODEL') ?? 'gpt-4o-mini',
          this.timeoutMs,
          allow,
        );
      }
      return new LocalOllamaAdapter(
        this.config.get<string>('OLLAMA_BASE_URL') ?? '',
        this.config.get<string>('LLM_MODEL') ?? 'qwen2.5:3b-instruct-q4_K_M',
        this.timeoutMs,
      );
    } catch (error) {
      // 配置不全不应该拖垮启动：降级为禁用态，把原因留在日志和 /ai/status 里
      this.logger.error(
        `AI_LLM_INIT_FAILED fallback=null message=${error instanceof Error ? error.message : String(error)}`,
      );
      return new NullLlmProvider();
    }
  }

  get status(): {
    enabled: boolean;
    provider: string;
    model: string;
    circuit: 'closed' | 'open';
    consecutiveFailures: number;
    timeoutMs: number;
  } {
    return {
      enabled: this.enabled,
      provider: this.provider.name,
      model: this.modelName,
      circuit: this.circuitOpen() ? 'open' : 'closed',
      consecutiveFailures: this.consecutiveFailures,
      timeoutMs: this.timeoutMs,
    };
  }

  private circuitOpen(): boolean {
    if (this.openedAt === 0) return false;
    if (Date.now() - this.openedAt >= OPEN_COOLDOWN_MS) {
      // 冷却结束：半开状态，允许一次试探（失败会重新打开）
      this.openedAt = 0;
      this.consecutiveFailures = 0;
      return false;
    }
    return true;
  }

  async chat(messages: readonly LlmMessage[], options: LlmChatOptions = {}): Promise<string> {
    if (!this.enabled || this.provider instanceof NullLlmProvider) throw new LlmDisabledError();
    if (this.circuitOpen()) throw new LlmCircuitOpenError();

    // 调用方可以收紧重试次数：路由失败即降级，重试三次只是把 8 秒拖成 25 秒
    const attempts = Math.max(1, Math.min(MAX_ATTEMPTS, options.maxAttempts ?? MAX_ATTEMPTS));
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const answer = await this.provider.chat(messages, options);
        this.consecutiveFailures = 0;
        return answer;
      } catch (error) {
        lastError = error;
        // 4xx 是「我们自己的请求写错了」（模型名不对、prompt 缺 json 字样），
        // 重试三次结果一样，还白白拖长用户等待 —— 直接抛给调用方降级。
        if (/LLM HTTP 4\d\d/.test(error instanceof Error ? error.message : '')) break;
        if (attempt < attempts - 1) {
          // 指数退避 + 抖动：避免多个实例同时重试打到同一个上游
          const delay = BASE_BACKOFF_MS * 2 ** attempt + Math.random() * 200;
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= FAILURE_THRESHOLD) {
      this.openedAt = Date.now();
      this.logger.error(`AI_LLM_CIRCUIT_OPEN failures=${this.consecutiveFailures}`);
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  async embed(text: string): Promise<number[]> {
    if (!this.enabled || this.provider instanceof NullLlmProvider) throw new LlmDisabledError();
    return this.provider.embed(text);
  }

  async health(): Promise<{ ok: boolean; message: string }> {
    return this.provider.health();
  }
}
