import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const localFailures = [];
const blockers = [];

run('migration_files', process.execPath, ['scripts/db/migrate.mjs', 'check-files']);
run('migration_001_immutable', 'git', ['diff', '--exit-code', '--', 'apps/api/migration/001_initial_tables.sql']);
const release = run('release_traceability', process.execPath, ['scripts/release/check-release-integrity.mjs', '--gate'], true);
if (release.status === 2) blockers.push('GIT_RELEASE_TRACEABILITY');
else if (release.status !== 0) localFailures.push('release_traceability');

const runtimeFiles = collect(path.join(repoRoot, 'apps'), new Set(['.ts', '.tsx', '.js']));
for (const file of runtimeFiles) {
  const source = fs.readFileSync(file, 'utf8');
  if (/\/auth\/(city|wechat)\/register/.test(source)) localFailures.push(`public_register_runtime:${path.relative(repoRoot, file)}`);
}

const taskSource = fs.readFileSync(path.join(repoRoot, 'specs/rbac-auth-export-settings/tasks.md'), 'utf8');
for (let item = 1; item <= 6; item += 1) {
  if (!new RegExp(`- \\[x\\] I-${item}\\b`).test(taskSource)) localFailures.push(`task_I-${item}_not_closed`);
}

for (const [gate, fileName] of [['REAL_MYSQL', 'mysql.json'], ['BROWSER', 'browser.json'], ['TEMP_UPLOAD_LIFECYCLE', 'storage.json']]) {
  const evidencePath = path.join(repoRoot, 'evidence/deployment-gates', fileName);
  if (!fs.existsSync(evidencePath)) { blockers.push(gate); continue; }
  try {
    const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
    if (evidence.status !== 'PASS' || evidence.environment !== 'isolated') blockers.push(gate);
  } catch { blockers.push(gate); }
}

console.log(`PLATFORM_COMPLETENESS_LOCAL status=${localFailures.length ? 'FAIL' : 'PASS'} failures=${localFailures.length}`);
for (const failure of localFailures) console.error(`PLATFORM_COMPLETENESS_FAILURE item=${failure}`);
console.log(`PLATFORM_COMPLETENESS_EXTERNAL status=${blockers.length ? 'BLOCKED' : 'PASS'} blockers=${[...new Set(blockers)].join(',') || 'none'}`);
console.log(`DEPLOYMENT_GATE status=${localFailures.length ? 'FAIL' : blockers.length ? 'BLOCKED' : 'PASS'}`);
if (localFailures.length) process.exit(1);
if (blockers.length) process.exit(2);

function run(label, command, args, allowBlocked = false) {
  const result = spawnSync(command, args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  console.log(`PLATFORM_CHECK item=${label} exit=${result.status}`);
  if (result.status !== 0 && !(allowBlocked && result.status === 2)) localFailures.push(label);
  return result;
}

function collect(directory, extensions) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (['dist', 'node_modules'].includes(entry.name)) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collect(target, extensions));
    else if (extensions.has(path.extname(entry.name))) files.push(target);
  }
  return files;
}
