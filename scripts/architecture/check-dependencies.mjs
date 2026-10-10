#!/usr/bin/env node
/**
 * 架构依赖方向检查（AR-R2 / AR-R4 / AR-R5 / AR-R6）
 * 只读检查，不修改任何文件。发现违规输出 [规则编号] 文件 :: 说明，并以非零码退出。
 *
 * 规则：
 *  R2-a  packages/*（共享契约层）不得依赖框架/基础设施（@nestjs、typeorm、react、vite、express）
 *  R2-b  apps/api 的 src 不得引用 apps/admin-web、apps/mini-program（后端不得反向依赖前端）
 *  R2-c  apps/admin-web 的 src 不得引用 apps/api 源码路径（前端只能经 API 契约通信）
 *  R2-d  app 启动装配（app.module/main）不得包含业务种子逻辑标记（seed*）——基线已知违规
 *  R4-a  packages/shared-types/src 不得存在生成物（.js/.d.ts/.map）
 *  R5-a  admin-web 页面层（features/**\/pages 或 pages/）不得直接调用 fetch( 或读写 localStorage token
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const violations = [];

function walk(dir, exts, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    if (["node_modules", "dist", ".git", "deploy-output", "uploads", "data"].includes(e)) continue;
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, exts, out);
    else if (exts.some((x) => e.endsWith(x))) out.push(p);
  }
  return out;
}
const rel = (p) => relative(ROOT, p).replaceAll("\\", "/");

// R2-a
for (const pkg of ["packages/shared-types", "packages/shared-constants"]) {
  for (const f of walk(join(ROOT, pkg, "src"), [".ts"])) {
    if (f.endsWith(".d.ts")) continue;
    const src = readFileSync(f, "utf8");
    for (const bad of ["@nestjs/", "typeorm", "react", "vite", "express"]) {
      const re = new RegExp(`(from|require\\()\\s*['\"]${bad}`);
      if (re.test(src)) violations.push(`[AR-R2-a] ${rel(f)} :: 共享包依赖框架 ${bad}`);
    }
  }
}

// R2-b / R2-c
for (const f of walk(join(ROOT, "apps/api/src"), [".ts"])) {
  const src = readFileSync(f, "utf8");
  if (/from\s+['"].*(admin-web|mini-program)/.test(src))
    violations.push(`[AR-R2-b] ${rel(f)} :: 后端引用前端目录`);
}
for (const f of walk(join(ROOT, "apps/admin-web/src"), [".ts", ".tsx"])) {
  const src = readFileSync(f, "utf8");
  if (/from\s+['"].*apps\/api/.test(src))
    violations.push(`[AR-R2-c] ${rel(f)} :: 前端直接引用后端源码`);
}

// R2-d
for (const name of ["app.module.ts", "main.ts"]) {
  const p = join(ROOT, "apps/api/src", name);
  try {
    const src = readFileSync(p, "utf8");
    if (/seed\w*\(/i.test(src))
      violations.push(`[AR-R2-d] ${rel(p)} :: 启动装配包含业务种子逻辑(seed*)`);
  } catch {}
}

// R4-a
for (const f of walk(join(ROOT, "packages/shared-types/src"), [".js", ".d.ts", ".map"])) {
  violations.push(`[AR-R4-a] ${rel(f)} :: 生成物混入 src`);
}

// R5-a
for (const f of walk(join(ROOT, "apps/admin-web/src"), [".tsx", ".ts"])) {
  const r = rel(f);
  if (!/\/pages\//.test(r)) continue;
  const src = readFileSync(f, "utf8");
  if (/(?<![a-zA-Z])fetch\s*\(/.test(src))
    violations.push(`[AR-R5-a] ${r} :: 页面层直接调用 fetch()`);
  if (/localStorage\.(get|set)Item\(\s*['"](token|access_token)/.test(src))
    violations.push(`[AR-R5-a] ${r} :: 页面层直接读写 token`);
}

if (violations.length) {
  console.error(`架构检查失败：${violations.length} 项违规`);
  for (const v of violations) console.error("  " + v);
  process.exit(1);
} else {
  console.log("架构检查通过：0 项违规");
}
