/**
 * SQL 护栏（纯函数，无 IO —— 所有分支都能被单元测试覆盖）
 *
 * 六道检查，任何一道不过就抛 SqlGuardError，绝不「尽力执行」：
 *   1. 单语句：只允许结尾一个分号，中间出现分号即拒；不允许注释（注释是绕过检测的常见手法）
 *   2. 只读：必须以 SELECT / WITH 开头，且不含写操作/系统库关键字
 *   3. 表白名单：FROM / JOIN 引用的表必须全部在白名单内
 *   4. 强制 LIMIT：必须是字面量数字，且不超过上限
 *   5. 参数化：`?` 个数必须与参数个数相等（多一个少一个都是 bug，宁可报错）
 *   6. 敏感表排除：用户/角色/权限表永远不在白名单里
 */

export class SqlGuardError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'NOT_SELECT'
      | 'MULTI_STATEMENT'
      | 'COMMENT'
      | 'FORBIDDEN_KEYWORD'
      | 'TABLE_NOT_ALLOWED'
      | 'LIMIT_MISSING'
      | 'LIMIT_TOO_LARGE'
      | 'PARAM_MISMATCH'
      | 'SCOPE_PLACEHOLDER',
  ) {
    super(message);
    this.name = 'SqlGuardError';
  }
}

/**
 * 允许 AI 查询的表。
 * 刻意不包含 biz_users / biz_roles / biz_permissions / biz_user_* / biz_*_token：
 * 这些表的读取权限与业务数据无关，AI 没有任何理由碰它们。
 */
export const AI_TABLE_WHITELIST: readonly string[] = [
  'biz_assessment_record',
  'biz_assessment_batch',
  'biz_performance_record',
  'biz_cities',
  'biz_provinces',
  'biz_cost_entries',
  'biz_cost_categories',
  'biz_contracts',
  'biz_contract_city_allocations',
  'biz_monthly_aggregates',
];

/** 写操作与危险函数：出现即拒（用词边界，避免误伤 `created_at` 这类列名） */
const FORBIDDEN_KEYWORDS: readonly RegExp[] = [
  /\binsert\b/i,
  /\bupdate\b/i,
  /\bdelete\b/i,
  /\bdrop\b/i,
  /\balter\b/i,
  /\btruncate\b/i,
  /\bcreate\b/i,
  /\bgrant\b/i,
  /\brevoke\b/i,
  /\bcall\b/i,
  /\bhandler\b/i,
  /\block\s+tables?\b/i,
  /\binto\s+(out|dump)file\b/i,
  /\bload_file\s*\(/i,
  /\bsleep\s*\(/i,
  /\bbenchmark\s*\(/i,
  /\binformation_schema\b/i,
  /\bperformance_schema\b/i,
  /\bmysql\s*\./i,
  /\bsys\s*\./i,
];

/** 统计 SQL 中的 `?` 占位符个数（跳过引号内的字面量，避免把 '香港?' 这类值算进去） */
export function countPlaceholders(sql: string): number {
  let count = 0;
  let quote: string | null = null;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (quote) {
      if (ch === quote) {
        // SQL 里连续两个引号表示转义后的引号本身
        if (sql[i + 1] === quote) i += 1;
        else quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '?') count += 1;
  }
  return count;
}

/** 提取 FROM / JOIN 后面引用的表名（去重、小写） */
export function extractTables(sql: string): string[] {
  const tables = new Set<string>();
  const re = /\b(?:from|join)\s+([`"[]?)([A-Za-z0-9_]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(sql)) !== null) {
    tables.add(match[2].toLowerCase());
  }
  return [...tables];
}

export function assertSingleStatement(sql: string): string {
  if (/--|#|\/\*/i.test(sql)) {
    throw new SqlGuardError('SQL 不允许包含注释', 'COMMENT');
  }
  const trimmed = sql.trim().replace(/;$/, '').trim();
  if (trimmed.includes(';')) {
    throw new SqlGuardError('SQL 不允许包含多条语句', 'MULTI_STATEMENT');
  }
  return trimmed;
}

export function assertSelectOnly(sql: string): void {
  if (!/^\s*(select|with)\b/i.test(sql)) {
    throw new SqlGuardError('只允许 SELECT 查询', 'NOT_SELECT');
  }
  for (const pattern of FORBIDDEN_KEYWORDS) {
    if (pattern.test(sql)) {
      throw new SqlGuardError(`SQL 包含禁止的关键字：${pattern.source}`, 'FORBIDDEN_KEYWORD');
    }
  }
}

export function assertTablesAllowed(sql: string, allowed: readonly string[] = AI_TABLE_WHITELIST): string[] {
  const tables = extractTables(sql);
  if (tables.length === 0) {
    throw new SqlGuardError('无法识别 SQL 中的表名', 'TABLE_NOT_ALLOWED');
  }
  const denied = tables.filter((table) => !allowed.includes(table));
  if (denied.length > 0) {
    throw new SqlGuardError(`表不在白名单内：${denied.join(',')}`, 'TABLE_NOT_ALLOWED');
  }
  return tables;
}

export function assertLimit(sql: string, maxRows: number): number {
  const match = /\blimit\s+(\d+)\s*$/i.exec(sql.trim());
  if (!match) {
    throw new SqlGuardError('SQL 必须包含字面量 LIMIT（不允许 LIMIT ?）', 'LIMIT_MISSING');
  }
  const limit = Number.parseInt(match[1], 10);
  if (limit > maxRows) {
    throw new SqlGuardError(`LIMIT ${limit} 超过上限 ${maxRows}`, 'LIMIT_TOO_LARGE');
  }
  return limit;
}

export function assertParamArity(sql: string, params: readonly unknown[]): number {
  const expected = countPlaceholders(sql);
  if (expected !== params.length) {
    throw new SqlGuardError(`参数个数不匹配：SQL 需要 ${expected}，实际 ${params.length}`, 'PARAM_MISMATCH');
  }
  return expected;
}

/**
 * `{{scope}}` 占位必须存在，且必须早于第一个 `?`。
 * 为什么：执行时 scope 参数总是排在意图参数之前，位置固定才能用「拼数组」而不是「插入到中间」。
 */
export function assertScopePlaceholder(sql: string): void {
  const scopeIndex = sql.indexOf('{{scope}}');
  if (scopeIndex < 0) {
    throw new SqlGuardError('SQL 模板缺少 {{scope}} 占位', 'SCOPE_PLACEHOLDER');
  }
  const firstParam = sql.indexOf('?');
  if (firstParam >= 0 && scopeIndex > firstParam) {
    throw new SqlGuardError('{{scope}} 必须出现在第一个 ? 之前', 'SCOPE_PLACEHOLDER');
  }
  if (sql.split('{{scope}}').length > 2) {
    throw new SqlGuardError('{{scope}} 只允许出现一次', 'SCOPE_PLACEHOLDER');
  }
}

/**
 * FROM 段不允许「逗号连表」。
 *
 * 原因：extractTables 只认 `FROM x` / `JOIN x` 两种写法，
 * `FROM biz_contracts c, biz_users u` 里的第二张表根本不会被提取，
 * 白名单就会放行 —— 那么「表必须在白名单内」这条不变量就是假的。
 *
 * 现在没有模板这么写，所以不可利用；但模板是手写的，将来有人图省事写一句连表
 * 就是静默穿透。与其补一套完整的 FROM 解析（正则做不可靠、上 AST 又太重），
 * 不如直接把这种写法禁掉 —— 需要多表就用显式 JOIN。
 *
 * 判定范围限定在 FROM 到 WHERE/GROUP/ORDER/HAVING/LIMIT 之间，
 * 并先剔除括号内容（派生表 `FROM (SELECT ...) t` 里的逗号不算连表）。
 */
export function assertNoCommaJoin(sql: string): void {
  const re = /\bfrom\b([\s\S]*?)(?=\bwhere\b|\bgroup\s+by\b|\border\s+by\b|\bhaving\b|\blimit\b|$)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(sql)) !== null) {
    // 只剔除单层括号：模板里不会出现深层嵌套，出现深层嵌套时宁可误报也不放过
    const outside = match[1].replace(/\([^()]*\)/g, '');
    if (outside.includes(',')) {
      throw new SqlGuardError('FROM 段不允许逗号连表，请改用显式 JOIN', 'TABLE_NOT_ALLOWED');
    }
  }
}

/** 执行前的完整校验（护栏入口） */
export function guardSql(input: { sql: string; params: readonly unknown[]; maxRows: number }): {
  sql: string;
  tables: string[];
  limit: number;
} {
  const sql = assertSingleStatement(input.sql);
  assertSelectOnly(sql);
  assertNoCommaJoin(sql);
  const tables = assertTablesAllowed(sql);
  const limit = assertLimit(sql, input.maxRows);
  assertParamArity(sql, input.params);
  return { sql, tables, limit };
}
