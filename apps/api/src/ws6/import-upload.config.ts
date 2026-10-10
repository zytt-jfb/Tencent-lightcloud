import { memoryStorage } from 'multer';
import { BadRequestException } from '@nestjs/common';

/**
 * D-01：统一上传过滤配置（tasks.md C-01/D-01）
 * 单一 Multer 选项：10MB 上限、单文件、xlsx/xls/csv 扩展名白名单。
 * 四控制器共用，避免各控制器重复内联 memoryStorage 配置。
 */
export const IMPORT_MAX_FILE_SIZE = 10 * 1024 * 1024;

const ALLOWED_EXTENSIONS = ['.xlsx', '.xls', '.csv'] as const;

export interface ImportUploadOptions {
  storage: ReturnType<typeof memoryStorage>;
  limits: { fileSize: number; files: number };
  fileFilter: (
    req: unknown,
    file: Express.Multer.File,
    callback: (error: Error | null, acceptFile: boolean) => void,
  ) => void;
}

export function importUploadOptions(): ImportUploadOptions {
  return {
    storage: memoryStorage(),
    limits: {
      fileSize: IMPORT_MAX_FILE_SIZE,
      files: 1,
    },
    fileFilter: (_req: unknown, file: Express.Multer.File, callback) => {
      const lower = (file.originalname || '').toLowerCase();
      const allowed = ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext));
      if (!allowed) {
        callback(
          new BadRequestException(`仅支持 ${ALLOWED_EXTENSIONS.join('/')} 文件`),
          false,
        );
        return;
      }
      callback(null, true);
    },
  };
}
