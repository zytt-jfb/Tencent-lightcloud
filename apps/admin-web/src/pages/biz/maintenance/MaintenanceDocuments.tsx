import { useMemo, useState } from 'react';
import { Alert, Button, Card, Select, Space, Steps, Table, Tag, Typography, Upload, message } from 'antd';
import { InboxOutlined, LinkOutlined, ScanOutlined, UploadOutlined } from '@ant-design/icons';
import type { UploadFile, UploadProps } from 'antd';

type TargetKind = 'personnel' | 'vehicle' | 'generator';
type DocumentRow = { key: string; name: string; type: string; target: string; status: '待识别' | '待核对' | '已关联'; expiry?: string };

const targetOptions = [
  { value: 'personnel', label: '人员资料' },
  { value: 'vehicle', label: '车辆资料' },
  { value: 'generator', label: '油机资料' },
];
const documentTypes: Record<TargetKind, Array<{ value: string; label: string }>> = {
  personnel: [{ value: 'id_card', label: '身份证' }, { value: 'driver_license', label: '驾驶证' }, { value: 'qualification', label: '资格证' }, { value: 'contract', label: '劳动合同' }],
  vehicle: [{ value: 'vehicle_license', label: '行驶证' }, { value: 'insurance', label: '保险单' }, { value: 'inspection', label: '年检材料' }],
  generator: [{ value: 'purchase', label: '购买凭证' }, { value: 'inspection', label: '检修材料' }, { value: 'warranty', label: '保修资料' }],
};

export default function MaintenanceDocuments() {
  const [targetKind, setTargetKind] = useState<TargetKind>('personnel');
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [rows, setRows] = useState<DocumentRow[]>([]);
  const [documentType, setDocumentType] = useState(documentTypes.personnel[0].value);
  const [activeStep, setActiveStep] = useState(0);
  const types = useMemo(() => documentTypes[targetKind], [targetKind]);
  const uploadProps: UploadProps = {
    multiple: true,
    fileList: files,
    beforeUpload: (file) => { setFiles(current => [...current, file]); return false; },
    onRemove: file => setFiles(current => current.filter(item => item.uid !== file.uid)),
  };
  const queueFiles = () => {
    if (!files.length) { message.warning('请先选择文件'); return; }
    setRows(current => [...current, ...files.map(file => ({ key: file.uid, name: file.name, type: types.find(item => item.value === documentType)?.label ?? documentType, target: targetOptions.find(item => item.value === targetKind)?.label ?? targetKind, status: '待识别' as const }))]);
    setFiles([]); setActiveStep(0); message.info('已添加到本页待上传列表，尚未保存文件');
  };
  return <main style={{ padding: 24 }}>
    <Typography.Title level={4}>资料管理</Typography.Title>
    <Alert type="warning" showIcon message="文件存储与识别服务尚未接入" description="当前列表仅在本页暂存，刷新后清空，文件尚未上传或保存。" style={{ marginBottom: 20 }} />
    <Steps current={activeStep} items={[{ title: '上传资料', icon: <UploadOutlined /> }, { title: '内容识别', icon: <ScanOutlined /> }, { title: '核对关联', icon: <LinkOutlined /> }]} style={{ marginBottom: 24 }} />
    <Card title="上传资料" extra={<Space><Select value={targetKind} options={targetOptions} onChange={(value: TargetKind) => { setTargetKind(value); setDocumentType(documentTypes[value][0].value); }} /><Select value={documentType} options={types} onChange={setDocumentType} /></Space>}>
      <Upload.Dragger {...uploadProps} accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx" style={{ padding: 24 }}><p className="ant-upload-drag-icon"><InboxOutlined /></p><p>选择资料文件</p></Upload.Dragger>
      <Button type="primary" icon={<UploadOutlined />} onClick={queueFiles} style={{ marginTop: 16 }}>加入待上传列表</Button>
    </Card>
    <Card title="待上传资料" style={{ marginTop: 20 }}>
      <Table rowKey="key" dataSource={rows} locale={{ emptyText: '暂无待处理资料' }} columns={[{ title: '文件名', dataIndex: 'name' }, { title: '资料类型', dataIndex: 'type' }, { title: '归属类别', dataIndex: 'target' }, { title: '状态', dataIndex: 'status', render: (status: DocumentRow['status']) => <Tag color={status === '已关联' ? 'green' : status === '待核对' ? 'orange' : 'blue'}>{status}</Tag> }, { title: '有效期', dataIndex: 'expiry', render: (value?: string) => value ?? '识别后确认' }, { title: '下一步', render: () => <Button size="small" disabled>识别服务接入后可用</Button> }]} />
    </Card>
  </main>;
}
