import { useEffect, useState } from 'react';
import { Button, Card, Descriptions, Form, Input, Modal, Popover, Space, Table, Tag, message, type TableColumnsType } from 'antd';
import { maintenanceCreate, maintenanceList, maintenanceRemove, maintenanceUpdate, type MaintenanceItem } from '@/api/maintenance.api';
import { useLocation } from 'react-router-dom';

const configs = {
  personnel: { label:'人员', fields:[['personnelCode','人员编号'],['name','姓名'],['gender','性别'],['age','年龄'],['account','账号'],['position','岗位'],['employmentType','自有人员/队伍人员'],['mobile','手机号'],['idCard','身份证号'],['orgProvince','省级组织'],['orgCompany','公司/分公司'],['orgRegion','地市/区域'],['lowVoltageCert','低压电工证'],['lowVoltageCertExpiry','低压电工证有效期限'],['highVoltageCert','高压电工证'],['highVoltageCertExpiry','高压电工证有效期限'],['workAtHeightCert','登高证'],['workAtHeightCertExpiry','登高证有效期限'],['employerLiabilityAmount','雇主责任险（万元）'],['employerLiabilityPolicyNo','雇主责任险（保单号）'],['employerLiabilityExpiry','雇主责任险有效期限'],['teamAccidentAmount','团队意外险（万元）'],['teamAccidentPolicyNo','团队意外险（保单号）'],['teamAccidentExpiry','团队意外险有效期限'],['teamAccidentAmount2','团队意外险（万元）#2'],['teamAccidentPolicyNo2','团队意外险（保单号）#2'],['teamAccidentExpiry2','团队意外险有效期限#2'],['teamAccidentAmount3','团队意外险（万元）#3'],['teamAccidentPolicyNo3','团队意外险（保单号）#3'],['teamAccidentExpiry3','团队意外险有效期限#3'],['personnelCondition','人员情况']] },
  vehicles: { label:'车辆', fields:[['plateNumber','车牌号'],['vehicleCode','车辆编号'],['orgProvince','省级组织'],['orgCompany','公司/分公司'],['orgRegion','地市/区域'],['vehicleType','车辆类型'],['usage','用途'],['brandModel','品牌型号'],['fuelType','燃料类型'],['ownership','所有权'],['ownerName','车主'],['driverMobile','人员手机'],['drivingLicense','行驶证'],['vehicleYears','车辆年限'],['mileage','公里数'],['vehicleStatus','车辆状态'],['compulsoryInsurancePolicyNo','交强险保险单号'],['compulsoryInsuranceExpiry','交强险到期时间'],['commercialInsurancePolicyNo','商业车险保险单号'],['commercialInsuranceExpiry','商业车险到期时间'],['maintenanceTime','车辆保养时间']] },
  generators: { label:'油机', fields:[['generatorCode','油机名称'],['externalId','油机ID'],['orgProvince','省级组织'],['orgCompany','公司/分公司'],['orgRegion','地市/区域'],['contactName','联系人'],['contactMobile','联系电话'],['manufacturer','生产厂家'],['model','规格型号'],['productionDate','生产日期'],['ratedPowerKw','额定功率'],['standardFuelConsumption','标准油耗'],['generatorType','机组类型'],['fuelType','燃料类型'],['ownership','所有权'],['usageStatus','使用状态'],['lastMaintenanceUploadAt','保养记录最近一次上传时间']] },
} as const;
type Kind = keyof typeof configs;
type Field = readonly [string, string];

/** 列表主展示列 + 二级弹窗详情列；详情列对齐《9月份合并汇总》人员/车辆/油机三张表的字段 */
const views: Record<Kind, { primary: Field; main: Field[]; detail: Field[] }> = {
  personnel: {
    primary: ['name', '姓名'],
    main: [['name','姓名'],['orgProvince','省份'],['orgRegion','区县'],['position','岗位']],
    detail: [
      ['personnelCode','人员编号'],['name','姓名'],['gender','性别'],['age','年龄'],['account','账号'],
      ['position','岗位'],['employmentType','自有人员/队伍人员'],['mobile','手机号'],
      ['idCard','身份证号'],['orgProvince','省份'],['orgCompany','所属队伍公司'],['orgRegion','区县'],
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
    main: [['plateNumber','车辆车牌号'],['orgProvince','省份'],['orgRegion','区域'],['vehicleType','车辆类型']],
    detail: [
      ['plateNumber','车辆车牌号'],['vehicleCode','车辆编号'],['vehicleType','车辆类型'],['usage','车辆用途'],
      ['brandModel','车辆品牌'],['fuelType','燃料种类'],['ownership','产权属性'],['vehicleStatus','车辆状态'],
      ['ownerName','车主'],['driverMobile','人员手机'],['drivingLicense','行驶证'],['vehicleYears','车辆年限'],['mileage','公里数'],
      ['compulsoryInsurancePolicyNo','交强险保险单号'],['compulsoryInsuranceExpiry','交强险到期时间'],
      ['commercialInsurancePolicyNo','商业车险保险单号'],['commercialInsuranceExpiry','商业车险到期时间'],
      ['maintenanceTime','车辆保养时间'],
      ['orgProvince','省份'],['orgCompany','所属队伍公司'],['orgRegion','区域'],
    ],
  },
  generators: {
    primary: ['generatorCode', '油机名称'],
    main: [['generatorCode','油机名称'],['orgProvince','省份'],['orgRegion','区域'],['contactName','联系人']],
    detail: [
      ['generatorCode','油机名称'],['externalId','油机ID'],['contactName','联系人'],['contactMobile','联系电话'],
      ['manufacturer','生产厂家'],['model','型号'],['productionDate','生产日期'],
      ['ratedPowerKw','额定功率(KW)'],['standardFuelConsumption','标准油耗(L/小时)'],
      ['generatorType','油机类型'],['fuelType','燃料种类'],['ownership','产权归属'],['usageStatus','使用状态'],
      ['lastMaintenanceUploadAt','保养记录最近一次上传时间'],
      ['orgProvince','省份'],['orgCompany','所属队伍公司'],['orgRegion','区域'],
    ],
  },
};

const isBlank = (value: unknown) => value === null || value === undefined || value === '';
const cellText = (value: unknown) => {
  if (isBlank(value)) return '—';
  if (typeof value === 'string') return value.replace(/\s*\n\s*/g, '、');
  return String(value);
};

/** 二级详细卡片：一次展示该项的全部字段 */
function DetailCard({ kind, row }: { kind: Kind; row: MaintenanceItem }) {
  const { detail } = views[kind];
  return (
    <Descriptions size="small" column={2} bordered style={{ minWidth: 420 }}
      items={[
        ...detail.map(([name, label]) => ({ key: name, label, children: cellText(row[name]) })),
        { key: 'status', label: '状态', children: <Tag color={row.status === 'active' ? 'green' : 'default'}>{row.status === 'active' ? '启用' : '停用'}</Tag> },
        { key: 'updatedAt', label: '更新时间', children: cellText(row.updatedAt) },
      ]}
    />
  );
}

export default function MaintenanceHome() { const location=useLocation(); const routeKind=location.pathname.split('/').pop() ?? ''; const kind:Kind=routeKind in configs ? routeKind as Kind : 'personnel'; const [items,setItems]=useState<MaintenanceItem[]>([]); const [total,setTotal]=useState(0); const [loading,setLoading]=useState(false); const [keyword,setKeyword]=useState(''); const [editing,setEditing]=useState<MaintenanceItem|null>(null); const [open,setOpen]=useState(false); const [form]=Form.useForm<any>();
  const load=async()=>{setLoading(true);try{const r=await maintenanceList(kind,{keyword,page:1,pageSize:50});setItems(r.items);setTotal(r.total);}catch(e){message.error('维护数据加载失败');}finally{setLoading(false);}}; useEffect(()=>{void load();},[kind]);
  const fields=configs[kind].fields; const submit=async()=>{try{const v=await form.validateFields(); if(editing) await maintenanceUpdate(kind,editing.id,v); else await maintenanceCreate(kind,v); message.success('保存成功');setOpen(false);form.resetFields();setEditing(null);void load();}catch(e){message.error('保存失败，请检查字段');}};

  const view=views[kind];
  const dataColumns:TableColumnsType<MaintenanceItem> = view.main.map(([dataIndex,title])=>({ key:dataIndex, dataIndex, title, ellipsis:true, render:dataIndex===view.primary[0]?(v:string,row:MaintenanceItem)=><Popover trigger="click" placement="right" content={<DetailCard kind={kind} row={row} />}><a>{cellText(v)}</a></Popover>:cellText }));
  const columns:TableColumnsType<MaintenanceItem> = [...dataColumns,
    {title:'状态',dataIndex:'status',render:(v:string)=><Tag color={v==='active'?'green':'default'}>{v==='active'?'启用':'停用'}</Tag>},
    {title:'操作',render:(_:unknown,row:MaintenanceItem)=><Space><Button size="small" onClick={()=>{setEditing(row);form.setFieldsValue(row);setOpen(true);}}>编辑</Button><Button danger size="small" onClick={async()=>{await maintenanceRemove(kind,row.id);void load();}}>停用</Button></Space>}];
  return <Card title="维护管理" extra={<Space><Input placeholder="关键词" value={keyword} onChange={e=>setKeyword(e.target.value)} onPressEnter={()=>void load()} /><Button onClick={()=>void load()}>查询</Button><Button type="primary" onClick={()=>{setEditing(null);form.resetFields();setOpen(true);}}>新增{configs[kind].label}</Button></Space>}>
    <Table rowKey="id" loading={loading} dataSource={items} pagination={{total,pageSize:50,showSizeChanger:false}} columns={columns}/>
    <Modal title={`${editing?'编辑':'新增'}${configs[kind].label}`} open={open} onOk={()=>void submit()} onCancel={()=>setOpen(false)} destroyOnClose><Form form={form} layout="vertical">{fields.map(([name,label])=><Form.Item key={name} name={name} label={label} rules={['personnelCode','name','plateNumber','generatorCode','orgProvince','orgCompany','orgRegion'].includes(name)?[{required:true,message:`请输入${label}`}]:undefined}><Input /></Form.Item>)}</Form></Modal>
  </Card>;
}
