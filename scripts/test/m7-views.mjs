/**
 * M7 前端截图验证（DEV-062）：
 *  - 桌面 1440x900 / 移动 390x844 视口
 *  - 登录 → 门户 → 合同/订单/完工/成本/分析/设置/权限管理 全链路
 *  - 每页检查水平溢出（无滚动条溢出/遮挡）
 *  - 四角色权限：super 全可见；city_user 菜单隐藏 + 直接 URL 403
 * 截图默认输出：.artifacts/m7-screenshots/；仅 M7_UPDATE_BASELINES=1 时更新基线。
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { resolveM7ScreenshotOutput } from './m7-screenshot-output.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const apiRoot = path.join(repoRoot, 'apps', 'api');
const requireFromApi = createRequire(path.join(apiRoot, 'package.json'));
const requireRoot = createRequire(path.join(repoRoot, 'package.json'));
const requireWeb = createRequire(path.join(repoRoot, 'apps', 'admin-web', 'package.json'));
const { chromium } = requireRoot('@playwright/test');

const testRoot = mkdtempSync(path.join(tmpdir(), 'biz-m7-views-'));
const database = path.join(testRoot, 'm7.sqlite');
const testPassword = randomBytes(24).toString('base64url');
const screenshotOutput = resolveM7ScreenshotOutput(repoRoot);
const screenshotDir = screenshotOutput.directory;
if (screenshotOutput.mode === 'artifact') rmSync(screenshotDir, { recursive: true, force: true });
mkdirSync(screenshotDir, { recursive: true });
console.log(`M7_SCREENSHOT_OUTPUT mode=${screenshotOutput.mode} directory=${screenshotDir}`);

const env = {
  ...process.env,
  NODE_ENV: 'test', DB_TYPE: 'sqlite', DB_DATABASE: database, DB_SYNC: 'false',
  FACT_SOURCE_STORAGE_ROOT: path.join(testRoot, 'src'),
  JWT_SECRET: randomBytes(32).toString('base64url'),
  AUTH_SECURITY_HMAC_KEY: randomBytes(32).toString('base64url'),
  JWT_ISSUER: 'biz-reporting-api', JWT_AUDIENCE: 'biz-reporting-clients',
  PORT: '0',
};

let apiProcess;
let viteProcess;
let apiBase = '';

// ---- 订单 fixture（供订单页展示 demo 订单）----
const XLSX = requireFromApi('xlsx');
const ORDER_HEADER = ['省份名称','地市名称','采购订单编号','供应商名称','订单主状态','含税总金额','物料名称','物料编码','合同编号','净价','运保费','建安费','费用类型','税率','税额','含税单价','采购数量','计量单位','收货人','收货人联系方式','收货人详细地址','通知人','下单时间','通知时间','附言信息','项目编号','项目名称','站址编号','站址信息','收货状态','商品名称','商品编号','物料源头贴签标识','是否补样订单'];

function buildOrderXlsxBuffer(po, contractNo, cityName, provinceName, amount, orderTime) {
  const row = new Array(34).fill('');
  row[0] = provinceName; row[1] = cityName; row[2] = po; row[3] = 'M7测试供应商';
  row[4] = '已提交'; row[5] = String(amount); row[6] = '物料A'; row[7] = `MAT-${po}`;
  row[8] = contractNo; row[9] = String(amount / 1.13); row[10] = '0'; row[11] = '0'; row[12] = '货物';
  row[13] = '13%'; row[14] = '0'; row[15] = '0'; row[16] = '1'; row[17] = '件';
  row[18] = '张收货'; row[19] = '13800138000'; row[20] = '山东省济南市测试路1号';
  row[21] = '通知人'; row[22] = orderTime; row[23] = orderTime; row[24] = '';
  row[25] = `PRJ-${po}`; row[26] = `项目-${po}`; row[27] = `SITE-${po}`; row[28] = '测试站址';
  row[29] = '已收货'; row[30] = '商品A'; row[31] = `SKU-${po}`; row[32] = '是'; row[33] = '否';
  const ws = XLSX.utils.aoa_to_sheet([ORDER_HEADER, row]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '电商化订单列表');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

async function uploadOrderAndWait(token, buffer, idempotencyKey) {
  const form = new FormData();
  form.append('idempotencyKey', idempotencyKey);
  form.append('file', new Blob([buffer]), 'm7-orders.xlsx');
  const res = await fetch(`${apiBase}/biz/orders/upload`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
  assert.equal(res.status, 201, `M7 order fixture upload must succeed: ${res.status}`);
  const { batchId } = await res.json();
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const detail = await (await fetch(`${apiBase}/biz/orders/batches/${batchId}`, { headers: { Authorization: `Bearer ${token}` } })).json();
    if (detail.batch?.status !== 'parsing') {
      assert.equal(detail.batch?.status, 'imported', `M7 order fixture batch must import: ${detail.batch?.failureReason ?? ''} errors=${JSON.stringify(detail.errors ?? []).slice(0, 600)}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('M7 order fixture batch timeout');
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitForHttp(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.status >= 200 && res.status < 500) return;
    } catch { /* not ready */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`not ready: ${url}`);
}

const checkOverflow = async (page) => page.evaluate(() => {
  const doc = document.scrollingElement;
  return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth, overflowX: doc.scrollWidth > doc.clientWidth + 1 };
});

async function login(page, username, password, webBase) {
  await page.goto(`${webBase}/#/biz/login`, { waitUntil: 'networkidle' });
  await page.getByTestId('biz-login-username').fill(username);
  await page.getByTestId('biz-login-password').fill(password);
  await page.getByTestId('biz-login-submit').click();
  await page.waitForURL('**/#/biz/portal', { timeout: 10_000 });
}

try {
  const { execFileSync } = await import('node:child_process');
  execFileSync(process.execPath, ['scripts/db/migrate.mjs', 'up'], { cwd: repoRoot, env, stdio: 'inherit' });
  execFileSync(process.execPath, ['scripts/auth/biz-init-super-admin.mjs'], {
    cwd: repoRoot, env: { ...env, BIZ_SUPER_ADMIN_USERNAME: 'm7_super', BIZ_SUPER_ADMIN_PASSWORD: testPassword }, stdio: 'inherit',
  });

  const apiPort = await freePort();
  const webPort = await freePort();
  apiBase = `http://127.0.0.1:${apiPort}/api`;
  const webBase = `http://127.0.0.1:${webPort}`;

  apiProcess = spawn(process.execPath, ['apps/api/dist/main.js'], {
    cwd: repoRoot, env: { ...env, PORT: String(apiPort) }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  apiProcess.stderr.on('data', (c) => process.stderr.write(`[api] ${c}`));
  await waitForHttp(`${apiBase}/biz/auth/me`);

  // vite bin 直接以 node 运行（Windows 下避免 .cmd 解析问题）
  const viteEntry = requireWeb.resolve('vite');
  const vitePkgRoot = path.dirname(path.dirname(path.dirname(viteEntry)));
  const viteBin = path.join(vitePkgRoot, 'node_modules', 'vite', 'bin', 'vite.js');
  viteProcess = spawn(process.execPath, [viteBin, '--port', String(webPort), '--strictPort'], {
    cwd: path.join(repoRoot, 'apps', 'admin-web'),
    env: { ...process.env, VITE_DEV_API_TARGET: `http://127.0.0.1:${apiPort}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  viteProcess.stderr.on('data', (c) => process.stderr.write(`[vite] ${c}`));
  await waitForHttp(`${webBase}/`);

  // 创建 admin/city_user 账号
  const loginRes = await fetch(`${apiBase}/biz/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'm7_super', password: testPassword }) });
  const superToken = (await loginRes.json()).accessToken;
  const provinces = await (await fetch(`${apiBase}/biz/admin/provinces`, { headers: { Authorization: `Bearer ${superToken}` } })).json();
  const cities = await (await fetch(`${apiBase}/biz/admin/cities`, { headers: { Authorization: `Bearer ${superToken}` } })).json();
  const shandong = provinces.items.find((p) => p.code === '370000').id;
  const jinan = cities.items.find((c) => c.code === '370100').id;
  for (const dto of [
    { username: 'm7_admin', password: testPassword, name: '管理员', roleCode: 'admin' },
    { username: 'm7_city', password: testPassword, name: '地市用户', roleCode: 'city_user', cityId: jinan },
  ]) {
    await fetch(`${apiBase}/biz/admin/users`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${superToken}` }, body: JSON.stringify(dto) });
  }

  const demoMonth = new Date().toISOString().slice(0, 7);
  const contractResponse = await fetch(`${apiBase}/biz/contracts`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${superToken}` },
    body: JSON.stringify({ contractNo: 'M7-VIEW-CONTRACT', contractName: 'M7 view regression contract', taxInclusiveAmountFen: 100000, provinceId: shandong, startDate: `${demoMonth}-01`, endDate: '2026-12-31' }),
  });
  assert.equal(contractResponse.status, 201, 'M7 contract fixture must be created');
  const viewContract = await contractResponse.json();
  const allocationResponse = await fetch(`${apiBase}/biz/contracts/${viewContract.id}/allocations`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${superToken}` },
    body: JSON.stringify({ cityId: jinan, quotaFen: 100000 }),
  });
  assert.equal(allocationResponse.status, 201, 'M7 allocation fixture must be created');
  const rateResponse = await fetch(`${apiBase}/biz/contracts/${viewContract.id}/fee-rates`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${superToken}` },
    body: JSON.stringify({ cityId: jinan, effectiveMonth: demoMonth, rateBp: 1200, changeReason: 'M7 view fixture' }),
  });
  assert.equal(rateResponse.status, 201, 'M7 fee-rate fixture must be created');
  // 激活合同：bizContractList 仅返回 active 合同，未激活的 draft 合同不会出现在列表中
  const activateResponse = await fetch(`${apiBase}/biz/contracts/${viewContract.id}/activate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${superToken}` },
  });
  assert.equal(activateResponse.status, 201, 'M7 contract must be activated');
  const offlineResponse = await fetch(`${apiBase}/biz/offline-completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${superToken}` },
    body: JSON.stringify({ contractId: viewContract.id, cityId: jinan, businessMonth: demoMonth, amountFen: 10000, summary: 'M7 view offline fixture' }),
  });
  assert.equal(offlineResponse.status, 201, 'M7 offline fixture must be created');
  const costResponse = await fetch(`${apiBase}/biz/costs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${superToken}` },
    body: JSON.stringify({ cityId: jinan, businessMonth: demoMonth, categoryCode: 'labor', amountFen: 5000, description: 'M7 view cost fixture' }),
  });
  assert.equal(costResponse.status, 201, 'M7 cost fixture must be created');

  // 订单 fixture：super_admin 上传一行订单，供订单页展示 demo 订单（M7-PO-001）
  const orderBuffer = buildOrderXlsxBuffer('M7-PO-001', 'M7-VIEW-CONTRACT', '济南市', '山东省', 1000, `${demoMonth}-15 10:00:00`);
  await uploadOrderAndWait(superToken, orderBuffer, `m7-order-${Date.now()}`);

  const browser = await chromium.launch();
  const viewports = [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'mobile', width: 390, height: 844 },
  ];

  const pages = [
    { route: '#/biz/portal', file: 'portal' },
    { route: '#/biz/operation', file: 'contracts' },
    { route: '#/biz/orders', file: 'orders' },
    { route: '#/biz/offline-completions', file: 'offline-completions' },
    { route: '#/biz/costs', file: 'costs' },
    { route: '#/biz/analysis', file: 'analysis' },
    { route: '#/biz/settings', file: 'settings' },
    { route: '#/biz/admin', file: 'admin' },
  ];

  const report = [];
  for (const vp of viewports) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await context.newPage();

    // 登录页
    await page.goto(`${webBase}/#/biz/login`, { waitUntil: 'networkidle' });
    assert.equal(await page.getByRole('heading', { name: '中屹技术有限公司欢迎您！' }).count(), 1, 'login page must show the prototype welcome heading');
    const loginBackground = await page.locator('.biz-login-page').evaluate((element) => getComputedStyle(element).backgroundImage);
    assert.match(loginBackground, /login-sky-clouds\.jpg/, 'login page must use the prototype cloud background');
    await page.screenshot({ path: path.join(screenshotDir, `login-${vp.name}.png`) });

    // super_admin 登录
    await login(page, 'm7_super', testPassword, webBase);
    // super_admin 侧边栏应包含订单管理（前端入口以 operation.order.upload 为准，super 通配可见）
    // 仅桌面视口断言：移动端菜单在未打开的 Drawer 中，不渲染 .ant-menu
    if (vp.name === 'desktop') {
      await page.goto(`${webBase}/#/biz/operation`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(600);
      assert.ok((await page.locator('.ant-menu').innerText()).includes('订单管理'), 'super_admin menu must include 订单管理');
    }
    for (const p of pages) {
      await page.goto(`${webBase}/${p.route}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(600);
      assert.equal(await page.locator('.v3-page-head .v3-page-description').count(), 0, `${p.file} must not show a page description under its title`);
      if (p.file === 'portal') {
        assert.equal(await page.locator('.ant-layout-sider').count(), 0, 'module portal must not show business sidebar');
        assert.equal(await page.getByText('经营概览', { exact: true }).count(), 0, 'module portal must not show the removed overview card');
        assert.equal(await page.getByText('经营管理', { exact: true }).count(), 1, 'module portal must show operation as a first-level entry');
      }
      if (p.file === 'orders') {
        await page.getByText('M7-PO-001').first().waitFor({ timeout: 10_000 });
      }
      if (p.file === 'admin') {
        await page.getByRole('button', { name: '重置密码' }).first().click();
        const resetDialog = page.getByRole('dialog', { name: '重置密码' });
        await resetDialog.getByRole('textbox').waitFor();
        assert.equal(await resetDialog.getByRole('textbox').count(), 1, 'reset password uses an in-page input');
      }
      await page.screenshot({ path: path.join(screenshotDir, `${p.file}-${vp.name}.png`) });
      const overflow = await checkOverflow(page);
      if (overflow.overflowX) report.push({ page: p.file, vp: vp.name, issue: `horizontal overflow ${overflow.scrollWidth} > ${overflow.clientWidth}` });
    }
    await context.close();
  }

  // admin：省市字典接口无用户管理权限时，业务列表仍应正常显示。
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await login(page, 'm7_admin', testPassword, webBase);
    for (const fixture of [
      { route: '#/biz/operation', text: 'M7-VIEW-CONTRACT' },
      { route: '#/biz/offline-completions', text: 'M7 view offline fixture' },
      { route: '#/biz/costs', text: 'M7 view cost fixture' },
    ]) {
      await page.goto(`${webBase}/${fixture.route}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1000);
      await page.getByText(fixture.text, { exact: true }).waitFor({ timeout: 10_000 });
    }
    await context.close();
  }

  // admin：订单入口可见 + 线下完工地市下拉来自合同分配（不依赖 /biz/admin/cities 字典）
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await login(page, 'm7_admin', testPassword, webBase);
    await page.goto(`${webBase}/#/biz/operation`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    assert.ok((await page.locator('.ant-menu').innerText()).includes('订单管理'), 'admin menu must include 订单管理');
    await page.goto(`${webBase}/#/biz/offline-completions`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: '新建完工' }).click();
    await page.locator('.ant-drawer-body').waitFor({ timeout: 5000 });
    await page.waitForTimeout(800);
    await page.locator('[data-testid="offline-contract-select"] .ant-select-selector').click();
    await page.locator('.ant-select-item-option').filter({ hasText: 'M7-VIEW-CONTRACT' }).first().click();
    await page.waitForTimeout(800);
    await page.locator('[data-testid="offline-city-select"] .ant-select-selector').click();
    const adminCityOptions = await page.locator('.ant-select-item-option').allInnerTexts();
    assert.ok(adminCityOptions.length > 0, 'admin offline city dropdown must have options');
    assert.ok(adminCityOptions.some((t) => t.includes('济南市')), `admin offline city options must include 济南市, got: ${adminCityOptions.join(',')}`);
    await page.keyboard.press('Escape');
    await context.close();
  }

  // city_user：菜单隐藏 + 直接 URL 权限验证 + 订单入口隐藏 + 线下完工地市来自合同分配
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await login(page, 'm7_city', testPassword, webBase);
    await page.goto(`${webBase}/#/biz/operation`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    // 菜单不应包含权限管理（operation.user.manage）
    const menuText = await page.locator('.ant-menu').innerText();
    assert.ok(!menuText.includes('权限管理'), 'city_user menu must NOT include 权限管理');
    assert.ok(!menuText.includes('订单管理'), 'city_user menu must NOT include 订单管理');
    assert.ok(!menuText.includes('系统设置') || true, 'city_user may see settings read menu');
    // 直接 URL 访问无权限页面 → 前端 403 结果页（后端 403 提示）
    await page.goto(`${webBase}/#/biz/admin`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    const bodyText = await page.locator('body').innerText();
    assert.ok(bodyText.includes('无权限访问') || bodyText.includes('权限不足') || bodyText.includes('403'), `city_user direct /biz/admin must show 403, got: ${bodyText.slice(0, 80)}`);
    await page.screenshot({ path: path.join(screenshotDir, 'city-403-direct-url.png') });
    // 直接访问订单路由 → 页面级权限保护跳回经营管理，不渲染上传区域与订单列表
    await page.goto(`${webBase}/#/biz/orders`, { waitUntil: 'networkidle' });
    await page.waitForURL('**/#/biz/operation', { timeout: 10_000 });
    await page.waitForTimeout(600);
    const bodyAfterOrderRedirect = await page.locator('body').innerText();
    assert.ok(!bodyAfterOrderRedirect.includes('上传订单文件'), 'city_user direct /biz/orders must not render upload area');
    assert.ok(!bodyAfterOrderRedirect.includes('导入批次'), 'city_user direct /biz/orders must not render batch list');
    assert.ok(!bodyAfterOrderRedirect.includes('M7-PO-001'), 'city_user direct /biz/orders must not render order rows');
    await page.screenshot({ path: path.join(screenshotDir, 'city-orders-redirect.png') });
    // 线下完工：打开新建抽屉，选择合同后地市下拉来自合同分配（不调用 /api/biz/admin/cities）
    await page.goto(`${webBase}/#/biz/offline-completions`, { waitUntil: 'networkidle' });
    let adminCitiesCalled = false;
    page.on('request', (req) => {
      if (req.url().includes('/biz/admin/cities')) adminCitiesCalled = true;
    });
    await page.getByRole('button', { name: '新建完工' }).click();
    await page.locator('.ant-drawer-body').waitFor({ timeout: 5000 });
    await page.waitForTimeout(800);
    await page.locator('[data-testid="offline-contract-select"] .ant-select-selector').click();
    await page.locator('.ant-select-item-option').filter({ hasText: 'M7-VIEW-CONTRACT' }).first().click();
    await page.waitForTimeout(800);
    await page.locator('[data-testid="offline-city-select"] .ant-select-selector').click();
    const cityOptionsText = await page.locator('.ant-select-item-option').allInnerTexts();
    assert.ok(cityOptionsText.length > 0, 'city_user offline city dropdown must have options');
    assert.ok(cityOptionsText.some((t) => t.includes('济南市')), `city_user offline city options must include 济南市, got: ${cityOptionsText.join(',')}`);
    await page.keyboard.press('Escape');
    assert.equal(adminCitiesCalled, false, 'offline completions must NOT call /api/biz/admin/cities');
    await page.screenshot({ path: path.join(screenshotDir, 'city-offline-create-cities.png') });
    await context.close();
  }

  await browser.close();

  if (report.length > 0) {
    console.error('OVERFLOW_ISSUES:', JSON.stringify(report));
    process.exitCode = 1;
  } else {
    console.log('M7_VIEWS_OK viewports=desktop,1440x900+mobile,390x844 pages=login,portal,contracts,orders,offline,completions,costs,analysis,settings,admin overflow=none city=menu-hidden+403-direct-url');
  }
} finally {
  if (viteProcess && viteProcess.exitCode === null) viteProcess.kill('SIGTERM');
  if (apiProcess && apiProcess.exitCode === null) apiProcess.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 1000));
  try { rmSync(testRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 300 }); } catch { console.log('M7_VIEWS_CLEANUP_WARN'); }
  console.log('M7_VIEWS_CLEANUP_OK');
}
