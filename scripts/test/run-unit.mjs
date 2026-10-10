import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const apiRoot = path.join(repoRoot, 'apps', 'api');
const apiRequire = createRequire(path.join(apiRoot, 'package.json'));
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'biz-reporting-unit-'));
const compiledRoot = path.join(tempRoot, 'compiled');

const localTests = [
  'apps/api/test/business-calculator.test.cjs',
  'apps/api/test/city-import-access.test.mjs',
  'apps/api/test/city-password-auth.test.cjs',
  'apps/api/test/cost-import-scope.test.cjs',
  'apps/api/test/import-overwrite.test.cjs',
  'apps/api/test/legacy-role-migration.test.cjs',
  'apps/api/test/security-scope.test.cjs',
  'apps/api/test/snapshot-manual-refresh.test.cjs',
  'apps/api/test/year-summary-source.test.cjs',
  'apps/api/test/auth-rate-limit.integration.mjs',
  'apps/api/test/export-access.integration.mjs',
  'apps/api/test/http-logging.test.mjs',
  'apps/api/test/import-job-concurrency.integration.mjs',
  'apps/api/test/import-job-list-memory.mjs',
  'apps/api/test/import-job-storage.integration.mjs',
  'apps/api/test/login-security.test.cjs',
  'apps/api/test/readiness.test.mjs',
  'apps/api/test/reporting-import-atomicity.integration.mjs',
  'apps/api/test/security-headers.test.mjs',
  'apps/api/test/workbook-policy.test.cjs',
  'scripts/test/migrate-import-job-files.test.mjs',
  'scripts/test/m7-screenshot-output.test.mjs',
];

const i1EnvironmentNames = [
  'BASE',
  'TEST_DB',
  'DUAL_CHAIN_CITY_USER_A_TOKEN',
  'DUAL_CHAIN_CITY_USER_B_TOKEN',
  'IMPORT_LOOP_OWNER_TOKEN',
  'IMPORT_LOOP_OUTSIDER_TOKEN',
  'IMPORT_LOOP_SYSTEM_ADMIN_TOKEN',
  'REAL_WRITE_CITY_USER_TOKEN',
  'MIGRATION_TEST_MYSQL_HOST',
  'MIGRATION_TEST_MYSQL_PORT',
  'MIGRATION_TEST_MYSQL_USER',
  'MIGRATION_TEST_MYSQL_PASSWORD',
  'I1_MYSQL_HOST',
  'I1_MYSQL_PORT',
  'I1_MYSQL_USER',
  'I1_MYSQL_PASSWORD',
  'I1_MYSQL_DATABASE',
  'I1_MYSQL_ISOLATED',
];

try {
  const tsc = apiRequire.resolve('typescript/bin/tsc');
  execFileSync(
    process.execPath,
    [
      tsc,
      '-p',
      path.join(apiRoot, 'tsconfig.v3-check.json'),
      '--noEmit',
      'false',
      '--declaration',
      'false',
      '--outDir',
      compiledRoot,
      '--pretty',
      'false',
    ],
    { cwd: repoRoot, stdio: 'inherit' },
  );

  const environment = {
    ...process.env,
    NODE_ENV: 'test',
    API_TEST_COMPILED_ROOT: path.join(compiledRoot, 'apps', 'api', 'src'),
    NODE_PATH: [
      path.join(apiRoot, 'node_modules'),
      path.join(repoRoot, 'node_modules'),
      process.env.NODE_PATH,
    ].filter(Boolean).join(path.delimiter),
  };
  for (const name of i1EnvironmentNames) delete environment[name];

  for (const relativePath of localTests) {
    console.log(`UNIT_FILE_START ${relativePath}`);
    const result = spawnSync(process.execPath, [path.join(repoRoot, relativePath)], {
      cwd: repoRoot,
      env: environment,
      stdio: 'inherit',
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`UNIT_FILE_FAILED path=${relativePath} exit=${result.status}`);
    }
    console.log(`UNIT_FILE_OK ${relativePath}`);
  }

  console.log(`UNIT_SUITE_OK files=${localTests.length}`);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
