import { useEffect, useMemo, useState } from 'react';
import { Button, Empty, Table, Tag } from 'antd';
import { ArrowRightOutlined, ReloadOutlined } from '@ant-design/icons';
import type { FactAggregateResponse } from '@biz-reporting/shared-types';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { factsApi } from '@/api/facts.api';
import { showRequestError } from '@/utils/request';
import { cityIdsFromSearch, navigateWithV3Context, singleMonth } from '@/utils/v3-context';

const money = (value: number) => Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const wan = (value: number) => (Number(value || 0) / 10_000).toLocaleString('zh-CN', { maximumFractionDigits: 1 });
const percentage = (value: number, base: number) => base ? Math.max(0, Math.min(100, value / base * 100)) : 0;

export default function V3Dashboard() {
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const [data, setData] = useState<FactAggregateResponse>();
  const [trend, setTrend] = useState<FactAggregateResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const query = useMemo(() => ({ year: Number(search.get('year') || new Date().getFullYear()), month: singleMonth(search), cityIds: cityIdsFromSearch(search) }), [search]);

  const load = async () => {
    setLoading(true);
    try {
      const summary = await factsApi.adminSummary(query);
      setData(summary);
      const months: FactAggregateResponse[] = [];
      for (let start = 0; start < 12; start += 3) {
        const batch = await Promise.all(Array.from({ length: 3 }, (_, index) => factsApi.adminSummary({ year: query.year, month: start + index + 1, cityIds: query.cityIds })));
        months.push(...batch);
      }
      setTrend(months);
    } catch (error) {
      showRequestError(error, '经营仪表盘加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [query]);
  const totals = data?.totals;
  const maxTrend = Math.max(1, ...trend.flatMap((item) => [item.totals.acceptanceAmount, item.totals.orderAmount]));
  const go = (path: string) => navigate(navigateWithV3Context(path, search.toString() ? `?${search.toString()}` : ''));
  const metrics = [
    ['完工产值', totals?.completionAmount, '当前筛选范围'],
    ['验收审定', totals?.acceptanceAmount, `验收率 ${percentage(totals?.acceptanceAmount || 0, totals?.completionAmount || 0).toFixed(1)}%`],
    ['订单金额', totals?.orderAmount, `转化率 ${percentage(totals?.orderAmount || 0, totals?.acceptanceAmount || 0).toFixed(1)}%`],
    ['实际成本', totals?.actualCost, `预算 ${wan(totals?.costBudget || 0)} 万元`],
    ['毛利润', totals?.grossProfit, '按生效管理费率计算'],
    ['实际净利润', totals?.actualNetProfit, `净利率 ${percentage(totals?.actualNetProfit || 0, totals?.acceptanceAmount || 0).toFixed(1)}%`],
  ] as const;

  return (
    <div className="v3-page-stack">
      <header className="v3-page-head">
        <div><div className="v3-eyebrow">经营分析</div><h1>经营仪表盘</h1><span className="v3-page-description">基于当前有效事实版本汇总，筛选范围在总览、地市数据与审计页面间共享。</span></div>
        <div className="v3-head-actions"><Tag color="success">当前有效口径</Tag><Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>刷新</Button></div>
      </header>

      <section className="v3-metric-strip" aria-label="核心经营指标">
        {metrics.map(([label, value, note], index) => <div className="v3-metric" key={label}><span className="v3-metric-label">{label}</span><strong className={`v3-metric-value${index === 5 ? ' is-positive' : index === 3 ? ' is-warning' : ''}`}>{wan(Number(value || 0))}<span className="v3-metric-unit">万元</span></strong><span className="v3-metric-note">{note}</span></div>)}
      </section>

      <section className="v3-panel-grid">
        <article className="v3-panel">
          <div className="v3-panel-head"><h2>{query.year} 年月度经营趋势</h2><div className="v3-legend"><span><i />验收审定</span><span><i className="is-order" />订单金额</span></div></div>
          <div className="v3-panel-body v3-trend-scroll">
            <div className="v3-trend">
              {trend.map((item, index) => <div className="v3-trend-column" key={index}><div className="v3-trend-bars"><span className="v3-trend-bar" title={`验收 ${money(item.totals.acceptanceAmount)} 元`} style={{ height: `${Math.max(item.totals.acceptanceAmount ? 3 : 0, item.totals.acceptanceAmount / maxTrend * 100)}%` }} /><span className="v3-trend-bar is-order" title={`订单 ${money(item.totals.orderAmount)} 元`} style={{ height: `${Math.max(item.totals.orderAmount ? 3 : 0, item.totals.orderAmount / maxTrend * 100)}%` }} /></div><span className="v3-trend-label">{index + 1}月</span></div>)}
            </div>
          </div>
        </article>
        <article className="v3-panel">
          <div className="v3-panel-head"><h2>转化与质量</h2></div>
          <div className="v3-panel-body v3-ratio-list">
            {[
              ['完工验收率', percentage(totals?.acceptanceAmount || 0, totals?.completionAmount || 0), ''],
              ['验收订单转化率', percentage(totals?.orderAmount || 0, totals?.acceptanceAmount || 0), 'is-blue'],
              ['实际净利率', percentage(totals?.actualNetProfit || 0, totals?.acceptanceAmount || 0), 'is-amber'],
            ].map(([label, value, tone]) => <div className="v3-ratio-row" key={String(label)}><span className="v3-ratio-label">{label}</span><strong className="v3-ratio-value">{Number(value).toFixed(1)}%</strong><span className="v3-ratio-track"><span className={`v3-ratio-fill ${tone}`} style={{ width: `${value}%` }} /></span></div>)}
          </div>
        </article>
      </section>

      <article className="v3-panel">
        <div className="v3-panel-head"><h2>地市经营概览</h2><Button type="link" icon={<ArrowRightOutlined />} onClick={() => go('/admin/overview')}>进入工作总览</Button></div>
        <Table rowKey="cityId" loading={loading} dataSource={data?.cities ?? []} locale={{ emptyText: <Empty description="当前范围暂无有效事实数据" /> }} pagination={false} scroll={{ x: 980 }} columns={[
          { title: '地市', dataIndex: 'cityName', width: 120, fixed: 'left' },
          { title: '合同数', dataIndex: 'contractCount', width: 80 },
          { title: '数据月份', dataIndex: 'dataMonthCount', width: 100, render: (value) => <Tag color={value ? 'success' : 'default'}>{value || 0} 个月</Tag> },
          { title: '验收审定（元）', render: (_, row) => money(row.totals.acceptanceAmount), align: 'right' },
          { title: '订单金额（元）', render: (_, row) => money(row.totals.orderAmount), align: 'right' },
          { title: '实际成本（元）', render: (_, row) => money(row.totals.actualCost), align: 'right' },
          { title: '实际净利润（元）', render: (_, row) => money(row.totals.actualNetProfit), align: 'right' },
          { title: '操作', width: 76, fixed: 'right', render: (_, row) => <Button type="link" onClick={() => { const next = new URLSearchParams(search); next.set('cities', String(row.cityId)); navigate(`/admin/overview?${next.toString()}`); }}>查看</Button> },
        ]} />
      </article>
    </div>
  );
}
