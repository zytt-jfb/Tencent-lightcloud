import { useEffect, useState } from 'react';
import { Card, Col, Row, Select, Statistic, Table } from 'antd';
import { performanceMonthly, type PerformanceResult } from '@/api/performance.api';

export default function MonthlyScore() {
  const [year, setYear] = useState(2026);
  const [month, setMonth] = useState(7);
  const [supplier, setSupplier] = useState<string | undefined>('中屹技术有限公司');
  const [city, setCity] = useState<string>();
  const [data, setData] = useState<PerformanceResult>();

  useEffect(() => {
    void performanceMonthly({ year, month, supplier, city }).then(setData);
  }, [year, month, supplier, city]);

  const citySupplierColumns = [
    { title: '排名', dataIndex: 'rank', width: 90 },
    { title: '地市', dataIndex: 'city', width: 140 },
    { title: '代维单位', dataIndex: 'supplier' },
    { title: '平均分', dataIndex: 'score', width: 130, render: (value: number) => value.toFixed(2) },
  ];

  return <>
    <Card title="月度分数" extra={<div style={{ display: 'flex', gap: 8 }}>
      <Select value={year} onChange={setYear} options={(data?.years?.length ? data.years : [2026]).map((value) => ({ value, label: `${value}年` }))} />
      <Select value={month} onChange={setMonth} options={Array.from({ length: 12 }, (_, index) => index + 1).map((value) => ({ value, label: `${value}月` }))} />
      <Select allowClear placeholder="代维单位" value={supplier} onChange={setSupplier} options={(data?.suppliers ?? ['中屹技术有限公司']).map((value) => ({ value, label: value }))} />
      <Select allowClear placeholder="地市" value={city} onChange={setCity} options={(data?.cities ?? []).map((value) => ({ value, label: value }))} />
    </div>}>
      <Row gutter={16}>
        <Col span={6}><Statistic title="全省平均分" value={data?.companyScore ?? 0} precision={2} /></Col>
        <Col span={6}><Statistic title="供应商数量" value={data?.items.length ?? 0} /></Col>
        <Col span={6}><Statistic title="组织数量" value={data?.organizationCount ?? 0} /></Col>
      </Row>
    </Card>
    <Card title="供应商排名（单位汇总）" style={{ marginTop: 16 }}>
      <Table rowKey="supplier" dataSource={data?.items} columns={[
        { title: '排名', dataIndex: 'rank' },
        { title: '代维单位', dataIndex: 'supplier' },
        { title: '平均分', dataIndex: 'score', render: (value: number) => value.toFixed(2) },
      ]} pagination={{ pageSize: 20 }} />
    </Card>
    <Card title="地市代维单位排名（汇总）" style={{ marginTop: 16 }}>
      <Table rowKey={(row) => `${row.city}-${row.supplier}`} dataSource={data?.citySupplierItems} columns={citySupplierColumns} pagination={{ pageSize: 20 }} />
    </Card>
  </>;
}
