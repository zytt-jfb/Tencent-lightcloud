import { ConflictException } from '@nestjs/common';

/** TypeORM @VersionColumn 乐观锁冲突时的错误名 */
export const OPTIMISTIC_LOCK_ERROR_NAME = 'OptimisticLockVersionMismatchError';

/**
 * 把 TypeORM 乐观锁冲突统一转成 409 + 人话，避免并发修改时直接把底层错误抛成 500。
 * 非冲突错误原样抛出（保持原有堆栈）。
 */
export function rethrowOptimisticLock(error: unknown): never {
  if (error instanceof Error && error.name === OPTIMISTIC_LOCK_ERROR_NAME) {
    throw new ConflictException('记录已被他人修改，请刷新后重试');
  }
  throw error;
}

/** 是否乐观锁冲突（用于需要区分处理的调用方） */
export function isOptimisticLockError(error: unknown): boolean {
  return error instanceof Error && error.name === OPTIMISTIC_LOCK_ERROR_NAME;
}
