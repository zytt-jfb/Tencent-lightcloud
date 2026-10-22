import { BizPermissionCode } from '@/utils/biz-permission-code';
import { useEffect, useState } from 'react';
import { Alert, Button, Card, Select, Space, Table, Typography, Upload, message } from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import { performanceUpload } from '@/api/performance.api';
import { bizOperationLogs } from '@/api/biz.api';
import { useBizPermission } from '@/utils/biz-permission';

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, index) => CURRENT_YEAR - index);

/**
 * 绩效上传
 *
 * 权限：performance.upload.create（默认只有超管）。菜单已按同一权限点过滤，
 * 这里再判一次，直接敲 URL 进来也不会只看到一个点了就 403 的按钮。
 *
 * 模板：单 Sheet，表头需含「代维单位」「地市/区域」以及月份列；
 * 月份列支持 7月 / 7月份 / 2026-07 / Excel 序列号，写入时按识别的月份落到对应 score 列。
 */
export default function UploadPage() {
  const [assessmentYear, setAssessmentYear] = useState(CURRENT_YEAR);
  const [loading, setLoading] = useState(false);
  const [months, setMonths] = useState<number[]>([]);
  const [logs, setLogs] = useState<Record<string, unknown>[]>([]);
  const canUpload = useBizPermission(BizPermissionCode.PERFORMANCE_UPLOAD_CREATE);

  const loadLogs = () => bizOperationLogs({ page: 1, pageSize: 20, targetType: 'performance' })
    .then((result) => setLogs(result.items ?? []))
    .catch(() => undefined);

  useEffect(() => { void loadLogs(); }, []);

  const handleUpload = async (file: File) => {
    setLoading(true);
    try {
      const result = await performanceUpload(file, assessmentYear);
      setMonths(result.months ?? []);
      message.success(`导入成功：${result.totalRows} 行，识别 ${result.monthCount ?? 0} 个月份列（${(result.months ?? []).join('、')}），考核年度 ${assessmentYear} 年`);
      await loadLogs();
    } catch (error) {
      const detail = (error as { response?: { data?: { message?: string } } }).response?.data?.message;
      message.error(detail ?? '上传失败，请检查模板和权限');
    } finally {
      setLoading(false);
    }
    return false;
  };

  return <>
    <Card title="绩效上传">
      <Space wrap>
        <span>考核年度</span>
        <Select value={assessmentYear} onChange={setAssessmentYear} options={YEARS.map((value) => ({ value, label: `${value}年` }))} />
        <Upload accept=".xlsx" showUploadList={false} beforeUpload={handleUpload} disabled={!canUpload}>
          <Button type="primary" icon={<UploadOutlined />} loading={loading} disabled={!canUpload}>上传</Button>
        </Upload>
      </Space>
      <Typography.Paragraph type="secondary" style={{ marginTop: 16, marginBottom: 0 }}>
        先确认考核年度，再上传业务提供的「代维打分 N月.xlsx」。系统读取单 Sheet 明细，按地市×代维单位先平均、单位再平均的口径计算（与后评估的加权均分不同）。
        重新上传同一考核年度会覆盖该年度已有明细，其他年度不受影响。
      </Typography.Paragraph>
      {months.length > 0 && <Alert style={{ marginTop: 12 }} type="success" showIcon message={`本次识别到 ${months.length} 个月份列：${months.map((month) => `${month}月`).join('、')}`} />}
      {!canUpload && <Alert style={{ marginTop: 12 }} type="warning" showIcon message="当前账号没有「绩效数据上传」权限，只能查看上传记录。" />}
    </Card>
    <Card title="本模块操作日志" style={{ marginTop: 16 }}>
      <Table
        rowKey={(row) => String(row.id)}
        dataSource={logs}
        pagination={false}
        scroll={{ x: 'max-content' }}
        columns={[
          { title: '时间', dataIndex: 'createdAt' },
          { title: '操作', dataIndex: 'actionType' },
          { title: '结果', dataIndex: 'resultStatus' },
          { title: '说明', dataIndex: 'summaryAfter' },
        ]}
      />
    </Card>
  </>;
}
