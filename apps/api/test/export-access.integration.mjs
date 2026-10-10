/**
 * B-03 阶段二 · 红测：导出鉴权与审计无密钥（PG-R4/R12）
 *
 * 覆盖缺陷：
 *  - PG-R4 导出文件鉴权：非系统管理员访问他人导出任务必须 Forbidden（对照组验证既有守卫可用）。
 *  - PG-R12 审计无密钥：导出审计（exports.controller.ts:34-65 audit）不得把凭证类 filter 值写入 afterDataJson；
 *    旧代码把 filters 原样存入（:40-44 仅截断、不过滤凭证键）→ 密钥落审计日志 → 红。
 *
 * 红测语义：断言 = 期望（修复后）行为。旧代码不满足 → 测试失败（exit 1）→ 红。
 *
 * 执行：node apps/api/test/export-access.integration.mjs（node:test，零新增依赖）
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module from 'node:module';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const API_ROOT = path.join(REPO_ROOT, 'apps', 'api');
const apiRequire = createRequire(path.join(API_ROOT, 'package.json'));

let compiledRoot = null;
let tempRoot = null;

function compileCurrentSrc() {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'biz-b03-p2-export-'));
  compiledRoot = path.join(tempRoot, 'compiled');
  process.env.NODE_PATH = [
    path.join(API_ROOT, 'node_modules'),
    path.join(REPO_ROOT, 'node_modules'),
    process.env.NODE_PATH,
  ].filter(Boolean).join(path.delimiter);
  Module._initPaths();
  apiRequire("reflect-metadata");
  const tsc = apiRequire.resolve('typescript/bin/tsc');
  execFileSync(
    process.execPath,
    [tsc, '-p', path.join(API_ROOT, 'tsconfig.v3-check.json'), '--noEmit', 'false', '--declaration', 'false', '--outDir', compiledRoot, '--pretty', 'false'],
    { cwd: REPO_ROOT, stdio: 'pipe' },
  );
}

function compiled(rel) {
  return apiRequire(path.join(compiledRoot, 'apps', 'api', 'src', rel));
}

before(() => compileCurrentSrc());

after(() => {
  if (tempRoot && fs.existsSync(tempRoot)) {
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('PG-R4 对照组（绿）：非系统管理员访问他人导出任务 → ForbiddenException', async () => {
  const { Ws6Service } = compiled('ws6/ws6.service.js');
  const { Role, JobStatus, ExportScopeType, ExportMode } = apiRequire('@biz-reporting/shared-types');

  const job = {
    id: 10,
    operatorUserId: 99,
    exportMode: ExportMode.REALTIME,
    scopeType: ExportScopeType.CITY,
    cityId: 2,
    reportYear: 2026,
    belongMonth: 1,
    snapshotRange: null,
    status: JobStatus.COMPLETED,
    fileUrl: '',
    expiresAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const exportJobRepo = { findOne: async () => job };
  const service = new Ws6Service(
    {}, exportJobRepo, {}, {}, {}, {}, {},
    {}, {}, { create: (x) => x, save: async (x) => x },
    {}, {},
  );
  await assert.rejects(
    service.getExportJob(10, { role: Role.CITY_USER, userId: 5, cityId: 1 }),
    (err) => err.constructor.name === 'ForbiddenException',
    'CONTROL_EXPECTED[PG-R4]: 他人导出任务应拒绝访问（Forbidden）',
  );
});

test('PG-R12 红测：导出审计不得把凭证类 filter 值写入日志，旧代码原样落库 → 含密钥', async () => {
  const { ExportsController } = compiled('ws6/exports.controller.js');

  const savedLogs = [];
  const operationLogs = {
    create: (entry) => entry,
    save: async (entry) => { savedLogs.push(entry); return entry; },
  };
  const controller = new ExportsController({}, operationLogs);

  const req = { user: { userId: 5, role: 'city_user', cityId: 1 } };
  const body = {
    pageName: 'packages',
    rowCount: 12,
    result: 'success',
    fileName: '导出.xlsx',
    filters: {
      token: 'SENSITIVE-TOKEN-ABC',
      password: 'hunter2-secret',
      jwt: 'eyJhbGciOiJIUzI1NiJ9',
      city: '济南',
      reportYear: 2026,
    },
  };
  await controller.audit(body, req);
  const saved = savedLogs[0];
  const filters = saved.afterDataJson.filters || {};
  const leakedKeys = Object.keys(filters).filter((key) =>
    /token|password|secret|jwt|credential|authorization/i.test(key) && filters[key],
  );
  assert.equal(
    leakedKeys.length,
    0,
    `RED_EXPECTED[PG-R12]: 导出审计不得记录凭证类 filter（应脱敏/剔除）；旧代码 exports.controller.ts:40-44 原样截断落库 → 泄漏键=${JSON.stringify(leakedKeys)}，值=${JSON.stringify(leakedKeys.map((k) => filters[k]))}`,
  );
});


// ---- E-01：五类下载访问 + 缓存头 + COS 扫描 ----

test('E-01 下载五类访问：success/denied/expired/not_ready/not_found 均审计且语义正确', async () => {
  const { Ws6Service } = compiled('ws6/ws6.service.js');
  const { Role, JobStatus, ExportScopeType, ExportMode } = apiRequire('@biz-reporting/shared-types');
  const logs = [];

  function makeService(overrides = {}) {
    const job = {
      id: 10, operatorUserId: 1, exportMode: ExportMode.REALTIME,
      scopeType: ExportScopeType.CITY, cityId: 1, reportYear: 2026,
      belongMonth: 1, snapshotRange: null,
      status: overrides.status ?? JobStatus.COMPLETED,
      fileUrl: '',
      expiresAt: overrides.expiresAt ?? new Date(Date.now() + 60_000),
      createdAt: new Date(), updatedAt: new Date(),
    };
    const exportJobRepo = { findOne: async () => (overrides.notFound ? null : job) };
    const opLog = { create: (x) => x, save: async (x) => { logs.push(x); return x; } };
    const service = new Ws6Service(
      {}, exportJobRepo, {}, { find: async () => [] }, {}, {}, {},
      { find: async () => [] }, { find: async () => [] }, opLog,
      {}, {},
    );
    return service;
  }
  const actor = { role: Role.SYSTEM_ADMIN, userId: 1, cityId: null };

  // success
  {
    logs.length = 0;
    const service = makeService();
    const file = await service.getExportFile(10, actor);
    assert.ok(file.buffer.length > 0, 'E-01: 成功下载应返回文件 buffer');
    const audit = logs.find((l) => l.actionType === 'export_download');
    assert.ok(audit && audit.resultStatus === 'success', 'E-01: 成功下载应写 success 审计，实测=' + JSON.stringify(logs.map((l) => l.resultStatus)));
  }
  // denied（他人）
  {
    logs.length = 0;
    const service = makeService();
    await assert.rejects(() => service.getExportFile(10, { role: Role.CITY_USER, userId: 5, cityId: 2 }), (err) => err.constructor.name === 'ForbiddenException');
    assert.ok(logs.some((l) => l.resultStatus === 'denied'), 'E-01: 越权下载应写 denied 审计');
  }
  // expired
  {
    logs.length = 0;
    const service = makeService({ expiresAt: new Date(Date.now() - 1000) });
    await assert.rejects(() => service.getExportFile(10, actor), (err) => err.constructor.name === 'BadRequestException' && /过期/.test(err.message));
    assert.ok(logs.some((l) => l.resultStatus === 'expired'), 'E-01: 过期下载应写 expired 审计');
  }
  // not_ready（非 COMPLETED）
  {
    logs.length = 0;
    const service = makeService({ status: JobStatus.PENDING });
    await assert.rejects(() => service.getExportFile(10, actor), (err) => err.constructor.name === 'BadRequestException' && /未完成/.test(err.message));
    assert.ok(logs.some((l) => l.resultStatus === 'failed'), 'E-01: 未完成下载应写 failed 审计');
  }
  // not_found
  {
    logs.length = 0;
    const service = makeService({ notFound: true });
    await assert.rejects(() => service.getExportFile(10, actor), (err) => err.constructor.name === 'NotFoundException');
  }
});

test('E-01 下载响应头：no-store + attachment（源码结构断言）', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'apps/api/src/ws6/exports.controller.ts'), 'utf8');
  assert.match(src, /Header\('Cache-Control', 'no-store'\)/, 'E-01: download 应设置 no-store');
  assert.match(src, /disposition: `attachment; filename=/ || /disposition: .*attachment/, 'E-01: download 应设置 attachment disposition');
  assert.match(src, /StreamableFile/, 'E-01: download 应使用 StreamableFile 流式返回');
});

test('E-01 公开对象扫描：仓库无 COS 公网 export 写入代码', () => {
  const srcRoot = path.join(REPO_ROOT, 'apps/api/src');
  const hits = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts')) {
        const content = fs.readFileSync(full, 'utf8');
        if (/cos-\w+-sdk|@cloudbase\/storage|getTempFileURL|putObject\s*\(/.test(content)) hits.push(full);
      }
    }
  };
  walk(srcRoot);
  assert.equal(hits.length, 0, 'E-01: 运行时代码不应存在 COS 公网导出写入（长期签名 URL/公开桶），命中=' + JSON.stringify(hits));
});
