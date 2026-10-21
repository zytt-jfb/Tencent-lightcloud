/**
 * 后评估数据归一化工具
 * 导入与线下填报共用。原则：展示值尽量保留原样，只有参与「业务键」的部分做激进归一化，
 * 因此原始整行仍写入 raw_json 以便回溯。
 */

/** 业务键用的激进归一化：去全部空白、全角括号转半角、转小写 */
export function normalizeKey(value: unknown): string {
  return String(value ?? '')
    .replace(/\s+/g, '')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/，/g, ',')
    .toLowerCase();
}

/** 展示用的轻度归一化：去首尾空白 + 连续空白压缩为一个空格 */
export function normalizeDisplay(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/** Excel 序列号转日期（以 1899-12-30 为基准，避免本地时区偏移） */
function serialToDate(serial: number): Date | null {
  if (!Number.isFinite(serial) || serial <= 0 || serial > 80000) return null;
  return new Date(Math.round((serial - 25569) * 86400000));
}

/**
 * 解析后评价月份为 YYYY-MM。
 * 支持：Excel 序列号（46082）、Date 对象、2026年3月、2026-03、2026/3、2026.3、202603、2026-03-01
 */
export function parseEvalMonth(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return null;
    return `${raw.getUTCFullYear()}-${String(raw.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  if (typeof raw === 'number') {
    const date = serialToDate(raw);
    if (!date) return null;
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  const text = String(raw).trim();
  if (!text) return null;

  // 纯数字：既可能是 Excel 序列号（>1000），也可能是 202603 这种紧凑写法
  if (/^\d+$/.test(text)) {
    if (text.length === 6) {
      const year = Number(text.slice(0, 4));
      const month = Number(text.slice(4, 6));
      if (year >= 2000 && year <= 2100 && month >= 1 && month <= 12) return `${year}-${String(month).padStart(2, '0')}`;
      return null;
    }
    const serial = Number(text);
    if (serial > 1000) {
      const date = serialToDate(serial);
      if (date) return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    }
    return null;
  }

  const matched = /^(\d{4})\s*[年\-/.]\s*(\d{1,2})/.exec(text);
  if (!matched) return null;
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  if (year < 2000 || year > 2100 || month < 1 || month > 12) return null;
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** 解析分数：容忍 ￥ ¥ 元 % 逗号 空格；非法返回 null */
export function parseScore(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const text = String(raw).trim().replace(/[￥¥元分,，%\s]/g, '');
  if (text === '' || !/^-?\d+(\.\d+)?$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** 后评价方式：线上/线下 → online/offline，缺省按线上 */
export function parseEvalMethod(raw: unknown): 'online' | 'offline' {
  const text = String(raw ?? '').trim();
  if (text.includes('线下') || /offline/i.test(text)) return 'offline';
  return 'online';
}

/**
 * 地市名称归一化：去掉尾部「公司 / 分公司」，兼容「烟台市分公司」「烟台市公司」「烟台市」。
 * 与订单导入 biz-order-import.service 的规则保持一致。
 */
export function normalizeCityName(value: string): string {
  return value.trim().replace(/\s+/g, '').replace(/(?:分)?公司$/, '');
}

/** 业务键：import|月份|项目|地市|供应商  或  offline|月份|合同|供应商 */
export function buildDedupKey(parts: Array<string | null | undefined>): string {
  return parts.map((part) => normalizeKey(part)).join('|').slice(0, 255);
}

/** 金额/分数四舍五入到 2 位，避免浮点尾数入库 */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * 解析「月份表头」（月度考核模板专用）
 *
 * 月度考核的月份列没有年份信息，表头可能是：7月 / 7月份 / 2026-07 / 2026年7月 / Excel 序列号 / Date。
 * 先交给 parseEvalMonth 处理带年份或可换算的写法，再兜底纯月份写法；
 * 只有月份时用上传时选择的考核年度补齐（fallbackYear）。
 *
 * 返回 null 表示这一列不是月份列（如「代维单位」「地市」）。
 */
export function parseMonthHeader(raw: unknown, fallbackYear?: number): { year: number; month: number } | null {
  const full = parseEvalMonth(raw);
  if (full) {
    const [year, month] = full.split('-').map(Number);
    return { year, month };
  }
  const text = raw === null || raw === undefined ? '' : String(raw).trim();
  const bareMonth = /^(\d{1,2})\s*月(?:份)?$/.exec(text);
  if (bareMonth) {
    const month = Number(bareMonth[1]);
    return month >= 1 && month <= 12 ? { year: fallbackYear ?? 0, month } : null;
  }
  // 表头只写数字的情况（1 / 01），限定 1-12 才不会把年份、条数当成月份
  if (/^\d{1,2}$/.test(text)) {
    const month = Number(text);
    return month >= 1 && month <= 12 ? { year: fallbackYear ?? 0, month } : null;
  }
  return null;
}
