#!/usr/bin/env node
/**
 * 经营单位详情页性能冒烟。
 *
 * 用途：在预发/生产环境验证"地市详情页"的两个关键接口没有性能回归。
 * 背景：该页曾因订单表回表查询单次耗时 25~42 秒（4 个查询累计约 118 秒），
 *       修复后为毫秒级；此脚本用于防止同类问题再次上线。
 *
 * 用法：
 *   API_BASE=https://your-host SMOKE_USERNAME=admin SMOKE_PASSWORD=*** \
 *   SMOKE_CITY_ID=<cityId> node scripts/test/city-detail-latency.mjs
 *
 * 可选：
 *   SMOKE_ROUNDS=5            采样次数（默认 5）
 *   SMOKE_THRESHOLD_MS=2000   P95 阈值（默认 2000ms）
 *
 * 退出码：0 通过 / 1 超阈值 / 2 参数缺失
 */
const BASE = (process.env.API_BASE || '').replace(/\/$/, '');
const USERNAME = process.env.SMOKE_USERNAME;
const PASSWORD = process.env.SMOKE_PASSWORD;
const CITY_ID = process.env.SMOKE_CITY_ID;
const ROUNDS = Math.max(1, Number(process.env.SMOKE_ROUNDS || 5));
const THRESHOLD = Number(process.env.SMOKE_THRESHOLD_MS || 2000);

if (!BASE || !USERNAME || !PASSWORD || !CITY_ID) {
  console.error('缺少参数。需要：API_BASE / SMOKE_USERNAME / SMOKE_PASSWORD / SMOKE_CITY_ID');
  console.error('示例：API_BASE=https://your-host SMOKE_USERNAME=admin SMOKE_PASSWORD=*** SMOKE_CITY_ID=xxx node scripts/test/city-detail-latency.mjs');
  process.exit(2);
}

const pct = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
};

async function timed(label, fn) {
  const t0 = Date.now();
  const res = await fn();
  const ms = Date.now() - t0;
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${label} HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  return ms;
}

const login = await fetch(`${BASE}/api/biz/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
});
if (!login.ok) {
  console.error(`登录失败 HTTP ${login.status}`);
  process.exit(1);
}
const { accessToken } = await login.json();
const headers = { Authorization: `Bearer ${accessToken}` };

const targets = [
  { name: '年度选项 /biz/analysis/years', url: `${BASE}/api/biz/analysis/years` },
  { name: '地市详情 /biz/analysis/city/:id', url: `${BASE}/api/biz/analysis/city/${encodeURIComponent(CITY_ID)}?orderPageSize=50&offlinePageSize=50` },
];

let failed = false;
for (const target of targets) {
  const samples = [];
  for (let i = 0; i < ROUNDS; i += 1) {
    try {
      samples.push(await timed(target.name, () => fetch(target.url, { headers })));
    } catch (e) {
      console.error(`[FAIL] ${target.name}: ${e instanceof Error ? e.message : e}`);
      failed = true;
      break;
    }
  }
  if (!samples.length) continue;

  const p50 = pct(samples, 50);
  const p95 = pct(samples, 95);
  const max = Math.max(...samples);
  const ok = p95 <= THRESHOLD;
  if (!ok) failed = true;
  console.log(`${ok ? '[ok]  ' : '[slow]'} ${target.name}  p50=${p50}ms p95=${p95}ms max=${max}ms  (阈值 ${THRESHOLD}ms, n=${samples.length})`);
}

if (failed) {
  console.error('性能冒烟未通过');
  process.exit(1);
}
console.log('性能冒烟通过');
