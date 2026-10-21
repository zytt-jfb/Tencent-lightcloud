import type { PaginationParams, PaginatedResponse } from '../common/base';
import type {
  MaintenanceGenerator,
  MaintenancePersonnel,
  MaintenanceRecordStatus,
  MaintenanceVehicle,
} from './maintenance';

export interface MaintenanceListQuery extends PaginationParams {
  /** 精确按记录 id 过滤：到期台账「去补录」跳转时用来取那一条，避免目标记录不在当前页 */
  id?: string;
  keyword?: string;
  orgProvince?: string;
  orgCity?: string;
  orgCompany?: string;
  orgRegion?: string;
  status?: MaintenanceRecordStatus;
}

export type MaintenancePersonnelListResponse = PaginatedResponse<MaintenancePersonnel>;
export type MaintenanceVehicleListResponse = PaginatedResponse<MaintenanceVehicle>;
export type MaintenanceGeneratorListResponse = PaginatedResponse<MaintenanceGenerator>;

export interface CreateMaintenancePersonnelRequest {
  personnelCode: string;
  name: string;
  orgProvince: string;
  orgCity?: string;
  orgCompany: string;
  orgRegion: string;
  gender?: string;
  age?: number;
  account?: string;
  position?: string;
  employmentType?: string;
  mobile?: string;
  idCard?: string;
  lowVoltageCert?: string;
  lowVoltageCertExpiry?: string;
  highVoltageCert?: string;
  highVoltageCertExpiry?: string;
  workAtHeightCert?: string;
  workAtHeightCertExpiry?: string;
  employerLiabilityAmount?: string;
  employerLiabilityPolicyNo?: string;
  employerLiabilityExpiry?: string;
  teamAccidentAmount?: string;
  teamAccidentPolicyNo?: string;
  teamAccidentExpiry?: string;
  teamAccidentAmount2?: string;
  teamAccidentPolicyNo2?: string;
  teamAccidentExpiry2?: string;
  teamAccidentAmount3?: string;
  teamAccidentPolicyNo3?: string;
  teamAccidentExpiry3?: string;
  personnelCondition?: string;
}

export type UpdateMaintenancePersonnelRequest = Partial<CreateMaintenancePersonnelRequest>;

export interface CreateMaintenanceVehicleRequest {
  plateNumber: string;
  orgProvince: string;
  orgCity?: string;
  orgCompany: string;
  orgRegion: string;
  vehicleCode?: string;
  vehicleType?: string;
  usage?: string;
  driverMobile?: string;
  brandModel?: string;
  fuelType?: string;
  ownership?: string;
  ownerName?: string;
  drivingLicense?: string;
  vehicleYears?: string;
  mileage?: string;
  vehicleStatus?: string;
  compulsoryInsurancePolicyNo?: string;
  compulsoryInsuranceExpiry?: string;
  commercialInsurancePolicyNo?: string;
  commercialInsuranceExpiry?: string;
  maintenanceTime?: string;
}

export type UpdateMaintenanceVehicleRequest = Partial<CreateMaintenanceVehicleRequest>;

export interface CreateMaintenanceGeneratorRequest {
  generatorCode: string;
  orgProvince: string;
  orgCity?: string;
  orgCompany: string;
  orgRegion: string;
  contactName?: string;
  contactMobile?: string;
  model?: string;
  ratedPowerKw?: number;
  standardFuelConsumption?: number;
  generatorType?: string;
  fuelType?: string;
  ownership?: string;
  usageStatus?: string;
  externalId?: string;
  manufacturer?: string;
  productionDate?: string;
  lastMaintenanceUploadAt?: string;
}

export type UpdateMaintenanceGeneratorRequest = Partial<CreateMaintenanceGeneratorRequest>;
