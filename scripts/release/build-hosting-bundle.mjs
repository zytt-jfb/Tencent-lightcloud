#!/usr/bin/env node
/**
 * E-04：构建可复现的 /dataofearth/ Hosting bundle（PG-R9/R11）
 *
 * 流程：
 * 1. 构建 admin-web（vite build，base=/dataofearth/）→ apps/admin-web/dist
 * 2. 组装 bundle：<out>/dataofearth/（完整 dist 内容）+ <out>/index.html（meta refresh 根 fallback）
 * 3. 计算 bundle digest（逐文件 sha256 + 汇总）→ <out>/bundle-digest.json
 *
 * 约束：保留 HashRouter 与 base /dataofearth/；禁止直接部署 dist 到根（必须 dataofearth 子目录）。
 *
 * 用法：node scripts/release/build-hosting-bundle.mjs [--out <dir>] [--skip-build]
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const ADMIN_WEB = path.join(REPO_ROOT, 'apps', 'admin-web');
const DIST_DIR = path.join(ADMIN_WEB, 'dist');
const DEFAULT_OUT = path.join(REPO_ROOT, 'scripts', 'release', 'out', 'hosting-bundle');

const args = process.argv.slice(2);
const outDir = (() => {
  const idx = args.indexOf('--out');
  return idx >= 0 && args[idx + 1] ? path.resolve(REPO_ROOT, args[idx + 1]) : DEFAULT_OUT;
})();
const skipBuild = args.includes('--skip-build');


function sha256file(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function walk(dir, base) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(base, full).split(path.sep).join('/');
    if (entry.isDirectory()) results.push(...walk(full, base));
    else results.push(rel);
  }
  return results;
}

// 1. 构建（可用 --skip-build 复用现有 dist）
if (!skipBuild) {
  console.log('[E-04] 构建 admin-web (vite base=/dataofearth/) ...');
  // pnpm 不 hoist：直接定位 admin-web 本地 vite bin
  const localVite = path.join(ADMIN_WEB, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!fs.existsSync(localVite)) {
    console.error(`FATAL: 未找到 vite bin ${localVite}`);
    process.exit(2);
  }
  const result = spawnSync(process.execPath, [localVite, 'build', '--base', '/dataofearth/'], {
    cwd: ADMIN_WEB,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    console.error('FATAL: admin-web build 失败');
    process.exit(1);
  }
}
if (!fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
  console.error(`FATAL: 未找到构建产物 ${path.join(DIST_DIR, 'index.html')}（先构建或 --skip-build）`);
  process.exit(2);
}

// 2. 组装 bundle
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(path.join(outDir, 'dataofearth'), { recursive: true });
fs.cpSync(DIST_DIR, path.join(outDir, 'dataofearth'), { recursive: true });
// 根 index.html：meta refresh 跳转到 /dataofearth/（SPA 入口）
fs.writeFileSync(
  path.join(outDir, 'index.html'),
  '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="UTF-8">\n'
  + '<meta http-equiv="refresh" content="0; url=/dataofearth/">\n'
  + '<title>经营单元上报系统</title>\n</head>\n<body>\n'
  + '<p>正在跳转 <a href="/dataofearth/">经营单元上报系统</a>…</p>\n</body>\n</html>\n',
  'utf8',
);

// 3. digest
const files = walk(outDir, outDir).sort();
const digestEntries = files.map((rel) => ({ path: rel, sha256: sha256file(path.join(outDir, rel)) }));
const aggregateHash = createHash('sha256')
  .update(digestEntries.map((e) => `${e.sha256} *${e.path}`).join('\n'))
  .digest('hex');
const digest = {
  generated_at: new Date().toISOString(),
  bundle_root: outDir,
  file_count: files.length,
  aggregate_sha256: aggregateHash,
  files: digestEntries,
};
fs.writeFileSync(path.join(outDir, 'bundle-digest.json'), JSON.stringify(digest, null, 2), 'utf8');

// 4. 断言 asset 前缀 /dataofearth/
const indexHtml = fs.readFileSync(path.join(outDir, 'dataofearth', 'index.html'), 'utf8');
if (!indexHtml.includes('/dataofearth/')) {
  console.error('FATAL: 构建产物 asset 路径缺少 /dataofearth/ 前缀');
  process.exit(1);
}

console.log(`HOSTING_BUNDLE_OK out=${outDir} files=${files.length} digest=${aggregateHash.slice(0, 16)}...`);
