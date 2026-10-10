import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 初始化/修复 biz（新基线）super_admin 账号（仅系统初始化或专门安全流程使用）。
 * 用法（密码经环境变量注入，不写命令行历史）：
 *   BIZ_SUPER_ADMIN_USERNAME=admin BIZ_SUPER_ADMIN_PASSWORD=<pwd> node scripts/auth/biz-init-super-admin.mjs
 *   --check 仅检查就绪状态
 * 约束：super_admin 不可被其他账号修改/停用（基线 01 §3.2），本脚本只做一次性初始化。
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const requireFromApi = createRequire(path.join(repoRoot, 'apps', 'api', 'package.json'));
const Database = requireFromApi('better-sqlite3');
const bcrypt = requireFromApi('bcryptjs');

const checkOnly = process.argv.includes('--check');
const type = String(process.env.BIZ_BOOTSTRAP_DB_TYPE || process.env.DB_TYPE || 'sqlite').toLowerCase();
const database = process.env.BIZ_BOOTSTRAP_DB_DATABASE || process.env.DB_DATABASE;
if (!database) fail('BIZ_BOOTSTRAP_DB_DATABASE/DB_DATABASE required');

const isMysql = type === 'mysql';
const mysql = isMysql ? requireFromApi('mysql2/promise') : null;
const db = isMysql
  ? { query: async (sql, params) => { const conn = await mysql.createConnection({ host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD, database, multipleStatements: true }); try { const [rows] = await conn.query(sql, params); return rows; } finally { await conn.end(); } } }
  : new Database(database);

async function run() {
  const countRows = isMysql ? await db.query('SELECT COUNT(*) AS c FROM biz_users WHERE role_code = ?', ['super_admin']) : [{ c: db.prepare("SELECT COUNT(*) AS c FROM biz_users WHERE role_code = 'super_admin'").get().c }];
  const count = Number(countRows[0]?.c ?? 0);
  if (checkOnly) {
    console.log(`BIZ_SUPER_ADMIN_READINESS count=${count} ready=${count === 1}`);
    if (!isMysql) db.close();
    process.exit(count === 1 ? 0 : 2);
  }
  const username = String(process.env.BIZ_SUPER_ADMIN_USERNAME || '').trim();
  const password = process.env.BIZ_SUPER_ADMIN_PASSWORD || '';
  if (!username || password.length < 6) fail('BIZ_SUPER_ADMIN_USERNAME + password(>=6) required');
  if (count > 0) {
    console.log(`BIZ_SUPER_ADMIN_ALREADY_EXISTS count=${count} (refusing to modify)`);
    if (!isMysql) db.close();
    process.exit(0);
  }
  const passwordHash = bcrypt.hashSync(password, 10);
  if (isMysql) {
    await db.query(
      `INSERT INTO biz_users
        (id, username, password_hash, role_code, name, city_id, status, auth_version, sensitive_order_scope, must_change_password, created_at, updated_at)
        VALUES (?, ?, ?, 'super_admin', ?, NULL, 'enabled', 1, 'full', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [randomUUID(), username, passwordHash, username],
    );
  } else {
    db.prepare(`INSERT INTO biz_users
      (id, username, password_hash, role_code, name, city_id, status, auth_version, sensitive_order_scope, must_change_password, created_at, updated_at)
      VALUES (?, ?, ?, 'super_admin', ?, NULL, 'enabled', 1, 'full', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`)
      .run(randomUUID(), username, passwordHash, username);
    db.close();
  }
  console.log('BIZ_SUPER_ADMIN_CREATED');
}
await run();

function fail(message) {
  console.error(`[biz-init-super-admin] ${message}`);
  process.exit(2);
}
