const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./compiled-root.cjs');

const { LlmClientService } = load('ai/llm/llm-client.service.js');
const { LlmDisabledError } = load('ai/llm/llm-provider.interface.js');

/** 最小的 ConfigService 替身：只实现 get() */
function configOf(env) {
  return { get: (key) => env[key] };
}

function withFetchSpy(fn) {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error('NETWORK_NOT_ALLOWED_IN_TEST');
  };
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      globalThis.fetch = original;
    })
    .then(() => calls);
}

test('默认禁用：ENABLE_LLM 未设置时注入的是 null provider', () => {
  const client = new LlmClientService(configOf({}));
  assert.equal(client.status.enabled, false);
  assert.equal(client.status.provider, 'disabled');
  assert.equal(client.status.circuit, 'closed');
});

test('ENABLE_LLM=false 时即使填了 OLLAMA_BASE_URL / LLM_API_KEY 也不初始化任何适配器', () => {
  const client = new LlmClientService(
    configOf({
      ENABLE_LLM: 'false',
      OLLAMA_BASE_URL: 'http://192.168.1.174:11434',
      LLM_API_KEY: 'sk-should-not-be-used',
      LLM_PROVIDER: 'cloud-api',
    }),
  );
  assert.equal(client.status.provider, 'disabled');
});

test('禁用态 chat() 抛 LlmDisabledError 且全程没有网络调用', async () => {
  const client = new LlmClientService(configOf({ ENABLE_LLM: 'false' }));
  const calls = await withFetchSpy(async () => {
    await assert.rejects(
      () => client.chat([{ role: 'user', content: '你好' }]),
      (error) => error instanceof LlmDisabledError,
    );
  });
  assert.equal(calls, 0, '禁用态竟然发生了 fetch 调用');
});

test('云 API 需要两道开关：AI_CLOUD_ALLOW=false 时降级为禁用态', () => {
  const client = new LlmClientService(
    configOf({
      ENABLE_LLM: 'true',
      LLM_PROVIDER: 'cloud-api',
      LLM_API_KEY: 'sk-test',
      AI_CLOUD_ALLOW: 'false',
    }),
  );
  assert.equal(client.status.provider, 'disabled');
  assert.equal(client.status.enabled, true, 'enabled 反映的是开关，不反映适配器是否可用');
});

test('本地适配器拒绝公网地址（数据不出内网）', () => {
  const client = new LlmClientService(
    configOf({ ENABLE_LLM: 'true', LLM_PROVIDER: 'local-ollama', OLLAMA_BASE_URL: 'http://example.com:11434' }),
  );
  assert.equal(client.status.provider, 'disabled');
});

test('内网地址会真正实例化适配器，但失败时按 3 次重试后抛出并累计熔断计数', async () => {
  const client = new LlmClientService(
    configOf({
      ENABLE_LLM: 'true',
      LLM_PROVIDER: 'local-ollama',
      OLLAMA_BASE_URL: 'http://192.168.1.174:11434',
    }),
  );
  assert.equal(client.status.provider, 'local-ollama');

  const calls = await withFetchSpy(async () => {
    await assert.rejects(() => client.chat([{ role: 'user', content: '你好' }]));
  });
  assert.equal(calls, 3, '应当尝试 3 次（1 次首发 + 2 次重试）');
  assert.equal(client.status.consecutiveFailures, 1, '一次完整失败应记 1 次，不是 3 次');
});
