import { useEffect, useState } from 'react';
import { AutoComplete, Button, Card, Descriptions, Drawer, Form, Input, Modal, Select, Space, Table, Tabs, Tag, Upload, message, type TableColumnsType } from 'antd';
import { maintenanceCreate, maintenanceDownloadDocument, maintenanceList, maintenanceListDocuments, maintenanceRemove, maintenanceUpdate, maintenanceUploadDocument, type MaintenanceDocument, type MaintenanceItem } from '@/api/maintenance.api';
import { useLocation } from 'react-router-dom';
import { useBizPermission } from '@/utils/biz-permission';

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

export default function MaintenanceHome() { const location=useLocation(); const routeKind=location.pathname.split('/').pop() ?? ''; const kind:Kind=routeKind in configs ? routeKind as Kind : 'personnel'; const [items,setItems]=useState<MaintenanceItem[]>([]); const [total,setTotal]=useState(0); const [page,setPage]=useState(1); const [loading,setLoading]=useState(false); const [filters,setFilters]=useState({ keyword:'', orgProvince:'', orgCity:'', orgRegion:'' }); const [editing,setEditing]=useState<MaintenanceItem|null>(null); const [open,setOpen]=useState(false); const [documentIds,setDocumentIds]=useState<string[]>([]); const [documents,setDocuments]=useState<MaintenanceDocument[]>([]); const [form]=Form.useForm<any>();
  const canDelete = useBizPermission('maintenance.data.delete');
  const load=async(nextPage=1,nextFilters=filters)=>{setLoading(true);try{const r=await maintenanceList(kind,{...nextFilters,page:nextPage,pageSize:50});setItems(r.items);setTotal(r.total);setPage(nextPage);}catch(e){message.error('维护数据加载失败');}finally{setLoading(false);}}; useEffect(()=>{void load(1);},[kind]);
  const sections=formSections(kind); const submit=async()=>{try{const v=await form.validateFields(); const payload={...v,documentFileIds:documentIds}; if(editing) await maintenanceUpdate(kind,editing.id,payload); else await maintenanceCreate(kind,payload); message.success('保存成功，资料已关联');setOpen(false);form.resetFields();setDocumentIds([]);setEditing(null);void load();}catch(e){message.error('保存失败，请检查字段');}};
  const uploadCategory=(field:string) => kind==='personnel' ? (field==='idCard'?'idCard':/Cert/i.test(field)?field.replace(/Expiry$/i,''):/employerLiability/i.test(field)?'employerLiabilityInsurance':/Insurance|Amount|Policy|Expiry/i.test(field)?'teamAccidentInsurance':'idCard') : kind==='vehicles' ? (field==='drivingLicense'?'drivingLicense':/compulsoryInsurance/i.test(field)?'compulsoryInsurance':/commercialInsurance/i.test(field)?'commercialInsurance':'maintenanceRecord') : (field==='lastMaintenanceUploadAt'?'maintenanceRecord':'generatorDocument');
  const canUploadForField=(sectionKey:string, field:string) => {
    if (sectionKey === 'certificates') return !/Expiry$/i.test(field);
    if (sectionKey === 'insurance') return field === 'employerLiabilityAmount' || field === 'teamAccidentAmount';
    if (kind === 'vehicles' && sectionKey === 'maintenance') return field === 'compulsoryInsurancePolicyNo' || field === 'commercialInsurancePolicyNo';
    if (kind === 'generators' && sectionKey === 'maintenance') return field === 'lastMaintenanceUploadAt';
    return false;
  };
  const handleUpload=async(field:string,file:File)=>{try{const result=await maintenanceUploadDocument(kind,uploadCategory(field),file);setDocumentIds(ids=>[...ids,result.id]);setDocuments(rows=>[...rows,{id:result.id,category:result.category,fileName:result.fileName,mimeType:result.mimeType,fileSize:result.fileSize}]);if(result.fields.length){const values=mapOcrFields(kind,uploadCategory(field),result.fields);form.setFieldsValue(values);}if(result.extractionError) message.warning(`文件已保存，识别失败：${result.extractionError}`);else if(!result.ocrAvailable) message.warning('文件已保存；当前未配置OCR密钥，请手工填写后保存');else message.success(result.fields.length?'已识别并回填，请复核后保存':'已完成文字识别，请核对内容并手工填写对应字段');}catch{message.error('资料上传失败，请检查文件格式和大小');}return false;};

  const [selected, setSelected] = useState<MaintenanceItem | null>(null);
  useEffect(() => { setSelected(null); }, [kind]);
  const view=views[kind];
  const dataColumns:TableColumnsType<MaintenanceItem> = view.main.map(([dataIndex,title])=>({ key:dataIndex, dataIndex, title, ellipsis:true, render:dataIndex===view.primary[0]?(v:string,row:MaintenanceItem)=><Button type="link" style={{ padding: 0 }} onClick={() => setSelected(row)}>{cellText(v)}</Button>:cellText }));
  const openEdit=(row:MaintenanceItem)=>{setEditing(row);form.setFieldsValue(row);setDocumentIds([]);setDocuments([]);setOpen(true);void maintenanceListDocuments(kind,row.id).then(setDocuments).catch(()=>message.error('附件列表加载失败'));};
  const downloadDocument=async(file:MaintenanceDocument)=>{try{const blob=await maintenanceDownloadDocument(kind,file.id);const url=URL.createObjectURL(blob);const anchor=window.document.createElement('a');anchor.href=url;anchor.download=file.fileName;anchor.click();URL.revokeObjectURL(url);}catch{message.error('资料下载失败');}};
  const columns:TableColumnsType<MaintenanceItem> = [...dataColumns,
    {title:'状态',dataIndex:'status',render:(v:string)=><Tag color={v==='active'?'green':'default'}>{v==='active'?'启用':'停用'}</Tag>},
    {title:'操作',render:(_:unknown,row:MaintenanceItem)=><Space><Button size="small" onClick={()=>openEdit(row)}>编辑</Button>{canDelete && <Button danger size="small" onClick={()=>Modal.confirm({title:`删除${configs[kind].label}`,content:'删除后该记录将从列表中隐藏，可由数据恢复流程处理。确定继续吗？',okText:'删除',okButtonProps:{danger:true},cancelText:'取消',onOk:async()=>{await maintenanceRemove(kind,row.id);message.success('已删除');void load(page);}})}>删除</Button>}</Space>}];
  return <Card title="维护管理" extra={<Button type="primary" onClick={()=>{setSelected(null);setEditing(null);form.resetFields();setOpen(true);}}>新增{configs[kind].label}</Button>}>
    <Space wrap style={{ marginBottom: 16, width: '100%' }}>
      <Input placeholder="关键词" value={filters.keyword} onChange={e=>setFilters(f=>({...f,keyword:e.target.value}))} onPressEnter={()=>void load(1)} style={{ width: 170 }} />
      {(['orgProvince','orgCity','orgRegion'] as const).map((field)=>{
        const label={orgProvince:'省份',orgCity:'地市',orgRegion:'区县'}[field];
        const options=Array.from(new Set(items.map(row=>String(row[field]??'').trim()).filter(Boolean))).map(value=>({value}));
        return <AutoComplete key={field} allowClear options={options} value={filters[field]} onChange={value=>setFilters(f=>({...f,[field]:value}))} onSelect={value=>setFilters(f=>({...f,[field]:value}))} onKeyDown={event=>{if(event.key==='Enter')void load(1);}} filterOption={(input,option)=>(option?.value??'').toLowerCase().includes(input.toLowerCase())} style={{width:140}}>
          <Input placeholder={label} />
        </AutoComplete>;
      })}
      <Button type="primary" onClick={()=>void load(1)}>筛选</Button><Button onClick={()=>{const next={keyword:'',orgProvince:'',orgCity:'',orgRegion:''};setFilters(next);void load(1,next);}}>重置</Button>
    </Space>
    <Table rowKey="id" loading={loading} dataSource={items} pagination={{total,current:page,pageSize:50,showSizeChanger:false,onChange:(nextPage)=>void load(nextPage)}} columns={columns}/>
    <Drawer title={`${configs[kind].label}详情${selected ? ` · ${cellText(selected[view.primary[0]])}` : ''}`} placement="right" width="50vw" open={selected !== null} onClose={() => setSelected(null)} mask={false} styles={{ wrapper: { maxWidth: '100vw' } }}>
      {selected && <DetailCard kind={kind} row={selected} />}
    </Drawer>
    <Drawer title={`${editing?'编辑':'新增'}${configs[kind].label}`} placement="right" width="50vw" open={open} onClose={()=>setOpen(false)} mask={false} destroyOnClose styles={{wrapper:{maxWidth:'100vw'}}} extra={<Space><Button onClick={()=>setOpen(false)}>取消</Button><Button type="primary" onClick={()=>void submit()}>保存</Button></Space>}>
      <Form form={form} layout="vertical">
        {documents.length>0&&<Card size="small" title="已上传资料" style={{marginBottom:16}}>{documents.map(document=><div key={document.id} style={{display:'flex',justifyContent:'space-between',padding:'4px 0'}}><span>{document.fileName}</span><Button type="link" onClick={()=>void downloadDocument(document)}>下载</Button></div>)}</Card>}
        <Tabs items={sections.map((section)=>({key:section.key,label:section.label,children:<div style={{padding: '12px 8px'}}>{section.fields.map(([name,label])=><Form.Item key={name} name={name} label={<Space>{label}{canUploadForField(section.key,name)&&<Upload showUploadList={false} beforeUpload={file=>{void handleUpload(name,file);return false;}} accept=".pdf,.jpg,.jpeg,.png,.bmp,.webp"><Button size="small">上传资料/证件</Button></Upload>}</Space>} rules={['personnelCode','name','plateNumber','generatorCode','orgProvince','orgCity','orgCompany','orgRegion'].includes(name)?[{required:true,message:`请输入${label}`}]:undefined}><Input /></Form.Item>)}</div>}))} />
      </Form>
    </Drawer>
  </Card>;
}
