import { SetMetadata } from '@nestjs/common';
import { Permission } from '@biz-reporting/shared-types';

export const PERMISSIONS_KEY = 'permissions';
export const Permissions = (...permissions: Permission[]) => SetMetadata(PERMISSIONS_KEY, permissions);

