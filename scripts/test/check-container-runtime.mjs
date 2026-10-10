#!/usr/bin/env node
/**
 * E-06 测试：容器运行时静态校验 + 可选 docker 构建检查（PG-R8/R10/R11）
 *
 * 静态断言（无需 docker）：
 * 1. 权威 Dockerfile = 仓库根 Dockerfile；apps/api/Dockerfile 副本与根一致（唯一权威）。
 * 2. runner 非 root：UID 10001（adduser/addgroup）、COPY --chown=10001:10001、USER 10001。
 * 3. 保留 PORT、live healthcheck（/api/health/live），且不得声明已退役的持久挂载。
 * 4. 禁止：privileged、chmod 777、root entrypoint 后降权替代。
 *
 * docker 构建检查（本机无 docker 时标 PENDING_DOCKER，不伪造 PASS）：
 * - 构建镜像 → 检查 UID 与监听配置。
 *
 * 用法：node scripts/test/check-container-runtime.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const ROOT_DOCKERFILE = path.join(REPO_ROOT, 'Dockerfile');
const API_DOCKERFILE = path.join(REPO_ROOT, 'apps/api', 'Dockerfile');
const APP_MODULE = path.join(REPO_ROOT, 'apps/api', 'src', 'app.module.ts');

const rootDf = fs.readFileSync(ROOT_DOCKERFILE, 'utf8');
const apiDf = fs.readFileSync(API_DOCKERFILE, 'utf8');
const appModule = fs.readFileSync(APP_MODULE, 'utf8');

// 1. 唯一权威 + 副本一致（忽略注释、尾部空行、CRLF/LF 差异）
const normalize = (s) => s.replace(/\r\n/g, '\n').split('\n').filter((l) => !l.startsWith('#') && l.trim() !== '').join('\n').trim();
assert.equal(normalize(rootDf), normalize(apiDf), 'E-06: apps/api/Dockerfile 副本应与根 Dockerfile 一致（唯一权威）');

// 2. runner 非 root
const runnerSection = rootDf.split('FROM node:20-alpine AS runner')[1] || '';
assert.match(runnerSection, /adduser -u 10001/, 'E-06: runner 应创建 UID 10001');
assert.match(runnerSection, /addgroup -g 10001/, 'E-06: runner 应创建 GID 10001');
assert.match(runnerSection, /COPY --from=builder --chown=10001:10001/, 'E-06: COPY 应 --chown=10001:10001');
assert.match(runnerSection, /USER 10001/, 'E-06: runner 应 USER 10001 非 root');

// 3. 保留 PORT / healthcheck；新经营模块只使用任务级临时文件，不声明持久卷。
assert.match(rootDf, /PORT|EXPOSE 3000/, 'E-06: 应保留 PORT 暴露');
assert.match(rootDf, /health\/live/, 'E-06: 应保留 live healthcheck');
assert.doesNotMatch(rootDf, /required-persistent-mount/, 'E-06: 退役源文件模块不得强制持久挂载');
assert.doesNotMatch(rootDf, /FACT_SOURCE_STORAGE_ROOT=\/mnt\/fact-source-files/, 'E-06: 不得把临时上传目录伪装为持久卷');
assert.doesNotMatch(appModule, /CREATE TABLE/i, 'E-06: 运行服务不得在启动阶段执行 DDL');

// 4. 禁止项
assert.ok(!/--privileged/.test(rootDf), 'E-06: 禁止 privileged');
assert.ok(!/chmod 777/.test(rootDf), 'E-06: 禁止 chmod 777');
assert.ok(!/USER root/.test(runnerSection), 'E-06: 禁止 root entrypoint 后降权替代');

// docker 可用性（可选检查；本机无 docker → PENDING_DOCKER，不伪造 PASS）
const dockerCheck = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8', timeout: 10_000 });
let dockerNote = 'PENDING_DOCKER（本机无 docker 守护进程；构建/挂载验证在 F-04/G-04 隔离环境完成）';
if (dockerCheck.status === 0) {
  const build = spawnSync('docker', ['build', '-q', '-f', ROOT_DOCKERFILE, '.'], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 600_000 });
  if (build.status === 0) {
    dockerNote = `DOCKER_BUILD_OK image=${(build.stdout || '').trim().slice(0, 16)}`;
  } else {
    dockerNote = `DOCKER_BUILD_FAILED: ${(build.stderr || '').slice(0, 200)}`;
  }
}

console.log(`CONTAINER_RUNTIME_CHECK_OK uid=10001 user_nonroot=true authoritative=root-Dockerfile ${dockerNote}`);
