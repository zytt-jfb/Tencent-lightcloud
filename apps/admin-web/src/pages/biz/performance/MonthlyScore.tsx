import { BizPermissionCode } from '@/utils/biz-permission-code';
import { useEffect, useMemo, useState } from 'react';
import { Button, Card, Col, Empty, Radio, Row, Select, Space, Statistic, Table, Typography, message } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { performanceMonthly, type PerformanceResult } from '@/api/performance.api';
import RankBadge from '@/components/biz/RankBadge';
import ScoreDistributionChart, { SCORE_BUCKET_META, type DistributionBucket } from '@/components/charts/ScoreDistributionChart';
import { exportPageRows } from '@/utils/page-export-core';
import { useBizPermission } from '@/utils/biz-permission';

const { Text } = Typography;

/**
 * 月度分数
 *
 * 口径（与后评估**不同**，不可横向比较）：
 *  - 均分：地市×代维单位先平均 → 单位再平均（二次平均）
 *  - 排名分母：全部代维单位（单位级）
 * 后评估是「明细 SUM ÷ 条数（加权）」且按「同项目 + 同月 + 全体供应商」排名。
 */
export default function MonthlyScore() {
  const [year, setYear] = useState(2026);
  const [month, setMonth] = useState(7);
  const [supplier, setSupplier] = useState<string | undefined>('中屹技术有限公司');
  const [city, setCity] = useState<string>();
  const [data, setData] = useState<PerformanceResult>();
  const [loading, setLoading] = useState(false);
  const [chartMode, setChartMode] = useState<'bar' | 'pie'>('bar');
  const canExport = useBizPermission(BizPermissionCode.PERFORMANCE_OVERVIEW_EXPORT);

  useEffect(() => {
    setLoading(true);
    void performanceMonthly({ year, month, supplier, city })
      .then(setData)
      .catch(() => message.error('月度考核数据加载失败'))
      .finally(() => setLoading(false));
  }, [year, month, supplier, city]);

  const distributionTotal = useMemo(() => (data?.distribution ?? []).reduce((sum, item) => sum + item.count, 0), [data]);
  const distributionBuckets: DistributionBucket[] = useMemo(() => {
    const counts = new Map((data?.distribution ?? []).map((item) => [item.bucket, item.count]));
    return SCORE_BUCKET_META.map((meta) => ({ label: meta.label, count: counts.get(meta.label) ?? 0, color: meta.color, range: meta.range }));
  }, [data]);

  /**
   * 导出：行先构造中文列名再交给 exportPageRows。
   * 原始字段是 supplier/score/rank/city，不转表头会是英文；
   * 这些行里也没有任何 UUID 列，导出结果自然不含内部主键。
   */
  const exportCitySupplier = () => {
    if (!data?.citySupplierItems?.length) return;
    exportPageRows(
      '月度考核-地市代维单位',
      data.citySupplierItems.map((item) => ({ 排名: item.rank, 地市: item.city, 代维单位: item.supplier, 平均分: Number(item.score.toFixed(2)) })),
      `${year}年${month}月`,
    );
  };
  const exportSuppliers = () => {
    if (!data?.items?.length) return;
    exportPageRows(
      '月度考核-单位汇总',
      data.items.map((item) => ({ 排名: item.rank, 代维单位: item.supplier, 平均分: Number(item.score.toFixed(2)) })),
      `${year}年${month}月`,
    );
  };

  const citySupplierColumns = [
    { title: '排名', dataIndex: 'rank', width: 90, render: (value: number) => <RankBadge rank={value} /> },
    { title: '地市', dataIndex: 'city', width: 140 },
    { title: '代维单位', dataIndex: 'supplier' },
    { title: '平均分', dataIndex: 'score', width: 130, render: (value: number) => value.toFixed(2) },
  ];

  return <>
    <Card
      title="月度分数"
      loading={loading}
      extra={<div style={{ display: 'flex', gap: 8 }}>
        <Select value={year} onChange={setYear} options={(data?.years?.length ? data.years : [2026]).map((value) => ({ value, label: `${value}年` }))} />
        <Select value={month} onChange={setMonth} options={Array.from({ length: 12 }, (_, index) => index + 1).map((value) => ({ value, label: `${value}月` }))} />
        <Select allowClear placeholder="代维单位" value={supplier} onChange={setSupplier} options={(data?.suppliers ?? ['中屹技术有限公司']).map((value) => ({ value, label: value }))} />
        <Select allowClear placeholder="地市" value={city} onChange={setCity} options={(data?.cities ?? []).map((value) => ({ value, label: value }))} />
        <Button icon={<DownloadOutlined />} disabled={!canExport || !data?.citySupplierItems?.length} onClick={exportCitySupplier}>导出地市汇总</Button>
        <Button icon={<DownloadOutlined />} disabled={!canExport || !data?.items?.length} onClick={exportSuppliers}>导出单位汇总</Button>
      </div>}
    >
      <Row gutter={16}>
        <Col span={6}><Statistic title="全省平均分" value={data?.companyScore ?? 0} precision={2} /></Col>
        <Col span={6}><Statistic title="供应商数量" value={data?.items.length ?? 0} /></Col>
        <Col span={6}><Statistic title="组织数量" value={data?.organizationCount ?? 0} /></Col>
        <Col span={6}><Statistic title="当月记录数" value={data?.recordCount ?? 0} /></Col>
      </Row>
      <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
        口径：地市×代维单位先平均、单位再平均，排名在全部代维单位内比较；与后评估（明细加权均分 + 同项目同月排名）不是同一套算法，分数不可横向比较。
      </Text>
    </Card>

    <Card
      title="分数分布"
      style={{ marginTop: 16 }}
      extra={<Space>
        <Text type="secondary">合计 {distributionTotal} 条 / 当月记录数 {data?.recordCount ?? 0}</Text>
        <Radio.Group value={chartMode} onChange={(event) => setChartMode(event.target.value as 'bar' | 'pie')} optionType="button" buttonStyle="solid">
          <Radio.Button value="bar">柱状</Radio.Button>
          <Radio.Button value="pie">饼图</Radio.Button>
        </Radio.Group>
      </Space>}
    >
      {distributionTotal === 0
        ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" />
        : <ScoreDistributionChart buckets={distributionBuckets} total={distributionTotal} mode={chartMode} height={240} />}
    </Card>

    <Card title="供应商排名（单位汇总）" style={{ marginTop: 16 }}>
      <Table rowKey="supplier" dataSource={data?.items} columns={[
        { title: '排名', dataIndex: 'rank', render: (value: number) => <RankBadge rank={value} /> },
        { title: '代维单位', dataIndex: 'supplier' },
        { title: '平均分', dataIndex: 'score', render: (value: number) => value.toFixed(2) },
      ]} pagination={{ pageSize: 20 }} />
    </Card>

    <Card title="地市代维单位排名（汇总）" style={{ marginTop: 16 }}>
      <Table rowKey={(row) => `${row.city}-${row.supplier}`} dataSource={data?.citySupplierItems} columns={citySupplierColumns} pagination={{ pageSize: 20 }} />
    </Card>
  </>;
}
