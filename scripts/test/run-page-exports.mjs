import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const require = createRequire(path.join(repoRoot, 'apps/admin-web/package.json'));
const ts = require('typescript');
const XLSX = require('xlsx');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'biz-page-export-'));

try {
  const coreSource = fs.readFileSync(path.join(repoRoot, 'apps/admin-web/src/utils/page-export-core.ts'), 'utf8');
  const compiled = ts.transpileModule(coreSource, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2020 },
  }).outputText.replace(/from ['"]xlsx['"]/, `from '${pathToFileURL(require.resolve('xlsx')).href}'`);
  const modulePath = path.join(tempRoot, 'page-export-core.mjs');
  fs.writeFileSync(modulePath, compiled);
  const core = await import(pathToFileURL(modulePath).href);

  assert.equal(core.PAGE_EXPORT_ROW_LIMIT, 10000);
  assert.equal(
    core.makeExportFileName('经营仪表盘', '全省', '2026年', new Date(2026, 6, 29, 12, 34, 56)),
    '经营仪表盘-全省-2026年-20260729-123456.xlsx',
  );

  const workbook = core.buildWorkbook([
    { name: '合同测算', rows: [['合同', '金额', '费率'], ['A', 1234.5, 0.125]], moneyColumns: [1], percentColumns: [2] },
    { name: '月度合同', rows: [['月份', '金额'], [1, 200]], moneyColumns: [1] },
    { name: '成本', rows: [['类别', '金额'], ['日常报销', 80.25]], moneyColumns: [1] },
    { name: '综合代维', rows: [['项目', '金额'], ['维护', 20]], moneyColumns: [1] },
  ]);
  assert.deepEqual(workbook.SheetNames, ['合同测算', '月度合同', '成本', '综合代维']);
  assert.equal(workbook.Sheets['合同测算'].B2.t, 'n');
  assert.equal(workbook.Sheets['合同测算'].B2.z, '#,##0.00');
  assert.equal(workbook.Sheets['合同测算'].C2.t, 'n');
  assert.equal(workbook.Sheets['合同测算'].C2.z, '0.00%');

  const outputPath = path.join(tempRoot, 'export-contract.xlsx');
  XLSX.writeFile(workbook, outputPath);
  const parsed = XLSX.readFile(outputPath, { cellNF: true });
  assert.deepEqual(parsed.SheetNames, workbook.SheetNames);
  assert.equal(XLSX.utils.sheet_to_json(parsed.Sheets['合同测算'], { header: 1 }).length, 2);
  assert.equal(parsed.Sheets['合同测算'].B2.t, 'n');
  assert.equal(parsed.Sheets['合同测算'].C2.t, 'n');

  const pageContracts = [
    ['Dashboard/index.tsx', ['filteredItems', 'filteredTotals', 'filteredItems.map', '导出本页']],
    ['CityEstimate/index.tsx', ["name: '合同测算'", "name: '月度合同'", "name: '成本'", "name: '综合代维'", '导出本页']],
    ['CityOverview/index.tsx', ['exportPageWorkbook', '导出本页']],
    ['CityContracts/index.tsx', ['exportPageWorkbook', '导出本页']],
    ['CityCosts/index.tsx', ['PAGE_EXPORT_ROW_LIMIT', 'pageSize: 100', 'all.length < total', '导出本页']],
    ['CityOrders/index.tsx', ['PAGE_EXPORT_ROW_LIMIT', 'pageSize: 100', 'all.length < total', '导出本页']],
    ['CityReporting/index.tsx', ['导出本页', 'disabled={!monthData}']],
  ];
  for (const [relativePath, requiredFragments] of pageContracts) {
    const source = fs.readFileSync(path.join(repoRoot, 'apps/admin-web/src/pages', relativePath), 'utf8');
    for (const fragment of requiredFragments) {
      assert.ok(source.includes(fragment), `${relativePath} missing ${fragment}`);
    }
  }

  console.log('PAGE_EXPORTS_OK sheets=4 rowLimit=10000 numericFormats=money,percent pages=7');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  console.log(`PAGE_EXPORTS_CLEANUP_OK root=${tempRoot}`);
}
