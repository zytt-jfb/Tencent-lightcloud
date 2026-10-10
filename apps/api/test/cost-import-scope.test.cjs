const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const {
  ReportingImportScope,
  ReportingImportService,
} = require('./compiled-root.cjs')('ws6/reporting-import.service.js');

test('cost scope parses a cost-only workbook without contract data', async () => {
  const workbook = XLSX.utils.book_new();
  const header = ['类别', ...Array.from({ length: 12 }, (_, index) => `${index + 1}月`)];
  const labor = ['人工成本', ...Array.from({ length: 12 }, (_, index) => index + 1)];
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([header, labor]),
    '成本测算',
  );
  const buffer = Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));

  const city = { id: 1, name: '济南' };
  const cityRepo = {
    findOne: async () => city,
    find: async () => [city],
  };
  const emptyRepo = { find: async () => [] };
  const dataSource = { getRepository: () => emptyRepo };
  const service = new ReportingImportService(emptyRepo, cityRepo, dataSource);

  const preview = await service.preview(
    buffer,
    '济南成本.xlsx',
    1,
    2026,
    ReportingImportScope.COST,
  );

  assert.equal(preview.errors.length, 0);
  assert.equal(preview.monthlyRows.length, 0);
  assert.equal(preview.maintenanceRows.length, 0);
  assert.equal(preview.costRows.length, 12);
  assert.equal(preview.totalRows, 2);
  assert.equal(preview.successCount, 12);
});
