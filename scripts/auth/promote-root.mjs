import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const requireFromApi = createRequire(path.join(repoRoot, 'apps', 'api', 'package.json'));
const args = new Map(process.argv.slice(2).map((value, index, all) => value.startsWith('--') ? [value, all[index + 1]] : [value, value]));
const checkOnly = process.argv.includes('--check');
const type = requiredEnv('RBAC_BOOTSTRAP_DB_TYPE').toLowerCase();
const database = requiredEnv('RBAC_BOOTSTRAP_DB_DATABASE');
if (!['sqlite', 'mysql'].includes(type)) fail('RBAC_BOOTSTRAP_DB_TYPE must be sqlite or mysql');
const db = type === 'sqlite' ? openSqlite(database) : await openMysql(database);

try {
  const rootCount = Number(await db.scalar("SELECT COUNT(*) FROM users WHERE role = 'root_admin'"));
  if (checkOnly) {
    console.log(`ROOT_READINESS count=${rootCount} ready=${rootCount === 1}`);
    process.exitCode = rootCount === 1 ? 0 : 2;
  } else {
    const username = String(args.get('--username') || '').trim();
    if (!username) fail('--username is required');
    if (args.get('--confirm') !== 'PROMOTE_ROOT') fail('--confirm PROMOTE_ROOT is required');
    await db.transaction(async () => {
      const target = await db.row('SELECT id, role, city_id, status, auth_version FROM users WHERE username = ?', [username]);
      if (!target) fail('TARGET_USER_NOT_FOUND');
      const currentRoots = Number(await db.scalar("SELECT COUNT(*) FROM users WHERE role = 'root_admin'"));
      if (currentRoots > 0 && target.role !== 'root_admin') fail('ROOT_ADMIN_ALREADY_EXISTS');
      if (target.role === 'root_admin') {
        console.log(`ROOT_ALREADY_CONFIGURED userId=${target.id}`);
        return;
      }
      await db.run("UPDATE users SET role='root_admin', city_id=NULL, status='enabled', auth_version=auth_version+1 WHERE id=?", [target.id]);
      await db.run(`INSERT INTO operation_logs
        (operator_user_id, operator_city_id, action_type, target_type, target_id, summary_text, before_data_json, after_data_json, result_status, created_at)
        VALUES (?, NULL, 'root_admin_promote', 'user', ?, 'Explicit root administrator promotion', ?, ?, 'success', CURRENT_TIMESTAMP)`, [
        target.id,
        String(target.id),
        JSON.stringify({ role: target.role, cityId: target.city_id, status: target.status }),
        JSON.stringify({ role: 'root_admin', cityId: null, status: 'enabled' }),
      ]);
      console.log(`ROOT_PROMOTED userId=${target.id}`);
    });
  }
} finally {
  await db.close();
}

function openSqlite(database) {
  if (!path.isAbsolute(database)) fail('RBAC_BOOTSTRAP_DB_DATABASE must be an absolute SQLite path');
  const Database = requireFromApi('better-sqlite3');
  const connection = new Database(database);
  return {
    scalar: async (sql, params = []) => connection.prepare(sql).pluck().get(...params),
    row: async (sql, params = []) => connection.prepare(sql).get(...params),
    run: async (sql, params = []) => connection.prepare(sql).run(...params),
    transaction: async (fn) => { connection.exec('BEGIN IMMEDIATE'); try { await fn(); connection.exec('COMMIT'); } catch (error) { connection.exec('ROLLBACK'); throw error; } },
    close: async () => connection.close(),
  };
}

async function openMysql(database) {
  const mysql = requireFromApi('mysql2/promise');
  const connection = await mysql.createConnection({
    host: requiredEnv('RBAC_BOOTSTRAP_MYSQL_HOST'),
    port: Number(requiredEnv('RBAC_BOOTSTRAP_MYSQL_PORT')),
    user: requiredEnv('RBAC_BOOTSTRAP_MYSQL_USER'),
    password: requiredEnv('RBAC_BOOTSTRAP_MYSQL_PASSWORD'),
    database,
  });
  return {
    scalar: async (sql, params = []) => Number(Object.values((await connection.query(sql, params))[0][0] || {})[0] || 0),
    row: async (sql, params = []) => (await connection.query(sql, params))[0][0],
    run: async (sql, params = []) => connection.execute(sql, params),
    transaction: async (fn) => { await connection.beginTransaction(); try { await fn(); await connection.commit(); } catch (error) { await connection.rollback(); throw error; } },
    close: async () => connection.end(),
  };
}

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) fail(`${name} is required`);
  return value;
}

function fail(message) { throw new Error(message); }
