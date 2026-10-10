import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { resolveM7ScreenshotOutput } from './m7-screenshot-output.mjs';

const repoRoot = path.resolve('test-repo');

test('M7 writes screenshots to an isolated artifact directory by default', () => {
  const output = resolveM7ScreenshotOutput(repoRoot, {});
  assert.equal(output.mode, 'artifact');
  assert.equal(output.directory, path.join(repoRoot, '.artifacts', 'm7-screenshots'));
});

test('M7 updates baselines only with the explicit opt-in flag', () => {
  const ignored = resolveM7ScreenshotOutput(repoRoot, { M7_UPDATE_BASELINES: 'true' });
  assert.equal(ignored.mode, 'artifact');

  const enabled = resolveM7ScreenshotOutput(repoRoot, { M7_UPDATE_BASELINES: '1' });
  assert.equal(enabled.mode, 'baseline');
  assert.equal(enabled.directory, path.join(repoRoot, 'docs', 'baseline', 'screenshots'));
});

test('M7 accepts a custom artifact directory without enabling baseline updates', () => {
  const output = resolveM7ScreenshotOutput(repoRoot, { M7_SCREENSHOT_DIR: 'tmp/m7-output' });
  assert.equal(output.mode, 'artifact');
  assert.equal(output.directory, path.resolve(repoRoot, 'tmp/m7-output'));
});
