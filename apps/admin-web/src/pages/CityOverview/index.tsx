import { useEffect, useMemo, useState } from 'react';
import { Button, DatePicker, Empty, Table, Tag } from 'antd';
import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import type { FactAggregateResponse } from '@biz-reporting/shared-types';
import dayjs from 'dayjs';
import { useSearchParams } from 'react-router-dom';
import { factsApi } from '@/api/facts.api';
import { exportPageWorkbook } from '@/utils/page-export';
import { showRequestError } from '@/utils/request';
import { singleMonth } from '@/utils/v3-context';

const money = (value: number) => Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const wan = (value: number) => (Number(value || 0) / 10_000).toLocaleString('zh-CN', { maximumFractionDigits: 1 });
const percentage = (value: number, base: number) => base ? Math.max(0, Math.min(100, value / base * 100)) : 0;

export default function CityOverview() {
  const [params, setParams] = useSearchParams();
  const query = useMemo(() => ({ year: Number(params.get('year') || dayjs().year()), month: singleMonth(params) }), [params]);
  const [data, setData] = useState<FactAggregateResponse>();
  const [trend, setTrend] = useState<FactAggregateResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const summary = await factsApi.citySummary(query);
      setData(summary);
      const months: FactAggregateResponse[] = [];
      for (let start = 0; start < 12; start += 3) {
        const batch = await Promise.all(Array.from({ length: 3 }, (_, index) => factsApi.citySummary({ year: query.year, month: start + index + 1 })));
        months.push(...batch);
      }
      setTrend(months);
    } catch (error) {
      showRequestError(error, '本地市总览加载失败');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, [query]);

  const setYear = (value: number) => { const next = new URLSearchParams(params); next.set('year', String(value)); setParams(next); };
  const totals = data?.totals;
  const maxTrend = Math.max(1, ...trend.flatMap((item) => [item.totals.acceptanceAmount, item.totals.actualCost]));
  const metrics = [
    ['完工产值', totals?.completionAmount, '当前有效版本'],
    ['验收审定', totals?.acceptanceAmount, `验收率 ${percentage(totals?.acceptanceAmount || 0, totals?.completionAmount || 0).toFixed(1)}%`],
    ['订单金额', totals?.orderAmount, `转化率 ${percentage(totals?.orderAmount || 0, totals?.acceptanceAmount || 0).toFixed(1)}%`],
    ['实际成本', totals?.actualCost, `预算 ${wan(totals?.costBudget || 0)} 万元`],
    ['毛利润', totals?.grossProfit, '按生效管理费率计算'],
    ['实际净利润', totals?.actualNetProfit, `净利率 ${percentage(totals?.actualNetProfit || 0, totals?.acceptanceAmount || 0).toFixed(1)}%`],
  ] as const;

  const exportCurrent = async () => {
    if (!data?.items.length) return;
    setExporting(true);
    try {
      await exportPageWorkbook({
        pageName: '本地市总览', scope: '本地市', period: `${query.year}年${query.month ? `${query.month}月` : '全年'}`,
        filters: query, rowCount: data.items.length,
        sheets: [{ name: '合同经营汇总', moneyColumns: [2, 3, 4, 5, 6, 7], rows: [
          ['合同编码', '合同名称', '立项完工', '验收审定', '订单金额', '实际成本', '毛利润', '实际净利润'],
          ...data.items.map((item) => [item.contractCode, item.contractName, item.completionAmount, item.acceptanceAmount, item.orderAmount, item.actualCost, item.grossProfit, item.actualNetProfit]),
        ] }],
      });
    } catch (error) {
      showRequestError(error, '导出失败，请稍后重试');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="v3-page-stack">
      <header className="v3-page-head">
        <div><div className="v3-eyebrow">地市经营</div><h1>本地市总览</h1><span className="v3-page-description">合同月度进度、成本事实与订单事实按当前有效版本统一汇总。</span></div>
        <div className="v3-head-actions"><Tag color="success">有效事实口径</Tag><Button icon={<DownloadOutlined />} disabled={!data?.items.length} loading={exporting} onClick={() => void exportCurrent()}>导出本页</Button><DatePicker picker="year" value={dayjs().year(query.year)} onChange={(value) => value && setYear(value.year())} allowClear={false} /><Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()} aria-label="刷新" /></div>
      </header>
      <section className="v3-metric-strip" aria-label="本地市核心指标">
        {metrics.map(([label, value, note], index) => <div className="v3-metric" key={label}><span className="v3-metric-label">{label}</span><strong className={`v3-metric-value${index === 5 ? ' is-positive' : index === 3 ? ' is-warning' : ''}`}>{wan(Number(value || 0))}<span className="v3-metric-unit">万元</span></strong><span className="v3-metric-note">{note}</span></div>)}
      </section>
      <section className="v3-panel-grid">
        <article className="v3-panel">
          <div className="v3-panel-head"><h2>{query.year} 年经营趋势</h2><div className="v3-legend"><span><i />验收审定</span><span><i className="is-order" />实际成本</span></div></div>
          <div className="v3-panel-body v3-trend-scroll"><div className="v3-trend">{trend.map((item, index) => <div className="v3-trend-column" key={index}><div className="v3-trend-bars"><span className="v3-trend-bar" title={`验收 ${money(item.totals.acceptanceAmount)} 元`} style={{ height: `${Math.max(item.totals.acceptanceAmount ? 3 : 0, item.totals.acceptanceAmount / maxTrend * 100)}%` }} /><span className="v3-trend-bar is-order" title={`成本 ${money(item.totals.actualCost)} 元`} style={{ height: `${Math.max(item.totals.actualCost ? 3 : 0, item.totals.actualCost / maxTrend * 100)}%` }} /></div><span className="v3-trend-label">{index + 1}月</span></div>)}</div></div>
        </article>
        <article className="v3-panel">
          <div className="v3-panel-head"><h2>经营转化</h2></div>
          <div className="v3-panel-body v3-ratio-list">{[
            ['完工验收率', percentage(totals?.acceptanceAmount || 0, totals?.completionAmount || 0), ''],
            ['验收订单转化率', percentage(totals?.orderAmount || 0, totals?.acceptanceAmount || 0), 'is-blue'],
            ['实际净利率', percentage(totals?.actualNetProfit || 0, totals?.acceptanceAmount || 0), 'is-amber'],
          ].map(([label, value, tone]) => <div className="v3-ratio-row" key={String(label)}><span className="v3-ratio-label">{label}</span><strong className="v3-ratio-value">{Number(value).toFixed(1)}%</strong><span className="v3-ratio-track"><span className={`v3-ratio-fill ${tone}`} style={{ width: `${value}%` }} /></span></div>)}</div>
        </article>
      </section>
      <article className="v3-panel">
        <div className="v3-panel-head"><h2>合同经营汇总</h2><span className="v3-page-description">共 {data?.items.length || 0} 条</span></div>
        <Table rowKey="contractId" loading={loading} dataSource={data?.items || []} pagination={{ pageSize: 10 }} scroll={{ x: 1120 }} locale={{ emptyText: <Empty description="当前期间暂无事实数据" /> }} columns={[
          { title: '合同编码', dataIndex: 'contractCode', width: 170, fixed: 'left' },
          { title: '合同名称', dataIndex: 'contractName', width: 220, ellipsis: true },
          { title: '完工（元）', dataIndex: 'completionAmount', align: 'right', render: money },
          { title: '审定（元）', dataIndex: 'acceptanceAmount', align: 'right', render: money },
          { title: '订单（元）', dataIndex: 'orderAmount', align: 'right', render: money },
          { title: '实际成本（元）', dataIndex: 'actualCost', align: 'right', render: money },
          { title: '毛利润（元）', dataIndex: 'grossProfit', align: 'right', render: money },
          { title: '实际净利润（元）', dataIndex: 'actualNetProfit', align: 'right', render: money },
        ]} />
      </article>
    </div>
  );
}
