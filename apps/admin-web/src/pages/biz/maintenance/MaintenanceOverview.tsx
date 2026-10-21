import { useCallback, useEffect, useState } from 'react';
import { Button, Col, Row, Select, Space, Statistic, Table, Tag, Tooltip, Typography, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { maintenanceOverview, type MaintenanceOverview as OverviewData, type MaintenanceReminder } from '@/api/maintenance.api';

const kinds = ['personnel', 'vehicles', 'generators'] as const;
const labels = { personnel: '人员', vehicles: '车辆', generators: '油机' };

/**
 * 数据总览：全部数字来自 `GET /biz/maintenance/overview`。
 * 改造前这里用 `for (let page = 1; ; page++)` 把三张表逐页翻完（38 次请求、约 2.7MB），
 * 到期提醒还恒为空（后端从不返回 expirations 字段）。现在一个请求出全部结果。
 */
export default function MaintenanceOverview() {
  const [data, setData] = useState<OverviewData>();
  const [loading, setLoading] = useState(false);
  const [windowDays, setWindowDays] = useState(30);

  const load = useCallback(async (days: number) => {
    setLoading(true);
    try {
      setData(await maintenanceOverview(days));
    } catch {
      message.error('数据总览加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(windowDays); }, [load, windowDays]);

  const reminders = data?.reminders ?? [];
  const expired = data?.counts.expired ?? 0;

  return (
    <main style={{ padding: 24 }}>
      <Space style={{ marginBottom: 24 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>数据总览</Typography.Title>
        <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load(windowDays)}>刷新</Button>
      </Space>
      <Row gutter={[24, 16]} style={{ marginBottom: 32 }}>
        {kinds.map((kind) => (
          <Col xs={12} md={6} key={kind}><Statistic title={`${labels[kind]}总数`} value={data?.counts[kind] ?? 0} /></Col>
        ))}
        <Col xs={12} md={6}><Statistic title="已到期事项" value={expired} valueStyle={{ color: '#cf1322' }} /></Col>
        <Col xs={12} md={6}><Statistic title={`${windowDays} 天内到期`} value={data?.counts.dueSoon ?? 0} valueStyle={{ color: '#d46b08' }} /></Col>
        <Col xs={12} md={6}>
          <Statistic title="待办合计" value={data?.counts.pending ?? 0} />
          {data && data.counts.anomaly > 0 && (
            <Tooltip title="有效期字段填了无法识别的文本（如「无」「2027-14-01」），需人工修正，不计入逾期">
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>其中日期异常 {data.counts.anomaly} 条</Typography.Text>
            </Tooltip>
          )}
        </Col>
      </Row>
      <Space style={{ marginBottom: 16 }}>
        <Typography.Title level={5} style={{ margin: 0 }}>到期提醒</Typography.Title>
        <Select value={windowDays} onChange={setWindowDays} options={[7, 30, 60, 90].map((value) => ({ value, label: `${value}天内到期` }))} />
        <Typography.Text type="secondary">统计基准日 {data?.today ?? '-'}：已逾期不设下限，提前 {windowDays} 天预警</Typography.Text>
      </Space>
      {/* 分类小计：车辆/人员/油机的待办口径不同，先看这张表再往下拉明细 */}
      <Table
        size="small"
        style={{ marginBottom: 16 }}
        loading={loading}
        rowKey="kind"
        pagination={false}
        dataSource={data?.byKind ?? []}
        columns={[
          { title: '类别', dataIndex: 'category', width: 100 },
          { title: '已到期', dataIndex: 'expired', width: 100 },
          { title: `${windowDays} 天内到期`, dataIndex: 'dueSoon', width: 140 },
          { title: '日期异常', dataIndex: 'anomaly', width: 110 },
          { title: '待办小计', dataIndex: 'total', width: 110 },
        ]}
      />
      <Table<MaintenanceReminder>
        loading={loading}
        rowKey="id"
        dataSource={reminders}
        scroll={{ x: 900 }}
        // 生产环境到期项可能有几百条，默认每页 50 条；不设虚拟滚动，先把总量压到一个接口里
        pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: [20, 50, 100, 200], showTotal: (total) => `共 ${total} 条待办` }}
        locale={{ emptyText: '暂无已登记的到期提醒' }}
        columns={[
          { title: '类别', dataIndex: 'category', width: 80 },
          { title: '人员 / 资产', dataIndex: 'name', width: 180, ellipsis: true },
          { title: '到期事项', dataIndex: 'title', width: 160 },
          { title: '到期日期', dataIndex: 'date', width: 140 },
          {
            title: '状态',
            dataIndex: 'days',
            width: 140,
            render: (_: unknown, row: MaintenanceReminder) => {
              if (row.invalidDate || row.days === null) return <Tooltip title={`原始值：${row.date}`}><Tag color="default">日期无法识别</Tag></Tooltip>;
              if (row.days < 0) return <Tag color="red">逾期{-row.days}天</Tag>;
              if (row.days === 0) return <Tag color="orange">今天到期</Tag>;
              return <Tag color="orange">{row.days}天后到期</Tag>;
            },
          },
          { title: '所属组织', dataIndex: 'region', ellipsis: true },
        ]}
      />
      <Typography.Title level={5} style={{ marginTop: 24 }}>组织汇总</Typography.Title>
      <Table
        loading={loading}
        rowKey="region"
        dataSource={data?.organizations ?? []}
        scroll={{ x: 600 }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true, pageSizeOptions: [20, 50, 100] }}
        columns={[{ title: '所属组织', dataIndex: 'region' }, ...kinds.map((kind) => ({ title: labels[kind], dataIndex: kind, width: 100 }))]}
      />
    </main>
  );
}
