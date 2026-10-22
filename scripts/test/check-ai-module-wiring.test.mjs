/**
 * AI 模块「接线自检」
 *
 * 为什么需要这个测试：
 *   AI 模块的接线分散在 8 个文件里（后端 module / 前端路由 / 导航 / 布局 / compose /
 *   Dockerfile / 部署脚本 / 单测清单）。少接一处不会报错，只会静默失效 ——
 *   例如路由加了但导航没加，入口就永远不出现；compose 加了环境变量但没挂卷，
 *   飞轮数据一重建就没了。这类问题在人工 review 里最容易漏。
 *
 *   所以把「必须同时存在」的几处写成断言：谁删掉任何一环，pnpm test:unit 直接红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function read(relativePath) {
  const absolute = path.join(repoRoot, relativePath);
  assert.ok(fs.existsSync(absolute), `文件不存在：${relativePath}`);
  return fs.readFileSync(absolute, 'utf8');
}

test('后端：AppModule 注册了 AiModule', () => {
  const source = read('apps/api/src/app.module.ts');
  assert.match(source, /import \{ AiModule \} from '\.\/ai\/ai\.module'/);
  assert.match(source, /^\s*AiModule,/m);
});

test('后端：AiModule 暴露了 chat/report/intents/feedback 路由', () => {
  const source = read('apps/api/src/ai/ai.controller.ts');
  assert.match(source, /@Controller\('biz\/ai'\)/);
  for (const route of ["@Post('chat')", "@Post('report')", "@Get('intents')", "@Post('feedback')", "@Get('status')"]) {
    assert.ok(source.includes(route), `缺少路由 ${route}`);
  }
  // 必须挂业务守卫：@Public() 只跳过旧 JWT 守卫，不能连业务鉴权一起跳过
  assert.match(source, /UseGuards\(BizAuthGuard\)/);
});

test('前端：路由 /biz/ai 存在且指向助手页', () => {
  const app = read('apps/admin-web/src/App.tsx');
  assert.match(app, /const BizAiAssistant = lazy\(\(\) => import\('@\/pages\/biz\/BizAiAssistant'\)\)/);
  assert.match(app, /<Route path="ai" element=\{/);
  assert.ok(fs.existsSync(path.join(repoRoot, 'apps/admin-web/src/pages/biz/BizAiAssistant.tsx')));
});

test('前端：导航里有 /biz/ai 叶子，且归属 assistant 分组', () => {
  const nav = read('apps/admin-web/src/components/biz/biz-navigation.tsx');
  assert.match(nav, /key: '\/biz\/ai'/);
  assert.match(nav, /code: 'assistant'/);
  // 分组必须在 GROUP_PARENT_KEY 里有映射，否则侧栏展开逻辑会取到 undefined 的 key
  assert.match(nav, /assistant: undefined,/);
});

test('前端：BizLayout 为 /biz/ai 单独判定模块名（否则会误显示「经营管理」）', () => {
  const layout = read('apps/admin-web/src/components/biz/BizLayout.tsx');
  assert.match(layout, /isAiModule/);
  assert.match(layout, /isAiModule \? '智能助手'/);
  assert.match(layout, /\.\.\.assistantItems/);
});

test('部署：compose 注入了 AI 环境变量并挂载了数据卷', () => {
  const compose = read('deploy/ecs/compose.yml');
  for (const key of ['ENABLE_LLM', 'READONLY_DSN', 'AI_SQLITE_PATH', 'MAX_CONCURRENCY', 'AI_MAX_ROWS']) {
    assert.ok(compose.includes(`${key}:`), `compose 缺少 ${key}`);
  }
  assert.match(compose, /\$\{DATA_ROOT\}\/ai:\/app\/data\/ai/);
  // 必须是「可选」而不是必填，否则老 .env 会导致整个 compose 起不来
  assert.ok(!compose.includes('READONLY_DSN: ${READONLY_DSN:?'), 'READONLY_DSN 不应设为必填');
});

test('部署：镜像内建好 AI 数据目录并交给非 root 用户', () => {
  const dockerfile = read('Dockerfile');
  assert.match(dockerfile, /mkdir -p \/app\/data\/ai/);
  assert.match(dockerfile, /chown -R 10001:10001 \/app\/data/);
});

test('部署：发布脚本会创建并 chown AI 目录', () => {
  const script = read('deploy/ecs/biz-deploy.sh');
  assert.match(script, /mkdir -p "\$\{DATA_ROOT\}\/ai"/);
  assert.match(script, /chown -R 10001:10001 "\$\{DATA_ROOT\}\/ai"/);
});

test('单测：三个 AI 测试文件都登记在 run-unit 白名单里', () => {
  const runner = read('scripts/test/run-unit.mjs');
  for (const file of [
    'apps/api/test/ai-sql-guard.test.cjs',
    'apps/api/test/ai-intent-match.test.cjs',
    'apps/api/test/ai-llm-disabled.test.cjs',
    'scripts/test/check-ai-module-wiring.test.mjs',
  ]) {
    assert.ok(runner.includes(file), `run-unit.mjs 未登记 ${file}`);
  }
});

test('环境变量模板与部署说明都覆盖了 AI 配置', () => {
  const envExample = read('apps/api/.env.example');
  for (const key of ['ENABLE_LLM=false', 'READONLY_DSN=', 'AI_SQLITE_PATH=', 'MAX_CONCURRENCY=']) {
    assert.ok(envExample.includes(key), `.env.example 缺少 ${key}`);
  }
  const readme = read('deploy/ecs/README.md');
  assert.match(readme, /内部 AI 助手/);
  assert.match(readme, /ai-readonly-user\.sql/);
});
