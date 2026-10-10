#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function normalize(value) {
  return value.split(path.sep).join('/');
}

export function readLiteralPathList({ repoRoot, relativePath, source = 'worktree' }) {
  const content = readCandidateFile({ repoRoot, relativePath, source }).toString('utf8');
  const withoutFinalNewline = content.replace(/\r?\n$/, '');
  const paths = withoutFinalNewline ? withoutFinalNewline.split(/\r?\n/) : [];
  if (paths.length === 0) throw new Error(`PATH_LIST_EMPTY path=${relativePath}`);
  if (paths.some((item) => !item || item !== item.trim())) throw new Error(`PATH_LIST_BLANK_OR_PADDED path=${relativePath}`);
  if (paths.some((item) => /[*?]/.test(item) || item.includes('\\') || path.isAbsolute(item) || /(^|\/)\.\.(\/|$)/.test(item))) {
    throw new Error(`PATH_LIST_NON_LITERAL path=${relativePath}`);
  }
  if (new Set(paths).size !== paths.length) throw new Error(`PATH_LIST_DUPLICATE path=${relativePath}`);

  return paths;
}

export function readReleaseManifest({ repoRoot, manifestPath, source = 'worktree' }) {
  const relativePath = normalize(path.relative(repoRoot, manifestPath));
  return JSON.parse(readCandidateFile({ repoRoot, relativePath, source }).toString('utf8'));
}

export function candidatePathExists({ repoRoot, relativePath, source = 'worktree' }) {
  if (source === 'index') {
    try {
      execFileSync('git', ['cat-file', '-e', `:${relativePath}`], { cwd: repoRoot, stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }
  return fs.existsSync(path.join(repoRoot, relativePath)) && fs.statSync(path.join(repoRoot, relativePath)).isFile();
}

export function readCandidateFile({ repoRoot, relativePath, source = 'worktree' }) {
  if (source === 'index') {
    return execFileSync('git', ['show', `:${relativePath}`], { cwd: repoRoot, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
  }
  return fs.readFileSync(path.join(repoRoot, relativePath));
}

export function computeManifestDigest({ repoRoot, manifestPath, source = 'worktree' }) {
  const manifest = readReleaseManifest({ repoRoot, manifestPath, source });
  const files = readLiteralPathList({ repoRoot, relativePath: manifest.sourceList, source });
  const missing = files.filter((relativePath) => !candidatePathExists({ repoRoot, relativePath, source }));
  if (missing.length > 0) throw new Error(`SOURCE_LIST_MISSING count=${missing.length} paths=${missing.join(',')}`);
  const digest = createHash('sha256')
    .update(files.map((relativePath) => {
      const contentHash = createHash('sha256')
        .update(readCandidateFile({ repoRoot, relativePath, source }))
        .digest('hex');
      return `${relativePath}\0${contentHash}`;
    }).join('\n'))
    .digest('hex');
  return { digest, files, fileCount: files.length, manifestVersion: manifest.version, manifest };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const manifestPath = path.join(repoRoot, 'specs', 'rbac-auth-export-settings', 'release-manifest.json');
  const source = process.argv.includes('--index') ? 'index' : 'worktree';
  const result = computeManifestDigest({ repoRoot, manifestPath, source });
  console.log(JSON.stringify({
    source,
    manifestVersion: result.manifestVersion,
    fileCount: result.fileCount,
    digest: result.digest,
    digestShort: result.digest.slice(0, 16),
  }, null, 2));
}
