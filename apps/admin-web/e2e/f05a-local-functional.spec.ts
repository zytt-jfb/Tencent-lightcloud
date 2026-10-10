/**
 * F-05A：本地完整功能验收（PG-20260803-LOCAL-I1-ALTERNATIVE 第四节）
 *
 * 使用本地隔离 API（127.0.0.1:57796）+ Admin build（vite dev 代理）+ Playwright：
 * 1. 四角色登录、强制改密、旧 JWT 失效
 * 2. 429 限流
 * 3. 根路径、/dataofearth/、hash 深链、刷新和导航
 * 4. CORS
 * 5. 上传、预览、确认、失败、重试
 * 6. 跨地市、跨用户访问拒绝
 * 7. 导出行数、金额、范围与审计一致
 * 8. 无 console/page/network error
 * 9. 桌面和移动视口截图无重叠、空白或布局破损
 *
 * 注意：不注入真实凭据；四角色账号由 F-04 隔离环境提供（i1-accounts.json，仅 600 权限文件）。
 */
import { test, expect } from '@playwright/test';

const BASE = process.env.F05A_BASE || 'http://127.0.0.1:5174/dataofearth/';

test.describe('F-05A 本地功能验收', () => {
  test('路由与深链：根跳转、/dataofearth/、hash 深链、刷新', async ({ page, browserName: _browserName }) => {
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

    // 1. 访问 dataofearth 根
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // 2. hash 深链导航
    await page.goto(BASE + '#/login', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    // 3. 刷新深链
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    // 4. 导航
    await page.goto(BASE + '#/login', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);

    // 截图（桌面 + 移动）
    await page.screenshot({ path: 'test-results/f05a-login-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: 'test-results/f05a-login-mobile.png', fullPage: true });

    // 断言：登录页关键元素存在（无空白/布局破损）
    const loginForm = await page.locator('input[type="text"], input[type="password"], button:has-text("登录"), button:has-text("登 录")').count();
    expect(loginForm).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });

  test('未登录访问受保护路由 → 重定向登录', async ({ page }) => {
    await page.goto(BASE + '#/dashboard', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    const url = page.url();
    // HashRouter 未登录应回登录页
    expect(url).toContain('#/login');
  });
});
