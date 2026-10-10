/**
 * 维护管理经营数据中台（新基线）— 订单模板 34 列常量
 * 来源：05-订单模板字段映射表-v1.0-当前确认版.docx
 * 决策（M0/M1 确认）：仅冻结「电商版 34 列」严格匹配；非电商模板列名变体留待 M4 业务确认。
 */

/** 34 列冻结表头（顺序即模板顺序，1-based 序号 = 数组下标 + 1） */
export const ORDER_TEMPLATE_COLUMNS: readonly string[] = [
  '省份名称',          // 1
  '地市名称',          // 2
  '采购订单编号',      // 3
  '供应商名称',        // 4
  '订单主状态',        // 5
  '含税总金额',        // 6 = F 列，订单完工金额
  '物料名称',          // 7
  '物料编码',          // 8
  '合同编号',          // 9
  '净价',              // 10
  '运保费',            // 11
  '建安费',            // 12
  '费用类型',          // 13
  '税率',              // 14
  '税额',              // 15
  '含税单价',          // 16
  '采购数量',          // 17
  '计量单位',          // 18
  '收货人',            // 19（敏感）
  '收货人联系方式',    // 20（敏感）
  '收货人详细地址',    // 21（敏感）
  '通知人',            // 22
  '下单时间',          // 23（业务月份唯一来源）
  '通知时间',          // 24
  '附言信息',          // 25
  '项目编号',          // 26
  '项目名称',          // 27
  '站址编号',          // 28
  '站址信息',          // 29
  '收货状态',          // 30
  '商品名称',          // 31
  '商品编号',          // 32
  '物料源头贴签标识',  // 33
  '是否补样订单',      // 34
] as const;

export const ORDER_TEMPLATE_COLUMN_COUNT = 34;

/** 固定工作表数量约束（基线 05：仅 1 个工作表；工作表名称不作为业务约束） */
export const ORDER_TEMPLATE_SHEET_COUNT = 1;

/** F 列（含税总金额）0-based 下标 */
export const ORDER_TEMPLATE_F_COLUMN_INDEX_0BASED = 5;

/** 敏感列（收货人/收货人联系方式/收货人详细地址）0-based 下标 */
export const ORDER_TEMPLATE_SENSITIVE_COLUMN_INDEXES_0BASED: readonly number[] = [18, 19, 20];

/** 下单时间列 0-based 下标 */
export const ORDER_TEMPLATE_ORDER_TIME_COLUMN_INDEX_0BASED = 22;

/** 合同编号列 0-based 下标 */
export const ORDER_TEMPLATE_CONTRACT_NO_COLUMN_INDEX_0BASED = 8;

/** 省份名称列 0-based 下标 */
export const ORDER_TEMPLATE_PROVINCE_COLUMN_INDEX_0BASED = 0;

/** 地市名称列 0-based 下标 */
export const ORDER_TEMPLATE_CITY_COLUMN_INDEX_0BASED = 1;

/** 单文件约束（基线 01 5.1 / 07 5.4） */
export const ORDER_FILE_MAX_BYTES = 50 * 1024 * 1024; // 50MB
export const ORDER_FILE_MAX_ROWS = 300_000; // 30 万行
export const ORDER_FILE_ALLOWED_EXT = '.xlsx';

/** 订单列名索引映射（用于解析时快速定位，0-based） */
export const ORDER_TEMPLATE_COLUMN_INDEX_MAP: Readonly<Record<string, number>> =
  Object.freeze(
    Object.fromEntries(
      ORDER_TEMPLATE_COLUMNS.map((name, idx) => [name, idx]),
    ),
  );
