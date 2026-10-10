import { useEffect, useRef, useState } from 'react';
import { Button, Card, Space, Table, Tag, Typography, message } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { bizSnapshotDashboard, type BizDashboardResult } from '@/api/biz.api';
import { BizAnalysisFilter, EMPTY_ANALYSIS_FILTER, type AnalysisFilterValue } from '@/components/biz/BizAnalysisFilter';
import { useBizAnalysisOptions } from '@/components/biz/BizAnalysisOptionsContext';
import { exportPageRows } from '@/utils/page-export-core';

const { Title } = Typography;
function fenToYuan(value: number): string { return (Number(value || 0) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

export default function BizAnalysisOverruns() {
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
        // 后端已按年度 / 月份 / 权限 / 省份 / 地市交集过滤超额，前端不再二次过滤
        setItems((d.overruns?.items as Array<Record<string, unknown>>) ?? []);
        setLoaded(true);
      })
      .catch(() => {
        if (controller.signal.aborted || seq !== seqRef.current) return;
        message.error('超额清单加载失败');
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
      <div className="v3-page-head"><div className="v3-page-titles"><Title level={4} style={{ margin: 0 }}>超额清单</Title></div><Space wrap><Button icon={<DownloadOutlined />} disabled={!items.length} onClick={() => exportPageRows('超额清单', items, filter.year || '全部年度')}>导出 Excel</Button></Space></div>
      <BizAnalysisFilter value={filter} onChange={setFilter} />
      <Card size="small" style={{ marginTop: 12 }} title="合同与地市超额" loading={loading}>
        <Table scroll={{ x: 'max-content' }} size="small" rowKey={(row) => `${row.type}-${row.contractId ?? row.cityId}-${row.overrunFen}`} pagination={{ pageSize: 20 }} dataSource={items}
          locale={{ emptyText: loaded && !loading ? '该筛选条件下暂无超额数据' : '暂无超额数据' }}
          columns={[
            { title: '类型', dataIndex: 'type', render: (value: string) => value === 'contract' ? <Tag color="red">合同超额</Tag> : <Tag color="orange">地市超额</Tag> },
            { title: '合同/地市', render: (_: unknown, row: Record<string, unknown>) => String(row.contractNo ?? row.cityName ?? row.cityId ?? '-') },
            { title: '超额（元）', dataIndex: 'overrunFen', render: (value: number) => <Tag color="red">{fenToYuan(value)}</Tag> },
          ]} />
      </Card>
    </div>
  );
}
