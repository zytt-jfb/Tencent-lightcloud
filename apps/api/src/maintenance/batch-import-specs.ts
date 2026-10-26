import type { BatchImportSpec } from './maintenance-batch-import.service';

/**
 * 人员 / 车辆 / 油机 的批量导入字段配置
 *
 * 三张表的复合唯一索引决定了判重键（与数据库强一致，不要在这里改口径）：
 *   personnel  uk_maintenance_personnel_code_org (personnel_code, org_company, org_region)
 *   vehicles   uk_maintenance_vehicle_plate_org  (plate_number,  org_company, org_region)
 *   generators uk_maintenance_generator_code_org (generator_code,org_company, org_region)
 *
 * required 的含义是「数据库 NOT NULL 且无默认值」——
 *   表头缺这一列会在预检阶段整批拒绝，因为逐行报同一个错只会制造噪音。
 *   org_province / org_company / org_region 都是 NOT NULL，所以必须人工填，
 *   不按账号数据范围自动补：同一地市可能横跨多个公司/区域，猜错比让人填更糟。
 */

export const PERSONNEL_IMPORT_SPEC: BatchImportSpec = {
  kind: 'personnel',
  label: '人员',
  keyFields: ['personnelCode', 'orgCompany', 'orgRegion'],
  keyLabels: ['人员编号', '所属公司', '所属区域'],
  orgCityField: 'orgCity',
  columns: [
    { field: 'personnelCode', label: '人员编号', required: true, aliases: ['工号', '员工编号', '编号'] },
    { field: 'name', label: '姓名', required: true, aliases: ['人员姓名', '员工姓名', '名字'] },
    { field: 'orgProvince', label: '所属省份', required: true, aliases: ['省份'] },
    { field: 'orgCompany', label: '所属公司', required: true, aliases: ['公司', '单位', '所属单位'] },
    { field: 'orgRegion', label: '所属区域', required: true, aliases: ['区域', '片区', '所属片区'] },
    { field: 'orgCity', label: '所属地市', aliases: ['地市', '城市'] },
    { field: 'gender', label: '性别' },
    { field: 'age', label: '年龄', kind: 'number' },
    { field: 'account', label: '账号', aliases: ['登录账号'] },
    { field: 'position', label: '岗位', aliases: ['职位'] },
    { field: 'employmentType', label: '用工类型', aliases: ['用工性质', '用工方式'] },
    { field: 'mobile', label: '手机号', aliases: ['手机', '联系电话', '联系方式', '电话'] },
    { field: 'idCard', label: '身份证号', aliases: ['身份证', '身份证号码'] },
    { field: 'lowVoltageCert', label: '低压证', aliases: ['低压电工证'] },
    { field: 'lowVoltageCertExpiry', label: '低压证到期', aliases: ['低压证有效期', '低压证到期时间'] },
    { field: 'highVoltageCert', label: '高压证', aliases: ['高压电工证'] },
    { field: 'highVoltageCertExpiry', label: '高压证到期', aliases: ['高压证有效期', '高压证到期时间'] },
    { field: 'workAtHeightCert', label: '高处证', aliases: ['登高证', '高处作业证'] },
    { field: 'workAtHeightCertExpiry', label: '高处证到期', aliases: ['高处证有效期', '高处证到期时间'] },
    { field: 'employerLiabilityAmount', label: '雇主责任险金额', aliases: ['雇主险金额'] },
    { field: 'employerLiabilityPolicyNo', label: '雇主责任险保单号', aliases: ['雇主险保单号'] },
    { field: 'employerLiabilityExpiry', label: '雇主责任险到期', aliases: ['雇主险到期', '雇主责任险有效期'] },
    { field: 'teamAccidentAmount', label: '团意险金额', aliases: ['团体意外险金额'] },
    { field: 'teamAccidentPolicyNo', label: '团意险保单号', aliases: ['团体意外险保单号'] },
    { field: 'teamAccidentExpiry', label: '团意险到期', aliases: ['团意险有效期', '团体意外险到期'] },
  ],
};

export const VEHICLE_IMPORT_SPEC: BatchImportSpec = {
  kind: 'vehicles',
  label: '车辆',
  keyFields: ['plateNumber', 'orgCompany', 'orgRegion'],
  keyLabels: ['车牌号', '所属公司', '所属区域'],
  orgCityField: 'orgCity',
  columns: [
    { field: 'plateNumber', label: '车牌号', required: true, aliases: ['车牌', '号牌号码'] },
    { field: 'orgProvince', label: '所属省份', required: true, aliases: ['省份'] },
    { field: 'orgCompany', label: '所属公司', required: true, aliases: ['公司', '单位', '所属单位'] },
    { field: 'orgRegion', label: '所属区域', required: true, aliases: ['区域', '片区', '所属片区'] },
    { field: 'orgCity', label: '所属地市', aliases: ['地市', '城市'] },
    { field: 'vehicleCode', label: '车辆编号', aliases: ['编号'] },
    { field: 'vehicleType', label: '车型', aliases: ['车辆类型'] },
    { field: 'usage', label: '用途', aliases: ['车辆用途'] },
    { field: 'driverMobile', label: '司机手机', aliases: ['司机电话', '驾驶员电话'] },
    { field: 'brandModel', label: '品牌型号', aliases: ['品牌', '型号'] },
    { field: 'fuelType', label: '燃料类型', aliases: ['燃料', '燃油类型'] },
    { field: 'ownership', label: '权属', aliases: ['车辆权属', '归属'] },
    { field: 'ownerName', label: '车主', aliases: ['车主姓名'] },
    { field: 'drivingLicense', label: '行驶证', aliases: ['行驶证号'] },
    { field: 'vehicleYears', label: '车龄', aliases: ['车辆年限'] },
    { field: 'mileage', label: '里程', aliases: ['行驶里程'] },
    { field: 'vehicleStatus', label: '车辆状态', aliases: ['状态'] },
    { field: 'compulsoryInsurancePolicyNo', label: '交强险保单号', aliases: ['交强险保单'] },
    { field: 'compulsoryInsuranceExpiry', label: '交强险到期', aliases: ['交强险有效期'] },
    { field: 'commercialInsurancePolicyNo', label: '商业险保单号', aliases: ['商业险保单'] },
    { field: 'commercialInsuranceExpiry', label: '商业险到期', aliases: ['商业险有效期'] },
    { field: 'maintenanceTime', label: '维保时间', aliases: ['最近维保时间'] },
  ],
};

export const GENERATOR_IMPORT_SPEC: BatchImportSpec = {
  kind: 'generators',
  label: '油机',
  keyFields: ['generatorCode', 'orgCompany', 'orgRegion'],
  keyLabels: ['油机编号', '所属公司', '所属区域'],
  orgCityField: 'orgCity',
  columns: [
    { field: 'generatorCode', label: '油机编号', required: true, aliases: ['发电机组编号', '机组编号', '编号'] },
    { field: 'orgProvince', label: '所属省份', required: true, aliases: ['省份'] },
    { field: 'orgCompany', label: '所属公司', required: true, aliases: ['公司', '单位', '所属单位'] },
    { field: 'orgRegion', label: '所属区域', required: true, aliases: ['区域', '片区', '所属片区'] },
    { field: 'orgCity', label: '所属地市', aliases: ['地市', '城市'] },
    { field: 'contactName', label: '联系人', aliases: ['联系人姓名'] },
    { field: 'contactMobile', label: '联系电话', aliases: ['联系人电话', '手机号'] },
    { field: 'model', label: '型号', aliases: ['机组型号'] },
    { field: 'ratedPowerKw', label: '额定功率kW', aliases: ['额定功率', '功率'], kind: 'number' },
    { field: 'standardFuelConsumption', label: '标准油耗', aliases: ['油耗'], kind: 'number' },
    { field: 'generatorType', label: '类型', aliases: ['机组类型'] },
    { field: 'fuelType', label: '燃料类型', aliases: ['燃料', '燃油类型'] },
    { field: 'ownership', label: '权属', aliases: ['归属'] },
    { field: 'usageStatus', label: '使用状态', aliases: ['状态'] },
    { field: 'externalId', label: '外部编号', aliases: ['外部ID'] },
    { field: 'manufacturer', label: '厂家', aliases: ['生产厂家'] },
    { field: 'productionDate', label: '生产日期' },
    { field: 'lastMaintenanceUploadAt', label: '最近维保时间', aliases: ['维保时间'] },
  ],
};
