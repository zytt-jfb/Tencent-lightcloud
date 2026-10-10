const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const expectedEnvId = 'zy-data-d0garirza83768686';
const serviceName = 'biz-reporting-api-prod';
const envId = process.env.TCB_ENV_ID || '';

if (envId !== expectedEnvId) {
  console.error(`DEPLOY_ENV_ID_MISMATCH expected=${expectedEnvId} received=${envId || '<missing>'}`);
  process.exit(2);
}

const configPaths = [
  path.join(repoRoot, 'cloudbaserc.json'),
  path.join(repoRoot, 'apps', 'api', 'cloudbaserc.json'),
];
for (const configPath of configPaths) {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (config.envId !== expectedEnvId || config.cloudrun?.name !== serviceName) {
    console.error(`DEPLOY_CONFIG_MISMATCH path=${configPath}`);
    process.exit(2);
  }
}

for (const script of ['governance:gates', 'release:integrity:gate']) {
  const gate = spawnSync('pnpm', [script], {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (gate.status !== 0) {
    console.error(`DEPLOY_GATE_FAILED script=${script}`);
    process.exit(gate.status ?? 1);
  }
}

const result = spawnSync('tcb', [
  'cloudrun', 'deploy',
  '--serviceName', serviceName,
  '--source', repoRoot,
  '--port', '3000',
  '--traffic',
  '--json',
], {
  cwd: repoRoot,
  env: { ...process.env, TCB_ENV_ID: expectedEnvId },
  stdio: 'inherit',
  shell: false,
});

if (result.error) {
  console.error(`DEPLOY_EXEC_ERROR ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
