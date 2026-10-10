/**
 * M12 浏览器级交互测试（DEV-13，发布前收口）：
 * - Chromium + WebKit（Safari 引擎）执行同一登录、筛选、导出和合同详情场景。
 * - 验证月份/地市筛选请求及结果、清空筛选、CSV 当前视图内容和合同日期显示。
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const requireRoot = createRequire(path.join(repoRoot, 'package.json'));
const requireWeb = createRequire(path.join(repoRoot, 'apps', 'admin-web', 'package.json'));
const requireApi = createRequire(path.join(repoRoot, 'apps', 'api', 'package.json'));
const { chromium, webkit } = requireRoot('@playwright/test');
const Database = requireApi('better-sqlite3');

const testRoot = mkdtempSync(path.join(tmpdir(), 'biz-m12-interact-'));
const database = path.join(testRoot, 'm12.sqlite');
const testAdminPassword = randomBytes(24).toString('base64url');
const env = {
  ...process.env,
  NODE_ENV: 'test', DB_TYPE: 'sqlite', DB_DATABASE: database, DB_SYNC: 'false',
  FACT_SOURCE_STORAGE_ROOT: path.join(testRoot, 'src'),
  JWT_SECRET: randomBytes(32).toString('base64url'),
  AUTH_SECURITY_HMAC_KEY: randomBytes(32).toString('base64url'),
  JWT_ISSUER: 'biz-reporting-api', JWT_AUDIENCE: 'biz-reporting-clients', PORT: '0',
};

let apiProcess;
let viteProcess;

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForHttp(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.status >= 200 && response.status < 500) return;
    } catch { /* not ready */ }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`not ready: ${url}`);
}

async function api(base, method, urlPath, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${base}${urlPath}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data };
}

function parseCsvLine(line) {
  const cells = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted && char === '"' && line[index + 1] === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      cells.push(value);
      value = '';
    } else {
      value += char;
    }
  }
  cells.push(value);
  return cells;
}

function responseFor(pathname, expectedParams) {
  return (response) => {
    if (!response.url().includes(pathname) || response.status() !== 200) return false;
    const url = new URL(response.url());
    return Object.entries(expectedParams).every(([key, value]) => url.searchParams.get(key) === value);
  };
}

async function chooseOption(page, testId, label) {
  await page.getByTestId(testId).click();
  const option = page.locator('.ant-select-item-option').filter({ hasText: label }).first();
  await option.waitFor({ state: 'visible' });
  await option.click();
}

async function runBrowserScenario({ browserName, browserType, webBase, jinan, jinanName, dezhouName, password }) {
  const executablePath = browserType.executablePath();
  if (!existsSync(executablePath)) {
    throw new Error(`${browserName} browser is not installed at ${executablePath}; run pnpm exec playwright install chromium webkit`);
  }

  const browser = await browserType.launch();
  try {
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    const browserErrors = [];
    page.on('pageerror', (error) => browserErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(message.text());
    });

    await page.goto(`${webBase}/#/biz/login`, { waitUntil: 'networkidle' });
    await page.getByTestId('biz-login-username').fill('m12_super');
    await page.getByTestId('biz-login-password').fill(password);
    await page.getByTestId('biz-login-submit').click();
    await page.waitForURL('**/#/biz/portal', { timeout: 10_000 });
    await page.goto(`${webBase}/#/biz/analysis`, { waitUntil: 'networkidle' });
    await page.getByTestId('analysis-month-filter').waitFor();

    assert.ok(await page.getByTestId('analysis-month-filter').isVisible(), `${browserName}: month Select rendered`);
    assert.ok(await page.getByTestId('analysis-city-filter').isVisible(), `${browserName}: city Select rendered`);
    assert.ok(await page.getByTestId('analysis-export').isVisible(), `${browserName}: export button rendered`);
    const pageText = await page.locator('body').innerText();
    assert.ok(pageText.includes('累计库存口径'), `${browserName}: inventory cumulative label present`);
    assert.ok(pageText.includes('不受月份筛选影响'), `${browserName}: alerts month-independent label present`);
    assert.ok((await page.getByText(/^\d{4}年\d{2}月$/).allInnerTexts()).includes('2026年06月'), `${browserName}: trend month is yyyy年mm月`);

    const monthRequest = page.waitForResponse(responseFor('/api/biz/analysis/overview', { month: '2026-06' }));
    await chooseOption(page, 'analysis-month-filter', '2026年06月');
    await monthRequest;

    const cityRequest = page.waitForResponse(responseFor('/api/biz/analysis/overview', { month: '2026-06', cityId: jinan }));
    await chooseOption(page, 'analysis-city-filter', jinanName);
    await cityRequest;

    const cityTable = page.getByTestId('analysis-city-table');
    await cityTable.locator('tbody tr').filter({ hasText: dezhouName }).waitFor({ state: 'detached' });
    await cityTable.locator('tbody tr').filter({ hasText: jinanName }).first().waitFor();
    assert.equal(await cityTable.locator('tbody tr').filter({ hasText: dezhouName }).count(), 0, `${browserName}: city filter removes ${dezhouName} from city result`);
    assert.equal(await cityTable.locator('tbody tr').filter({ hasText: jinanName }).count(), 1, `${browserName}: city filter retains only ${jinanName}`);
    assert.ok(await page.getByTestId('analysis-clear-filter').isVisible(), `${browserName}: clear-filter appears`);

    const downloadPromise = page.waitForEvent('download', { timeout: 10_000 });
    await page.getByTestId('analysis-export').click();
    const download = await downloadPromise;
    assert.match(download.suggestedFilename(), /^经营分析-地市指标-2026-06\.csv$/, `${browserName}: filtered export filename`);
    const downloadPath = await download.path();
    assert.ok(downloadPath, `${browserName}: download path available`);
    const lines = readFileSync(downloadPath, 'utf8').replace(/^\uFEFF/, '').trim().split(/\r?\n/);
    assert.equal(lines.length, 2, `${browserName}: filtered CSV has header plus one city row`);
    const header = parseCsvLine(lines[0]);
    const row = parseCsvLine(lines[1]);
    assert.equal(header.length, 9, `${browserName}: CSV header has 9 columns`);
    assert.equal(row.length, 9, `${browserName}: CSV row has 9 columns`);
    assert.equal(row[0], jinanName, `${browserName}: CSV contains filtered city name`);
    assert.equal(row[2], '500,000.00', `${browserName}: CSV contract amount is formatted and escaped`);
    assert.equal(row[4], '100,000.00', `${browserName}: CSV offline completion amount is formatted and escaped`);

    await page.getByTestId('analysis-clear-filter').click();
    await cityTable.locator('tbody tr').filter({ hasText: dezhouName }).first().waitFor();
    assert.equal(await cityTable.locator('tbody tr').filter({ hasText: dezhouName }).count(), 1, `${browserName}: clear-filter restores ${dezhouName} to city result`);
    assert.equal(await page.getByTestId('analysis-clear-filter').count(), 0, `${browserName}: clear-filter hides after reset`);

    // P2-1: formula-like text is neutralized while negative numeric values remain numeric.
    const fullDownloadPromise = page.waitForEvent('download', { timeout: 10_000 });
    await page.getByTestId('analysis-export').click();
    const fullDownload = await fullDownloadPromise;
    assert.match(fullDownload.suggestedFilename(), /^经营分析-地市指标-累计\.csv$/, `${browserName}: full export filename uses 累计`);
    const fullPath = await fullDownload.path();
    assert.ok(fullPath, `${browserName}: full download path available`);
    const fullLines = readFileSync(fullPath, 'utf8').replace(/^\uFEFF/, '').trim().split(/\r?\n/);
    assert.equal(fullLines.length, 4, `${browserName}: full CSV header plus three city rows`);
    const fullRows = fullLines.slice(1).map(parseCsvLine);
    const injected = fullRows.find((r) => r[0].includes('1+1'));
    assert.ok(injected, `${browserName}: injected formula city present in full export`);
    assert.ok(!/^[=+\-@]/.test(injected[0]), `${browserName}: injected city name has no bare formula prefix`);
    assert.ok(injected[0].startsWith("'"), `${browserName}: injected city name neutralized with quote prefix`);
    assert.equal(injected[2], '300,000.00', `${browserName}: injected city contract amount stays numeric`);
    assert.match(injected[7], /^-\d{1,3}(,\d{3})*\.\d{2}$/, `${browserName}: injected city negative net profit stays numeric`);
    assert.ok(!injected[7].startsWith("'"), `${browserName}: negative net profit is not quoted as text`);
    const jinanFullRow = fullRows.find((r) => r[0] === jinanName);
    assert.equal(jinanFullRow[2], '500,000.00', `${browserName}: jinan contract amount stays numeric in full export`);

    await page.goto(`${webBase}/#/biz/operation`, { waitUntil: 'networkidle' });
    await page.getByTestId('contract-detail-HT-M12-JINAN').click();
    await page.getByTestId('contract-start-date').waitFor();
    assert.equal(await page.getByTestId('contract-start-date').innerText(), '2026年01月', `${browserName}: contract start date formatted yyyy年mm月`);
    assert.equal(await page.getByTestId('contract-end-date').innerText(), '2026年12月', `${browserName}: contract end date formatted yyyy年mm月`);
    assert.equal(await page.getByText('2026-01-01', { exact: true }).count(), 0, `${browserName}: raw contract start date is not displayed`);
    assert.deepEqual(browserErrors, [], `${browserName}: no browser console/page errors`);
    await context.close();
    console.log(`M12_${browserName.toUpperCase()}_OK login/filter/request/result/export/contract-date`);
  } finally {
    await browser.close();
  }
}

try {
  const { execFileSync } = await import('node:child_process');
  execFileSync(process.execPath, ['scripts/db/migrate.mjs', 'up'], { cwd: repoRoot, env, stdio: 'inherit' });
  execFileSync(process.execPath, ['scripts/auth/biz-init-super-admin.mjs'], {
    cwd: repoRoot, env: { ...env, BIZ_SUPER_ADMIN_USERNAME: 'm12_super', BIZ_SUPER_ADMIN_PASSWORD: testAdminPassword }, stdio: 'inherit',
  });
  const fixtureDb = new Database(database);
  // P2-1 公式注入回归数据：SQL 直插带「前置空白符」的公式前缀城市名（admin API 会对 name trim，无法构造该场景）
  const shandongRow = fixtureDb.prepare("SELECT id FROM biz_provinces WHERE code = '370000'").get();
  assert.ok(shandongRow, 'M12 shandong province fixture available');
  const injectedCityId = randomUUID();
  const insertInjected = fixtureDb.prepare(
    "INSERT INTO biz_cities (id, province_id, code, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', datetime('now'), datetime('now'))",
  ).run(injectedCityId, shandongRow.id, '379999', '  =1+1');
  assert.equal(insertInjected.changes, 1, 'M12 formula-injection city fixture inserted');
  fixtureDb.close();

  const apiPort = await freePort();
  const webPort = await freePort();
  const apiBase = `http://127.0.0.1:${apiPort}/api`;
  const webBase = `http://127.0.0.1:${webPort}`;
  apiProcess = spawn(process.execPath, ['apps/api/dist/main.js'], { cwd: repoRoot, env: { ...env, PORT: String(apiPort) }, stdio: ['ignore', 'pipe', 'pipe'] });
  apiProcess.stderr.on('data', (chunk) => process.stderr.write(`[api] ${chunk}`));
  await waitForHttp(`${apiBase}/biz/auth/me`);

  const viteEntry = requireWeb.resolve('vite');
  const vitePkgRoot = path.dirname(path.dirname(path.dirname(viteEntry)));
  const viteBin = path.join(vitePkgRoot, 'node_modules', 'vite', 'bin', 'vite.js');
  viteProcess = spawn(process.execPath, [viteBin, '--port', String(webPort), '--strictPort'], {
    cwd: path.join(repoRoot, 'apps', 'admin-web'), env: { ...process.env, VITE_DEV_API_TARGET: `http://127.0.0.1:${apiPort}` }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  viteProcess.stderr.on('data', (chunk) => process.stderr.write(`[vite] ${chunk}`));
  await waitForHttp(`${webBase}/`);

  const login = await api(apiBase, 'POST', '/biz/auth/login', { body: { username: 'm12_super', password: testAdminPassword } });
  assert.equal(login.status, 201, 'M12 test super admin login');
  const superToken = login.data.accessToken;
  const provinces = (await api(apiBase, 'GET', '/biz/admin/provinces', { token: superToken })).data;
  const cities = (await api(apiBase, 'GET', '/biz/admin/cities', { token: superToken })).data;
  const shandong = provinces.items.find((province) => province.code === '370000').id;
  const jinan = cities.items.find((city) => city.code === '370100');
  const dezhou = cities.items.find((city) => city.code === '371400');
  assert.ok(jinan && dezhou, 'M12 fixture cities available');

  const createContract = async ({ contractNo, contractName, cityId, amountFen, completionFen }) => {
    const contract = await api(apiBase, 'POST', '/biz/contracts', { token: superToken, body: {
      contractNo, contractName, taxInclusiveAmountFen: amountFen, provinceId: shandong, startDate: '2026-01-01', endDate: '2026-12-31',
    } });
    assert.equal(contract.status, 201, `M12 create ${contractNo}`);
    await api(apiBase, 'POST', `/biz/contracts/${contract.data.id}/allocations`, { token: superToken, body: { cityId, quotaFen: amountFen } });
    const offline = await api(apiBase, 'POST', '/biz/offline-completions', { token: superToken, body: {
      contractId: contract.data.id, cityId, businessMonth: '2026-06', amountFen: completionFen, summary: `${contractNo} 完工`,
    } });
    await api(apiBase, 'POST', `/biz/offline-completions/${offline.data.id}/submit`, { token: superToken });
    const approved = await api(apiBase, 'POST', `/biz/offline-completions/${offline.data.id}/approve`, { token: superToken });
    assert.ok([200, 201].includes(approved.status), `M12 approve ${contractNo}`);
  };
  await createContract({ contractNo: 'HT-M12-JINAN', contractName: 'M12 济南交互合同', cityId: jinan.id, amountFen: 500_000_00, completionFen: 100_000_00 });
  await createContract({ contractNo: 'HT-M12-DEZHOU', contractName: 'M12 德州交互合同', cityId: dezhou.id, amountFen: 300_000_00, completionFen: 200_000_00 });
  // 注入城市合同：合同额 300,000.00 元、完工 50,000.00 元（毛利 50,000.00）；
  // 再注入成本 100,000.00 元 → 净利 = 50,000.00 - 100,000.00 = -50,000.00 元（负数金额列保持数值语义）
  await createContract({ contractNo: 'HT-M12-INJ', contractName: 'M12 公式注入合同', cityId: injectedCityId, amountFen: 300_000_00, completionFen: 50_000_00 });
  const negativeCost = await api(apiBase, 'POST', '/biz/costs', { token: superToken, body: {
    cityId: injectedCityId, businessMonth: '2026-06', categoryCode: 'labor', amountFen: 100_000_00, description: 'P2-1 注入负净利',
  } });
  assert.equal(negativeCost.status, 201, 'P2-1 negative CSV fixture cost created');
  const submittedCost = await api(apiBase, 'POST', `/biz/costs/${negativeCost.data.id}/submit`, { token: superToken });
  assert.ok([200, 201].includes(submittedCost.status), 'P2-1 negative CSV fixture cost submitted');
  const approvedCost = await api(apiBase, 'POST', `/biz/costs/${negativeCost.data.id}/approve`, { token: superToken });
  assert.ok([200, 201].includes(approvedCost.status), 'P2-1 negative CSV fixture cost approved');
  await api(apiBase, 'POST', '/biz/aggregates/recalc', { token: superToken, body: { scope: {}, confirmAll: true } });
  const byCity = (await api(apiBase, 'GET', '/biz/analysis/by-city?month=2026-06', { token: superToken })).data.items;
  const cityDisplayName = (cityId) => {
    const row = byCity.find((item) => String(item.cityId) === String(cityId));
    assert.ok(row?.cityName, `M12 by-city has display name for ${cityId}`);
    return String(row.cityName);
  };

  for (const [browserName, browserType] of [['chromium', chromium], ['webkit', webkit]]) {
    await runBrowserScenario({ browserName, browserType, webBase, jinan: jinan.id, jinanName: cityDisplayName(jinan.id), dezhouName: cityDisplayName(dezhou.id), password: testAdminPassword });
  }
  console.log('M12_INTERACTION_OK chromium+webkit filter/export/contract-date all passed');
} finally {
  if (apiProcess && apiProcess.exitCode === null) apiProcess.kill('SIGTERM');
  if (viteProcess && viteProcess.exitCode === null) viteProcess.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 1000));
  try { rmSync(testRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 300 }); } catch { console.log('M12_INTERACTION_CLEANUP_WARN'); }
  console.log('M12_INTERACTION_CLEANUP_OK');
}
