import { Injectable, InternalServerErrorException, OnModuleInit } from '@nestjs/common';
import { constants } from 'node:fs';
import { access, mkdir, open, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { assertFactSourceStorageConfig, resolveFactSourceStorageRoot } from './fact-source-storage.config';

export interface StoredFactSourceFile {
  storageKey: string;
  size: number;
  storedAt: Date;
}

@Injectable()
export class FactSourceFileStorageService implements OnModuleInit {
  private readonly root = resolveFactSourceStorageRoot(process.env, __dirname);

  async onModuleInit(): Promise<void> {
    assertFactSourceStorageConfig(process.env, process.platform);
    await mkdir(this.root, { recursive: true });
    // E-02：模块初始化执行一次写探针（可写性），后续 ready 只读
    await this.assertWritable();
  }

  /** E-02：只读探针——目录存在且可读（ready 用，不创建文件）。 */
  async assertReadable(): Promise<void> {
    await access(this.root, constants.R_OK);
  }

  /** E-02：写探针——创建/删除临时探针文件（模块初始化时执行一次）。 */
  async assertWritable(): Promise<void> {
    await this.assertReadable();
    const probe = path.join(this.root, `.readiness-probe-${process.pid}-${Date.now()}`);
    const handle = await open(probe, 'wx');
    try {
      await handle.writeFile('fact-source-storage-ready');
      await handle.sync();
    } finally {
      await handle.close();
      await unlink(probe).catch(() => undefined);
    }
  }

  /** @deprecated E-02 拆分后保留兼容别名（等价 assertWritable） */
  async assertReady(): Promise<void> {
    await this.assertWritable();
  }

  async store(buffer: Buffer, originalName: string, expectedSha256: string): Promise<StoredFactSourceFile> {
    const actualSha256 = createHash('sha256').update(buffer).digest('hex');
    if (actualSha256 !== expectedSha256) throw new InternalServerErrorException('SOURCE_FILE_HASH_MISMATCH');
    const storageKey = `${actualSha256.slice(0, 2)}/${actualSha256}`;
    const absolutePath = this.resolveKey(storageKey);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    try {
      const handle = await open(absolutePath, 'wx');
      try {
        await handle.writeFile(buffer);
        await handle.sync();
      } finally {
        await handle.close();
      }
    } catch (error: unknown) {
      const errorCode = error && typeof error === 'object' && 'code' in error ? (error as { code?: unknown }).code : undefined;
      if (errorCode !== 'EEXIST') throw error;
      const existing = await readFile(absolutePath);
      const existingHash = createHash('sha256').update(existing).digest('hex');
      if (existingHash !== actualSha256) throw new InternalServerErrorException('SOURCE_FILE_IMMUTABILITY_VIOLATION');
    }
    return { storageKey, size: buffer.length, storedAt: new Date() };
  }

  async read(storageKey: string): Promise<Buffer> {
    return readFile(this.resolveKey(storageKey));
  }

  async exists(storageKey: string): Promise<boolean> {
    try {
      await access(this.resolveKey(storageKey), constants.R_OK);
      return true;
    } catch {
      return false;
    }
  }

  private resolveKey(storageKey: string): string {
    if (!/^[a-f0-9]{2}\/[a-f0-9]{64}$/.test(storageKey)) {
      throw new InternalServerErrorException('SOURCE_FILE_STORAGE_KEY_INVALID');
    }
    const absolutePath = path.resolve(this.root, storageKey);
    if (!absolutePath.startsWith(`${this.root}${path.sep}`)) {
      throw new InternalServerErrorException('SOURCE_FILE_STORAGE_KEY_OUTSIDE_ROOT');
    }
    return absolutePath;
  }

}


