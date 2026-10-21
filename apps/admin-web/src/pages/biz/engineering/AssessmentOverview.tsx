import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, Col, Drawer, Empty, Radio, Row, Select, Space, Statistic, Table, Tabs, Tag, Typography, message } from 'antd';
import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import { exportPageRows } from '@/utils/page-export-core';
import ScoreDistributionChart, { SCORE_BUCKET_META, type DistributionBucket } from '@/components/charts/ScoreDistributionChart';
import {
  assessmentExportRows, assessmentOptions, assessmentOverview, assessmentSummary,
  type AssessmentOverviewRow, type AssessmentQuery, type AssessmentSummary,
} from '@/api/biz-assessment.api';

const { Title, Text } = Typography;

const METHOD_LABEL: Record<string, { label: string; color: string }> = {
  online: { label: '线上', color: 'blue' },
  offline: { label: '线下', color: 'gold' },
};

const SOURCE_LABEL: Record<string, { label: string; color: string }> = {
  import: { label: '导入', color: 'default' },
  offline: { label: '填报', color: 'purple' },
};

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  active: { label: '已生效', color: 'success' },
  submitted: { label: '已提交', color: 'processing' },
  draft: { label: '草稿', color: 'default' },
  returned: { label: '已退回', color: 'warning' },
  voided: { label: '已作废', color: 'default' },
};

/** 中屹快捷筛选的关键字（供应商名称按包含匹配） */
const ZHONGYI_KEYWORD = '中屹';

function formatMonth(value: string | null | undefined): string {
  const matched = /^(\d{4})-(\d{2})$/.exec(String(value ?? ''));
  return matched ? `${matched[1]}年${matched[2]}月` : (value ?? '-');
}

function formatScore(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-';
  return Number(value).toFixed(2);
}

interface FilterState {
  months: string[];
  cityIds: string[];
  supplierName?: string;
  projectName?: string;
  evalMethod?: string;
  source?: string;
}

const EMPTY_FILTER: FilterState = { months: [], cityIds: [] };

/**
 * 后评估概览（工程管理 / 后评估管理）
 * 口径：导入行(status=active) + 线下已提交(status=submitted) 计入统计；草稿/退回/作废不计入。
 * 数据范围由后端强制，本页不自行过滤，避免页面口径与后端不一致。
 */
export default function AssessmentOverview() {
  const [options, setOptions] = useState<{ months: string[]; suppliers: string[]; cities: Array<{ id: string; name: string }>; projects: string[] }>({ months: [], suppliers: [], cities: [], projects: [] });
  const [filter, setFilter] = useState<FilterState>(EMPTY_FILTER);
  const [onlyZhongyi, setOnlyZhongyi] = useState(false);
  const [summary, setSummary] = useState<AssessmentSummary | null>(null);
  const [rows, setRows] = useState<AssessmentOverviewRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  /** 最高分/最低分卡片的钻取抽屉：max / min / null */
  const [extremeOpen, setExtremeOpen] = useState<'max' | 'min' | null>(null);
  /** 分布图形态：柱状 / 饼图 */
  const [chartMode, setChartMode] = useState<'bar' | 'pie'>('bar');
  /**
   * 分数段下钻：只作用于「后评估明细」列表与导出。
   * 分布图与三张聚合表保持全量口径——否则点一下柱子，图表就只剩一根，失去对比意义。
   */
  const [scoreRange, setScoreRange] = useState<{ min: number; max: number; label: string } | null>(null);
  /** 请求序号：只接受最后一次请求结果，避免慢响应覆盖新筛选 */
  const seqRef = useRef(0);

  const query: AssessmentQuery = useMemo(() => ({
    months: filter.months,
    cityIds: filter.cityIds,
    supplierName: onlyZhongyi ? ZHONGYI_KEYWORD : filter.supplierName,
    projectName: filter.projectName,
    evalMethod: filter.evalMethod,
    source: filter.source,
  }), [filter, onlyZhongyi]);

  /** 明细列表与导出的查询：比概览多一个分数段条件 */
  const detailQuery: AssessmentQuery = useMemo(() => ({
    ...query,
    ...(scoreRange ? { scoreMin: scoreRange.min, scoreMax: scoreRange.max } : {}),
  }), [query, scoreRange]);

  const loadOptions = useCallback(async () => {
    try {
      setOptions(await assessmentOptions());
    } catch {
      message.error('筛选项加载失败');
    }
  }, []);

  const loadRows = useCallback(async (targetPage: number, targetPageSize: number) => {
    const seq = ++seqRef.current;
    setLoading(true);
    try {
      const result = await assessmentOverview({ ...detailQuery, page: targetPage, pageSize: targetPageSize });
      if (seq !== seqRef.current) return;
      setRows(result.items);
      setTotal(result.total);
    } catch (error: unknown) {
      const detail = (error as { response?: { data?: { message?: string } } }).response?.data?.message;
      message.error(detail ?? '后评估数据加载失败');
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, [detailQuery]);

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true);
    try {
      setSummary(await assessmentSummary(query));
    } catch {
      setSummary(null);
    } finally {
      setSummaryLoading(false);
    }
  }, [query]);

  useEffect(() => { void loadOptions(); }, [loadOptions]);
  useEffect(() => { void loadRows(page, pageSize); }, [loadRows, page, pageSize]);
  useEffect(() => { void loadSummary(); }, [loadSummary]);

  const resetFilter = () => {
    setFilter(EMPTY_FILTER);
    setOnlyZhongyi(false);
    setScoreRange(null);
    setPage(1);
  };

  const onExport = async () => {
    setExporting(true);
    try {
      const result = await assessmentExportRows(detailQuery);
      if (!result.items.length) { message.warning('当前筛选没有可导出的数据'); return; }
      const limited = result.items.slice(0, 10000);
      exportPageRows('后评估概览', limited as unknown as Array<object>, filter.months.length ? filter.months.join('、') : '全部月份');
      if (result.items.length > limited.length) message.warning(`数据 ${result.items.length} 行，已导出前 10000 行，请缩小筛选范围`);
    } catch {
      message.error('导出失败');
    } finally {
      setExporting(false);
    }
  };

  // 列序按「看数优先级」排：分数必须落在首屏，合同编号只有线下填报行才有值，放最后。
  const columns = [
    { title: '后评价月份', dataIndex: 'evalMonth', key: 'evalMonth', width: 100, render: (value: string) => formatMonth(value) },
    { title: '采购项目名称', dataIndex: 'projectName', key: 'projectName', ellipsis: true },
    { title: '地市', dataIndex: 'cityName', key: 'cityName', width: 100, render: (value: string) => value || '省本部/未匹配' },
    { title: '供应商', dataIndex: 'supplierName', key: 'supplierName', width: 180, ellipsis: true },
    { title: '分数', dataIndex: 'score', key: 'score', width: 80, align: 'right' as const, render: (value: number) => formatScore(value) },
    {
      title: '方式', dataIndex: 'evalMethod', key: 'evalMethod', width: 70,
      render: (value: string) => { const item = METHOD_LABEL[value] ?? { label: value, color: 'default' }; return <Tag color={item.color}>{item.label}</Tag>; },
    },
    {
      title: '来源', dataIndex: 'source', key: 'source', width: 70,
      render: (value: string) => { const item = SOURCE_LABEL[value] ?? { label: value, color: 'default' }; return <Tag color={item.color}>{item.label}</Tag>; },
    },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 85,
      render: (value: string) => { const item = STATUS_LABEL[value] ?? { label: value, color: 'default' }; return <Tag color={item.color}>{item.label}</Tag>; },
    },
    { title: '合同编号', dataIndex: 'contractNo', key: 'contractNo', width: 150, ellipsis: true, render: (value: string | null) => value ?? '-' },
  ];

  const cityColumns = [
    { title: '地市', dataIndex: 'cityName', key: 'cityName', render: (value: string) => value || '省本部/未匹配' },
    { title: '记录数', dataIndex: 'count', key: 'count', align: 'right' as const, width: 100 },
    { title: '平均分', dataIndex: 'avgScore', key: 'avgScore', align: 'right' as const, width: 110, render: (value: number) => formatScore(value) },
    { title: '最低分', dataIndex: 'minScore', key: 'minScore', align: 'right' as const, width: 110, render: (value: number) => formatScore(value) },
  ];

  const supplierColumns = [
    { title: '供应商', dataIndex: 'supplierName', key: 'supplierName', ellipsis: true },
    { title: '记录数', dataIndex: 'count', key: 'count', align: 'right' as const, width: 100 },
    { title: '平均分', dataIndex: 'avgScore', key: 'avgScore', align: 'right' as const, width: 110, render: (value: number) => formatScore(value) },
    { title: '最低分', dataIndex: 'minScore', key: 'minScore', align: 'right' as const, width: 110, render: (value: number) => formatScore(value) },
  ];

  const distributionTotal = summary?.distribution.reduce((sum, item) => sum + item.count, 0) ?? 0;

  /** 把后端返回的分布映射成图表数据：段位定义（颜色 + 下钻区间）来自前端常量表 */
  const distributionBuckets: DistributionBucket[] = useMemo(() => {
    const counts = new Map((summary?.distribution ?? []).map((item) => [item.bucket, item.count]));
    return SCORE_BUCKET_META.map((meta) => ({
      label: meta.label,
      count: counts.get(meta.label) ?? 0,
      color: meta.color,
      range: meta.range,
    }));
  }, [summary]);

  /** 点击某段下钻；再次点击同一段取消 */
  const handleBucketSelect = (bucket: DistributionBucket) => {
    const range = bucket.range;
    if (!range) return;
    setScoreRange((prev) => (prev && prev.label === bucket.label
      ? null
      : { min: range.min, max: range.max, label: bucket.label }));
    setPage(1);
  };

  return (
    <div className="v3-content">
      <div className="v3-page-head">
        <div className="v3-page-titles">
          <Title level={4} style={{ margin: 0 }}>后评估概览</Title>
          <Text type="secondary">统计口径：导入数据与线下已提交的填报记录；草稿、已退回、已作废不计入</Text>
        </div>
        <Space className="v3-page-head-actions" wrap>
          <Button icon={<ReloadOutlined />} onClick={() => { void loadOptions(); void loadRows(page, pageSize); void loadSummary(); }}>刷新</Button>
          <Button icon={<DownloadOutlined />} loading={exporting} onClick={() => void onExport()}>导出 Excel</Button>
        </Space>
      </div>

      <Card size="small" style={{ marginBottom: 12 }}>
        <Space wrap size={12}>
          <Select
            mode="multiple" allowClear placeholder="后评价月份" style={{ minWidth: 200 }} maxTagCount={2}
            value={filter.months}
            options={options.months.map((month) => ({ value: month, label: formatMonth(month) }))}
            onChange={(values) => { setFilter((prev) => ({ ...prev, months: values })); setPage(1); }}
          />
          <Select
            mode="multiple" allowClear placeholder="地市" style={{ minWidth: 200 }} maxTagCount={2}
            value={filter.cityIds}
            options={options.cities.map((city) => ({ value: city.id, label: city.name }))}
            onChange={(values) => { setFilter((prev) => ({ ...prev, cityIds: values })); setPage(1); }}
          />
          <Select
            allowClear showSearch placeholder="供应商" style={{ minWidth: 200 }}
            value={onlyZhongyi ? ZHONGYI_KEYWORD : filter.supplierName}
            disabled={onlyZhongyi}
            options={options.suppliers.map((supplier) => ({ value: supplier, label: supplier }))}
            onChange={(value) => { setFilter((prev) => ({ ...prev, supplierName: value })); setPage(1); }}
          />
          <Select
            allowClear showSearch placeholder="采购项目" style={{ minWidth: 260 }}
            value={filter.projectName}
            options={options.projects.map((project) => ({ value: project, label: project }))}
            onChange={(value) => { setFilter((prev) => ({ ...prev, projectName: value })); setPage(1); }}
          />
          <Select
            allowClear placeholder="评价方式" style={{ width: 130 }}
            value={filter.evalMethod}
            options={[{ value: 'online', label: '线上' }, { value: 'offline', label: '线下' }]}
            onChange={(value) => { setFilter((prev) => ({ ...prev, evalMethod: value })); setPage(1); }}
          />
          <Select
            allowClear placeholder="数据来源" style={{ width: 130 }}
            value={filter.source}
            options={[{ value: 'import', label: '导入' }, { value: 'offline', label: '填报' }]}
            onChange={(value) => { setFilter((prev) => ({ ...prev, source: value })); setPage(1); }}
          />
          <Button
            type={onlyZhongyi ? 'primary' : 'default'}
            onClick={() => { setOnlyZhongyi((prev) => !prev); setPage(1); }}
          >
            只看中屹
          </Button>
          <Button onClick={resetFilter}>重置</Button>
        </Space>
      </Card>

      <Row gutter={12} style={{ marginBottom: 12 }}>
        <Col xs={12} md={6}>
          <Card size="small"><Statistic title="评价记录" value={summary?.totalCount ?? 0} loading={summaryLoading} suffix="条" /></Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small"><Statistic title="供应商" value={summary?.supplierCount ?? 0} loading={summaryLoading} suffix="家" /></Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small"><Statistic title="覆盖地市" value={summary?.cityCount ?? 0} loading={summaryLoading} suffix="个" /></Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small"><Statistic title="采购项目" value={summary?.projectCount ?? 0} loading={summaryLoading} suffix="个" /></Card>
        </Col>
      </Row>

      <Row gutter={12} style={{ marginBottom: 12 }}>
        <Col xs={12} md={8}>
          <Card size="small"><Statistic title="平均分" value={summary?.avgScore ?? 0} precision={2} loading={summaryLoading} /></Card>
        </Col>
        <Col xs={12} md={8}>
          <Card
            size="small" hoverable style={{ cursor: 'pointer' }}
            onClick={() => setExtremeOpen('max')}
          >
            <Statistic
              title={<span>最高分 <Text type="secondary" style={{ fontSize: 12 }}>点击查看记录</Text></span>}
              value={summary?.maxScore ?? 0} precision={2} loading={summaryLoading}
              valueStyle={{ color: '#237804', textDecoration: 'underline', textDecorationColor: '#91caff' }}
            />
          </Card>
        </Col>
        <Col xs={12} md={8}>
          <Card
            size="small" hoverable style={{ cursor: 'pointer' }}
            onClick={() => setExtremeOpen('min')}
          >
            <Statistic
              title={<span>最低分 <Text type="secondary" style={{ fontSize: 12 }}>点击查看记录</Text></span>}
              value={summary?.minScore ?? 0} precision={2} loading={summaryLoading}
              valueStyle={{ color: (summary?.minScore ?? 100) < 90 ? '#cf1322' : '#173A53', textDecoration: 'underline', textDecorationColor: '#91caff' }}
            />
          </Card>
        </Col>
      </Row>

      <Card
        size="small"
        style={{ marginBottom: 12 }}
        title="分数分布"
        extra={
          <Space size={12}>
            <Radio.Group
              size="small"
              value={chartMode}
              onChange={(event) => setChartMode(event.target.value as 'bar' | 'pie')}
              optionType="button"
              buttonStyle="solid"
            >
              <Radio.Button value="bar">柱状</Radio.Button>
              <Radio.Button value="pie">饼图</Radio.Button>
            </Radio.Group>
            <Text type="secondary">线上 {summary?.onlineCount ?? 0} 条 / 线下 {summary?.offlineCount ?? 0} 条</Text>
          </Space>
        }
      >
        {distributionTotal === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" /> : (
          <Row gutter={16} align="middle">
            <Col xs={24} xl={15}>
              <ScoreDistributionChart
                buckets={distributionBuckets}
                total={distributionTotal}
                mode={chartMode}
                selectedLabel={scoreRange?.label ?? null}
                onSelect={handleBucketSelect}
                height={240}
              />
            </Col>
            <Col xs={24} xl={9}>
              {distributionBuckets.map((bucket) => {
                const percent = distributionTotal === 0 ? 0 : (bucket.count / distributionTotal) * 100;
                const selected = scoreRange?.label === bucket.label;
                const dimmed = scoreRange != null && !selected;
                return (
                  <div
                    key={bucket.label}
                    onClick={() => handleBucketSelect(bucket)}
                    title={bucket.range ? '点击按该分数段筛选明细' : undefined}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '5px 6px',
                      borderRadius: 4,
                      cursor: bucket.range ? 'pointer' : 'default',
                      background: selected ? '#e6f4ff' : 'transparent',
                      opacity: dimmed ? 0.45 : 1,
                    }}
                  >
                    <span style={{ width: 10, height: 10, borderRadius: 2, background: bucket.color, flex: 'none' }} />
                    <Text style={{ width: 76, whiteSpace: 'nowrap' }}>{bucket.label}</Text>
                    <Text strong style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}>{bucket.count.toLocaleString('zh-CN')}</Text>
                    <Text type="secondary" style={{ width: 48, textAlign: 'right' }}>{percent.toFixed(1)}%</Text>
                  </div>
                );
              })}
              {scoreRange && (
                <div style={{ marginTop: 8 }}>
                  <Tag
                    color="blue"
                    closable
                    onClose={() => { setScoreRange(null); setPage(1); }}
                  >
                    已按 {scoreRange.label} 筛选明细
                  </Tag>
                </div>
              )}
            </Col>
          </Row>
        )}
      </Card>

      <Card size="small" style={{ marginBottom: 12 }}>
        <Tabs
          items={[
            {
              key: 'cities',
              label: `按地市（${summary?.cities.length ?? 0}）`,
              children: <Table rowKey="cityName" size="small" columns={cityColumns} dataSource={summary?.cities ?? []} pagination={false} scroll={{ y: 320 }} />,
            },
            {
              key: 'suppliers',
              label: `按供应商（前 30）`,
              children: <Table rowKey="supplierName" size="small" columns={supplierColumns} dataSource={summary?.suppliers ?? []} pagination={false} scroll={{ y: 320 }} />,
            },
            {
              key: 'months',
              label: '按月份',
              children: (
                <Table
                  rowKey="month" size="small" pagination={false}
                  dataSource={summary?.months ?? []}
                  columns={[
                    { title: '月份', dataIndex: 'month', key: 'month', render: (value: string) => formatMonth(value) },
                    { title: '记录数', dataIndex: 'count', key: 'count', align: 'right' as const },
                    { title: '平均分', dataIndex: 'avgScore', key: 'avgScore', align: 'right' as const, render: (value: number) => formatScore(value) },
                  ]}
                />
              ),
            },
          ]}
        />
      </Card>

      <Card
        size="small"
        title={`后评估明细（${total} 条）`}
        extra={scoreRange ? (
          <Tag color="blue" closable onClose={() => { setScoreRange(null); setPage(1); }}>
            分数段 {scoreRange.label}
          </Tag>
        ) : null}
      >
        <Table
          rowKey="id"
          size="small"
          loading={loading}
          columns={columns}
          dataSource={rows}
          tableLayout="fixed"
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            showTotal: (count) => `共 ${count} 条`,
            onChange: (nextPage, nextSize) => { setPage(nextPage); setPageSize(nextSize); },
          }}
        />
      </Card>

      <Drawer
        open={extremeOpen !== null}
        onClose={() => setExtremeOpen(null)}
        width={1020}
        title={extremeOpen === 'max' ? '最高分记录' : '最低分记录'}
        destroyOnHidden
      >
        {(() => {
          const extreme = extremeOpen === 'max' ? summary?.extremes.max : summary?.extremes.min;
          if (!extreme) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前筛选下暂无数据" />;
          return (
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <Text>
                {extremeOpen === 'max' ? '最高分' : '最低分'} <Text strong style={{ fontSize: 18 }}>{extreme.score.toFixed(2)}</Text>
                ，当前筛选下共 <Text strong>{extreme.count}</Text> 条{extreme.count > extreme.sample.length ? `，下表显示前 ${extreme.sample.length} 条` : ''}
              </Text>
              <Table
                rowKey="id"
                size="small"
                dataSource={extreme.sample}
                pagination={false}
                columns={[
                  { title: '后评价月份', dataIndex: 'evalMonth', key: 'evalMonth', width: 95, render: (value: string) => formatMonth(value) },
                  {
                    title: '采购项目名称', dataIndex: 'projectName', key: 'projectName', ellipsis: true,
                    render: (value: string) => (
                      <a onClick={() => { setFilter((prev) => ({ ...prev, projectName: value })); setPage(1); setExtremeOpen(null); }}>
                        {value}
                      </a>
                    ),
                  },
                  { title: '地市', dataIndex: 'cityName', key: 'cityName', width: 105, render: (value: string) => value || '省本部/未匹配' },
                  { title: '供应商', dataIndex: 'supplierName', key: 'supplierName', width: 190, ellipsis: true },
                  { title: '分数', dataIndex: 'score', key: 'score', width: 75, align: 'right' as const, render: (value: number) => value.toFixed(2) },
                  { title: '方式', dataIndex: 'evalMethod', key: 'evalMethod', width: 60, render: (value: string) => value === 'offline' ? '线下' : '线上' },
                  { title: '来源', dataIndex: 'source', key: 'source', width: 60, render: (value: string) => value === 'offline' ? '填报' : '导入' },
                ]}
              />
              <Text type="secondary">点项目名称可把主表筛到该项目，查看它的全部记录。</Text>
            </Space>
          );
        })()}
      </Drawer>
    </div>
  );
}
