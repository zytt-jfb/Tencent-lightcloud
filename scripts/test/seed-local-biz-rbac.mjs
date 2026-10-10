import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const database = process.argv[2];
if (!database || !path.isAbsolute(database)) throw new Error('Usage: node scripts/test/seed-local-biz-rbac.mjs <absolute-sqlite-path>');
const requireFromApi = createRequire(path.join(repoRoot, 'apps', 'api', 'package.json'));
const Database = requireFromApi('better-sqlite3');
const db = new Database(database);
db.function('UUID', () => randomUUID());
for (const filename of ['011_biz_seed_main_data.sql', '012_biz_permission_seed.sql', '019_biz_admin_crud_permissions.sql', '021_biz_contract_permissions.sql', '025_biz_messages_announcements.sql']) {
  const sql = readFileSync(path.join(repoRoot, 'apps', 'api', 'migration', filename), 'utf8').split('\n').filter((line) => !line.startsWith('SET NAMES')).join('\n');
  try { db.exec(sql); } catch (error) {
    if (!(error instanceof Error) || !/already exists|duplicate/i.test(error.message)) throw error;
  }
}
db.prepare("INSERT OR IGNORE INTO biz_permissions (id, code, name, module_id, action) VALUES (?, ?, ?, ?, ?)").run('00000000-0000-4000-8000-000000000520', 'operation.region.manage', '维护省市设置', '00000000-0000-4000-8000-000000000020', 'manage');
db.prepare("INSERT OR IGNORE INTO biz_role_permissions (id, role_id, permission_code) VALUES (?, ?, ?)").run('00000000-0000-4000-8000-000000000521', '00000000-0000-4000-8000-000000000002', 'operation.region.manage');
const permissions = db.prepare('SELECT COUNT(*) AS count FROM biz_permissions').get().count;
const roles = db.prepare('SELECT COUNT(*) AS count FROM biz_roles').get().count;
console.log(`LOCAL_BIZ_RBAC_SEEDED roles=${roles} permissions=${permissions}`);
db.close();
