import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * 订单原始行（新基线 biz_order_rows）
 * 基线：01 §5 / 05 / 07 TABLE 5
 * 关键规则：
 *  - 34 个原始字段按模板顺序原样保存（col_01..col_34），空值原样保存，导入后不可在线编辑；
 *  - 一行一条真实业务事实，不设置业务去重键；完全相同的订单行也全部保存；
 *  - 标准化字段与原始字段并列保存，不覆盖原始值；
 *  - F 列"含税总金额"→ completion_amount_fen（四舍五入到分）；
 *  - 业务月份按下单时间归属；费率快照按业务月份当时生效的合同-地市费率；
 *  - 超额标识（city_overrun_flag / contract_overrun_flag）按当前累计净额计算，可同时存在；
 *  - 敏感列（收货人/联系方式/详细地址）存储加密或等效保护（M4/M8 实现加密策略）。
 */
@Entity('biz_order_rows')
@Index('idx_biz_order_row_batch', ['batchId'])
@Index('idx_biz_order_row_city_month', ['cityId', 'businessMonth'])
@Index('idx_biz_order_row_contract', ['contractId'])
@Index('idx_biz_order_row_replaces', ['replacesOrderRowId'])
@Index('uk_biz_order_row_replaces', ['replacesOrderRowId'], { unique: true })
@Index('idx_biz_order_row_resolved_batch', ['resolvedByBatchId'])
export class BizOrderRowEntity {
  /** 系统 order_row_id（UUID） */
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  /** 来源批次 UUID（biz_order_import_batches） */
  @Column({ name: 'batch_id', type: 'varchar', length: 36 })
  batchId: string;

  /** 源文件行号（从 2 开始，表头为 1） */
  @Column({ name: 'source_row_no', type: 'int' })
  sourceRowNo: number;

  // ===== 34 列原始字段（顺序与模板一致）=====
  @Column({ name: 'col_01', type: 'varchar', length: 100, nullable: true }) provinceName: string | null;        // 省份名称
  @Column({ name: 'col_02', type: 'varchar', length: 100, nullable: true }) cityName: string | null;            // 地市名称
  @Column({ name: 'col_03', type: 'varchar', length: 160, nullable: true }) purchaseOrderNo: string | null;     // 采购订单编号
  @Column({ name: 'col_04', type: 'varchar', length: 255, nullable: true }) supplierName: string | null;        // 供应商名称
  @Column({ name: 'col_05', type: 'varchar', length: 100, nullable: true }) orderMainStatus: string | null;     // 订单主状态
  @Column({ name: 'col_06', type: 'varchar', length: 64, nullable: true }) taxInclusiveAmountRaw: string | null; // 含税总金额（F 列原始值）
  @Column({ name: 'col_07', type: 'varchar', length: 1000, nullable: true }) materialName: string | null;       // 物料名称
  @Column({ name: 'col_08', type: 'varchar', length: 160, nullable: true }) materialCode: string | null;        // 物料编码
  @Column({ name: 'col_09', type: 'varchar', length: 100, nullable: true }) contractNoRaw: string | null;       // 合同编号
  @Column({ name: 'col_10', type: 'varchar', length: 64, nullable: true }) netPriceRaw: string | null;          // 净价
  @Column({ name: 'col_11', type: 'varchar', length: 64, nullable: true }) freightRaw: string | null;           // 运保费
  @Column({ name: 'col_12', type: 'varchar', length: 64, nullable: true }) constructionRaw: string | null;      // 建安费
  @Column({ name: 'col_13', type: 'varchar', length: 100, nullable: true }) feeType: string | null;             // 费用类型
  @Column({ name: 'col_14', type: 'varchar', length: 64, nullable: true }) taxRateRaw: string | null;           // 税率
  @Column({ name: 'col_15', type: 'varchar', length: 64, nullable: true }) taxAmountRaw: string | null;         // 税额
  @Column({ name: 'col_16', type: 'varchar', length: 64, nullable: true }) taxInclusiveUnitPriceRaw: string | null; // 含税单价
  @Column({ name: 'col_17', type: 'varchar', length: 64, nullable: true }) quantityRaw: string | null;          // 采购数量
  @Column({ name: 'col_18', type: 'varchar', length: 64, nullable: true }) unit: string | null;                 // 计量单位
  @Column({ name: 'col_19', type: 'varchar', length: 255, nullable: true }) receiverNameEnc: string | null;     // 收货人（敏感，加密存储）
  @Column({ name: 'col_20', type: 'varchar', length: 255, nullable: true }) receiverPhoneEnc: string | null;    // 收货人联系方式（敏感，加密存储）
  @Column({ name: 'col_21', type: 'varchar', length: 500, nullable: true }) receiverAddressEnc: string | null;  // 收货人详细地址（敏感，加密存储）
  @Column({ name: 'col_22', type: 'varchar', length: 255, nullable: true }) notifier: string | null;            // 通知人
  @Column({ name: 'col_23', type: 'varchar', length: 64, nullable: true }) orderTimeRaw: string | null;         // 下单时间（业务月份唯一来源）
  @Column({ name: 'col_24', type: 'varchar', length: 64, nullable: true }) noticeTimeRaw: string | null;        // 通知时间
  @Column({ name: 'col_25', type: 'varchar', length: 500, nullable: true }) postscript: string | null;          // 附言信息
  @Column({ name: 'col_26', type: 'varchar', length: 160, nullable: true }) projectCode: string | null;         // 项目编号
  @Column({ name: 'col_27', type: 'varchar', length: 1000, nullable: true }) projectName: string | null;        // 项目名称
  @Column({ name: 'col_28', type: 'varchar', length: 160, nullable: true }) siteCode: string | null;            // 站址编号
  @Column({ name: 'col_29', type: 'varchar', length: 1000, nullable: true }) siteInfo: string | null;           // 站址信息
  @Column({ name: 'col_30', type: 'varchar', length: 100, nullable: true }) receiptStatus: string | null;       // 收货状态
  @Column({ name: 'col_31', type: 'varchar', length: 1000, nullable: true }) productName: string | null;        // 商品名称
  @Column({ name: 'col_32', type: 'varchar', length: 160, nullable: true }) productCode: string | null;         // 商品编号
  @Column({ name: 'col_33', type: 'varchar', length: 64, nullable: true }) sourceTagFlag: string | null;        // 物料源头贴签标识
  @Column({ name: 'col_34', type: 'varchar', length: 64, nullable: true }) resampleFlag: string | null;         // 是否补样订单

  // ===== 标准化字段（系统生成，与原始字段并列保存）=====
  /** 标准省份 UUID（biz_provinces） */
  @Column({ name: 'province_id', type: 'varchar', length: 36, nullable: true })
  provinceId: string | null;

  /** 标准地市 UUID（biz_cities） */
  @Column({ name: 'city_id', type: 'varchar', length: 36, nullable: true })
  cityId: string | null;

  /** 合同 UUID（biz_contracts） */
  @Column({ name: 'contract_id', type: 'varchar', length: 36, nullable: true })
  contractId: string | null;

  /** 标准下单时间 */
  @Column({ name: 'order_time_std', type: 'datetime', nullable: true })
  orderTimeStd: Date | null;

  /** 标准通知时间（为空时展示按下单时间补齐） */
  @Column({ name: 'notice_time_std', type: 'datetime', nullable: true })
  noticeTimeStd: Date | null;

  /** 业务月份 'YYYY-MM'（下单时间所属月份） */
  @Column({ name: 'business_month', type: 'varchar', length: 7, nullable: true })
  businessMonth: string | null;

  /** F 列完工金额（分，四舍五入） */
  @Column({ name: 'completion_amount_fen', type: 'bigint', nullable: true })
  completionAmountFen: number | null;

  /** 业务月份适用的合同-地市管理费率快照（整数基点） */
  @Column({ name: 'fee_rate_snapshot_bp', type: 'int', nullable: true })
  feeRateSnapshotBp: number | null;

  /** 毛利润（分）= completionAmountFen × feeRateSnapshotBp，负数按原值计算 */
  @Column({ name: 'gross_profit_fen', type: 'bigint', nullable: true })
  grossProfitFen: number | null;

  /** 是否超过地市固定分配额度 */
  @Column({ name: 'city_overrun_flag', type: 'boolean', default: false })
  cityOverrunFlag: boolean;

  /** 是否超过合同总额（可与地市超额同时存在） */
  @Column({ name: 'contract_overrun_flag', type: 'boolean', default: false })
  contractOverrunFlag: boolean;

  /** 批次作废后整行退出统计（原始行永久保留） */
  @Column({ name: 'is_void', type: 'boolean', default: false })
  isVoid: boolean;

  /** 作废原因（批次作废时冗余，便于行级排查） */
  @Column({ name: 'void_reason', type: 'varchar', length: 255, nullable: true })
  voidReason: string | null;

  /** 原始 34 列 JSON 冗余（顺序与模板一致，审计用） */
  @Column({ name: 'source_row_json', type: 'json', nullable: true })
  sourceRowJson: string[] | null;

  @Column({ name: 'validation_status', type: 'varchar', length: 16, default: 'valid' })
  validationStatus: 'valid' | 'needs_review' | 'superseded';

  @Column({ name: 'is_current', type: 'boolean', default: true })
  isCurrent: boolean;

  @Column({ name: 'validation_error', type: 'text', nullable: true })
  validationError: string | null;

  /** 修正批次中的新行接替的旧待维护行 */
  @Column({ name: 'replaces_order_row_id', type: 'varchar', length: 36, nullable: true })
  replacesOrderRowId: string | null;

  /** 旧行被接替后的新批次 */
  @Column({ name: 'resolved_by_batch_id', type: 'varchar', length: 36, nullable: true })
  resolvedByBatchId: string | null;

  /** 执行接替的账号 */
  @Column({ name: 'resolved_by_user_id', type: 'varchar', length: 36, nullable: true })
  resolvedByUserId: string | null;

  @Column({ name: 'resolved_at', type: 'datetime', nullable: true })
  resolvedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;
}
