import { useEffect, useState } from 'react';
import { Alert, Card, Select, Statistic, Table, Typography, message } from 'antd';
import { performanceOverview, type PerformanceResult } from '@/api/performance.api';
import RankBadge from '@/components/biz/RankBadge';

const CURRENT_MONTH = new Date().getMonth() + 1;

/**
 * 绩效总览（月度考核）
 * 月份 1-12 全量可选，默认当前月。原来写死 [1..7]、默认 7 月 —— 8 月以后来的数据根本选不到。
 */
export default function Overview() {
  const [month, setMonth] = useState(CURRENT_MONTH);
  const [data, setData] = useState<PerformanceResult>();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    void performanceOverview({ month })
      .then(setData)
      .catch(() => message.error('绩效总览加载失败'))
      .finally(() => setLoading(false));
  }, [month]);

  return <Card
    title="绩效总览"
    loading={loading}
    extra={<Select value={month} onChange={setMonth} options={Array.from({ length: 12 }, (_, index) => index + 1).map((value) => ({ value, label: `${value}月` }))} />}
  >
    <Statistic title="当前范围平均分" value={data?.companyScore ?? 0} precision={2} />
    <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
      数据范围：{data?.scope ?? '-'}｜口径：地市×代维单位先平均、单位再平均（与后评估的加权均分不同，不可横向比较）
    </Typography.Text>
    <Alert style={{ marginTop: 12 }} type="info" showIcon message={`共 ${data?.items?.length ?? 0} 个代维单位，当月记录 ${data?.recordCount ?? 0} 条`} />
    <Table
      style={{ marginTop: 16 }}
      rowKey="supplier"
      dataSource={data?.items}
      pagination={{ pageSize: 20 }}
      columns={[
        { title: '排名', dataIndex: 'rank', width: 90, render: (value: number) => <RankBadge rank={value} /> },
        { title: '供应商', dataIndex: 'supplier' },
        { title: '平均分', dataIndex: 'score', render: (value: number) => value.toFixed(2) },
      ]}
    />
  </Card>;
}
