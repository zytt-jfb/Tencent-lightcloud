import { useEffect, useState } from 'react';
import { Button, Card, DatePicker, Descriptions, Drawer, Form, Input, Modal, Select, Space, Table, Tabs, Tag, Tooltip, Upload, message, type TableColumnsType } from 'antd';
import dayjs from 'dayjs';
import { DownloadOutlined } from '@ant-design/icons';
import { maintenanceCreate, maintenanceDownloadDocument, maintenanceFacets, maintenanceList, maintenanceListDocuments, maintenanceRemove, maintenanceUpdate, maintenanceUploadDocument, type MaintenanceDocument, type MaintenanceFacets, type MaintenanceItem } from '@/api/maintenance.api';
import { bizCities, bizProvinces } from '@/api/biz.api';
import { useLocation } from 'react-router-dom';
import { useBizPermission } from '@/utils/biz-permission';
import { exportPageRows } from '@/utils/page-export-core';

const configs = {
  personnel: { label:'人员', fields:[['personnelCode','人员编号'],['name','姓名'],['gender','性别'],['age','年龄'],['account','账号'],['position','岗位'],['employmentType','自有人员/队伍人员'],['mobile','手机号'],['idCard','身份证号'],['orgProvince','省份'],['orgCity','地市'],['orgCompany','公司/分公司'],['orgRegion','区县'],['lowVoltageCert','低压电工证'],['lowVoltageCertExpiry','低压电工证有效期限'],['highVoltageCert','高压电工证'],['highVoltageCertExpiry','高压电工证有效期限'],['workAtHeightCert','登高证'],['workAtHeightCertExpiry','登高证有效期限'],['employerLiabilityAmount','雇主责任险（万元）'],['employerLiabilityPolicyNo','雇主责任险（保单号）'],['employerLiabilityExpiry','雇主责任险有效期限'],['teamAccidentAmount','团队意外险（万元）'],['teamAccidentPolicyNo','团队意外险（保单号）'],['teamAccidentExpiry','团队意外险有效期限'],['teamAccidentAmount2','团队意外险（万元）#2'],['teamAccidentPolicyNo2','团队意外险（保单号）#2'],['teamAccidentExpiry2','团队意外险有效期限#2'],['teamAccidentAmount3','团队意外险（万元）#3'],['teamAccidentPolicyNo3','团队意外险（保单号）#3'],['teamAccidentExpiry3','团队意外险有效期限#3'],['personnelCondition','人员情况']] },
  vehicles: { label:'车辆', fields:[['plateNumber','车牌号'],['vehicleCode','车辆编号'],['orgProvince','省份'],['orgCity','地市'],['orgCompany','公司/分公司'],['orgRegion','区县'],['vehicleType','车辆类型'],['usage','用途'],['brandModel','品牌型号'],['fuelType','燃料类型'],['ownership','所有权'],['ownerName','车主'],['driverMobile','人员手机'],['drivingLicense','行驶证'],['vehicleYears','车辆年限'],['mileage','公里数'],['vehicleStatus','车辆状态'],['compulsoryInsurancePolicyNo','交强险保险单号'],['compulsoryInsuranceExpiry','交强险到期时间'],['commercialInsurancePolicyNo','商业车险保险单号'],['commercialInsuranceExpiry','商业车险到期时间'],['maintenanceTime','车辆保养时间']] },
  generators: { label:'油机', fields:[['generatorCode','油机名称'],['externalId','油机ID'],['orgProvince','省份'],['orgCity','地市'],['orgCompany','公司/分公司'],['orgRegion','区县'],['contactName','联系人'],['contactMobile','联系电话'],['manufacturer','生产厂家'],['model','规格型号'],['productionDate','生产日期'],['ratedPowerKw','额定功率'],['standardFuelConsumption','标准油耗'],['generatorType','机组类型'],['fuelType','燃料类型'],['ownership','所有权'],['usageStatus','使用状态'],['lastMaintenanceUploadAt','保养记录最近一次上传时间']] },
} as const;
type Kind = keyof typeof configs;
type Field = readonly [string, string];

function mapOcrFields(kind: Kind, category: string, fields: Array<{ key: string; text: string }>): Record<string, string> {
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

/** 列表主展示列 + 二级弹窗详情列；详情列对齐《9月份合并汇总》人员/车辆/油机三张表的字段 */
const views: Record<Kind, { primary: Field; main: Field[]; detail: Field[] }> = {
  personnel: {
    primary: ['name', '姓名'],
    main: [['name','姓名'],['orgProvince','省份'],['orgCity','地市'],['orgRegion','区县'],['position','岗位'],['account','账号']],
    detail: [
      ['personnelCode','人员编号'],['name','姓名'],['gender','性别'],['age','年龄'],['account','账号'],
      ['position','岗位'],['employmentType','自有人员/队伍人员'],['mobile','手机号'],
      ['idCard','身份证号'],['orgProvince','省份'],['orgCity','地市'],['orgCompany','所属队伍公司'],['orgRegion','区县'],
      ['lowVoltageCert','低压电工证'],['lowVoltageCertExpiry','低压电工证有效期限'],
      ['highVoltageCert','高压电工证'],['highVoltageCertExpiry','高压电工证有效期限'],
      ['workAtHeightCert','登高证'],['workAtHeightCertExpiry','登高证有效期限'],
      ['employerLiabilityAmount','雇主责任险（万元）'],['employerLiabilityPolicyNo','雇主责任险（保单号）'],['employerLiabilityExpiry','雇主责任险有效期限'],
      ['teamAccidentAmount','团队意外险（万元）'],['teamAccidentPolicyNo','团队意外险（保单号）'],['teamAccidentExpiry','团队意外险有效期限'],
      ['teamAccidentAmount2','团队意外险（万元）#2'],['teamAccidentPolicyNo2','团队意外险（保单号）#2'],['teamAccidentExpiry2','团队意外险有效期限#2'],
      ['teamAccidentAmount3','团队意外险（万元）#3'],['teamAccidentPolicyNo3','团队意外险（保单号）#3'],['teamAccidentExpiry3','团队意外险有效期限#3'],
      ['personnelCondition','人员情况'],
    ],
  },
  vehicles: {
    primary: ['plateNumber', '车辆车牌号'],
    main: [['plateNumber','车辆车牌号'],['orgProvince','省份'],['orgCity','地市'],['orgRegion','区县'],['vehicleType','车辆类型']],
    detail: [
      ['plateNumber','车辆车牌号'],['vehicleCode','车辆编号'],['vehicleType','车辆类型'],['usage','车辆用途'],
      ['brandModel','车辆品牌'],['fuelType','燃料种类'],['ownership','产权属性'],['vehicleStatus','车辆状态'],
      ['ownerName','车主'],['driverMobile','人员手机'],['drivingLicense','行驶证'],['vehicleYears','车辆年限'],['mileage','公里数'],
      ['compulsoryInsurancePolicyNo','交强险保险单号'],['compulsoryInsuranceExpiry','交强险到期时间'],
      ['commercialInsurancePolicyNo','商业车险保险单号'],['commercialInsuranceExpiry','商业车险到期时间'],
      ['maintenanceTime','车辆保养时间'],
      ['orgProvince','省份'],['orgCity','地市'],['orgCompany','所属队伍公司'],['orgRegion','区县'],
    ],
  },
  generators: {
    primary: ['generatorCode', '油机名称'],
    main: [['generatorCode','油机名称'],['orgProvince','省份'],['orgCity','地市'],['orgRegion','区县'],['contactName','联系人']],
    detail: [
      ['generatorCode','油机名称'],['externalId','油机ID'],['contactName','联系人'],['contactMobile','联系电话'],
      ['manufacturer','生产厂家'],['model','型号'],['productionDate','生产日期'],
      ['ratedPowerKw','额定功率(KW)'],['standardFuelConsumption','标准油耗(L/小时)'],
      ['generatorType','油机类型'],['fuelType','燃料种类'],['ownership','产权归属'],['usageStatus','使用状态'],
      ['lastMaintenanceUploadAt','保养记录最近一次上传时间'],
      ['orgProvince','省份'],['orgCity','地市'],['orgCompany','所属队伍公司'],['orgRegion','区县'],
    ],
  },
};

const isBlank = (value: unknown) => value === null || value === undefined || value === '';
const cellText = (value: unknown) => {
  if (isBlank(value)) return '—';
  if (typeof value === 'string') return value.replace(/\s*\n\s*/g, '、');
  return String(value);
};

function formSections(kind: Kind): Array<{ key: string; label: string; fields: readonly Field[] }> {
  const fields = configs[kind].fields as readonly Field[];
  const matches = (name: string, pattern: RegExp) => pattern.test(name);
  if (kind === 'personnel') {
    const certificates = fields.filter(([name]) => matches(name, /Cert|cert/i));
    const insurance = fields.filter(([name]) => matches(name, /employerLiability|teamAccident/i));
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

/** 二级详细卡片：一次展示该项的全部字段 */
function DetailCard({ kind, row }: { kind: Kind; row: MaintenanceItem }) {
  const { detail } = views[kind];
  return (
    <Descriptions size="small" column={1} bordered styles={{ content: { overflowWrap: 'anywhere' } }}
      items={[
        ...detail.map(([name, label]) => ({ key: name, label, children: cellText(row[name]) })),
        { key: 'status', label: '状态', children: <Tag color={row.status === 'active' ? 'green' : 'default'}>{row.status === 'active' ? '启用' : '停用'}</Tag> },
        { key: 'updatedAt', label: '更新时间', children: cellText(row.updatedAt) },
      ]}
    />
  );
}

const PAGE_SIZES = [20, 50, 100];
/** 会被权限点维护掩码的字段：无 maintenance.sensitive.read 时读到的就是 3701****1234 */
const MASKED_FIELDS = ['idCard', 'mobile', 'driverMobile', 'contactMobile'];
/**
 * 有效期 / 日期类字段：原来是纯文本 Input，没有格式约束，历史数据里混进了「无」「2027-14-01」
 * 「至2027年8月19日」这类值（总览里被单列为「日期异常」）。改成 DatePicker 之后新增/编辑只能产出
 * YYYY-MM-DD，从源头止住脏值。
 */
const DATE_FIELD_RE = /(Expiry|Time|Date)$/;
/** 已有脏值反解析失败时给 undefined，避免 DatePicker 显示 Invalid Date 白屏 */
const toDayjs = (value: unknown) => {
  const parsed = dayjs(String(value ?? ''));
  return parsed.isValid() ? parsed : undefined;
};

export default function MaintenanceHome() {
  const location = useLocation();
  const routeKind = location.pathname.split('/').pop() ?? '';
  const kind: Kind = routeKind in configs ? (routeKind as Kind) : 'personnel';
  const [items, setItems] = useState<MaintenanceItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [facets, setFacets] = useState<MaintenanceFacets>();
  const [filters, setFilters] = useState({ keyword: '', orgProvince: '', orgCity: '', orgRegion: '' });
  const [editing, setEditing] = useState<MaintenanceItem | null>(null);
  const [open, setOpen] = useState(false);
  const [documentIds, setDocumentIds] = useState<string[]>([]);
  const [documents, setDocuments] = useState<MaintenanceDocument[]>([]);
  const [form] = Form.useForm<any>();
  const [cityOptions, setCityOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [provinceOptions, setProvinceOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [selected, setSelected] = useState<MaintenanceItem | null>(null);

  useEffect(() => {
    void Promise.all([bizCities(), bizProvinces()])
      .then(([cityResult, provinceResult]) => {
        setCityOptions(cityResult.items.map((city) => ({ value: city.name, label: city.name })));
        setProvinceOptions(provinceResult.items.map((province) => ({ value: province.name, label: province.name })));
      })
      .catch(() => message.error('地市字典加载失败'));
  }, []);

  const canDelete = useBizPermission('maintenance.data.delete');

  const load = async (nextPage = 1, nextFilters = filters, nextPageSize = pageSize) => {
    setLoading(true);
    try {
      const result = await maintenanceList(kind, { ...nextFilters, page: nextPage, pageSize: nextPageSize });
      setItems(result.items);
      setTotal(result.total);
      setPage(nextPage);
      setPageSize(nextPageSize);
    } catch { message.error('维护数据加载失败'); } finally { setLoading(false); }
  };

  /**
   * 区县下拉改服务端 distinct。
   * 原实现是 `Array.from(new Set(items.map(row => row.orgRegion)))` —— 只覆盖当前页 50 条，
   * 翻页后选项跟着变，别的区县永远选不到。
   */
  useEffect(() => {
    setFacets(undefined);
    void maintenanceFacets(kind).then(setFacets).catch(() => undefined);
  }, [kind]);

  useEffect(() => { void load(1); }, [kind]);
  useEffect(() => { setSelected(null); }, [kind]);

  /**
   * 导出：用户点导出才按 100/页 拉全量（翻页循环只出现在这里，列表本身永远是单次分页请求）。
   * 列取详情口径的全字段，导出中文化交给 exportPageRows。
   */
  const exportRows = async () => {
    setExporting(true);
    try {
      const rows: MaintenanceItem[] = [];
      for (let nextPage = 1; ; nextPage++) {
        const result = await maintenanceList(kind, { ...filters, page: nextPage, pageSize: 100 });
        rows.push(...result.items);
        if (!result.items.length || rows.length >= result.total) break;
      }
      const scopeLabel = [filters.orgProvince, filters.orgCity, filters.orgRegion].filter(Boolean).join(' / ') || '全部组织';
      exportPageRows(`维护-${configs[kind].label}`, rows, scopeLabel, views[kind].detail.map(([name]) => name));
      message.success(`已导出 ${rows.length} 条`);
    } catch { message.error('导出失败，请稍后重试'); } finally { setExporting(false); }
  };

  const sections = formSections(kind);
  const submit = async () => {
    try {
      const values = await form.validateFields();
      const payload = { ...values, documentFileIds: documentIds };
      if (editing) await maintenanceUpdate(kind, editing.id, payload); else await maintenanceCreate(kind, payload);
      message.success('保存成功，资料已关联'); setOpen(false); form.resetFields(); setDocumentIds([]); setEditing(null); void load(page);
    } catch { message.error('保存失败，请检查字段'); }
  };
  const uploadCategory = (field: string) => kind === 'personnel' ? (field === 'idCard' ? 'idCard' : /Cert/i.test(field) ? field.replace(/Expiry$/i, '') : /employerLiability/i.test(field) ? 'employerLiabilityInsurance' : /Insurance|Amount|Policy|Expiry/i.test(field) ? 'teamAccidentInsurance' : 'idCard') : kind === 'vehicles' ? (field === 'drivingLicense' ? 'drivingLicense' : /compulsoryInsurance/i.test(field) ? 'compulsoryInsurance' : /commercialInsurance/i.test(field) ? 'commercialInsurance' : 'maintenanceRecord') : (field === 'lastMaintenanceUploadAt' ? 'maintenanceRecord' : 'generatorDocument');
  const canUploadForField = (sectionKey: string, field: string) => {
    if (sectionKey === 'certificates') return !/Expiry$/i.test(field);
    if (sectionKey === 'insurance') return field === 'employerLiabilityAmount' || field === 'teamAccidentAmount';
    if (kind === 'vehicles' && sectionKey === 'maintenance') return field === 'compulsoryInsurancePolicyNo' || field === 'commercialInsurancePolicyNo';
    if (kind === 'generators' && sectionKey === 'maintenance') return field === 'lastMaintenanceUploadAt';
    return false;
  };
  const handleUpload = async (field: string, file: File) => {
    try {
      const result = await maintenanceUploadDocument(kind, uploadCategory(field), file);
      setDocumentIds((ids) => [...ids, result.id]);
      setDocuments((rows) => [...rows, { id: result.id, category: result.category, fileName: result.fileName, mimeType: result.mimeType, fileSize: result.fileSize }]);
      if (result.fields.length) { const values = mapOcrFields(kind, uploadCategory(field), result.fields); form.setFieldsValue(values); }
      if (result.extractionError) message.warning(`文件已保存，识别失败：${result.extractionError}`);
      else if (!result.ocrAvailable) message.warning('文件已保存；当前未配置OCR密钥，请手工填写后保存');
      else message.success(result.fields.length ? '已识别并回填，请复核后保存' : '已完成文字识别，请核对内容并手工填写对应字段');
    } catch { message.error('资料上传失败，请检查文件格式和大小'); }
    return false;
  };

  const view = views[kind];
  const isMaskedField = (name: string) => MASKED_FIELDS.includes(name) && String((editing as Record<string, unknown> | null)?.[name] ?? '').includes('****');
  const dataColumns: TableColumnsType<MaintenanceItem> = view.main.map(([dataIndex, title]) => ({
    key: dataIndex, dataIndex, title, ellipsis: true, width: 140,
    render: dataIndex === view.primary[0]
      ? (value: string, row: MaintenanceItem) => <Button type="link" style={{ padding: 0 }} onClick={() => setSelected(row)}>{cellText(value)}</Button>
      : (value: unknown) => cellText(value),
  }));
  const openEdit = (row: MaintenanceItem) => {
    setEditing(row); form.setFieldsValue(row); setDocumentIds([]); setDocuments([]); setOpen(true);
    void maintenanceListDocuments(kind, row.id).then(setDocuments).catch(() => message.error('附件列表加载失败'));
  };
  const downloadDocument = async (file: MaintenanceDocument) => {
    try {
      const blob = await maintenanceDownloadDocument(kind, file.id);
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement('a');
      anchor.href = url; anchor.download = file.fileName; anchor.click(); URL.revokeObjectURL(url);
    } catch { message.error('资料下载失败'); }
  };
  const columns: TableColumnsType<MaintenanceItem> = [...dataColumns,
    { title: '状态', dataIndex: 'status', width: 90, render: (value: string) => <Tag color={value === 'active' ? 'green' : 'default'}>{value === 'active' ? '启用' : '停用'}</Tag> },
    { title: '操作', width: 150, fixed: 'right', render: (_: unknown, row: MaintenanceItem) => <Space><Button size="small" onClick={() => openEdit(row)}>编辑</Button>{canDelete && <Button danger size="small" onClick={() => Modal.confirm({ title: `删除${configs[kind].label}`, content: '删除后该记录将从列表中隐藏，可由数据恢复流程处理。确定继续吗？', okText: '删除', okButtonProps: { danger: true }, cancelText: '取消', onOk: async () => { await maintenanceRemove(kind, row.id); message.success('已删除'); void load(page); } })}>删除</Button>}</Space> }];

  return <Card
    title="维护管理"
    extra={<Space>
      <Button icon={<DownloadOutlined />} loading={exporting} disabled={!total} onClick={() => void exportRows()}>导出 Excel</Button>
      <Button type="primary" onClick={() => { setSelected(null); setEditing(null); form.resetFields(); setOpen(true); }}>新增{configs[kind].label}</Button>
    </Space>}
  >
    <Space wrap style={{ marginBottom: 16, width: '100%' }}>
      <Input placeholder="关键词" value={filters.keyword} onChange={(event) => setFilters((f) => ({ ...f, keyword: event.target.value }))} onPressEnter={() => void load(1)} style={{ width: 170 }} />
      <Select allowClear showSearch optionFilterProp="label" placeholder="省份" value={filters.orgProvince || undefined} options={provinceOptions} onChange={(value) => setFilters((f) => ({ ...f, orgProvince: value ?? '', orgCity: '' }))} style={{ width: 140 }} />
      <Select allowClear showSearch optionFilterProp="label" placeholder="地市" value={filters.orgCity || undefined} options={cityOptions} onChange={(value) => setFilters((f) => ({ ...f, orgCity: value ?? '' }))} style={{ width: 140 }} />
      <Select allowClear showSearch optionFilterProp="label" placeholder="区县" value={filters.orgRegion || undefined} options={(facets?.regions ?? []).map((value) => ({ value, label: value }))} onChange={(value) => setFilters((f) => ({ ...f, orgRegion: value ?? '' }))} style={{ width: 160 }} />
      <Button type="primary" onClick={() => void load(1)}>筛选</Button>
      <Button onClick={() => { const next = { keyword: '', orgProvince: '', orgCity: '', orgRegion: '' }; setFilters(next); void load(1, next); }}>重置</Button>
    </Space>
    <Table rowKey="id" loading={loading} dataSource={items} columns={columns} scroll={{ x: 'max-content' }}
      pagination={{ total, current: page, pageSize, showSizeChanger: true, pageSizeOptions: PAGE_SIZES, showTotal: (value) => `共 ${value} 条`, onChange: (nextPage, nextPageSize) => void load(nextPage, filters, nextPageSize) }} />
    <Drawer title={`${configs[kind].label}详情${selected ? ` · ${cellText(selected[view.primary[0]])}` : ''}`} placement="right" width="50vw" open={selected !== null} onClose={() => setSelected(null)} mask={false} styles={{ wrapper: { maxWidth: '100vw' } }}>
      {selected && <DetailCard kind={kind} row={selected} />}
    </Drawer>
    <Drawer title={`${editing ? '编辑' : '新增'}${configs[kind].label}`} placement="right" width="50vw" open={open} onClose={() => setOpen(false)} mask={false} destroyOnClose styles={{ wrapper: { maxWidth: '100vw' } }} extra={<Space><Button onClick={() => setOpen(false)}>取消</Button><Button type="primary" onClick={() => void submit()}>保存</Button></Space>}>
      <Form form={form} layout="vertical">
        {documents.length > 0 && <Card size="small" title="已上传资料" style={{ marginBottom: 16 }}>{documents.map((document) => <div key={document.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}><span>{document.fileName}</span><Button type="link" onClick={() => void downloadDocument(document)}>下载</Button></div>)}</Card>}
        <Tabs items={sections.map((section) => ({
          key: section.key,
          label: section.label,
          children: <div style={{ padding: '12px 8px' }}>{section.fields.map(([name, label]) => (
            <Form.Item key={name} name={name} label={<Space>{label}{canUploadForField(section.key, name) && <Upload showUploadList={false} beforeUpload={(file) => { void handleUpload(name, file); return false; }} accept=".pdf,.jpg,.jpeg,.png,.bmp,.webp"><Button size="small">上传资料/证件</Button></Upload>}</Space>} rules={['personnelCode', 'name', 'plateNumber', 'generatorCode', 'orgProvince', 'orgCity', 'orgCompany', 'orgRegion'].includes(name) ? [{ required: true, message: `请选择或输入${label}` }] : undefined}
              getValueProps={DATE_FIELD_RE.test(name) ? (value) => ({ value: toDayjs(value) }) : undefined}
              normalize={DATE_FIELD_RE.test(name) ? (value) => (value && dayjs.isDayjs(value) ? value.format('YYYY-MM-DD') : '') : undefined}>
              {name === 'orgProvince'
                ? <Select showSearch optionFilterProp="label" options={provinceOptions} placeholder="请选择省份" />
                : name === 'orgCity'
                  ? <Select showSearch optionFilterProp="label" options={cityOptions} placeholder="请选择地市" />
                  : isMaskedField(name)
                    // 掩码值只读：无权限账号看不到明文，也就不能用掩码值把库里的真值盖掉（后端同样会丢弃）
                    ? <Tooltip title="当前账号只能查看脱敏后的号码，如需修改请联系管理员"><Input readOnly /></Tooltip>
                    : DATE_FIELD_RE.test(name)
                      ? <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" placeholder="请选择日期" />
                      : <Input />}
            </Form.Item>
          ))}</div>,
        }))} />
      </Form>
    </Drawer>
  </Card>;
}
