import path from 'node:path';
import { tmpdir } from 'node:os';

export const DEFAULT_FACT_SOURCE_STORAGE_ROOT = path.join(tmpdir(), 'biz-reporting-source-files');

export function resolveFactSourceStorageRoot(env: NodeJS.ProcessEnv, dirname: string): string {
  void dirname;
  return path.resolve(env.FACT_SOURCE_STORAGE_ROOT || DEFAULT_FACT_SOURCE_STORAGE_ROOT);
}

export function assertFactSourceStorageConfig(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): void {
  const configured = env.FACT_SOURCE_STORAGE_ROOT?.trim();
  if (!configured) return;
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  if (!pathApi.isAbsolute(configured)) throw new Error('FACT_SOURCE_STORAGE_ROOT_MUST_BE_ABSOLUTE');
}
