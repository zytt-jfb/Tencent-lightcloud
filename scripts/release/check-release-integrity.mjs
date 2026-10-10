import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  candidatePathExists,
  computeManifestDigest,
  normalize,
  readLiteralPathList,
} from './manifest-digest.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifestPath = path.join(repoRoot, 'specs', 'rbac-auth-export-settings', 'release-manifest.json');
const mode = process.argv.includes('--checkpoint') ? 'checkpoint' : process.argv.includes('--gate') ? 'release' : 'report';
const source = mode === 'checkpoint' ? 'index' : 'worktree';
const failures = [];

execFileSync(process.execPath, ['scripts/db/migrate.mjs', 'check-files'], { cwd: repoRoot, stdio: 'inherit' });

let digestResult;
try {
  digestResult = computeManifestDigest({ repoRoot, manifestPath, source });
} catch (error) {
  console.error(`RELEASE_SOURCE_MANIFEST_INVALID error=${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
const { digest, files: sourcePaths, manifest } = digestResult;
const sourceSet = new Set(sourcePaths);
const forbiddenPaths = readLiteralPathList({ repoRoot, relativePath: manifest.forbiddenCandidateList, source });
const forbiddenSet = new Set(forbiddenPaths);
const stagedPaths = new Set(gitPaths(['diff', '--cached', '--name-only', '--']));
const unstagedPaths = new Set(gitPaths(['diff', '--name-only', '--']));
const untrackedSource = sourcePaths.filter((relativePath) => !isTracked(relativePath));
const unstagedSource = sourcePaths.filter((relativePath) => unstagedPaths.has(relativePath));
const stagedSource = sourcePaths.filter((relativePath) => stagedPaths.has(relativePath));
const forbiddenPresent = forbiddenPaths.filter((relativePath) => candidatePathExists({ repoRoot, relativePath, source }));
const unexpectedStaged = [...stagedPaths].filter((relativePath) => !sourceSet.has(relativePath) && !forbiddenSet.has(relativePath));
const missingIndexSource = mode === 'checkpoint'
  ? sourcePaths.filter((relativePath) => !candidatePathExists({ repoRoot, relativePath, source: 'index' }))
  : [];

validateGeneratedArtifacts(manifest.generatedArtifacts ?? []);
validatePublicConfiguration(manifest.publicConfiguration ?? []);

console.log(`RELEASE_SOURCE_REPORT mode=${mode} version=${manifest.version} files=${sourcePaths.length} digest=${digest}`);
console.log(`RELEASE_SOURCE_GIT_STATUS untracked=${untrackedSource.length} unstaged=${unstagedSource.length} staged=${stagedSource.length} unexpected_staged=${unexpectedStaged.length} forbidden_present=${forbiddenPresent.length}`);
for (const relativePath of untrackedSource) console.error(`RELEASE_SOURCE_UNTRACKED path=${relativePath}`);
for (const relativePath of unstagedSource) console.error(`RELEASE_SOURCE_UNSTAGED path=${relativePath}`);
for (const relativePath of unexpectedStaged) console.error(`RELEASE_SOURCE_UNEXPECTED_STAGED path=${relativePath}`);
for (const relativePath of forbiddenPresent) console.error(`RELEASE_FORBIDDEN_PRESENT path=${relativePath}`);
for (const failure of failures) console.error(`RELEASE_ARTIFACT_FAILURE item=${failure}`);

if (failures.length > 0 || forbiddenPresent.length > 0 || missingIndexSource.length > 0) process.exit(1);
if (mode === 'checkpoint' && (unstagedSource.length > 0 || unexpectedStaged.length > 0)) process.exit(2);
if (mode === 'release' && (untrackedSource.length > 0 || unstagedSource.length > 0 || stagedSource.length > 0)) process.exit(2);
console.log(`RELEASE_INTEGRITY_OK mode=${mode} digest=${digest.slice(0, 16)}`);

function validateGeneratedArtifacts(artifacts) {
  for (const artifact of artifacts) {
    const requiredForCheckpoint = artifact.requiredForCheckpoint !== false;
    for (const requiredFile of artifact.requiredFiles ?? []) {
      if ((mode !== 'checkpoint' || requiredForCheckpoint) && !fs.existsSync(path.join(repoRoot, requiredFile))) {
        failures.push(`${artifact.id}:missing:${requiredFile}`);
      }
      if (artifact.mustBeIgnored && !isIgnored(requiredFile)) failures.push(`${artifact.id}:not_ignored:${requiredFile}`);
    }
    if (artifact.mustBeIgnored && !isIgnored(`${artifact.outputDirectory}/.integrity-probe`)) {
      failures.push(`${artifact.id}:output_not_ignored:${artifact.outputDirectory}`);
    }
    if (artifact.mustBeUntracked) {
      for (const tracked of gitPaths(['ls-files', '--', artifact.outputDirectory])) {
        failures.push(`${artifact.id}:tracked_generated:${tracked}`);
      }
    }
    if (artifact.sourceDirectory && artifact.forbiddenSourceExtensions) {
      const sourceRoot = path.join(repoRoot, artifact.sourceDirectory);
      for (const file of collectFiles(sourceRoot)) {
        if (artifact.forbiddenSourceExtensions.some((extension) => file.endsWith(extension))) {
          failures.push(`${artifact.id}:generated_in_source:${normalize(path.relative(repoRoot, file))}`);
        }
      }
    }
  }
}

function validatePublicConfiguration(configurations) {
  for (const configuration of configurations) {
    const absolutePath = path.join(repoRoot, configuration.path);
    if (!fs.existsSync(absolutePath)) { failures.push(`public_config_missing:${configuration.path}`); continue; }
    if (configuration.allowedKeys) {
      const keys = fs.readFileSync(absolutePath, 'utf8').split(/\r?\n/)
        .filter((line) => line.trim() && !line.trim().startsWith('#'))
        .map((line) => line.split('=', 1)[0].trim()).sort();
      const allowed = [...configuration.allowedKeys].sort();
      if (JSON.stringify(keys) !== JSON.stringify(allowed)) failures.push(`public_config_keys:${configuration.path}`);
    }
    if (configuration.allowedJsonPaths) {
      const keys = flattenJson(JSON.parse(fs.readFileSync(absolutePath, 'utf8'))).sort();
      const allowed = [...configuration.allowedJsonPaths].sort();
      if (JSON.stringify(keys) !== JSON.stringify(allowed)) failures.push(`public_config_json_paths:${configuration.path}`);
    }
  }
}

function flattenJson(value, prefix = '') {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return [prefix];
  return Object.entries(value).flatMap(([key, child]) => flattenJson(child, prefix ? `${prefix}.${key}` : key));
}

function collectFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectFiles(target));
    else files.push(target);
  }
  return files;
}

function isTracked(relativePath) {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', '--', relativePath], { cwd: repoRoot, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function isIgnored(relativePath) {
  return spawnGit(['check-ignore', '-q', '--', relativePath]) === 0;
}

function gitPaths(args) {
  const commandArgs = ['-c', 'core.quotepath=false', ...args];
  const separator = commandArgs.indexOf('--');
  commandArgs.splice(separator >= 0 ? separator : commandArgs.length, 0, '-z');
  const output = execFileSync('git', commandArgs, { cwd: repoRoot, encoding: 'utf8' });
  return output.split('\0').map(normalize).filter(Boolean);
}

function spawnGit(args) {
  try {
    execFileSync('git', args, { cwd: repoRoot, stdio: 'ignore' });
    return 0;
  } catch (error) {
    return typeof error?.status === 'number' ? error.status : 1;
  }
}
