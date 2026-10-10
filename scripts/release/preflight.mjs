/**
 * M8（DEV-068）发布预检：
 *  - 迁移文件 checksum 与账本校验
 *  - 生产环境弱密钥静态扫描（.env* 中的 JWT_SECRET/AUTH_SECURITY_HMAC_KEY）
 *  - 关键测试套件就绪检查
 *  - BLK 清单输出（DEV-067 formal gate is mandatory; preflight pass is not a release approval）
 * 输出：docs/baseline/release-preflight-report.md
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const checksumsPath = path.join(repoRoot, 'scripts', 'db', 'migration-checksums.json');
const migrationDir = path.join(repoRoot, 'apps', 'api', 'migration');
const reportPath = path.join(repoRoot, 'docs', 'baseline', 'release-preflight-report.md');

const WEAK_PATTERNS = [/^(secret|changeme|change-me|password|admin|123456|qwerty|your-secret|your_secret|xxx+)$/i, /^(test|demo|dev|local|default)[-_]?.*$/i];

function run(cmd, args, useShell = false, env = process.env) {
  try {
    const out = execFileSync(cmd, args, { cwd: repoRoot, env, encoding: 'utf-8', timeout: 900_000, shell: useShell && process.platform === 'win32' });
    return { ok: true, out: out.trim().split('\n').slice(-1)[0] };
  } catch (e) {
    return { ok: false, out: e.stderr?.toString()?.slice(0, 300) ?? String(e).slice(0, 300) };
  }
}

const report = { checksum: { ok: false, detail: '' }, ledger: { ok: false, detail: '' }, secrets: { ok: true, detail: '未发现弱密钥' }, tests: {}, blk: [] };

// 1. checksum
try {
  const checksums = JSON.parse(readFileSync(checksumsPath, 'utf-8'));
  const files = readdirSync(migrationDir).filter((f) => f.endsWith('.sql')).sort();
  let mismatch = null;
  for (const f of files) {
    const version = f.replace('.sql', '');
    const actual = createHash('sha256').update(readFileSync(path.join(migrationDir, f), 'utf-8')).digest('hex');
    if (checksums[version] !== actual) { mismatch = version; break; }
  }
  report.checksum = { ok: !mismatch, detail: mismatch ? `checksum 不匹配: ${mismatch}` : `${files.length} 个迁移文件 checksum 全部一致` };
} catch (e) {
  report.checksum = { ok: false, detail: String(e) };
}

// 2. ledger
{
  const r = run(process.execPath, ['scripts/test/run-migration-ledger-contract.mjs']);
  report.ledger = { ok: r.ok, detail: r.out };
}

// 3. 弱密钥静态扫描（.env* 与 docker 相关）
{
  const envFiles = ['apps/api/.env', 'apps/api/.env.production', 'apps/admin-web/.env.production', '.env', '.env.production'].filter((f) => existsSync(path.join(repoRoot, f)));
  const weakFound = [];
  for (const f of envFiles) {
    const content = readFileSync(path.join(repoRoot, f), 'utf-8');
    for (const line of content.split('\n')) {
      const m = line.match(/^\s*(JWT_SECRET|AUTH_SECURITY_HMAC_KEY)\s*=\s*["']?(.+?)["']?\s*$/);
      if (m) {
        const value = m[2];
        if (value.length < 32 || WEAK_PATTERNS.some((re) => re.test(value))) weakFound.push(`${f}: ${m[1]}=${value.slice(0, 6)}***`);
      }
    }
  }
  if (weakFound.length) report.secrets = { ok: false, detail: `发现弱密钥：${weakFound.join('; ')}` };
}

// 4. 关键测试套件（引用执行）
const suites = ['typecheck', 'build', 'test:m7-views', 'test:m12-interaction', 'test:unit', 'test:architecture', 'test:migrations:ledger', 'test:m2-rbac-auth', 'test:m3-contracts', 'test:m4-orders', 'test:m5-offcost', 'test:m6-aggregates', 'test:m8-security', 'test:m9-negative', 'test:m10-negative', 'test:m11-business', 'test:auth-v3', 'test:exports-v3', 'test:metric-sources', 'test:storage-gate'];
for (const s of suites) {
  const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf-8'));
  if (pkg.scripts?.[s]) {
    const r = run('pnpm', [s], true);
    report.tests[s] = { ok: r.ok, detail: r.out.slice(0, 160) };
  }
}

// 5. BLK 清单
// DEV-067 is part of release preflight: require a live, non-local gate and run both formal checks.
const requiredMysqlEnv = ['MIGRATION_TEST_MYSQL_HOST', 'MIGRATION_TEST_MYSQL_PORT', 'MIGRATION_TEST_MYSQL_USER', 'MIGRATION_TEST_MYSQL_PASSWORD'];
const missingMysqlEnv = requiredMysqlEnv.filter((name) => !process.env[name]);
const gateHost = process.env.MIGRATION_TEST_MYSQL_HOST?.trim() || '';
const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
let mysqlGate = { ok: false, detail: '' };
if (missingMysqlEnv.length) {
  mysqlGate = { ok: false, detail: `DEV-067 credentials missing: ${missingMysqlEnv.join(', ')}` };
} else if (localHosts.has(gateHost.toLowerCase())) {
  mysqlGate = { ok: false, detail: 'DEV-067 refuses localhost; provide an isolated non-local MySQL gate' };
} else {
  const gateEnv = { ...process.env, NODE_ENV: 'test' };
  const migrationGate = run(process.execPath, ['scripts/test/run-migrations-mysql.mjs'], false, gateEnv);
  const integrationGate = run(process.execPath, ['scripts/test/run-mysql-integration.mjs'], false, gateEnv);
  mysqlGate = {
    ok: migrationGate.ok && integrationGate.ok,
    detail: `host=${gateHost}:${process.env.MIGRATION_TEST_MYSQL_PORT} user=${process.env.MIGRATION_TEST_MYSQL_USER}; migration=${migrationGate.ok ? 'PASS' : 'FAIL'}; integration=${integrationGate.ok ? 'PASS' : 'FAIL'}`,
  };
}
report.mysql = mysqlGate;

report.blk = [
  { id: 'BLK-1', status: 'open', note: 'DEV-067 formal MySQL gate not verified' },
  { id: 'BLK-2', status: 'mitigated-by-retirement', note: 'facts-v31 测试 Node24 崩溃：旧事实工作台已退役隔离（见 M8-legacy-retirement.md），新系统无依赖，风险豁免已记录' },
  { id: 'BLK-3', status: 'accepted-out-of-scope', note: '非电商订单模板 8 列名变体：M4 范围外事项，已确认仅支持电商版 34 列' },
];

report.blk[0] = { id: 'BLK-1', status: report.mysql.ok ? 'resolved' : 'open', note: report.mysql.detail || 'DEV-067 formal MySQL gate not verified' };
const allCore = report.checksum.ok && report.ledger.ok && report.secrets.ok && report.mysql.ok && Object.values(report.tests).every((t) => t.ok);
const conclusion = allCore
  ? '预检通过（核心检查全绿）。BLK-1 已解除（正式 MySQL gate 通过）；满足 M8 最终验收前置条件，可进入发布候选评审。'
  : '预检未通过，详见下方失败项。';
const reportDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());

const md = `# 发布预检报告（DEV-068）

> 日期：${reportDate} · 脚本：scripts/release/preflight.mjs
> 结论：**${allCore ? '预检通过（BLK-1 已解除，满足 M8 最终验收前置）' : '预检未通过'}**

## 检查结果

| 项目 | 状态 | 说明 |
|---|---|---|
| 迁移 checksum | ${report.checksum.ok ? '✅' : '❌'} | ${report.checksum.detail} |
| 迁移账本 | ${report.ledger.ok ? '✅' : '❌'} | ${report.ledger.detail} |
| 生产密钥审计 | ${report.secrets.ok ? '✅' : '❌'} | ${report.secrets.detail} |
${Object.entries(report.tests).map(([k, v]) => `| ${k} | ${v.ok ? '✅' : '❌'} | ${v.detail} |`).join('\n')}

## BLK 清单

| ID | 状态 | 说明 |
|---|---|---|
${report.blk.map((b) => `| ${b.id} | ${b.status} | ${b.note} |`).join('\n')}

## 结论

${conclusion}
`;

writeFileSync(reportPath, md, 'utf-8');
console.log(`PREFLIGHT_${allCore ? 'PASS' : 'FAIL'} checksum=${report.checksum.ok} ledger=${report.ledger.ok} secrets=${report.secrets.ok} tests=${Object.values(report.tests).filter((t) => t.ok).length}/${Object.keys(report.tests).length} report=${reportPath}`);
process.exit(allCore ? 0 : 1);
