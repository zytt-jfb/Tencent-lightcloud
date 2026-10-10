/**
 * 经营单元上报系统 - 共享 TypeScript 类型
 * 统一导出入口
 */

export * from './enums/index';
export * from './baseline/enums';
export * from './baseline/order-template';
export * from './baseline/permissions';
export * from './auth/rbac';
export * from './common/metric-source';
export * from './maintenance';

export type { City } from './contract/city';
export type { Contract, ContractCityAllocation } from './contract/contract';
export * from './contract/contract-status';
export type { AnnualReportPackage } from './package/annual-package';
export type { ReportContractMonthlyRow, ReportCostMonthlyRow, ReportMaintenanceMonthlyRow } from './reporting/monthly-rows';
export type { User, UserBrief } from './user/user';
export type { Message } from './reminder/message';
export type { MonthUnlockGrant, MonthSnapshot, SnapshotSummaryData } from './common/snapshots';
export type { OperationLog } from './common/operation-log';
export type { BaseEntity, PaginationParams, PaginatedResponse, ApiResponse, ApiErrorResponse } from './common/base';
export type {
  AdminLoginRequest,
  CityPasswordLoginRequest,
  ChangeOwnPasswordRequest,
  ChangeOwnPasswordResponse,
  LoginResponse,
  MeResponse,
} from './common/auth.dto';
export type {
  UserListItem,
  UserListResponse,
  UpdateUserStatusRequest,
  RebindUserCityRequest,
  CreateManagedUserRequest,
  CreateManagedUserResponse,
  UpdateManagedUserRoleRequest,
  ResetManagedUserPasswordResponse,
  ExportAuditRequest,
} from './user/user.dto';
export type { CreateContractRequest, UpdateContractRequest, CreateAllocationRequest, UpdateAllocationRequest } from './contract/contract.dto';
export type {
  ContractMonthInput,
  CostMonthInput,
  MaintenanceMonthInput,
  DraftSaveRequest,
  SubmitPreviewResponse,
  SubmitMonthRequest,
  ReturnToDraftRequest,
  UnlockMonthsRequest,
  BulkUnlockMonthsRequest,
  BulkUnlockMonthsResponse,
  OpenCurrentMonthContractRequest,
} from './reporting/reporting.dto';
export type { DashboardStats, AdminBusinessSummaryDataStatus, AdminBusinessSummaryItem, AdminBusinessSummaryResponse } from './common/dashboard.dto';
export type { CityConfigDto } from './common/city-config.dto';
export type { OperationLogListRequest, OperationLogListResponse } from './common/operation-log.dto';
export type { AdminPackageItem } from './package/admin-package.dto';
export type {
  SendRemindersRequest,
  ConfirmImportRequest,
  CreateExportJobRequest,
  RetryRecalcTaskRequest,
  ImportPreviewResponse,
  ImportConfirmResponse,
  ImportQualityIssueType,
  ImportQualityIssue,
  ImportJobListItem,
  ImportJobDetail,
  ImportJobListResponse,
  ImportJobCancelResponse,
  ImportJobRetryResponse,
  ExportJobResponse,
  ExportCreateResponse,
  RecalcTaskItem,
  RecalcTaskListResponse,
  RecalcRetryResponse,
} from './common/misc.dto';
export type {
  FactKind,
  FactImportLifecycleStatus,
  FactVersionLifecycleStatus,
  FactSourceType,
  FactValidationIssue,
  FactImportResult,
  FactListQuery,
  CostFactItem,
  OrderFactItem,
  FactPage,
  CreateCostFactRequest,
  UpdateCostFactRequest,
  CreateOrderFactRequest,
  UpdateOrderFactRequest,
  ReverseFactRequest,
  FactVersionQuery,
  FactVersionItem,
  FactVersionConflictCurrent,
  FactAggregateItem,
  FactAggregateResponse,
  ContractProgressFactItem,
  LocalContractItem,
} from './facts/facts.dto';
