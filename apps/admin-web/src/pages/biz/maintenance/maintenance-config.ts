import dayjs from 'dayjs';

/**
 * 维护管理三类资产的字段定义。
 *
 * 这里只放「数据」不放「界面」：字段清单、列表主列、详情列、表单分区、上传分类映射。
 * 从原 MaintenanceHome.tsx（337 行三合一）拆出来的目的——三个页面的列与表单差异很大，
 * 继续挤在一个文件里改一处要读三百行。
 */

export type Kind = 'personnel' | 'vehicles' | 'generators';
export type Field = readonly [string, string];

/** 全字段清单：编辑表单、必填校验、上传按钮判定都基于它 */
export const FIELD_CONFIG: Record<Kind, { label: string; fields: readonly Field[] }> = {
  personnel: {
    label: '人员',
    fields: [
      ['personnelCode', '人员编号'], ['name', '姓名'], ['gender', '性别'], ['age', '年龄'], ['account', '账号'],
      ['position', '岗位'], ['employmentType', '自有人员/队伍人员'], ['mobile', '手机号'], ['idCard', '身份证号'],
      ['orgProvince', '省份'], ['orgCity', '地市'], ['orgCompany', '公司/分公司'], ['orgRegion', '区县'],
      ['lowVoltageCert', '低压电工证'], ['lowVoltageCertExpiry', '低压电工证有效期限'],
      ['highVoltageCert', '高压电工证'], ['highVoltageCertExpiry', '高压电工证有效期限'],
      ['workAtHeightCert', '登高证'], ['workAtHeightCertExpiry', '登高证有效期限'],
      ['employerLiabilityAmount', '雇主责任险（万元）'], ['employerLiabilityPolicyNo', '雇主责任险（保单号）'], ['employerLiabilityExpiry', '雇主责任险有效期限'],
      ['teamAccidentAmount', '团队意外险（万元）'], ['teamAccidentPolicyNo', '团队意外险（保单号）'], ['teamAccidentExpiry', '团队意外险有效期限'],
      ['teamAccidentAmount2', '团队意外险（万元）#2'], ['teamAccidentPolicyNo2', '团队意外险（保单号）#2'], ['teamAccidentExpiry2', '团队意外险有效期限#2'],
      ['teamAccidentAmount3', '团队意外险（万元）#3'], ['teamAccidentPolicyNo3', '团队意外险（保单号）#3'], ['teamAccidentExpiry3', '团队意外险有效期限#3'],
      ['personnelCondition', '人员情况'],
    ],
  },
  vehicles: {
    label: '车辆',
    fields: [
      ['plateNumber', '车牌号'], ['vehicleCode', '车辆编号'],
      ['orgProvince', '省份'], ['orgCity', '地市'], ['orgCompany', '公司/分公司'], ['orgRegion', '区县'],
      ['vehicleType', '车辆类型'], ['usage', '用途'], ['brandModel', '品牌型号'], ['fuelType', '燃料类型'],
      ['ownership', '所有权'], ['ownerName', '车主'], ['driverMobile', '人员手机'], ['drivingLicense', '行驶证'],
      ['vehicleYears', '车辆年限'], ['mileage', '公里数'], ['vehicleStatus', '车辆状态'],
      ['compulsoryInsurancePolicyNo', '交强险保险单号'], ['compulsoryInsuranceExpiry', '交强险到期时间'],
      ['commercialInsurancePolicyNo', '商业车险保险单号'], ['commercialInsuranceExpiry', '商业车险到期时间'],
      ['maintenanceTime', '车辆保养时间'],
    ],
  },
  generators: {
    label: '油机',
    fields: [
      ['generatorCode', '油机名称'], ['externalId', '油机ID'],
      ['orgProvince', '省份'], ['orgCity', '地市'], ['orgCompany', '公司/分公司'], ['orgRegion', '区县'],
      ['contactName', '联系人'], ['contactMobile', '联系电话'], ['manufacturer', '生产厂家'], ['model', '规格型号'],
      ['productionDate', '生产日期'], ['ratedPowerKw', '额定功率'], ['standardFuelConsumption', '标准油耗'],
      ['generatorType', '机组类型'], ['fuelType', '燃料类型'], ['ownership', '所有权'], ['usageStatus', '使用状态'],
      ['lastMaintenanceUploadAt', '保养记录最近一次上传时间'],
    ],
  },
};

/** 列表主展示列 + 详情列；详情列对齐《9月份合并汇总》人员/车辆/油机三张表 */
export const VIEWS: Record<Kind, { primary: Field; main: Field[]; detail: Field[] }> = {
  personnel: {
    primary: ['name', '姓名'],
    main: [['name', '姓名'], ['orgProvince', '省份'], ['orgCity', '地市'], ['orgRegion', '区县'], ['position', '岗位'], ['account', '账号']],
    detail: [
      ['personnelCode', '人员编号'], ['name', '姓名'], ['gender', '性别'], ['age', '年龄'], ['account', '账号'],
      ['position', '岗位'], ['employmentType', '自有人员/队伍人员'], ['mobile', '手机号'],
      ['idCard', '身份证号'], ['orgProvince', '省份'], ['orgCity', '地市'], ['orgCompany', '所属队伍公司'], ['orgRegion', '区县'],
      ['lowVoltageCert', '低压电工证'], ['lowVoltageCertExpiry', '低压电工证有效期限'],
      ['highVoltageCert', '高压电工证'], ['highVoltageCertExpiry', '高压电工证有效期限'],
      ['workAtHeightCert', '登高证'], ['workAtHeightCertExpiry', '登高证有效期限'],
      ['employerLiabilityAmount', '雇主责任险（万元）'], ['employerLiabilityPolicyNo', '雇主责任险（保单号）'], ['employerLiabilityExpiry', '雇主责任险有效期限'],
      ['teamAccidentAmount', '团队意外险（万元）'], ['teamAccidentPolicyNo', '团队意外险（保单号）'], ['teamAccidentExpiry', '团队意外险有效期限'],
      ['teamAccidentAmount2', '团队意外险（万元）#2'], ['teamAccidentPolicyNo2', '团队意外险（保单号）#2'], ['teamAccidentExpiry2', '团队意外险有效期限#2'],
      ['teamAccidentAmount3', '团队意外险（万元）#3'], ['teamAccidentPolicyNo3', '团队意外险（保单号）#3'], ['teamAccidentExpiry3', '团队意外险有效期限#3'],
      ['personnelCondition', '人员情况'],
    ],
  },
  vehicles: {
    primary: ['plateNumber', '车辆车牌号'],
    main: [['plateNumber', '车辆车牌号'], ['orgProvince', '省份'], ['orgCity', '地市'], ['orgRegion', '区县'], ['vehicleType', '车辆类型']],
    detail: [
      ['plateNumber', '车辆车牌号'], ['vehicleCode', '车辆编号'], ['vehicleType', '车辆类型'], ['usage', '车辆用途'],
      ['brandModel', '车辆品牌'], ['fuelType', '燃料种类'], ['ownership', '产权属性'], ['vehicleStatus', '车辆状态'],
      ['ownerName', '车主'], ['driverMobile', '人员手机'], ['drivingLicense', '行驶证'], ['vehicleYears', '车辆年限'], ['mileage', '公里数'],
      ['compulsoryInsurancePolicyNo', '交强险保险单号'], ['compulsoryInsuranceExpiry', '交强险到期时间'],
      ['commercialInsurancePolicyNo', '商业车险保险单号'], ['commercialInsuranceExpiry', '商业车险到期时间'],
      ['maintenanceTime', '车辆保养时间'],
      ['orgProvince', '省份'], ['orgCity', '地市'], ['orgCompany', '所属队伍公司'], ['orgRegion', '区县'],
    ],
  },
  generators: {
    primary: ['generatorCode', '油机名称'],
    main: [['generatorCode', '油机名称'], ['orgProvince', '省份'], ['orgCity', '地市'], ['orgRegion', '区县'], ['contactName', '联系人']],
    detail: [
      ['generatorCode', '油机名称'], ['externalId', '油机ID'], ['contactName', '联系人'], ['contactMobile', '联系电话'],
      ['manufacturer', '生产厂家'], ['model', '型号'], ['productionDate', '生产日期'],
      ['ratedPowerKw', '额定功率(KW)'], ['standardFuelConsumption', '标准油耗(L/小时)'],
      ['generatorType', '油机类型'], ['fuelType', '燃料种类'], ['ownership', '产权归属'], ['usageStatus', '使用状态'],
      ['lastMaintenanceUploadAt', '保养记录最近一次上传时间'],
      ['orgProvince', '省份'], ['orgCity', '地市'], ['orgCompany', '所属队伍公司'], ['orgRegion', '区县'],
    ],
  },
};

/** 编辑表单按语义分区，避免 32 个字段平铺 */
export function formSections(kind: Kind): Array<{ key: string; label: string; fields: readonly Field[] }> {
  const fields = FIELD_CONFIG[kind].fields;
  if (kind === 'personnel') {
    const certificates = fields.filter(([name]) => /Cert|cert/i.test(name));
    const insurance = fields.filter(([name]) => /employerLiability|teamAccident/i.test(name));
    const other = fields.filter(([name]) => name === 'personnelCondition');
    const grouped = new Set([...certificates, ...insurance, ...other].map(([name]) => name));
    return [
      { key: 'basic', label: '基本信息', fields: fields.filter(([name]) => !grouped.has(name)) },
      { key: 'certificates', label: '证件资料', fields: certificates },
      { key: 'insurance', label: '保险资料', fields: insurance },
      { key: 'other', label: '其他信息', fields: other },
    ].filter((section) => section.fields.length > 0);
  }
  if (kind === 'vehicles') {
    const insurance = fields.filter(([name]) => /Insurance|Expiry|maintenanceTime/i.test(name));
    const grouped = new Set(insurance.map(([name]) => name));
    return [
      { key: 'basic', label: '车辆信息', fields: fields.filter(([name]) => !grouped.has(name)) },
      { key: 'maintenance', label: '保险与保养', fields: insurance },
    ].filter((section) => section.fields.length > 0);
  }
  const maintenance = fields.filter(([name]) => name === 'lastMaintenanceUploadAt');
  return [
    { key: 'basic', label: '油机信息', fields: fields.filter(([name]) => name !== 'lastMaintenanceUploadAt') },
    { key: 'maintenance', label: '保养记录', fields: maintenance },
  ].filter((section) => section.fields.length > 0);
}

/** 必填字段：三类资产的业务编号、名称与组织归属 */
export const REQUIRED_FIELDS = ['personnelCode', 'name', 'plateNumber', 'generatorCode', 'orgProvince', 'orgCity', 'orgCompany', 'orgRegion'];

/** 会被权限点维护掩码的字段：无 maintenance.sensitive.read 时读到的就是 3701****1234 */
export const MASKED_FIELDS = ['idCard', 'mobile', 'driverMobile', 'contactMobile'];

/**
 * 有效期 / 日期类字段：原来是纯文本 Input，没有格式约束，历史数据里混进了「无」「2027-14-01」
 * 「至2027年8月19日」这类值（总览里被单列为「日期异常」）。改成 DatePicker 之后新增/编辑只能产出
 * YYYY-MM-DD，从源头止住脏值。
 */
export const DATE_FIELD_RE = /(Expiry|Time|Date)$/;

/** 已有脏值反解析失败时给 undefined，避免 DatePicker 显示 Invalid Date 白屏 */
export const toDayjs = (value: unknown) => {
  const parsed = dayjs(String(value ?? ''));
  return parsed.isValid() ? parsed : undefined;
};

export const isBlank = (value: unknown) => value === null || value === undefined || value === '';
export const cellText = (value: unknown) => {
  if (isBlank(value)) return '—';
  if (typeof value === 'string') return value.replace(/\s*\n\s*/g, '、');
  return String(value);
};

/** 上传资料时的业务分类（后端按分类做 OCR 字段映射） */
export function uploadCategory(kind: Kind, field: string): string {
  if (kind === 'personnel') {
    if (field === 'idCard') return 'idCard';
    if (/Cert/i.test(field)) return field.replace(/Expiry$/i, '');
    if (/employerLiability/i.test(field)) return 'employerLiabilityInsurance';
    if (/Insurance|Amount|Policy|Expiry/i.test(field)) return 'teamAccidentInsurance';
    return 'idCard';
  }
  if (kind === 'vehicles') {
    if (field === 'drivingLicense') return 'drivingLicense';
    if (/compulsoryInsurance/i.test(field)) return 'compulsoryInsurance';
    if (/commercialInsurance/i.test(field)) return 'commercialInsurance';
    return 'maintenanceRecord';
  }
  return field === 'lastMaintenanceUploadAt' ? 'maintenanceRecord' : 'generatorDocument';
}

/** 哪些字段旁边显示「上传资料/证件」按钮 */
export function canUploadForField(kind: Kind, sectionKey: string, field: string): boolean {
  if (sectionKey === 'certificates') return !/Expiry$/i.test(field);
  if (sectionKey === 'insurance') return field === 'employerLiabilityAmount' || field === 'teamAccidentAmount';
  if (kind === 'vehicles' && sectionKey === 'maintenance') return field === 'compulsoryInsurancePolicyNo' || field === 'commercialInsurancePolicyNo';
  if (kind === 'generators' && sectionKey === 'maintenance') return field === 'lastMaintenanceUploadAt';
  return false;
}

/** OCR 结果 → 表单字段（各分类的 key 命名不统一，逐个映射） */
export function mapOcrFields(kind: Kind, category: string, fields: Array<{ key: string; text: string }>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const field of fields) {
    const key = field.key.toLowerCase();
    if (kind === 'personnel' && category === 'idCard') {
      if (key.includes('name')) result.name = field.text;
      if (key.includes('idnumber') || key.includes('idno')) result.idCard = field.text;
      if (key.includes('address')) result.personnelCondition = field.text;
    } else if (kind === 'vehicles' && category === 'drivingLicense') {
      if (key.includes('platenumber') || key.includes('plate')) result.plateNumber = field.text;
      if (key.includes('vehicle') && key.includes('type')) result.vehicleType = field.text;
      if (key.includes('owner')) result.ownerName = field.text;
      if (key.includes('register') || key.includes('license')) result.drivingLicense = field.text;
    } else if (kind === 'personnel' && /Cert/i.test(category)) {
      if (key === 'certificateexpiry') result[`${category.replace(/Expiry$/i, '')}Expiry`] = field.text;
    } else if (kind === 'personnel' && /Insurance/.test(category)) {
      const prefix = category === 'employerLiabilityInsurance' ? 'employerLiability' : 'teamAccident';
      if (key === 'policyno') result[`${prefix}PolicyNo`] = field.text;
      if (key === 'expirydate') result[`${prefix}Expiry`] = field.text;
      if (key === 'insuranceamount') result[`${prefix}Amount`] = field.text;
    } else if (kind === 'vehicles' && /Insurance/.test(category)) {
      const prefix = category === 'compulsoryInsurance' ? 'compulsoryInsurance' : 'commercialInsurance';
      if (key === 'policyno') result[`${prefix}PolicyNo`] = field.text;
      if (key === 'expirydate') result[`${prefix}Expiry`] = field.text;
    } else if ((kind === 'vehicles' || kind === 'generators') && key === 'maintenancedate') {
      result[kind === 'vehicles' ? 'maintenanceTime' : 'lastMaintenanceUploadAt'] = field.text;
    }
  }
  return result;
}
