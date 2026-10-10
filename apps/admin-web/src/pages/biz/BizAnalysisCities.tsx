import { useEffect, useRef, useState } from 'react';
import { Button, Card, Space, Table, Typography, message } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { bizSnapshotDashboard, type BizDashboardResult } from '@/api/biz.api';
import { BizAnalysisFilter, EMPTY_ANALYSIS_FILTER, type AnalysisFilterValue } from '@/components/biz/BizAnalysisFilter';
import { useBizAnalysisOptions } from '@/components/biz/BizAnalysisOptionsContext';
import { exportPageRows } from '@/utils/page-export-core';

const { Title } = Typography;
function fenToYuan(value: number): string { return (Number(value || 0) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

export default function BizAnalysisCities() {
  const navigate = useNavigate();
  const { loading: optionsLoading } = useBizAnalysisOptions();
  const [filter, setFilter] = useState<AnalysisFilterValue>(EMPTY_ANALYSIS_FILTER);
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  /** 请求序列号：仅接受最新一次请求结果，避免旧响应覆盖新响应 */
  const seqRef = useRef(0);

  const filterKey = [
    filter.year,
    [...filter.months].sort().join(','),
    [...filter.provinceIds].sort().join(','),
    [...filter.cityIds].sort().join(','),
  ].join('|');

  useEffect(() => {
    // 年度未就绪前不请求，避免首屏空跑；年度确定后每个筛选组合只发一次必要请求
    if (optionsLoading || !filter.year) return;
    const seq = ++seqRef.current;
    const controller = new AbortController();
    setLoading(true);
    void bizSnapshotDashboard({
      year: filter.year,
      months: filter.months,
      provinceIds: filter.provinceIds,
      cityIds: filter.cityIds,
      signal: controller.signal,
    })
      .then((dashboard) => {
        if (seq !== seqRef.current) return; // 已过期响应，直接丢弃
        const d = dashboard as BizDashboardResult;
        // 后端已按数据权限 + 年度 / 月份 / 省份 / 地市做交集过滤，前端不再二次过滤
        const rows = (d.byCity?.items ?? []).map((row) => {
          const order = Number(row.orderCompletionFen ?? 0) || 0;
          const offline = Number(row.offlineCompletionFen ?? 0) || 0;
          const reported = Number(row.completionFen ?? Number.NaN);
          // 累计完工 = 订单完工 + 线下完工（后端口径已保证；缺失时本地兜底重算）
          return { ...row, completionFen: Number.isFinite(reported) && reported > 0 ? reported : order + offline };
        });
        setItems(rows);
        setLoaded(true);
      })
      .catch(() => {
        if (controller.signal.aborted || seq !== seqRef.current) return;
        message.error('地市对比加载失败');
        setLoaded(true);
      })
      .finally(() => {
        if (seq === seqRef.current) setLoading(false);
      });
    return () => controller.abort();
    // filterKey 已完整表达筛选条件的变化
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, optionsLoading]);

  return (
    <div className="v3-content">
      <div className="v3-page-head"><div className="v3-page-titles"><Title level={4} style={{ margin: 0 }}>地市对比</Title></div><Space wrap><Button icon={<DownloadOutlined />} disabled={!items.length} onClick={() => exportPageRows('地市对比', items, filter.year || '全部年度')}>导出 Excel</Button></Space></div>
      <BizAnalysisFilter value={filter} onChange={setFilter} />
      <Card size="small" style={{ marginTop: 12 }} title="地市指标对比" loading={loading}>
        <Table scroll={{ x: 'max-content' }} size="small" rowKey="cityId" pagination={{ pageSize: 20 }} dataSource={items}
          locale={{ emptyText: loaded && !loading ? '该筛选条件下暂无地市数据' : '暂无数据' }}
          columns={[
            { title: '省份', dataIndex: 'provinceName', key: 'province', fixed: 'left' },
            { title: '地市', dataIndex: 'cityName', key: 'city', fixed: 'left', render: (value: string, row: Record<string, unknown>) => <Button type="link" size="small" onClick={() => navigate(`/biz/analysis/city/${encodeURIComponent(String(row.cityId))}`)}>{value}{row.unitType === 'province_branch' ? '（省级直属）' : ''}</Button> },
            { title: '合同数', dataIndex: 'contractCount' },
            { title: '合同额（元）', dataIndex: 'contractAmountFen', render: (value: number) => fenToYuan(value) },
            { title: '订单完工（元）', dataIndex: 'orderCompletionFen', render: (value: number) => fenToYuan(value) },
            { title: '线下完工（元）', dataIndex: 'offlineCompletionFen', render: (value: number) => fenToYuan(value) },
            { title: '累计完工（元）', dataIndex: 'completionFen', render: (value: number) => fenToYuan(value) },
            { title: '毛利（元）', dataIndex: 'grossProfitFen', render: (value: number) => fenToYuan(value) },
            { title: '净利（元）', dataIndex: 'netProfitFen', render: (value: number) => fenToYuan(value) },
          ]} />
      </Card>
    </div>
  );
}
