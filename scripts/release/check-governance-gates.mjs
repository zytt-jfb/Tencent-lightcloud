#!/usr/bin/env node
/**
 * F-01：治理门禁检查（PG-R2/R3/R11/R13）
 *
 * 1. C-E 阶段每个任务必须存在证据文件（evidence/governance/）。
 * 2. tasks.md 对应任务必须勾选（[x]）且状态 REVIEW_COMPLETE。
 * 3. F-01 纠偏令第 4 节新增硬检查：
 *    a. tasks.md 与 STATUS-LEDGER.md 状态一致性（C-E 任务双源都须 REVIEW_COMPLETE）。
 *    b. 治理测试（apps/api/test/、scripts/test/）中 test.skip / it.skip / describe.skip 硬失败。
 *    c. 治理证据中 fail>0 或 skip>0（测试输出型证据的失败/跳过残留）硬失败。
 *    d. C-E 任务证据缺失测试命令或退出码字段时硬失败。
 * 4. 缺证据 / 检查不通过 → exit 2（硬阻断）；全部通过 → exit 0。
 *
 * 用法：node scripts/release/check-governance-gates.mjs [--gate]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const EVIDENCE_DIR = path.join(REPO_ROOT, 'evidence', 'governance');
const TASKS_MD = path.join(REPO_ROOT, 'specs', 'production-governance-20260802', 'tasks.md');
const LEDGER_MD = path.join(REPO_ROOT, 'evidence', 'governance', 'STATUS-LEDGER.md');
const API_TEST_DIR = path.join(REPO_ROOT, 'apps', 'api', 'test');
const SCRIPTS_TEST_DIR = path.join(REPO_ROOT, 'scripts', 'test');

// C-E 阶段任务 → 证据文件映射（F-01 清单）
const REQUIRED_EVIDENCE = {
  'C-01': 'C-01-migrations.txt',
  'C-02': 'C-02-dependencies.txt',
  'C-03': 'C-03-runtime-security.txt',
  'C-04': 'C-04-login-security.txt',
  'C-05': 'C-05-auth-integration.txt',
  'D-01': 'D-01-import-storage.txt',
  'D-02': 'D-02-list-access.txt',
  'D-03': 'D-03-atomicity.txt',
  'D-04': 'D-04-concurrency-retry.txt',
  'D-05': 'D-05-workbook-policy.txt',
  'D-06': 'D-06-file-migration.txt',
  'E-01': 'E-01-export-security.txt',
  'E-02': 'E-02-readiness.txt',
  'E-03': 'E-03-http-logging.txt',
  'E-04': 'E-04-hosting-bundle.txt',
  'E-05': 'E-05-browser.json',
  'E-06': 'E-06-container.json',
};

const missingEvidence = [];
const notReviewComplete = [];
const ledgerMismatch = [];
const testSkips = [];
const evidenceFailSkip = [];
const evidenceNoCmdOrExit = [];

for (const [task, file] of Object.entries(REQUIRED_EVIDENCE)) {
  const evidencePath = path.join(EVIDENCE_DIR, file);
  if (!fs.existsSync(evidencePath)) {
    missingEvidence.push(`${task} -> ${file}`);
    continue;
  }

  // ---- 检查 d：证据必须含测试命令与退出码字段（F-01 纠偏令） ----
  const evidenceContent = fs.readFileSync(evidencePath, 'utf8');
  const hasCommand = /(?:node|pnpm|npx|npm|tsc|yarn)\s+[^\n]*(?:test|build|check|migrate|--)/.test(evidenceContent)
    || /(?:命令|command|cmd)\s*[:：]/.test(evidenceContent);
  const hasExitCode = /(?:exit|退出码|exit_code|exitCode)\s*[:：\s]+\d+/.test(evidenceContent)
    || /(?:exit|退出码)\s*(?:=|：|:)\s*\d+/.test(evidenceContent)
    || /["']exit_code["']\s*:\s*\d+/.test(evidenceContent);
  if (!hasCommand || !hasExitCode) {
    evidenceNoCmdOrExit.push(`${task}（command=${hasCommand ? 'Y' : 'N'}，exitCode=${hasExitCode ? 'Y' : 'N'}）`);
  }
}

// tasks.md 状态机：C-E 任务必须 [x] 且状态 REVIEW_COMPLETE
const tasksMd = fs.readFileSync(TASKS_MD, 'utf8');
const ledgerMd = fs.existsSync(LEDGER_MD) ? fs.readFileSync(LEDGER_MD, 'utf8') : '';
const taskLines = tasksMd.split('\n');
for (const [task] of Object.entries(REQUIRED_EVIDENCE)) {
  const lineIdx = taskLines.findIndex((l) => l.includes(`**${task} `));
  if (lineIdx < 0) { notReviewComplete.push(`${task} 未在 tasks.md 找到`); continue; }
  const checkboxLine = taskLines[lineIdx];
  if (!checkboxLine.trim().startsWith('- [x]')) {
    notReviewComplete.push(`${task} 未勾选（[x]）`);
  }
  const statusLine = taskLines[lineIdx + 1] || '';
  if (!/REVIEW_COMPLETE/.test(statusLine)) {
    notReviewComplete.push(`${task} 状态非 REVIEW_COMPLETE（${statusLine.trim() || '缺失'}）`);
  }

  // ---- 检查 a：tasks.md 与 STATUS-LEDGER.md 一致性（F-01 纠偏令） ----
  if (ledgerMd) {
    const ledgerRow = ledgerMd.split('\n').find((l) => l.startsWith('|') && l.includes(`**${task} `) || (l.startsWith('|') && new RegExp(`\\| ${task} `).test(l)));
    if (!ledgerRow || !/REVIEW_COMPLETE/.test(ledgerRow)) {
      ledgerMismatch.push(`${task} STATUS-LEDGER 未达 REVIEW_COMPLETE`);
    }
  }
}

// ---- 检查 b：治理测试中 test.skip / it.skip / describe.skip 硬失败（F-01 纠偏令） ----
function scanSkips(directory, label) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!/\.(test|spec|integration|mjs|cjs|verify|loop)\.(mjs|cjs)$/.test(entry.name) && !entry.name.endsWith('.mjs') && !entry.name.endsWith('.cjs')) continue;
    const full = path.join(directory, entry.name);
    const content = fs.readFileSync(full, 'utf8');
    // 排除注释行中的字样（以 // 或 * 开头）
    const codeLines = content.split('\n').filter((l) => !/^\s*(\/\/|\*|#)/.test(l));
    for (const line of codeLines) {
      if (/\b(test|it|describe)\.skip\s*\(/.test(line)) {
        testSkips.push(`${label}/${entry.name}: ${line.trim().slice(0, 120)}`);
      }
    }
  }
}
scanSkips(API_TEST_DIR, 'apps/api/test');
scanSkips(SCRIPTS_TEST_DIR, 'scripts/test');

// ---- 检查 c：治理证据中 fail>0 或 skip>0 硬失败（F-01 纠偏令，仅测试输出型证据） ----
for (const [task, file] of Object.entries(REQUIRED_EVIDENCE)) {
  const evidencePath = path.join(EVIDENCE_DIR, file);
  if (!fs.existsSync(evidencePath)) continue;
  const content = fs.readFileSync(evidencePath, 'utf8');
  // 匹配 node:test 输出：ℹ fail 1 / ℹ skipped 2；或 exit: 1 且非 gate 语义
  const failMatch = content.match(/ℹ\s+fail\s+([1-9]\d*)/);
  const skipMatch = content.match(/ℹ\s+skipped\s+([1-9]\d*)/);
  if (failMatch) evidenceFailSkip.push(`${task} 证据中 fail=${failMatch[1]}（F-01 纠偏令：fail>0 硬失败）`);
  if (skipMatch) evidenceFailSkip.push(`${task} 证据中 skip=${skipMatch[1]}（F-01 纠偏令：skip>0 硬失败）`);
}

console.log(`GOVERNANCE_GATES_REPORT tasks=${Object.keys(REQUIRED_EVIDENCE).length} evidence_missing=${missingEvidence.length} not_review_complete=${notReviewComplete.length} ledger_mismatch=${ledgerMismatch.length} test_skips=${testSkips.length} evidence_fail_skip=${evidenceFailSkip.length} evidence_no_cmd_exit=${evidenceNoCmdOrExit.length}`);
for (const item of missingEvidence) console.error(`GOVERNANCE_GATE_MISSING_EVIDENCE ${item}`);
for (const item of notReviewComplete) console.error(`GOVERNANCE_GATE_NOT_REVIEW_COMPLETE ${item}`);
for (const item of ledgerMismatch) console.error(`GOVERNANCE_GATE_LEDGER_MISMATCH ${item}`);
for (const item of testSkips) console.error(`GOVERNANCE_GATE_TEST_SKIP ${item}`);
for (const item of evidenceFailSkip) console.error(`GOVERNANCE_GATE_EVIDENCE_FAIL_SKIP ${item}`);
for (const item of evidenceNoCmdOrExit) console.error(`GOVERNANCE_GATE_EVIDENCE_NO_CMD_EXIT ${item}`);

if (missingEvidence.length > 0) process.exit(2);
if (notReviewComplete.length > 0 || ledgerMismatch.length > 0 || testSkips.length > 0 || evidenceFailSkip.length > 0 || evidenceNoCmdOrExit.length > 0) process.exit(2);
console.log('GOVERNANCE_GATES_OK all C-E evidence present, REVIEW_COMPLETE, ledger aligned, no skip/fail residue, command+exit code present');
process.exit(0);
