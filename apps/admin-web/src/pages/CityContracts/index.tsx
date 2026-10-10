import { useEffect, useState } from 'react';
import { Alert, Button, Card, DatePicker, Empty, Space, Statistic, Table, Tag, Typography } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { LocalContractItem } from '@biz-reporting/shared-types';
import dayjs from 'dayjs';
import { factsApi } from '@/api/facts.api';
import { exportPageWorkbook } from '@/utils/page-export';
import { showRequestError } from '@/utils/request';

const { Title, Text } = Typography;
const money = (value: number) => Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function CityContracts() {
  const [year, setYear] = useState(dayjs().year());
  const [items, setItems] = useState<LocalContractItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  useEffect(() => {
    setLoading(true);
    void factsApi.localContracts({ year })
      .then(setItems)
      .catch((error) => showRequestError(error, '本地合同加载失败'))
      .finally(() => setLoading(false));
  }, [year]);
  const columns: ColumnsType<LocalContractItem> = [
    { title: '合同编码', dataIndex: 'contractCode', width: 180, fixed: 'left' },
    { title: '合同名称', dataIndex: 'contractName', width: 260, ellipsis: true },
    { title: '分配金额', dataIndex: 'allocationAmount', width: 130, align: 'right', render: money },
    { title: '生效费率', dataIndex: 'effectiveRate', width: 100, render: (v) => `${(Number(v) * 100).toFixed(2)}%` },
    { title: '本地市订单', dataIndex: 'orderAmount', width: 130, align: 'right', render: money },
    { title: '验收审定', dataIndex: 'acceptanceAmount', width: 130, align: 'right', render: money },
    { title: '实际成本', dataIndex: 'actualCost', width: 130, align: 'right', render: money },
    { title: '毛利润', dataIndex: 'grossProfit', width: 130, align: 'right', render: money },
    { title: '实际净利润', dataIndex: 'actualNetProfit', width: 130, align: 'right', render: money },
    { title: '合同期限', width: 210, render: (_, r) => `${r.signDate || '-'} 至 ${r.expireDate || '-'}` },
    { title: '数据状态', width: 100, render: () => <Tag color="green">当前有效</Tag> },
    { title: '更新时间', dataIndex: 'updatedAt', width: 180, render: (v) => v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-' },
  ];
  const exportCurrent = async () => {
    if (!items.length) return;
    setExporting(true);
    try {
      await exportPageWorkbook({ pageName: '本地合同', scope: '本地市', period: `${year}年`, filters: { year }, rowCount: items.length, sheets: [{ name: '本地合同', moneyColumns: [2, 4, 5, 6, 7, 8], percentColumns: [3], rows: [
        ['合同编码', '合同名称', '分配金额', '生效费率', '订单金额', '验收审定', '实际成本', '毛利润', '实际净利润', '签订日期', '到期日期', '更新时间'],
        ...items.map((item) => [item.contractCode, item.contractName, item.allocationAmount, item.effectiveRate, item.orderAmount, item.acceptanceAmount, item.actualCost, item.grossProfit, item.actualNetProfit, item.signDate || '', item.expireDate || '', item.updatedAt || '']),
      ] }] });
    } catch (error) { showRequestError(error, '导出失败，请稍后重试'); } finally { setExporting(false); }
  };
  return <Space direction="vertical" size={16} style={{ width: '100%' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <div><Title level={3} style={{ margin: 0 }}>本地合同</Title><Text type="secondary">仅显示当前账号所属地市的已分配合同，合同主数据与费率为只读。</Text></div>
      <Space><Button icon={<DownloadOutlined />} disabled={!items.length} loading={exporting} onClick={() => void exportCurrent()}>导出本页</Button><DatePicker picker="year" value={dayjs().year(year)} onChange={(value) => value && setYear(value.year())} allowClear={false} /></Space>
    </div>
    <Alert showIcon type="info" message="经营口径" description="毛利润 = 验收审定金额 × 合同生效管理费率；实际净利润 = 毛利润 - 实际成本。" />
    <Card styles={{ body: { padding: 0 } }}><Table rowKey="contractId" loading={loading} columns={columns} dataSource={items} pagination={{ pageSize: 20 }} scroll={{ x: 1750 }} locale={{ emptyText: <Empty description="当前地市暂无已分配合同" /> }} /></Card>
    <Card><Space size={32}><Statistic title="合同数" value={items.length} /><Statistic title="订单总额" value={money(items.reduce((s, i) => s + i.orderAmount, 0))} /><Statistic title="实际成本" value={money(items.reduce((s, i) => s + i.actualCost, 0))} /></Space></Card>
  </Space>;
}
