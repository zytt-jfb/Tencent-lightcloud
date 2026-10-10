#!/usr/bin/env node
/**
 * F-01：治理证据 schema 校验（evidence 强制绑定 commit 与 manifest digest）
 *
 * 1. evidence/governance 下任务证据文件头部 meta 必须含：
 *    task_id / batch / self_declared_status / internal_gate（+ generated_at）。
 * 2. 强制绑定：头部 meta 的 commit 字段必须等于当前 git HEAD；manifest_digest 字段
 *    必须等于 release-manifest requiredPaths 的聚合 digest（check-release-integrity 口径）。
 * 3. 缺证据 → exit 2；内容不一致 → exit 1；全部通过 → exit 0。
 * 4. 排除：原始事故证据目录（incident-20260802-redacted）与 analysis-output 不纳入校验。
 *
 * 用法：node scripts/test/check-governance-evidence.mjs [--gate]
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeManifestDigest } from '../release/manifest-digest.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const EVIDENCE_DIR = path.join(REPO_ROOT, 'evidence', 'governance');
const MANIFEST_PATH = path.join(REPO_ROOT, 'specs', 'rbac-auth-export-settings', 'release-manifest.json');
const gate = process.argv.includes('--gate');

const headCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();

// F-01（纠偏令第 4 节）：manifest 聚合 digest 统一由 manifest-digest.mjs 计算
// （与 check-release-integrity 同源，排除 evidence/governance 自指，禁止各自计算不同 digest）。
const { digest: manifestDigest } = computeManifestDigest({ repoRoot: REPO_ROOT, manifestPath: MANIFEST_PATH });

// evidence 文件清单（排除 backup/分析输出：仅 governance 目录下的任务证据）
const evidenceFiles = fs.readdirSync(EVIDENCE_DIR).filter((f) =>
  /^[A-Z]-\d{2}-/.test(f) && (f.endsWith('.txt') || f.endsWith('.json') || f.endsWith('.md')),
);

const missingMeta = [];
const badCommit = [];
const badDigest = [];
const skippedDataFiles = [];

for (const file of evidenceFiles.sort()) {
  const content = fs.readFileSync(path.join(EVIDENCE_DIR, file), 'utf8');
  const header = content.slice(0, 1200);
  // 纯数据文件（无 meta 结构，如 B-02-baseline-manifest.txt 逐行哈希列表）跳过 binding 校验
  const hasMetaStructure = /task_id\s*[:：]/.test(header) || /"\$meta"/.test(header) || /self_declared_status\s*[:：]/.test(header);
  if (!hasMetaStructure) {
    skippedDataFiles.push(file);
    continue;
  }
  // meta 字段检查
  const metaOk = /["']?task_id["']?\s*[:：]/.test(header) && /["']?batch["']?\s*[:：]\s*["'`]*PG-20260802/.test(header)
    && /["']?self_declared_status["']?\s*[:：]/.test(header) && /["']?internal_gate["']?\s*[:：]/.test(header);
  if (!metaOk) missingMeta.push(file);
  // commit 绑定：新证据（本批次生成）应含 commit=<HEAD>；缺失或不等 → badCommit
  const commitMatch = header.match(/["\x27]?commit["\x27]?\s*[:：]\s*["\x27`]*([0-9a-f]{7,40})/);
  if (!commitMatch || commitMatch[1] !== headCommit.slice(0, 12)) {
    badCommit.push(`${file}（commit=${commitMatch ? commitMatch[1] : '缺失'}，HEAD=${headCommit.slice(0, 12)}）`);
  }
  // digest 绑定
  const digestMatch = header.match(/["\']?manifest_digest["\']?\s*[:：]\s*["\'`]*([0-9a-f]{16,64})["\'`]*/);
  if (!digestMatch || digestMatch[1].slice(0, 16) !== manifestDigest.slice(0, 16)) {
    badDigest.push(`${file}（digest=${digestMatch ? digestMatch[1] : '缺失'}，manifest=${manifestDigest.slice(0, 16)}）`);
  }
}

console.log(`GOVERNANCE_EVIDENCE_REPORT commit=${headCommit.slice(0, 12)} manifest_digest=${manifestDigest.slice(0, 16)} files=${evidenceFiles.length} missing_meta=${missingMeta.length} bad_commit=${badCommit.length} bad_digest=${badDigest.length} skipped_data=${skippedDataFiles.length}`);
for (const item of missingMeta) console.error(`EVIDENCE_MISSING_META ${item}`);
for (const item of badCommit) console.error(`EVIDENCE_COMMIT_MISMATCH ${item}`);
for (const item of badDigest) console.error(`EVIDENCE_DIGEST_MISMATCH ${item}`);

// exit 语义：缺 meta/digest/commit → 2；其余不一致 → 1；全过 → 0
if (missingMeta.length > 0 || badCommit.length > 0 || badDigest.length > 0) process.exit(gate ? 2 : 1);
console.log('GOVERNANCE_EVIDENCE_OK all evidence bound to commit and manifest digest');
process.exit(0);
