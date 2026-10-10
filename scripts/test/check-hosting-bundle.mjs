#!/usr/bin/env node
/**
 * E-04 测试：校验 /dataofearth/ Hosting bundle 可复现性
 *
 * 断言：
 * 1. bundle 存在且 dataofearth/ 完整（index.html + assets）
 * 2. 根 index.html 含 meta refresh 跳转 /dataofearth/
 * 3. asset 路径前缀 /dataofearth/（index.html 与入口 JS）
 * 4. 本地静态服务器：根 "/" 与 "/dataofearth/" 均非 500；抽查资源 200
 * 5. digest 汇总与逐文件一致（可复现）
 *
 * 用法：node scripts/test/check-hosting-bundle.mjs [--bundle <dir>]
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const args = process.argv.slice(2);
const bundleRoot = (() => {
  const idx = args.indexOf('--bundle');
  return idx >= 0 && args[idx + 1]
    ? path.resolve(REPO_ROOT, args[idx + 1])
    : path.join(REPO_ROOT, 'scripts', 'release', 'out', 'hosting-bundle');
})();

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

function serve(dir) {
  return http.createServer((req, res) => {
    let urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (urlPath.endsWith('/')) urlPath += 'index.html';
    const file = path.join(dir, urlPath);
    if (!file.startsWith(path.resolve(dir))) {
      res.writeHead(403).end();
      return;
    }
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      const ext = path.extname(file).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(fs.readFileSync(file));
    } else {
      res.writeHead(404).end();
    }
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

function fetchStatus(base, pathname) {
  return fetch(`${base}${pathname}`).then((r) => r.status).catch(() => 0);
}

function sha256file(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function walk(dir, base) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(base, full).split(path.sep).join('/');
    if (entry.isDirectory()) out.push(...walk(full, base));
    else out.push(rel);
  }
  return out;
}

async function main() {
  // 1. bundle 结构
  assert.ok(fs.existsSync(path.join(bundleRoot, 'dataofearth', 'index.html')), 'E-04: dataofearth/index.html 应存在');
  assert.ok(fs.existsSync(path.join(bundleRoot, 'bundle-digest.json')), 'E-04: bundle-digest.json 应存在');
  // 2. 根 index.html meta refresh
  const rootIndex = fs.readFileSync(path.join(bundleRoot, 'index.html'), 'utf8');
  assert.match(rootIndex, /meta\s+http-equiv="refresh"\s+content="0;\s*url=\/dataofearth\//i, 'E-04: 根 index.html 应有 meta refresh → /dataofearth/');
  // 3. asset 前缀
  const dataIndex = fs.readFileSync(path.join(bundleRoot, 'dataofearth', 'index.html'), 'utf8');
  assert.match(dataIndex, /\/dataofearth\/assets\//, 'E-04: 构建产物 asset 应带 /dataofearth/assets/ 前缀');
  // 4. 本地静态服务器：根与子目录均非 500、资源 200
  const port = await freePort();
  const server = serve(bundleRoot);
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${port}`;
    assert.notEqual(await fetchStatus(base, '/'), 500, 'E-04: 根路径不应 500');
    assert.notEqual(await fetchStatus(base, '/dataofearth/'), 500, 'E-04: /dataofearth/ 不应 500');
    const indexStatus = await fetchStatus(base, '/dataofearth/index.html');
    assert.equal(indexStatus, 200, 'E-04: /dataofearth/index.html 应 200');
    // 抽查一个 asset 200（请求路径带 /dataofearth/ 前缀）
    const assetMatch = dataIndex.match(/\/dataofearth\/(assets\/[^"']+\.js)/);
    if (assetMatch) {
      const assetStatus = await fetchStatus(base, `/dataofearth/${assetMatch[1]}`);
      assert.equal(assetStatus, 200, `E-04: asset /dataofearth/${assetMatch[1]} 应 200`);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  // 5. digest 一致（路径基准 = bundleRoot，与 build 脚本一致；排除 digest 自身）
  const digest = JSON.parse(fs.readFileSync(path.join(bundleRoot, 'bundle-digest.json'), 'utf8'));
  const files = walk(bundleRoot, bundleRoot)
    .filter((rel) => rel !== 'bundle-digest.json')
    .sort();
  const aggregateHash = createHash('sha256')
    .update(files.map((rel) => `${sha256file(path.join(bundleRoot, rel))} *${rel}`).join('\n'))
    .digest('hex');
  assert.equal(aggregateHash, digest.aggregate_sha256, 'E-04: digest 汇总应与逐文件一致（可复现）');
  console.log(`HOSTING_BUNDLE_CHECK_OK bundle=${bundleRoot} files=${files.length} digest=${digest.aggregate_sha256.slice(0, 16)}...`);
}

main().catch((err) => {
  console.error(`HOSTING_BUNDLE_CHECK_FAIL: ${err.message}`);
  process.exit(1);
});
