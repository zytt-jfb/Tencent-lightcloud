import { BizPermissionCode } from '@biz-reporting/shared-types';
import type { Intent } from './intent.types';

/**
 * 意图目录（首批 11 个，全部基于真实表结构）
 *
 * 写这个文件的规矩：
 *   1. SQL 只写 SELECT，`{{scope}}` 必须放在 WHERE 的第一个条件位（早于所有 ?）；
 *   2. 表名必须在 sql-guard 白名单内，LIMIT 写死数字且在末尾；
 *   3. summary 里只能用占位符引用真实结果，禁止出现任何「预计/可能/大约」的生成式措辞；
 *   4. 同一个 trigger 不要出现在两个意图上，否则排序会变成玄学；
 *   5. **参数一律给默认值**：当前没有任何 required 参数，所以 ask_param / missing_param
 *      分支实际不会触发（问「后评估排名」直接用最新评估月回答）。这是刻意的：
 *      宁可给一个"文案里标明了月份"的答案，也不要先追问一句再回答。
 *      将来若要加必填参数，记得同时确认 askParam 的文案与前端渲染分支。
 *   6. **GROUP BY 的硬规则**：SELECT 里的非聚合列必须出现在 GROUP BY 中，
 *      聚合表达式必须整体套在 AVG/SUM/COUNT 里。写成 `ROUND((a+b)/12, 2) AS x` + `GROUP BY org`
 *      会触发 MySQL 的 only_full_group_by 直接报错（已在生产踩过，用户看到的是 500）。
 *      正确写法：`ROUND(AVG((a+b)/12), 2)`。
 *
 * 表与语义对应（两套「后评估」在本系统里是两份数据，不要混）：
 *   · biz_assessment_record  —— 工程管理/后评估管理：按月（eval_month）、有 A/B/C/D 等级、按项目打分
 *   · biz_performance_record —— 维护管理/月度考核：按年（assessment_year）、12 项打分、按经营单元
 */

const PERM_ASSESSMENT = BizPermissionCode.ASSESSMENT_OVERVIEW_READ;
const PERM_PERFORMANCE = BizPermissionCode.PERFORMANCE_OVERVIEW_READ;
const PERM_COST = BizPermissionCode.OPERATION_COST_READ;
const PERM_CONTRACT = BizPermissionCode.OPERATION_CONTRACT_READ;
const PERM_KB = BizPermissionCode.PORTAL_MAINTENANCE_ENTER;
const PERM_ANALYSIS = BizPermissionCode.OPERATION_ANALYSIS_READ;
const PERM_PERSONNEL = BizPermissionCode.MAINTENANCE_PERSONNEL_ENTER;
const PERM_ASSET = BizPermissionCode.MAINTENANCE_ASSET_ENTER;

/**
 * 月度考核的分数口径（这条曾经算错过，改之前先读完）
 *
 * biz_performance_record 的 score_1..score_12 是 **1-12 月的月度评分列**，不是 12 个考核维度
 * —— 导入时按表头「7月」「2026-07」解析月份再按序落到 score_N（见 performance.service.ts）。
 * 生产实际只有 1-7 月有值，8-12 月全为 NULL。
 *
 * 旧写法是 (Σ COALESCE(score_N,0)) / 12，把 7 个月的总分除以 12：
 *   青岛/平度市 显示 58.11 分，实际 99.62 分，整体被压低约 41%。
 *
 * 现口径：**有值月份的算术平均** = 总分 / 非空月份数，缺月不进分母。
 * 必须包在 SUM(...) 聚合里：GROUP BY 下直接引用 `score_1 IS NOT NULL` 会触发 only_full_group_by。
 */
const PERF_SCORE_SUM =
  '(COALESCE(score_1,0)+COALESCE(score_2,0)+COALESCE(score_3,0)+COALESCE(score_4,0)'
  + '+COALESCE(score_5,0)+COALESCE(score_6,0)+COALESCE(score_7,0)+COALESCE(score_8,0)'
  + '+COALESCE(score_9,0)+COALESCE(score_10,0)+COALESCE(score_11,0)+COALESCE(score_12,0))';

/** 每行有多少个月真的有分数（0-12），用于做分母 */
const PERF_SCORE_MONTHS =
  '((score_1 IS NOT NULL)+(score_2 IS NOT NULL)+(score_3 IS NOT NULL)+(score_4 IS NOT NULL)'
  + '+(score_5 IS NOT NULL)+(score_6 IS NOT NULL)+(score_7 IS NOT NULL)+(score_8 IS NOT NULL)'
  + '+(score_9 IS NOT NULL)+(score_10 IS NOT NULL)+(score_11 IS NOT NULL)+(score_12 IS NOT NULL))';

/**
 * 有值月份平均分；一行都没分数时 NULLIF 兜住，避免除零。
 *
 * 用 AVG(行总分/行月数) 而不是 SUM(总分)/SUM(月数)：
 *   同一个 organization 理论上可能对应多行（唯一键是 batch+supplier+organization），
 *   两行有值月份数不同（3 个月 vs 7 个月）时，SUM/SUM 会按"月数"加权，
 *   让数据多的那行主导结果；而业务上要的是"各成员月均的算术平均"。
 *   单行时两者恒等（实测 TOP1 仍为 99.62，不改口径）。
 */
const PERF_AVG_SCORE = `ROUND(AVG(${PERF_SCORE_SUM} / NULLIF(${PERF_SCORE_MONTHS}, 0)), 2)`;

export const INTENT_CATALOG: Intent[] = [
  // ========================================================================
  // 一、后评估（biz_assessment_record）
  // ========================================================================
  {
    id: 'assessment.city_rank',
    route: { desc: '某月后评估各地市平均分排名（谁高谁低）' },
    name: '后评估地市排名',
    category: 'rank',
    triggers: ['后评估排名', '后评估排行', '后评估名次', '地市排名', '地市排行', '城市排名', '评分排名', '得分排名', '哪一个地市', '哪个市最高', '哪个市最低', '后评估谁第一', '后评估第一名', '后评估垫底', '后评估倒数', '各地市成绩', '各地市得分', '后评估榜单', '地市分数', '地市成绩', '谁考得最好', '排名情况', '后评估均分排名'],
    synonyms: { 座次: '排名', 排行: '排名', 名次: '排名', 榜单: '排名', 排序: '排名' },
    params: {
      month: { from: 'month', required: false, defaultValue: { kind: 'latest_eval_month' }, label: '月份' },
    },
    auth: PERM_ASSESSMENT,
    // 16：低于「供应商排名」的 18。两者都会命中「后评估排名」这类词，
    // 只有当问句里出现「代维单位/供应商」时才该由供应商意图胜出，靠优先级让位。
    // 「后评估分数」这个 trigger 已移除：它会让「后评估分数怎么算」被误判成查排名。
    priority: 16,
    sql: {
      text: [
        'SELECT city_name AS city, COUNT(*) AS projects, ROUND(AVG(score), 2) AS avg_score',
        'FROM biz_assessment_record',
        "WHERE {{scope}} AND status = 'active' AND eval_month = ?",
        'GROUP BY city_name',
        'ORDER BY avg_score DESC',
        'LIMIT 50',
      ].join(' '),
      scopeColumn: 'city_id',
      scopeValueType: 'city_id',
    },
    chart: { type: 'bar', xField: 'city', yFields: ['avg_score'], title: '后评估地市平均分排名', unit: '分' },
    columns: [
      { key: 'city', label: '地市' },
      { key: 'projects', label: '项目数', kind: 'number' },
      { key: 'avg_score', label: '平均分', kind: 'number' },
    ],
    summary: '{month} 后评估共有 {rowCount} 个地市有数据，平均分最高的是 {top1.city}（{top1.avg_score} 分），最低的是 {last.city}（{last.avg_score} 分）。',
    emptyHint: '{month} 没有查到后评估记录，请确认该月是否已导入数据。',
    examples: ['2026-09 后评估排名', '各地市后评估排行'],
  },
  {
    id: 'assessment.supplier_rank',
    route: { desc: '某月后评估各供应商（代维单位）平均分排名' },
    name: '后评估供应商排名',
    category: 'rank',
    triggers: ['供应商排名', '供应商排行', '代维单位排名', '代维单位排行', '供应商名次', '供应商得分', '供应商谁第一', '代维单位谁最好', '供应商垫底', '哪个供应商最高', '代维排名', '供应商榜单', '代维单位后评估', '哪个供应商最差', '供应商后评估'],
    synonyms: { 座次: '排名', 排行: '排名', 名次: '排名', 排序: '排名', 榜单: '排名' },
    params: {
      month: { from: 'month', required: false, defaultValue: { kind: 'latest_eval_month' }, label: '月份' },
    },
    auth: PERM_ASSESSMENT,
    priority: 18,
    sql: {
      text: [
        'SELECT supplier_name AS supplier, COUNT(*) AS projects, ROUND(AVG(score), 2) AS avg_score',
        'FROM biz_assessment_record',
        "WHERE {{scope}} AND status = 'active' AND eval_month = ?",
        'GROUP BY supplier_name',
        'ORDER BY avg_score DESC',
        'LIMIT 50',
      ].join(' '),
      scopeColumn: 'city_id',
      scopeValueType: 'city_id',
    },
    chart: { type: 'bar', xField: 'supplier', yFields: ['avg_score'], title: '后评估供应商平均分排名', unit: '分' },
    columns: [
      { key: 'supplier', label: '供应商' },
      { key: 'projects', label: '项目数', kind: 'number' },
      { key: 'avg_score', label: '平均分', kind: 'number' },
    ],
    summary: '{month} 后评估共有 {rowCount} 家供应商参与，平均分最高的是 {top1.supplier}（{top1.avg_score} 分），最低的是 {last.supplier}（{last.avg_score} 分）。',
    emptyHint: '{month} 没有查到供应商后评估记录。',
    examples: ['2026-09 供应商排名', '代维单位后评估排行'],
  },
  {
    id: 'assessment.month_summary',
    route: { desc: '某月后评估整体情况：记录数、地市数、供应商数、平均分、最高最低分' },
    name: '后评估月度汇总',
    category: 'summary',
    triggers: ['后评估汇总', '后评估概况', '后评估整体', '后评估情况', '后评估统计', '后评估总览', '后评估整体情况', '后评估数据', '后评估概览', '后评估整体表现'],
    params: {
      month: { from: 'month', required: false, defaultValue: { kind: 'latest_eval_month' }, label: '月份' },
    },
    auth: PERM_ASSESSMENT,
    priority: 16,
    sql: {
      text: [
        "SELECT COUNT(*) AS records, COUNT(DISTINCT city_name) AS cities, COUNT(DISTINCT supplier_name) AS suppliers,",
        'ROUND(AVG(score), 2) AS avg_score, ROUND(MIN(score), 2) AS min_score, ROUND(MAX(score), 2) AS max_score,',
        "SUM(CASE WHEN grade = 'A' THEN 1 ELSE 0 END) AS grade_a,",
        "SUM(CASE WHEN grade = 'B' THEN 1 ELSE 0 END) AS grade_b,",
        "SUM(CASE WHEN grade = 'C' THEN 1 ELSE 0 END) AS grade_c,",
        "SUM(CASE WHEN grade = 'D' THEN 1 ELSE 0 END) AS grade_d",
        'FROM biz_assessment_record',
        "WHERE {{scope}} AND status = 'active' AND eval_month = ?",
        'LIMIT 1',
      ].join(' '),
      scopeColumn: 'city_id',
      scopeValueType: 'city_id',
    },
    columns: [
      { key: 'records', label: '记录数', kind: 'number' },
      { key: 'cities', label: '地市数', kind: 'number' },
      { key: 'suppliers', label: '供应商数', kind: 'number' },
      { key: 'avg_score', label: '平均分', kind: 'number' },
      { key: 'min_score', label: '最低分', kind: 'number' },
      { key: 'max_score', label: '最高分', kind: 'number' },
      { key: 'grade_a', label: 'A 级', kind: 'number' },
      { key: 'grade_b', label: 'B 级', kind: 'number' },
      { key: 'grade_c', label: 'C 级', kind: 'number' },
      { key: 'grade_d', label: 'D 级', kind: 'number' },
    ],
    summary: '{month} 后评估共 {records} 条记录，覆盖 {cities} 个地市、{suppliers} 家供应商；平均 {avg_score} 分，区间 {min_score}~{max_score} 分。',
    emptyHint: '{month} 没有查到后评估记录。',
    examples: ['2026-09 后评估概况', '后评估汇总'],
  },
  {
    id: 'assessment.grade_distribution',
    route: { desc: '某月后评估各等级（A/B/C/D）分别多少条' },
    name: '后评估等级分布',
    category: 'summary',
    triggers: ['等级分布', '等级占比', 'ABCD 分布', '评级分布', '等级构成', 'ABCD 占比', '后评估等级', '各等级多少', '等级比例'],
    params: {
      month: { from: 'month', required: false, defaultValue: { kind: 'latest_eval_month' }, label: '月份' },
    },
    auth: PERM_ASSESSMENT,
    priority: 15,
    sql: {
      text: [
        "SELECT COALESCE(NULLIF(grade, ''), '未评级') AS grade, COUNT(*) AS records",
        'FROM biz_assessment_record',
        "WHERE {{scope}} AND status = 'active' AND eval_month = ?",
        "GROUP BY COALESCE(NULLIF(grade, ''), '未评级')",
        'ORDER BY records DESC',
        'LIMIT 10',
      ].join(' '),
      scopeColumn: 'city_id',
      scopeValueType: 'city_id',
    },
    chart: { type: 'pie', nameField: 'grade', yFields: ['records'], title: '后评估等级分布' },
    columns: [
      { key: 'grade', label: '等级' },
      { key: 'records', label: '记录数', kind: 'number' },
    ],
    summary: '{month} 后评估等级分布：{rowCount} 个等级，其中 {top1.grade} 级 {top1.records} 条，占比最高。',
    emptyHint: '{month} 没有查到等级数据。',
    examples: ['等级分布', '后评估 ABCD 占比'],
  },
  {
    id: 'assessment.mom',
    route: { desc: '一段时间内后评估平均分逐月走势' },
    name: '后评估均分趋势',
    category: 'compare',
    triggers: ['环比', '趋势', '走势', '对比', '变化', '后评估环比', '后评估走势', '后评估趋势', '逐月', '月度变化', '分数走势', '后评估逐月'],
    synonyms: { 环比: '趋势', 走势: '趋势', 变化: '趋势' },
    params: {
      range: { from: 'month_range', required: false, defaultValue: { kind: 'ytd_months' }, label: '月份区间' },
    },
    auth: PERM_ASSESSMENT,
    priority: 12,
    sql: {
      text: [
        'SELECT eval_month AS month, ROUND(AVG(score), 2) AS avg_score, COUNT(*) AS records',
        'FROM biz_assessment_record',
        "WHERE {{scope}} AND status = 'active' AND eval_month BETWEEN ? AND ?",
        'GROUP BY eval_month',
        'ORDER BY eval_month ASC',
        'LIMIT 24',
      ].join(' '),
      scopeColumn: 'city_id',
      scopeValueType: 'city_id',
    },
    chart: { type: 'line', xField: 'month', yFields: ['avg_score'], title: '后评估月度平均分趋势', unit: '分' },
    columns: [
      { key: 'month', label: '月份' },
      { key: 'avg_score', label: '平均分', kind: 'number' },
      { key: 'records', label: '记录数', kind: 'number' },
    ],
    summary: '{rangeFrom}~{rangeTo} 共 {rowCount} 个月有后评估数据，最近一个月（{last.month}）平均 {last.avg_score} 分。',
    emptyHint: '所选区间没有后评估数据。',
    examples: ['2026-01 到 2026-09 后评估趋势', '后评估环比'],
  },

  {
    id: 'assessment.project_detail',
    route: { desc: '某月后评估每个项目的得分与等级明细' },
    name: '后评估项目明细',
    category: 'summary',
    triggers: ['后评估项目', '项目明细', '后评估明细', '有哪些项目', '项目得分', '后评估有哪些项目', '项目列表', '后评估项目列表', '各项目得分', '后评估项目得分'],
    params: {
      month: { from: 'month', required: false, defaultValue: { kind: 'latest_eval_month' }, label: '月份' },
    },
    auth: PERM_ASSESSMENT,
    priority: 11,
    sql: {
      text: [
        "SELECT project_name AS project, supplier_name AS supplier, ROUND(score, 2) AS score, COALESCE(NULLIF(grade, ''), '—') AS grade",
        'FROM biz_assessment_record',
        "WHERE {{scope}} AND status = 'active' AND eval_month = ?",
        'ORDER BY score DESC',
        'LIMIT 50',
      ].join(' '),
      scopeColumn: 'city_id',
      scopeValueType: 'city_id',
    },
    columns: [
      { key: 'project', label: '项目名称' },
      { key: 'supplier', label: '供应商' },
      { key: 'score', label: '得分', kind: 'number' },
      { key: 'grade', label: '等级' },
    ],
    summary: '{month} 后评估共 {rowCount} 个项目明细，得分最高的是 {top1.project}（{top1.score} 分，{top1.supplier}）。',
    emptyHint: '{month} 没有查到后评估项目明细。',
    examples: ['2026-09 后评估项目明细', '后评估有哪些项目'],
  },

  // ========================================================================
  // 二、月度考核（biz_performance_record，注意 city 字段存的是地名）
  // ========================================================================
  {
    id: 'performance.organization_rank',
    route: { desc: '某年各经营单元的月度考核平均分排名' },
    name: '月度考核经营单元排名',
    category: 'rank',
    triggers: ['月度考核排名', '月度考核排行', '经营单元排名', '经营单元排行', '考核排名', '考核得分排名', '月度打分排名', '哪个经营单元最高', '经营单元谁第一', '考核垫底', '经营单元得分', '经营单元成绩', '考核谁最好', '考核榜单'],
    synonyms: { 座次: '排名', 排行: '排名', 名次: '排名', 排序: '排名', 榜单: '排名' },
    params: {
      year: { from: 'year', required: false, defaultValue: { kind: 'current_year' }, label: '年份' },
    },
    auth: PERM_PERFORMANCE,
    priority: 20,
    sql: {
      text: [
        // 聚合表达式必须整体套在 SUM/AVG 里。写成 ROUND((a+b)/12, 2) 会被
        // MySQL 的 only_full_group_by 判定为「非聚合列出现在 SELECT」，直接报错。
        `SELECT organization, ${PERF_AVG_SCORE} AS avg_score`,
        'FROM biz_performance_record',
        'WHERE {{scope}} AND assessment_year = ?',
        'GROUP BY organization',
        'ORDER BY avg_score DESC',
        'LIMIT 50',
      ].join(' '),
      scopeColumn: 'city',
      // biz_performance_record.city 是 varchar 地名（038 迁移加的列），不是 UUID
      scopeValueType: 'city_name',
    },
    chart: { type: 'bar', xField: 'organization', yFields: ['avg_score'], title: '月度考核经营单元平均分排名', unit: '分' },
    columns: [
      { key: 'organization', label: '经营单元' },
      { key: 'avg_score', label: '月度平均分', kind: 'number' },
    ],
    summary: '{year} 年月度考核共 {rowCount} 个经营单元有数据（按有分数的月份求平均，缺月不计入分母），平均分最高的是 {top1.organization}（{top1.avg_score} 分），最低的是 {last.organization}（{last.avg_score} 分）。',
    emptyHint: '{year} 年没有查到月度考核数据。',
    examples: ['2026 年经营单元考核排名', '月度考核排名'],
  },
  {
    id: 'performance.supplier_rank',
    route: { desc: '某年各供应商（代维单位）的月度考核平均分排名' },
    name: '月度考核供应商排名',
    category: 'rank',
    triggers: ['供应商考核排名', '供应商考核得分', '代维单位考核排名', '月度供应商排名', '哪个供应商考核最高', '供应商考核谁第一', '供应商考核榜单'],
    params: {
      year: { from: 'year', required: false, defaultValue: { kind: 'current_year' }, label: '年份' },
    },
    auth: PERM_PERFORMANCE,
    // 21：高于 organization_rank 的 20。两者都会命中「考核排名」这个子串，
    // 而问句里出现「供应商/代维单位」时应该由本意图胜出（静态审计证实有 3 条被抢）
    priority: 21,
    sql: {
      text: [
        `SELECT supplier, COUNT(*) AS units, ${PERF_AVG_SCORE} AS avg_score`,
        'FROM biz_performance_record',
        'WHERE {{scope}} AND assessment_year = ?',
        'GROUP BY supplier',
        'ORDER BY avg_score DESC',
        'LIMIT 50',
      ].join(' '),
      scopeColumn: 'city',
      scopeValueType: 'city_name',
    },
    chart: { type: 'bar', xField: 'supplier', yFields: ['avg_score'], title: '月度考核供应商平均分排名', unit: '分' },
    columns: [
      { key: 'supplier', label: '供应商' },
      { key: 'units', label: '经营单元数', kind: 'number' },
      { key: 'avg_score', label: '月度平均分', kind: 'number' },
    ],
    summary: '{year} 年共 {rowCount} 家供应商参与月度考核（按有分数的月份求平均），平均分最高的是 {top1.supplier}（{top1.avg_score} 分）。',
    emptyHint: '{year} 年没有查到供应商考核数据。',
    examples: ['2026 年供应商考核排名'],
  },
  {
    id: 'performance.year_summary',
    route: { desc: '某年月度考核整体情况：记录数、经营单元数、供应商数、平均分' },
    name: '月度考核年度汇总',
    category: 'summary',
    triggers: ['月度考核汇总', '月度考核概况', '考核总览', '考核汇总', '月度打分汇总', '绩效汇总', '考核整体', '考核数据', '月度考核总览', '考核整体情况'],
    params: {
      year: { from: 'year', required: false, defaultValue: { kind: 'current_year' }, label: '年份' },
    },
    auth: PERM_PERFORMANCE,
    priority: 15,
    sql: {
      text: [
        `SELECT COUNT(*) AS records, COUNT(DISTINCT organization) AS organizations,`,
        `COUNT(DISTINCT supplier) AS suppliers, ${PERF_AVG_SCORE} AS avg_score`,
        'FROM biz_performance_record',
        'WHERE {{scope}} AND assessment_year = ?',
        'LIMIT 1',
      ].join(' '),
      scopeColumn: 'city',
      scopeValueType: 'city_name',
    },
    columns: [
      { key: 'records', label: '记录数', kind: 'number' },
      { key: 'organizations', label: '经营单元数', kind: 'number' },
      { key: 'suppliers', label: '供应商数', kind: 'number' },
      { key: 'avg_score', label: '月度平均分', kind: 'number' },
    ],
    summary: '{year} 年月度考核共 {records} 条记录，覆盖 {organizations} 个经营单元、{suppliers} 家供应商，按有分数的月份求平均的月度平均分为 {avg_score} 分。',
    emptyHint: '{year} 年没有查到月度考核数据。',
    examples: ['2026 年考核汇总'],
  },

  // ========================================================================
  // 三、成本（金额列 —— 只有具备成本查看权限的账号才能命中这个意图）
  // ========================================================================
  {
    id: 'operation.cost_summary',
    route: { desc: '一段时间内每月成本金额' },
    name: '成本月度汇总',
    category: 'summary',
    triggers: ['成本汇总', '成本统计', '成本金额', '成本情况', '花费', '费用汇总', '成本趋势', '按月成本', '成本多少钱', '花了多少钱', '成本走势', '成本概览'],
    // 只保留「费用→成本」：加「花费→成本」会让本意图的触发器「花费」「花了多少钱」
    // 在归一化后变成「成本」「花了金额」，永远匹配不到自己（静态审计已证实）
    synonyms: { 费用: '成本' },
    params: {
      range: { from: 'month_range', required: false, defaultValue: { kind: 'ytd_months' }, label: '月份区间' },
    },
    auth: PERM_COST,
    priority: 14,
    sql: {
      text: [
        'SELECT business_month AS month, ROUND(SUM(amount_fen) / 100, 2) AS amount_yuan, COUNT(*) AS entries',
        'FROM biz_cost_entries',
        "WHERE {{scope}} AND status <> 'voided' AND business_month BETWEEN ? AND ?",
        'GROUP BY business_month',
        'ORDER BY business_month ASC',
        'LIMIT 24',
      ].join(' '),
      scopeColumn: 'city_id',
      scopeValueType: 'city_id',
    },
    chart: { type: 'line', xField: 'month', yFields: ['amount_yuan'], title: '成本月度金额（元）', unit: '元' },
    columns: [
      { key: 'month', label: '月份' },
      { key: 'amount_yuan', label: '金额（元）', kind: 'money' },
      { key: 'entries', label: '条目数', kind: 'number' },
    ],
    summary: '{rangeFrom}~{rangeTo} 成本合计 {sum_amount_yuan} 元，共 {rowCount} 个月有记录。',
    emptyHint: '所选区间没有成本记录，或你的账号没有成本查看权限。',
    examples: ['2026-01 到 2026-09 成本汇总', '成本统计'],
  },

  {
    id: 'cost.by_category',
    route: { desc: '一段时间内成本按分类汇总（成本花在哪）' },
    name: '成本分类汇总',
    category: 'summary',
    triggers: ['成本分类', '成本构成', '按分类成本', '各类成本', '成本都花在哪', '成本分类汇总', '分类成本', '成本结构'],
    // 「构成→分类」会让 grade_distribution 的「等级构成」被改成「等级分类」而失配；
    // 本意图的触发器「成本构成」「成本结构」本来就是原文，不需要归一
    synonyms: {},
    params: {
      range: { from: 'month_range', required: false, defaultValue: { kind: 'ytd_months' }, label: '月份区间' },
    },
    auth: PERM_COST,
    priority: 13,
    sql: {
      text: [
        'SELECT cat.name AS category, ROUND(SUM(e.amount_fen) / 100, 2) AS amount_yuan, COUNT(*) AS entries',
        'FROM biz_cost_entries e',
        'LEFT JOIN biz_cost_categories cat ON cat.code = e.category_code',
        "WHERE {{scope}} AND e.status <> 'voided' AND e.business_month BETWEEN ? AND ?",
        'GROUP BY cat.name',
        'ORDER BY amount_yuan DESC',
        'LIMIT 30',
      ].join(' '),
      scopeColumn: 'e.city_id',
      scopeValueType: 'city_id',
    },
    chart: { type: 'pie', nameField: 'category', yFields: ['amount_yuan'], title: '成本分类占比' },
    columns: [
      { key: 'category', label: '分类' },
      { key: 'amount_yuan', label: '金额（元）', kind: 'money' },
      { key: 'entries', label: '条目数', kind: 'number' },
    ],
    summary: '{rangeFrom}~{rangeTo} 成本按分类合计，共 {rowCount} 个分类，金额最高的是 {top1.category}（{top1.amount_yuan} 元）。',
    emptyHint: '所选区间没有成本记录，或你的账号没有成本查看权限。',
    examples: ['2026 年成本分类', '成本都花在哪了'],
  },

  // ========================================================================
  // 四、合同到期（biz_contracts 无 city_id，必须 JOIN 地市分配表）
  // ========================================================================
  {
    id: 'operation.contract_expiring',
    route: { desc: '未来 N 天内到期的合同清单' },
    name: '即将到期合同',
    category: 'summary',
    triggers: ['即将到期', '快到期的合同', '到期的合同', '天到期', '到期合同', '合同到期', '到期提醒', '合同续签', '未来到期', '哪天到期', '还有多久到期', '临期合同', '合同什么时候到期'],
    params: {
      days: { from: 'days', required: false, defaultValue: { kind: 'next_days', days: 90 }, label: '天数' },
    },
    auth: PERM_CONTRACT,
    priority: 14,
    sql: {
      text: [
        'SELECT c.contract_no AS contract_no, c.contract_name AS contract_name, c.end_date AS end_date,',
        'c.status AS status, ROUND(c.tax_inclusive_amount_fen / 100, 2) AS amount_yuan',
        'FROM biz_contracts c',
        "JOIN biz_contract_city_allocations a ON a.contract_id = c.id AND a.status = 'active'",
        "WHERE {{scope}} AND c.status <> 'voided'",
        'AND c.end_date IS NOT NULL AND c.end_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY)',
        'GROUP BY c.id, c.contract_no, c.contract_name, c.end_date, c.status, c.tax_inclusive_amount_fen',
        'ORDER BY c.end_date ASC',
        'LIMIT 100',
      ].join(' '),
      scopeColumn: 'a.city_id',
      scopeValueType: 'city_id',
    },
    columns: [
      { key: 'contract_no', label: '合同编号' },
      { key: 'contract_name', label: '合同名称' },
      { key: 'end_date', label: '到期日', kind: 'date' },
      { key: 'status', label: '状态' },
      { key: 'amount_yuan', label: '含税金额（元）', kind: 'money' },
    ],
    summary: '未来 {days} 天内有 {rowCount} 份合同到期，最早到期的是 {top1.contract_name}（{top1.end_date}）。',
    emptyHint: '未来 {days} 天内没有即将到期的合同。',
    examples: ['未来 60 天到期的合同', '即将到期合同'],
  },

  {
    id: 'contract.amount_summary',
    route: { desc: '合同金额按状态汇总（总共有多少合同、多少钱）' },
    name: '合同金额汇总',
    category: 'summary',
    triggers: ['合同金额', '合同总额', '合同额', '合同规模', '合同金额汇总', '合同多少钱', '合同总金额', '合同金额分布'],
    synonyms: { 总额: '金额' },
    params: {},
    auth: PERM_CONTRACT,
    priority: 13,
    sql: {
      text: [
        'SELECT t.status AS status, COUNT(*) AS contracts, ROUND(SUM(t.amount_yuan), 2) AS amount_yuan',
        'FROM (',
        '  SELECT c.id, c.status, c.tax_inclusive_amount_fen / 100 AS amount_yuan',
        '  FROM biz_contracts c',
        "  JOIN biz_contract_city_allocations a ON a.contract_id = c.id AND a.status = 'active'",
        "  WHERE {{scope}} AND c.status <> 'voided'",
        '  GROUP BY c.id, c.status, c.tax_inclusive_amount_fen',
        ') t',
        'GROUP BY t.status',
        'ORDER BY amount_yuan DESC',
        'LIMIT 20',
      ].join(' '),
      scopeColumn: 'a.city_id',
      scopeValueType: 'city_id',
    },
    chart: { type: 'pie', nameField: 'status', yFields: ['amount_yuan'], title: '合同金额按状态分布' },
    columns: [
      { key: 'status', label: '状态' },
      { key: 'contracts', label: '合同数', kind: 'number' },
      { key: 'amount_yuan', label: '金额（元）', kind: 'money' },
    ],
    summary: '当前范围内合同共 {rowCount} 类状态，金额最高的是 {top1.status} 类（{top1.amount_yuan} 元），共 {top1.contracts} 份。',
    emptyHint: '当前范围内没有合同，或你的账号没有合同查看权限。',
    examples: ['合同金额汇总', '合同总额是多少'],
  },
  {
    id: 'contract.newly_signed',
    route: { desc: '某年新签合同数量与金额' },
    name: '本年新签合同',
    category: 'summary',
    triggers: ['新签合同', '新签', '今年签约', '本年签约', '签约金额', '今年新签', '本年新签', '签了多少合同'],
    // 「新签→签约」「签了→签约」都会把本意图自己的触发器改没（「新签合同」「签了多少合同」），
    // 而这两个触发器本来就是用户的原话，不需要归一
    synonyms: {},
    params: {
      year: { from: 'year', required: false, defaultValue: { kind: 'current_year' }, label: '年份' },
    },
    auth: PERM_CONTRACT,
    priority: 12,
    sql: {
      text: [
        'SELECT COUNT(DISTINCT c.id) AS contracts, ROUND(SUM(c.tax_inclusive_amount_fen) / 100, 2) AS amount_yuan',
        'FROM biz_contracts c',
        "JOIN biz_contract_city_allocations a ON a.contract_id = c.id AND a.status = 'active'",
        "WHERE {{scope}} AND c.status <> 'voided' AND c.signed_date IS NOT NULL AND YEAR(c.signed_date) = ?",
        'LIMIT 1',
      ].join(' '),
      scopeColumn: 'a.city_id',
      scopeValueType: 'city_id',
    },
    columns: [
      { key: 'contracts', label: '合同数', kind: 'number' },
      { key: 'amount_yuan', label: '含税金额（元）', kind: 'money' },
    ],
    summary: '{year} 年新签合同 {contracts} 份，含税金额合计 {amount_yuan} 元。',
    emptyHint: '{year} 年没有查到新签合同。',
    examples: ['2026 年新签合同', '今年签了多少合同'],
  },
  {
    id: 'operation.profit_monthly',
    route: { desc: '一段时间内每月完工额、毛利、净利、成本' },
    name: '利润与完工月度趋势',
    category: 'compare',
    triggers: ['毛利', '净利润', '利润', '完工额', '利润汇总', '毛利净利', '经营利润', '利润趋势', '完工金额', '利润情况'],
    synonyms: { 净利: '利润', 毛利润: '利润' },
    params: {
      range: { from: 'month_range', required: false, defaultValue: { kind: 'ytd_months' }, label: '月份区间' },
    },
    auth: PERM_ANALYSIS,
    priority: 12,
    sql: {
      text: [
        'SELECT business_month AS month,',
        'ROUND(SUM(order_completion_fen) / 100, 2) AS completion_yuan,',
        'ROUND(SUM(gross_profit_fen) / 100, 2) AS gross_yuan,',
        'ROUND(SUM(net_profit_fen) / 100, 2) AS net_yuan,',
        'ROUND(SUM(cost_fen) / 100, 2) AS cost_yuan',
        'FROM biz_monthly_aggregates',
        "WHERE {{scope}} AND city_id IS NOT NULL AND business_month BETWEEN ? AND ?",
        'GROUP BY business_month',
        'ORDER BY business_month ASC',
        'LIMIT 24',
      ].join(' '),
      scopeColumn: 'city_id',
      scopeValueType: 'city_id',
    },
    chart: { type: 'line', xField: 'month', yFields: ['completion_yuan', 'gross_yuan', 'net_yuan', 'cost_yuan'], title: '利润与完工月度趋势（元）', unit: '元' },
    columns: [
      { key: 'month', label: '月份' },
      { key: 'completion_yuan', label: '完工额（元）', kind: 'money' },
      { key: 'gross_yuan', label: '毛利（元）', kind: 'money' },
      { key: 'net_yuan', label: '净利（元）', kind: 'money' },
      { key: 'cost_yuan', label: '成本（元）', kind: 'money' },
    ],
    summary: '{rangeFrom}~{rangeTo} 共 {rowCount} 个月有利润/完工数据，最近一个月（{last.month}）毛利 {last.gross_yuan} 元、净利 {last.net_yuan} 元。',
    emptyHint: '所选区间没有利润/完工汇总数据。',
    examples: ['2026 年利润趋势', '毛利净利汇总'],
  },

  // ========================================================================
  // 五、维护台账到期（人员 / 车辆 / 油机）
  //
  // 这是唯一不走 SQL 的意图：到期字段是 VARCHAR 文本，判定必须在应用层做，
  // 且工作台已经有一套口径（MaintenanceOverviewService），重写必然打架。
  // ========================================================================
  {
    id: 'maintenance.expiry',
    route: { desc: '人员证照/保险、车辆保险、油机保养的到期清单（谁快过期、谁已过期）' },
    name: '证照保险到期清单',
    category: 'summary',
    // 触发词刻意不写裸的「到期」「快过期」：那会和合同到期互相抢，
    // 用户说「合同快到期了」不该落到人员证照上。这里只认带主体的说法。
    triggers: [
      '证照到期', '证照过期', '证照快到期', '证件到期', '证书到期', '证书过期',
      '资质到期', '资质过期', '保险到期', '保险过期', '保险快到期', '保险快过期',
      '交强险到期', '商业险到期', '保险该续', '续保',
      '电工证', '高压证', '低压证', '登高证', '高处作业', '雇主责任险', '团意险', '团队意外险',
      '保养到期', '人员到期', '车辆到期', '油机到期', '到期清单', '到期人员', '到期车辆',
      '哪些人到期', '哪些证到期', '无证上岗',
      // 带主体的组合词：既纠正「车辆保险」被合同到期抢走，也覆盖「人证」这类行业说法
      '车辆保险', '人员保险', '人员证照', '车辆证照', '人证到期', '人证过期', '人证',
      // 裸的「证照」：用来压过合同到期里那个过宽的「天到期」（「未来60天到期的证照」）
      '证照',
    ],
    synonyms: { 快到期: '到期', 要到期: '到期', 过期: '到期', 续期: '续保' },
    params: {
      kind: {
        // 'all' 时按账号权限裁剪类别，不会把没权限的那类也返回
        enum: {
          values: ['personnel', 'vehicles', 'generators', 'all'],
          // 长词优先匹配（「车辆保养」不会被「车辆」以外的东西抢走）
          aliases: {
            人员: 'personnel', 员工: 'personnel', 电工证: 'personnel', 高压证: 'personnel',
            低压证: 'personnel', 登高证: 'personnel', 高处作业: 'personnel', 雇主责任险: 'personnel',
            团意险: 'personnel', 团队意外险: 'personnel', 证照: 'personnel', 证件: 'personnel',
            证书: 'personnel', 资质: 'personnel', 人证: 'personnel',
            // 单词「人」放最后（长度最短，天然排在最后匹配）：
            // 「保险快过期的人有哪些」这种最口语的问法就是靠它落到人员类
            人: 'personnel',
            车辆: 'vehicles', 车: 'vehicles', 车牌: 'vehicles', 交强险: 'vehicles', 商业险: 'vehicles',
            行驶证: 'vehicles', 车辆保养: 'vehicles',
            油机: 'generators', 发电机: 'generators', 油机保养: 'generators',
          },
          // 给路由器看的展示名（派生参数说明时用），与 aliases 是两回事：
          // aliases 负责"从中文问句认出值"，labels 负责"告诉模型这个值叫什么"
          labels: { personnel: '人员', vehicles: '车辆', generators: '油机', all: '全部' },
          defaultValue: 'all',
        },
        label: '资产类别',
      },
      windowDays: { from: 'days', defaultValue: { kind: 'next_days', days: 30 }, label: '天数' },
    },
    authAny: [PERM_PERSONNEL, PERM_ASSET],
    priority: 22,
    handler: { kind: 'maintenance_expiry' },
    columns: [
      { key: 'category', label: '类别' },
      { key: 'name', label: '名称' },
      { key: 'item', label: '到期项' },
      { key: 'date', label: '到期日', kind: 'date' },
      { key: 'status', label: '状态' },
      { key: 'days', label: '剩余天数', kind: 'number' },
      { key: 'region', label: '所属组织' },
    ],
    // handler 会自己拼结论（需要按类别/状态动态叙述），这里只是模板兜底
    summary: '共 {rowCount} 条证照或保险到期记录。',
    emptyHint: '所选窗口内没有到期的证照或保险记录。',
    examples: ['保险快过期的人有哪些', '未来 30 天到期的车辆保险', '人员证照到期清单'],
  },

  // ========================================================================
  // 六、知识库问答（RAG，不查业务库）
  // ========================================================================
  {
    id: 'qa.knowledge',
    // 明确不上架：生产 chunks=0，模型选了也只会返回空片段。
    // 写 null 而不是省略，这样启动时的 missingDesc 告警不会把它误报成"忘了写"。
    route: null,
    name: '制度/口径问答',
    category: 'qa',
    triggers: ['怎么算', '怎么计算', '如何计算', '什么规定', '制度', '办法', '口径', '什么意思', '怎么填', '怎么报', '规则', '规定', '说明', '解释', '依据', '标准', '如何填报', '怎么理解', '是什么', '怎么定'],
    params: {},
    auth: PERM_KB,
    priority: 1,
    summary: '从知识库找到 {rowCount} 段相关片段（按相关度排序）。当前为原文摘录，未做模型改写。',
    emptyHint: '知识库里没有找到相关片段。可以换个说法，或让管理员补充该主题的历史报告。',
    examples: ['后评估的分数怎么算', '合同口径是什么'],
  },
];
