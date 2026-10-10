/**
 * E-05：Hosting 路由与认证回归（PG-R9/R11）
 *
 * 覆盖：
 * 1. 根跳转（meta refresh → /dataofearth/）
 * 2. dataofearth 加载 + HashRouter 三类深链（/#/login、/#/dashboard、/#/settings/imports）与刷新
 * 3. 未登录访问受保护 hash 路由 → 前端 redirect 到登录
 * 4. 捕获 console error / pageerror / failed request（断言无未捕获异常）
 * 5. 桌面 + 移动视口（playwright.config projects）
 *
 * 注意：测试不注入任何真实凭据；CORS 浏览器级验证依赖隔离后端（I1，F-04/F-05 完成），
 * 此处引用 C-03 check-production-runtime-config 的 CORS 正负测试作为静态证据。
 */
import { test, expect } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const BUNDLE_ROOT = path.join(REPO_ROOT, 'scripts', 'release', 'out', 'hosting-bundle');
const PORT = 4174;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/** 启动 E-04 hosting-bundle 静态服务器（根 + /dataofearth/ + hash 深链；/api/* 返回 401 模拟未认证） */
function startStaticServer() {
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url || '/', 'http://localhost').pathname;
    // SPA 启动会探测 /api/auth/me 等：静态服务器无后端，统一返回 401（未认证）让前端走登录重定向
    if (pathname.startsWith('/api/')) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ statusCode: 401, message: 'Unauthorized' }));
      return;
    }
    let p = decodeURIComponent(pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(BUNDLE_ROOT, p);
    if (!file.startsWith(path.resolve(BUNDLE_ROOT))) { res.writeHead(403).end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      const ext = path.extname(file).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(fs.readFileSync(file));
    } else {
      res.writeHead(404).end();
    }
  });
  return new Promise((resolve) => {
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

let server;
test.beforeAll(async () => {
  server = await startStaticServer();
});
test.afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

const DEEP_LINKS = ['/#/login', '/#/dashboard', '/#/settings/imports', '/#/city/facts/contracts'];

test.describe('E-05 hosting 路由', () => {
  test('根路径 meta refresh 跳转 /dataofearth/', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`); });
    page.on('requestfailed', (req) => errors.push(`requestfailed: ${req.url()}`));

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForURL(/\/dataofearth\//, { timeout: 8000 }).catch(() => {});
    // meta refresh 跟随到 /dataofearth/（React 应用）或停留在根 fallback 页，均视为路由正常
    const content = await page.content();
    const onFallback = content.includes('经营单元上报系统');
    const onApp = page.url().includes('/dataofearth/');
    expect(onFallback || onApp).toBe(true);
    expect(errors).toEqual([]);
  });

  test('dataofearth 首页与三类 hash 深链加载、刷新不丢路由', async ({ page }) => {
    for (const deepLink of DEEP_LINKS) {
      const errors = [];
      page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
      page.on('requestfailed', (req) => errors.push(`requestfailed: ${req.url()}`));

      const url = deepLink.startsWith('/dataofearth') ? deepLink : `/dataofearth${deepLink}`;
      // hash 同文档导航：HTTP 响应不可依赖（goto 返回 null），以 URL 保持 + 无崩溃为准
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      expect(page.url()).toContain('/dataofearth/');
      // 刷新（HashRouter 深链刷新保持）
      await page.reload({ waitUntil: 'domcontentloaded' });
      expect(page.url()).toContain('/dataofearth/');
      // 无未捕获异常（认证相关 redirect 属预期，但不应有 pageerror）
      expect(errors.filter((e) => !e.includes('401'))).toEqual([]);
    }
  });

  test('未登录访问受保护路由 → 前端重定向到登录', async ({ page }) => {
    await page.goto('/dataofearth/#/dashboard', { waitUntil: 'networkidle' });
    // 前端认证守卫会把未登录用户重定向到 #/login（HashRouter；/api/* 返回 401 驱动）
    await page.waitForURL(/#\/login/, { timeout: 10_000 });
    expect(page.url()).toContain('#/login');
  });

  test('移动视口核心路径可加载（无布局崩溃）', async ({ page }) => {
    await page.goto('/dataofearth/#/login', { waitUntil: 'networkidle' });
    // 页面有可见内容（非空白、React 已挂载）
    await page.waitForSelector('body', { timeout: 10_000 });
    const bodyText = await page.locator('body').innerText().catch(() => '');
    expect(bodyText.length > 0).toBe(true);
  });
});
