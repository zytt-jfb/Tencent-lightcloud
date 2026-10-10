import path from 'node:path';

export function resolveM7ScreenshotOutput(repoRoot, environment = process.env) {
  if (environment.M7_UPDATE_BASELINES === '1') {
    return {
      mode: 'baseline',
      directory: path.join(repoRoot, 'docs', 'baseline', 'screenshots'),
    };
  }

  return {
    mode: 'artifact',
    directory: environment.M7_SCREENSHOT_DIR
      ? path.resolve(repoRoot, environment.M7_SCREENSHOT_DIR)
      : path.join(repoRoot, '.artifacts', 'm7-screenshots'),
  };
}
