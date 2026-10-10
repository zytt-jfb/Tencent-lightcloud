import { useState } from 'react';
import { Button, Card, Descriptions, InputNumber, Select, Space, Table, Typography, message } from 'antd';
import { RobotOutlined } from '@ant-design/icons';
import * as aiApi from '@/api/ai.api';

function numberValue(result: Record<string, unknown> | null, key: string): number {
  const value = result?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function failedJobs(result: Record<string, unknown> | null): Array<{ id: number; cityId: number | null; fileName: string }> {
  const value = result?.failedJobs;
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== 'object' || item === null) return [];
    const row = item as Record<string, unknown>;
    return [{
      id: typeof row.id === 'number' ? row.id : 0,
      cityId: typeof row.cityId === 'number' ? row.cityId : null,
      fileName: typeof row.fileName === 'string' ? row.fileName : '未记录文件名',
    }];
  });
}

export default function AiAssistant() {
  const [tool, setTool] = useState<aiApi.AiTool>('business_summary');
  const [year, setYear] = useState(new Date().getFullYear());
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);

  async function query() {
    setLoading(true);
    try {
      setResult(await aiApi.queryAiTool(tool, year));
    } catch {
      message.error('数据助手查询失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div><Typography.Title level={3} style={{ margin: 0 }}>数据助手</Typography.Title><Typography.Text type="secondary">仅管理员可用，只执行白名单只读查询。</Typography.Text></div>
      <Card>
        <Space wrap>
          <Select value={tool} style={{ width: 220 }} onChange={setTool} options={[{ value: 'business_summary', label: '经营提交汇总' }, { value: 'import_anomalies', label: '导入异常检查' }]} />
          <InputNumber min={2000} max={2100} value={year} onChange={(value) => setYear(value ?? new Date().getFullYear())} />
          <Button type="primary" icon={<RobotOutlined />} loading={loading} onClick={() => void query()}>执行查询</Button>
        </Space>
      </Card>
      <Card title="查询结果">
        {!result ? '请选择工具并执行查询' : (
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <Descriptions bordered size="small" column={{ xs: 1, sm: 2, lg: 3 }}>
              <Descriptions.Item label="统计年份">{numberValue(result, 'year')}</Descriptions.Item>
              <Descriptions.Item label="统计范围">{result.cityId == null ? '全部地市' : `地市编号 ${numberValue(result, 'cityId')}`}</Descriptions.Item>
              {tool === 'business_summary' ? (
                <>
                  <Descriptions.Item label="已提交地市数">{numberValue(result, 'submittedCityCount')}</Descriptions.Item>
                  <Descriptions.Item label="已提交月份数">{numberValue(result, 'submittedMonthCount')}</Descriptions.Item>
                  <Descriptions.Item label="最新提交月份">{numberValue(result, 'latestMonth') || '暂无提交'}</Descriptions.Item>
                </>
              ) : (
                <>
                  <Descriptions.Item label="待处理任务">{numberValue(result, 'pendingCount')}</Descriptions.Item>
                  <Descriptions.Item label="失败任务">{numberValue(result, 'failedCount')}</Descriptions.Item>
                  <Descriptions.Item label="已完成任务">{numberValue(result, 'completedCount')}</Descriptions.Item>
                </>
              )}
            </Descriptions>
            {tool === 'import_anomalies' && failedJobs(result).length > 0 && (
              <Table
                rowKey="id"
                size="small"
                pagination={false}
                dataSource={failedJobs(result)}
                columns={[
                  { title: '任务编号', dataIndex: 'id' },
                  { title: '地市编号', dataIndex: 'cityId', render: (value: number | null) => value ?? '未绑定' },
                  { title: '文件名', dataIndex: 'fileName' },
                ]}
              />
            )}
          </Space>
        )}
      </Card>
    </Space>
  );
}
