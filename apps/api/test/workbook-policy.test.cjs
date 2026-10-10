/**
 * D-05 集成测试：集中工作簿策略（readWorkbookSafe 行列/sheet 限制）
 *
 * 覆盖：
 * 1. 正常工作簿通过
 * 2. 超 sheet（>20）→ 400
 * 3. 超行（>100k）→ 400
 * 4. 超列（>200）→ 400
 * 5. 畸形文件（非 Excel buffer）→ 400
 * 6. 仓库扫描：运行时代码无直接 XLSX.read（统一走 readWorkbookSafe）
 *
 * 执行：node apps/api/test/workbook-policy.test.cjs（node:test，零新增依赖）
 */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const API_ROOT = path.resolve(__dirname, '..');
const apiRequire = createRequire(path.join(API_ROOT, 'package.json'));
const XLSX = apiRequire('xlsx');

// 编译当前 src 到 tmp 后 require 编译产物（与其它集成测试一致）。
const { execFileSync } = require('node:child_process');
const os = require('node:os');
const Module = require('node:module');
const compiledRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'biz-d05-wb-'));
process.env.NODE_PATH = [path.join(API_ROOT, 'node_modules'), path.resolve(__dirname, '../../node_modules')].join(path.delimiter);
Module._initPaths();
apiRequire('reflect-metadata');
{
  const tsc = apiRequire.resolve('typescript/bin/tsc');
  execFileSync(process.execPath, [tsc, '-p', path.join(API_ROOT, 'tsconfig.v3-check.json'), '--noEmit', 'false', '--declaration', 'false', '--outDir', compiledRoot, '--pretty', 'false'], { cwd: path.resolve(__dirname, '../..'), stdio: 'pipe' });
}
const compiledPolicy = require(path.join(compiledRoot, 'apps/api/src/common/files/workbook-policy.js'));
const { readWorkbookSafe } = compiledPolicy;

test('D-05 正常工作簿通过', () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['a', 'b'], [1, 2]]), 's1');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const parsed = readWorkbookSafe(buf);
  assert.equal(parsed.SheetNames.length, 1);
});

test('D-05 超 sheet（21 > 20）→ 400', () => {
  const wb = XLSX.utils.book_new();
  for (let i = 0; i < 21; i += 1) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['x']]), `s${i}`);
  }
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  assert.throws(() => readWorkbookSafe(buf), (err) => err.status === 400 && /sheet/.test(err.message));
});

test('D-05 超行（100001 > 100000）→ 400', () => {
  const rows = [];
  for (let i = 0; i < 100001; i += 1) rows.push([i]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'big');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  assert.throws(() => readWorkbookSafe(buf), (err) => err.status === 400 && /行数/.test(err.message));
});

test('D-05 超列（201 > 200）→ 400', () => {
  const row = [];
  for (let i = 0; i < 201; i += 1) row.push(`c${i}`);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([row]), 'wide');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  assert.throws(() => readWorkbookSafe(buf), (err) => err.status === 400 && /列数/.test(err.message));
});

test('D-05 畸形文件（截断 xlsx）→ 400', () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['a']]), 's');
  const full = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const truncated = full.subarray(0, Math.floor(full.length / 3)); // 截断 zip → 解析失败
  assert.throws(() => readWorkbookSafe(truncated), (err) => err.status === 400);
});

test('D-05 仓库扫描：运行时代码无直接 XLSX.read（统一走 readWorkbookSafe）', () => {
  const srcRoot = path.join(API_ROOT, 'src');
  const direct = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts')) {
        const content = fs.readFileSync(full, 'utf8');
        // 允许 workbook-policy.ts 自身调用 XLSX.read
        if (full.endsWith('workbook-policy.ts')) continue;
        const m = content.match(/XLSX\.read\s*\(/);
        if (m) direct.push(`${path.relative(srcRoot, full)}:${content.slice(0, content.indexOf(m[0])).split('\n').length}`);
      }
    }
  };
  walk(srcRoot);
  assert.equal(
    direct.length,
    0,
    `D-05: 运行时代码不应直接 XLSX.read（应统一走 readWorkbookSafe）；发现 ${direct.length} 处：${JSON.stringify(direct)}`,
  );
});
