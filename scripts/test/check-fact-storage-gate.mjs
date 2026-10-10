import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const modulePath = path.resolve('apps/api/dist/facts/fact-source-storage.config.js');
const { assertFactSourceStorageConfig, resolveFactSourceStorageRoot, DEFAULT_FACT_SOURCE_STORAGE_ROOT } = await import(pathToFileURL(modulePath));

assert.equal(DEFAULT_FACT_SOURCE_STORAGE_ROOT, path.join(os.tmpdir(), 'biz-reporting-source-files'));
assert.equal(resolveFactSourceStorageRoot({}, '/unused'), DEFAULT_FACT_SOURCE_STORAGE_ROOT);
assert.throws(() => assertFactSourceStorageConfig({ FACT_SOURCE_STORAGE_ROOT: 'relative/files' }, 'linux'), /MUST_BE_ABSOLUTE/);
assert.doesNotThrow(() => assertFactSourceStorageConfig({ NODE_ENV: 'production' }, 'linux'));
assert.doesNotThrow(() => assertFactSourceStorageConfig({ FACT_SOURCE_STORAGE_ROOT: '/tmp/custom-source-files' }, 'linux'));
console.log(`FACT_SOURCE_STORAGE_GATE_OK mode=ephemeral root=${DEFAULT_FACT_SOURCE_STORAGE_ROOT}`);
