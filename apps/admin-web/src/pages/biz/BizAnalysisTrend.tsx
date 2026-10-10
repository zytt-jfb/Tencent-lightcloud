import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, Space, Spin, Typography } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import { bizSnapshotDashboard } from '@/api/biz.api';
import { BizAnalysisFilter, EMPTY_ANALYSIS_FILTER, type AnalysisFilterValue } from '@/components/biz/BizAnalysisFilter';
import { useBizAnalysisOptions } from '@/components/biz/BizAnalysisOptionsContext';
import { exportPageRows } from '@/utils/page-export-core';

const { Title } = Typography;

/** 金额（分）→ 元 */
function fenToYuan(value: number | null | undefined): number {
  return Number(value ?? 0) / 100;
}

/** 坐标轴金额缩写：亿 / 万 / 原值 */
function formatAxis(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e8) return `${(value / 1e8).toFixed(2)}亿`;
  if (abs >= 1e4) return `${(value / 1e4).toFixed(1)}万`;
  return String(value);
}

/** 金额千分位（元） */
function formatMoney(value: number): string {
  return (Number(value) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type TrendBucket = {
  orderCompletionFen: number;
  offlineCompletionFen: number;
  grossProfitFen: number;
  netProfitFen: number;
};

const emptyBucket = (): TrendBucket => ({
  orderCompletionFen: 0,
  offlineCompletionFen: 0,
  grossProfitFen: 0,
  netProfitFen: 0,
});

export default function BizAnalysisTrend() {
  const { loading: optionsLoading } = useBizAnalysisOptions();
  const [filter, setFilter] = useState<AnalysisFilterValue>(EMPTY_ANALYSIS_FILTER);
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 请求序列号：仅接受最新一次请求的结果，避免旧响应覆盖新响应 */
  const seqRef = useRef(0);
  const chartRef = useRef<ReactECharts>(null);

  const filterKey = [
    filter.year,
    [...filter.months].sort().join(','),
    [...filter.provinceIds].sort().join(','),
    [...filter.cityIds].sort().join(','),
  ].join('|');

  useEffect(() => {
    // 年度未就绪时不发请求：避免首屏以空年度空跑一次，再因默认年度生效而二次请求
    if (optionsLoading || !filter.year) return;
    const seq = ++seqRef.current;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void bizSnapshotDashboard({
      year: filter.year,
      months: filter.months,
      provinceIds: filter.provinceIds,
      cityIds: filter.cityIds,
      signal: controller.signal,
    })
      .then((dashboard) => {
        if (seq !== seqRef.current) return; // 已过期响应，直接丢弃
        setItems((dashboard.trend?.items as Array<Record<string, unknown>>) ?? []);
        setLoaded(true);
      })
      .catch(() => {
        if (controller.signal.aborted || seq !== seqRef.current) return;
        setError('趋势数据加载失败');
        setLoaded(true);
      })
      .finally(() => {
        if (seq === seqRef.current) setLoading(false);
      });
    return () => controller.abort();
    // filterKey 已完整表达筛选条件的变化
  }, [filterKey, optionsLoading]);

  // 数据/筛选变化后重算画布尺寸，避免容器尺寸为 0 时出现"有容器无线条"
  useEffect(() => {
    const timer = window.setTimeout(() => {
      chartRef.current?.getEchartsInstance?.()?.resize();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [filterKey, items, loading]);

  useEffect(() => {
    const onResize = () => chartRef.current?.getEchartsInstance?.()?.resize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  /** 横轴月份：多选月份时只展示所选月份，否则展示该年度全部 12 个月 */
  const months = useMemo(() => {
    if (!filter.year) return [];
    const all = Array.from({ length: 12 }, (_, index) => `${filter.year}-${String(index + 1).padStart(2, '0')}`);
    return filter.months.length ? all.filter((m) => filter.months.includes(m)) : all;
  }, [filter.year, filter.months]);

  /** 按 YYYY-MM 聚合求和：保证每个 YYYY-MM 只有一个数据点，无数据月份补 0 */
  const byMonth = useMemo(() => {
    const map = new Map<string, TrendBucket>();
    for (const m of months) map.set(m, emptyBucket());
    for (const it of items) {
      const key = String(it.month ?? '');
      const bucket = map.get(key);
      if (!bucket) continue; // 仅接受当前年度 / 所选月份的数据
      bucket.orderCompletionFen += Number(it.orderCompletionFen ?? 0);
      bucket.offlineCompletionFen += Number(it.offlineCompletionFen ?? 0);
      bucket.grossProfitFen += Number(it.grossProfitFen ?? 0);
      bucket.netProfitFen += Number(it.netProfitFen ?? 0);
    }
    return map;
  }, [months, items]);

  const trendRows = useMemo(() => months.map((month) => {
    const bucket = byMonth.get(month) ?? emptyBucket();
    return { month, orderCompletionFen: bucket.orderCompletionFen, offlineCompletionFen: bucket.offlineCompletionFen, grossProfitFen: bucket.grossProfitFen, netProfitFen: bucket.netProfitFen };
  }), [months, byMonth]);

  const hasData = useMemo(
    () =>
      months.some((m) => {
        const b = byMonth.get(m);
        return !!b && Boolean(b.orderCompletionFen || b.offlineCompletionFen || b.grossProfitFen || b.netProfitFen);
      }),
    [months, byMonth],
  );

  const toSeries = (key: keyof TrendBucket) => months.map((m) => fenToYuan(byMonth.get(m)?.[key] ?? 0));

  const option = {
    tooltip: {
      trigger: 'axis',
      // 显示完整年月（YYYY-MM）与各系列金额
      formatter: (params: Array<{ dataIndex: number; seriesName: string; value: number; marker: string }>) => {
        if (!params?.length) return '';
        const fullMonth = months[params[0].dataIndex] ?? '';
        const lines = params.map((p) => `${p.marker}${p.seriesName}：${formatMoney(p.value ?? 0)} 元`);
        return [fullMonth, ...lines].join('<br/>');
      },
    },
    legend: { data: ['订单完工', '线下完工', '毛利', '净利'], top: 0 },
    grid: { left: 72, right: 28, top: 40, bottom: 36 },
    xAxis: { type: 'category', boundaryGap: true, data: months.map((m) => `${m.slice(5, 7)}月`), name: '月份' },
    yAxis: { type: 'value', name: '金额（元）', axisLabel: { formatter: (v: number) => formatAxis(v) } },
    series: [
      { name: '订单完工', type: 'bar', barMaxWidth: 24, data: toSeries('orderCompletionFen') },
      { name: '线下完工', type: 'bar', barMaxWidth: 24, data: toSeries('offlineCompletionFen') },
      { name: '毛利', type: 'bar', barMaxWidth: 24, data: toSeries('grossProfitFen') },
      { name: '净利', type: 'bar', barMaxWidth: 24, data: toSeries('netProfitFen') },
    ],
  };

  const renderChartBody = () => {
    if (!filter.year) {
      return <div style={{ textAlign: 'center', color: '#999' }}>暂无可选年度，请先导入订单数据</div>;
    }
    if (loading || !loaded) {
      return (
        <div style={{ textAlign: 'center' }}>
          <Spin />
        </div>
      );
    }
    if (error) {
      return <div style={{ textAlign: 'center', color: '#cf1322' }}>{error}</div>;
    }
    if (!hasData) {
      return <div style={{ textAlign: 'center', color: '#999' }}>该年度暂无趋势数据</div>;
    }
    return (
      <ReactECharts
        ref={chartRef}
        option={option}
        style={{ height: '100%', width: '100%' }}
        notMerge
        lazyUpdate
        opts={{ renderer: 'canvas' }}
      />
    );
  };

  return (
    <div className="v3-content">
      <div className="v3-page-head">
        <div className="v3-page-titles">
          <Title level={4} style={{ margin: 0 }}>月度趋势</Title>
          <Typography.Text type="secondary">{filter.year ? `${filter.year}年度` : '全部期间'}</Typography.Text>
        </div>
        <Space wrap><Button icon={<DownloadOutlined />} disabled={!items.length} onClick={() => exportPageRows('月度趋势', trendRows, filter.year || '全部年度')}>导出 Excel</Button></Space>
      </div>
      <BizAnalysisFilter value={filter} onChange={setFilter} />
      <Card size="small" style={{ marginTop: 12 }} title={filter.year ? `${filter.year}年月度经营趋势` : '月度经营趋势'}>
        {/* 固定高度容器：加载 / 空状态 / 图表共用同一高度，避免布局跳动与 0 高度导致的空画布 */}
        <div style={{ height: 380, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{renderChartBody()}</div>
      </Card>
    </div>
  );
}
