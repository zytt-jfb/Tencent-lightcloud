import * as XLSX from 'xlsx';

export const PAGE_EXPORT_ROW_LIMIT = 10000;

export type PageExportSheet = {
  name: string;
  rows: unknown[][];
  moneyColumns?: number[];
  percentColumns?: number[];
};

export function exportTimestamp(date = new Date()): string {
  const p = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

export function makeExportFileName(pageName: string, scope: string, period: string, date = new Date()): string {
  return `${pageName}-${scope}-${period}-${exportTimestamp(date)}.xlsx`.replace(/[\\/:*?"<>|]/g, '-');
}

export function buildWorkbook(sheets: PageExportSheet[]): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const worksheet = XLSX.utils.aoa_to_sheet(sheet.rows);
    const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
    for (let row = 1; row <= range.e.r; row += 1) {
      for (const column of sheet.moneyColumns || []) {
        const cell = worksheet[XLSX.utils.encode_cell({ r: row, c: column })];
        if (cell?.t === 'n') cell.z = '#,##0.00';
      }
      for (const column of sheet.percentColumns || []) {
        const cell = worksheet[XLSX.utils.encode_cell({ r: row, c: column })];
        if (cell?.t === 'n') cell.z = '0.00%';
      }
    }
    worksheet['!cols'] = sheet.rows[0]?.map((_, column) => ({
      wch: Math.min(32, Math.max(12, ...sheet.rows.map((row) => String(row[column] ?? '').length + 2))),
    })) || [];
    XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name.slice(0, 31));
  }
  return workbook;
}

export function writeWorkbook(fileName: string, sheets: PageExportSheet[]): void {
  XLSX.writeFile(buildWorkbook(sheets), fileName, { compression: true });
}

/** 常见字段名 → 中文列名。未命中时保留原字段名，页面也可以自行传入已中文化的行。 */
const FIELD_LABEL: Record<string, string> = {
  contractNo: '合同编号', contractName: '合同名称', contractAmountFen: '合同额(元)',
  taxInclusiveAmountFen: '含税合同额(元)', taxExclusiveAmountFen: '不含税合同额(元)',
  signedDate: '签订日期', startDate: '开始日期', endDate: '合同到期',
  cumulativeCompletionFen: '累计完工(元)', completionProgressPct: '完工进度(%)',
  effectiveStatus: '有效状态', statusAsOf: '数据基准日',
  cityName: '地市', provinceName: '省份', unitType: '单位类型',
  businessMonth: '业务月份', month: '月份', year: '年度',
  orderCompletionFen: '订单完工(元)', offlineCompletionFen: '线下完工(元)',
  completionFen: '完工金额(元)', grossProfitFen: '毛利(元)', netProfitFen: '净利(元)',
  costFen: '成本(元)', contractCount: '合同数', quotaFen: '配额(元)', overrunFen: '超额(元)',
  contractAmount: '合同额(元)', amountFen: '金额(元)',
  purchaseOrderNo: '采购订单编号', supplierName: '供应商', receiverPhone: '收货人电话',
  receiverAddress: '收货地址', feeRateSnapshotBp: '费率快照(基点)', validationStatus: '校验状态',
  sourceRowNo: '行号', filename: '文件名', totalRows: '总行数', importedRows: '入账行数',
  categoryCode: '成本类别', categoryName: '成本类别', submittedAt: '提交时间',
  username: '账号', name: '名称', roleCode: '角色', status: '状态', description: '说明',
  createdAt: '创建时间', updatedAt: '更新时间', remark: '备注', failureReason: '说明',
  actionType: '操作类型', targetType: '对象类型', resultStatus: '结果', operator: '操作人',
  evalMonth: '后评价月份', projectName: '采购项目名称', score: '分数', grade: '等级',
  evalMethod: '后评价方式', source: '数据来源', returnReason: '退回原因',
};

/** 常见枚举值 → 中文。未命中时保留原值。 */
const ENUM_LABEL: Record<string, string> = {
  active: '生效中', draft: '待生效', expired: '已到期', completed: '已完成',
  voided: '已作废', cancelled: '已取消', enabled: '启用', disabled: '停用',
  valid: '有效', invalid: '无效', pending: '待处理', approved: '已审核', rejected: '已驳回',
  building: '构建中', ready: '已就绪', failed: '失败', none: '无',
  current: '当前生效', historical: '历史批次', manual: '手动', auto: '自动',
  province_branch: '省级直属', city: '地市', province: '省份',
  labor: '人工成本', utilities: '水电费', fuel: '油补', entertainment: '招待费',
  rent: '房租', reimbursement: '报销', other: '其他',
  overrun: '超额', normal: '正常', ok: '正常',
  success: '成功', failure: '失败', queued: '排队中',
  online: '线上', offline: '线下', submitted: '已提交', returned: '已退回', import: '导入',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 内部主键/外键列且值均为 UUID → 导出时整列剔除（UUID 对使用导出文件的人是噪音） */
function isInternalIdColumn(key: string, records: Array<Record<string, unknown>>): boolean {
  if (!/^(id|.*Id|.*_id)$/.test(key)) return false;
  return records.every((row) => {
    const value = row[key];
    return value == null || (typeof value === 'string' && UUID_RE.test(value));
  });
}

/**
 * 导出页面行数据，统一中文化：
 *  - 列名走 FIELD_LABEL，未命中保留原字段名
 *  - 字符串值走 ENUM_LABEL（active → 生效中 等），未命中保留原值
 *  - 以 Fen 结尾的字段是"分"，自动换算为元（数值，便于 Excel 直接求和）
 *  - 纯 UUID 的内部主键/外键列整列剔除
 * 页面若已自行构造中文行，上述规则不会二次改写。
 */
export function exportPageRows(pageName: string, rows: Array<object>, scope = '当前筛选', fields?: string[]): void {
  const records = rows as Array<Record<string, unknown>>;
  const candidateKeys = fields ?? [...new Set(records.flatMap((row) => Object.keys(row)))];
  const keys = candidateKeys.filter((key) => !isInternalIdColumn(key, records));
  const safe = (value: unknown) => {
    if (typeof value !== 'string') return value;
    return /^[=+\-@]/.test(value) ? `'${value}` : value;
  };

  const headers = keys.map((key) => FIELD_LABEL[key] ?? key);
  const body = records.map((row) => keys.map((key) => {
    const raw = row[key];
    if (typeof raw === 'number' && /Fen$/.test(key)) return Math.round(raw) / 100;
    if (typeof raw === 'string') {
      if (/Fen$/.test(key) && /^-?\d+$/.test(raw)) return Number(raw) / 100;
      return safe(ENUM_LABEL[raw] ?? raw);
    }
    return safe(raw);
  }));

  writeWorkbook(makeExportFileName(pageName, scope, '导出'), [{
    name: '数据',
    rows: [headers, ...body],
  }]);
}
