import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, Drawer, Empty, Select, Space, Spin, Table, Tag, Tooltip, Typography, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import {
  assessmentBreakdown, assessmentOptions, assessmentScorecard,
  type BreakdownGroup, type BreakdownRow, type BreakdownSupplierRow, type ProjectBreakdown,
  type SupplierScorecard, type SupplierScorecardRow, type TrendPoint,
} from '@/api/biz-assessment.api';
import RankBadge from '@/components/biz/RankBadge';

const { Title, Text } = Typography;

/** 版式 token：取值直接照抄汇报表，保证观感一致 */
const C = {
  head: '#BDD7EE',
  headMid: '#9DC3E6',
  scoreBg: '#E2EFDA',
  focus: 'rgba(146, 208, 80, 0.28)',
  focusSolid: '#92D050',
  border: '#000000',
};

const FOCUS_SUPPLIER = '中屹技术有限公司';

function formatMonth(value: string | null | undefined): string {
  const matched = /^(\d{4})-(\d{2})$/.exec(String(value ?? ''));
  return matched ? `${matched[1]}年${matched[2]}月` : (value ?? '-');
}

/** 负数按原表写法：(0.26)，红色 */
function signed(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined) return '-';
  const fixed = Number(value).toFixed(digits);
  return Number(value) < -0.004 ? `(${Math.abs(Number(fixed)).toFixed(digits)})` : fixed;
}

const CELL: React.CSSProperties = {
  border: `1px solid ${C.border}`,
  padding: '4px 8px',
  fontSize: 12,
  textAlign: 'center',
  whiteSpace: 'nowrap',
};
const HEAD: React.CSSProperties = { ...CELL, background: C.head, fontSize: 12 };
const SCORE_CELL: React.CSSProperties = { ...CELL, background: C.scoreBg };

/** 月度趋势：分数柱 + 排名折线（排名轴反向，1 在最上） */
function TrendChart({ points }: { points: TrendPoint[] }) {
  if (points.length === 0) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无趋势数据" />;
  const width = 720;
  const height = 180;
  const padding = { left: 40, right: 40, top: 16, bottom: 28 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const maxScore = Math.max(100, ...points.map((point) => point.monthScore));
  const maxRank = Math.max(2, ...points.map((point) => point.avgRank ?? 1));
  const step = innerW / Math.max(1, points.length);
  const barW = Math.min(28, step * 0.5);

  const yScore = (value: number): number => padding.top + innerH - (value / maxScore) * innerH;
  const yRank = (rank: number): number => padding.top + ((rank - 1) / Math.max(1, maxRank - 1)) * innerH;
  const rankPath = points
    .map((point, index) => {
      if (point.avgRank === null) return null;
      const x = padding.left + step * index + step / 2;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${yRank(point.avgRank).toFixed(1)}`;
    })
    .filter(Boolean)
    .join(' ');

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg width={width} height={height} style={{ background: '#fff' }}>
        <line x1={padding.left} y1={padding.top + innerH} x2={width - padding.right} y2={padding.top + innerH} stroke="#d9d9d9" />
        <text x={padding.left - 6} y={padding.top + 8} textAnchor="end" fontSize={10} fill="#888">{maxScore}</text>
        <text x={padding.left - 6} y={padding.top + innerH} textAnchor="end" fontSize={10} fill="#888">0</text>
        <text x={width - padding.right + 6} y={padding.top + 6} fontSize={10} fill="#888">第1名</text>
        <text x={width - padding.right + 6} y={padding.top + innerH} fontSize={10} fill="#888">第{maxRank}名</text>
        {points.map((point, index) => {
          const x = padding.left + step * index + step / 2 - barW / 2;
          const y = yScore(point.monthScore);
          return (
            <g key={point.month}>
              <rect x={x} y={y} width={barW} height={padding.top + innerH - y} fill={C.headMid}>
                <title>{`${formatMonth(point.month)} 得分 ${point.monthScore}（${point.monthCount} 条）`}</title>
              </rect>
              <text x={x + barW / 2} y={height - 10} textAnchor="middle" fontSize={10} fill="#666">{point.month.slice(2)}</text>
            </g>
          );
        })}
        {rankPath && <path d={rankPath} fill="none" stroke="#f5222d" strokeWidth={1.6} />}
        {points.map((point, index) => {
          if (point.avgRank === null) return null;
          const x = padding.left + step * index + step / 2;
          return (
            <circle key={`${point.month}-r`} cx={x} cy={yRank(point.avgRank)} r={2.6} fill="#f5222d">
              <title>{`${formatMonth(point.month)} 全省排名 第${point.avgRank}名`}</title>
            </circle>
          );
        })}
      </svg>
      <Text type="secondary" style={{ fontSize: 12 }}>蓝柱=当月得分（左轴）；红线=该项目内平均分排名（右轴，1 为最好）</Text>
    </div>
  );
}

/** 块① 地市维度 */
function Block1({ rows }: { rows: BreakdownRow[] }) {
  return (
    <table style={{ borderCollapse: 'collapse', width: '100%' }}>
      <thead>
        <tr>
          {['地市', '供应商', '当月得分', '累计总分', '平均分', '当月排名', '累计排名'].map((label) => (
            <th key={label} style={HEAD}>{label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={`${row.cityName}-${row.supplierName}`}>
            <td style={CELL}>{row.cityName}</td>
            <td style={CELL}>{row.supplierName}</td>
            <td style={SCORE_CELL}>{row.monthCount > 0 ? row.monthScore.toFixed(2) : '-'}</td>
            <td style={CELL}>{row.totalScore.toFixed(2)}</td>
            <td style={CELL}>{row.avgScore.toFixed(2)}</td>
            <td style={CELL}>{row.monthRank ?? '-'}</td>
            <td style={CELL}>{row.totalRank ?? '-'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** 块② 省维度分析 */
function Block2({ rows }: { rows: BreakdownSupplierRow[] }) {
  return (
    <table style={{ borderCollapse: 'collapse', width: '100%' }}>
      <thead>
        <tr>
          {['供应商', '累计总分', '平均分', '平均分排名', '总分排名'].map((label) => (
            <th key={label} style={HEAD}>{label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.supplierName} style={row.isFocus ? { background: C.focus } : undefined}>
            <td style={{ ...CELL, textAlign: 'left' }}>
              {row.supplierName}{row.isFocus ? <Tag color="green" style={{ marginLeft: 6 }}>当前</Tag> : null}
            </td>
            <td style={CELL}>{row.totalScore.toFixed(2)}</td>
            <td style={SCORE_CELL}>{row.avgScore.toFixed(2)}</td>
            <td style={CELL}><RankBadge rank={row.avgRank} /></td>
            <td style={CELL}><RankBadge rank={row.totalRank} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** 块③ 供应商分层：供应商合并单元格 + 各地市 + 加粗合计条 */
function Block3({ groups }: { groups: BreakdownGroup[] }) {
  return (
    <table style={{ borderCollapse: 'collapse', width: '100%' }}>
      <thead>
        <tr>
          {['供应商', '平均分排名', '总分排名', '地市', '平均分', '与榜首差', '总分数', '统计月数'].map((label) => (
            <th key={label} style={HEAD}>{label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {groups.map((group) => (
          <Fragment key={group.supplierName}>
            {group.cities.map((city, index) => (
              <tr key={`${group.supplierName}-${city.cityName}`} style={group.isFocus ? { background: C.focus } : undefined}>
                {index === 0 && (
                  <td style={{ ...CELL, textAlign: 'left', verticalAlign: 'middle' }} rowSpan={group.cities.length + 1}>
                    {group.supplierName}{group.isFocus ? <Tag color="green" style={{ marginLeft: 6 }}>当前</Tag> : null}
                  </td>
                )}
                <td style={CELL} />
                <td style={CELL} />
                <td style={CELL}>{city.cityName}</td>
                <td style={SCORE_CELL}>{city.avgScore.toFixed(2)}</td>
                <td style={CELL} />
                <td style={CELL}>{city.totalScore.toFixed(2)}</td>
                <td style={CELL}>{city.monthCount}</td>
              </tr>
            ))}
            <tr style={{ background: group.isFocus ? C.focusSolid : undefined, fontWeight: 700 }}>
              <td style={{ ...CELL, fontWeight: 700 }}>{group.avgRank ?? '-'}</td>
              <td style={{ ...CELL, fontWeight: 700 }}>{group.totalRank ?? '-'}</td>
              <td style={{ ...CELL, fontWeight: 700 }}>合计</td>
              <td style={{ ...CELL, fontWeight: 700, background: C.scoreBg }}>{group.avgScore.toFixed(2)}</td>
              <td style={{ ...CELL, fontWeight: 700, color: group.gapToLeaderAvg < -0.004 ? '#cf1322' : undefined }}>
                {group.avgRank === 1 ? '-' : signed(group.gapToLeaderAvg)}
              </td>
              <td style={{ ...CELL, fontWeight: 700 }}>{group.totalScore.toFixed(2)}</td>
              <td style={{ ...CELL, fontWeight: 700 }}>-</td>
            </tr>
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

/**
 * 供应商明细（工程管理 / 后评估管理）
 * 视角：选一个供应商 → 它在每个采购项目上的本月得分、累计、两个排名；点行看排名解剖。
 * 排名分母固定为「同项目 + 同月 + 全体供应商」，不随筛选变化，保证换人看口径一致。
 */
export default function SupplierScorecardPage() {
  const [supplierOptions, setSupplierOptions] = useState<string[]>([]);
  const [projectOptions, setProjectOptions] = useState<string[]>([]);
  const [supplier, setSupplier] = useState<string>(FOCUS_SUPPLIER);
  const [month, setMonth] = useState<string | undefined>(undefined);
  const [projects, setProjects] = useState<string[]>([]);
  const [data, setData] = useState<SupplierScorecard | null>(null);
  const [loading, setLoading] = useState(false);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerRow, setDrawerRow] = useState<SupplierScorecardRow | null>(null);
  const [breakdown, setBreakdown] = useState<ProjectBreakdown | null>(null);
  const [breakdownLoading, setBreakdownLoading] = useState(false);

  useEffect(() => {
    void assessmentOptions()
      .then((result) => {
        setSupplierOptions(result.suppliers);
        setProjectOptions(result.projects);
        setSupplier((prev) => (result.suppliers.includes(prev) ? prev : result.suppliers[0] ?? prev));
      })
      .catch(() => message.error('筛选项加载失败'));
  }, []);

  const load = useCallback(async (targetMonth?: string) => {
    if (!supplier) return;
    setLoading(true);
    try {
      const result = await assessmentScorecard({ supplier, month: targetMonth ?? month, projects });
      setData(result);
      if (!month && result.month) setMonth(result.month);
    } catch (error: unknown) {
      const detail = (error as { response?: { data?: { message?: string } } }).response?.data?.message;
      message.error(detail ?? '明细加载失败');
    } finally {
      setLoading(false);
    }
  }, [supplier, month, projects]);

  useEffect(() => { void load(); }, [load]);

  const openBreakdown = async (row: SupplierScorecardRow) => {
    setDrawerRow(row);
    setDrawerOpen(true);
    setBreakdown(null);
    setBreakdownLoading(true);
    try {
      setBreakdown(await assessmentBreakdown({ project: row.projectName, month: data?.month ?? undefined, supplier }));
    } catch {
      message.error('该合同的排名明细加载失败');
    } finally {
      setBreakdownLoading(false);
    }
  };

  const columns = useMemo(() => [
    {
      title: '合同 / 采购项目', dataIndex: 'projectName', key: 'projectName', ellipsis: true,
      render: (value: string, row: SupplierScorecardRow) => (
        <Tooltip title={value}>
          <a onClick={() => void openBreakdown(row)}>{value}</a>
        </Tooltip>
      ),
    },
    { title: '省份', dataIndex: 'provinceName', key: 'provinceName', width: 70, render: (value: string) => value || '-' },
    {
      title: '本月得分', dataIndex: 'monthScore', key: 'monthScore', width: 100, align: 'right' as const,
      render: (value: number, row: SupplierScorecardRow) => (
        <span style={{ background: C.scoreBg, padding: '2px 8px' }}>{row.hasMonthData ? value.toFixed(2) : '暂无数据'}</span>
      ),
    },
    { title: '累计总分', dataIndex: 'totalScore', key: 'totalScore', width: 95, align: 'right' as const, render: (value: number) => value.toFixed(2) },
    { title: '平均分', dataIndex: 'avgScore', key: 'avgScore', width: 80, align: 'right' as const, render: (value: number) => value.toFixed(2) },
    { title: '均分排名', dataIndex: 'avgRank', key: 'avgRank', width: 85, align: 'center' as const, render: (value: number | null) => <RankBadge rank={value} /> },
    { title: '总分排名', dataIndex: 'totalRank', key: 'totalRank', width: 85, align: 'center' as const, render: (value: number | null) => <RankBadge rank={value} /> },
    {
      title: '排名变化', dataIndex: 'monthRankDelta', key: 'monthRankDelta', width: 85, align: 'center' as const,
      render: (value: number | null) => {
        if (value === null) return <span style={{ color: '#999' }}>-</span>;
        if (value === 0) return <span style={{ color: '#999' }}>持平</span>;
        return <span style={{ color: value > 0 ? '#237804' : '#cf1322' }}>{value > 0 ? `↑${value}` : `↓${Math.abs(value)}`}</span>;
      },
    },
    {
      title: '与榜首差', dataIndex: 'gapToLeaderAvg', key: 'gapToLeaderAvg', width: 95, align: 'right' as const,
      render: (value: number, row: SupplierScorecardRow) => {
        if (row.singleSupplier) return <span style={{ color: '#999' }}>-</span>;
        return <span style={{ color: value < -0.004 ? '#cf1322' : undefined }}>{signed(value)}</span>;
      },
    },
    { title: '供应商数', dataIndex: 'supplierCount', key: 'supplierCount', width: 85, align: 'right' as const },
    {
      title: '备注', dataIndex: 'singleSupplier', key: 'singleSupplier', width: 75,
      render: (value: boolean) => value ? <Tag>仅一家</Tag> : null,
    },
  ], [data?.month, supplier]);

  const totals = data?.totals;
  /**
   * 本月口径单独算一遍：后端 totals 里 projectCount / avgScore 都是**累计**口径（含本月没报数据的项目），
   * 直接和「本月合计」并排摆着会被读成同一时点，导致 41 vs 20、96.41 vs 94.88 这类疑问。
   * 本月数字按 rows 里 monthCount > 0 的项目与明细条数现算，与工作台摘要卡同源同口径。
   */
  const monthStats = useMemo(() => {
    const rows = data?.rows ?? [];
    const count = rows.reduce((sum, row) => sum + row.monthCount, 0);
    const score = rows.reduce((sum, row) => sum + row.monthScore, 0);
    return {
      projectCount: rows.filter((row) => row.monthCount > 0).length,
      count,
      avgScore: count > 0 ? Math.round((score / count) * 100) / 100 : 0,
    };
  }, [data?.rows]);
  /** 累计区间起点：只取 <= 当前选中月份的月份，避免把"未来"月份写进口径说明 */
  const cumulativeFrom = useMemo(() => {
    const months = (data?.months ?? []).filter((item) => !data?.month || item <= data.month);
    return months.length ? months[months.length - 1] : null;
  }, [data?.months, data?.month]);

  return (
    <div className="v3-content assessment-scorecard">
      {/* 表头配色照搬汇报表：主表 #9DC3E6、抽屉内 #BDD7EE */}
      <style>{`
        .assessment-scorecard .ant-table-thead > tr > th {
          background: ${C.headMid} !important; color: #000; font-weight: 400;
        }
        .assessment-scorecard .ant-table-tbody > tr > td { background: transparent; }
      `}</style>
      <div className="v3-page-head">
        <div className="v3-page-titles">
          <Title level={4} style={{ margin: 0 }}>明细</Title>
          <Text type="secondary">
            按「同项目 + 同月 + 全体供应商」排名；平均分 = 得分合计 ÷ 明细条数（加权）。
            「本月」只算选中月份，「累计」算截至选中月份的全部月份——两套口径不要混看。点项目名看该合同的排名解剖
          </Text>
        </div>
        <Space className="v3-page-head-actions" wrap>
          <Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button>
        </Space>
      </div>

      <Card size="small" style={{ marginBottom: 12 }}>
        <Space wrap size={12}>
          <span>
            <Text type="secondary">供应商</Text>{' '}
            <Select
              showSearch style={{ minWidth: 220 }} value={supplier} onChange={setSupplier}
              options={supplierOptions.map((name) => ({ value: name, label: name }))}
            />
          </span>
          <span>
            <Text type="secondary">月份</Text>{' '}
            <Select
              style={{ width: 150 }} value={month}
              options={(data?.months ?? []).map((item) => ({ value: item, label: formatMonth(item) }))}
              onChange={(value) => { setMonth(value); void load(value); }}
            />
          </span>
          <span>
            <Text type="secondary">项目</Text>{' '}
            <Select
              mode="multiple" allowClear maxTagCount={2} showSearch style={{ minWidth: 280 }}
              placeholder="全部项目" value={projects} onChange={setProjects}
              options={projectOptions.map((name) => ({ value: name, label: name }))}
            />
          </span>
        </Space>
        {totals && (
          <div style={{ marginTop: 10, fontSize: 13 }}>
            <Space size={18} wrap>
              <Text type="secondary">本月（{formatMonth(data?.month)}）</Text>
              <span>项目 <strong>{monthStats.projectCount}</strong></span>
              <span>明细 <strong>{monthStats.count}</strong> 条</span>
              <span>合计 <strong>{totals.monthScore.toFixed(2)}</strong></span>
              <span>本月平均分 <strong>{monthStats.avgScore.toFixed(2)}</strong></span>
            </Space>
            <Space size={18} wrap style={{ marginTop: 6 }}>
              <Text type="secondary">累计（{cumulativeFrom ? formatMonth(cumulativeFrom) : '-'} ~ {formatMonth(data?.month)}）</Text>
              <span>项目 <strong>{totals.projectCount}</strong></span>
              <span>总分 <strong>{totals.totalScore.toFixed(2)}</strong></span>
              <span>累计平均分 <strong>{totals.avgScore.toFixed(2)}</strong></span>
              <span>仅一家合同 <strong>{totals.singleSupplierCount}</strong></span>
            </Space>
          </div>
        )}
      </Card>

      <Card size="small" title={`${supplier || '-'} · ${formatMonth(data?.month)} 明细`}>
        <Table
          rowKey="projectName"
          size="small"
          loading={loading}
          columns={columns}
          dataSource={data?.rows ?? []}
          scroll={{ x: 'max-content', y: 560 }}
          pagination={false}
          onRow={(row) => ({ onClick: () => void openBreakdown(row), style: { cursor: 'pointer' } })}
        />
      </Card>

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={1180}
        title={drawerRow ? `${drawerRow.projectName}` : '合同排名解剖'}
        destroyOnHidden
      >
        {breakdownLoading ? (
          <div style={{ padding: 48, textAlign: 'center' }}><Spin /></div>
        ) : !breakdown || breakdown.supplierCount === 0 ? (
          <Empty description="暂无数据" />
        ) : (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <div>
              <Text strong>块① 地市维度</Text>
              <Text type="secondary" style={{ marginLeft: 8 }}>{formatMonth(breakdown.month)} · {breakdown.block1.length} 行</Text>
              <div style={{ marginTop: 6 }}><Block1 rows={breakdown.block1} /></div>
            </div>

            <div>
              <Text strong>块② 省维度分析</Text>
              <Text type="secondary" style={{ marginLeft: 8 }}>共 {breakdown.supplierCount} 家供应商</Text>
              <div style={{ marginTop: 6 }}><Block2 rows={breakdown.block2} /></div>
            </div>

            <div>
              <Text strong>块③ 供应商分层</Text>
              <Text type="secondary" style={{ marginLeft: 8 }}>按供应商展开各地市，末尾为加粗合计条</Text>
              <div style={{ marginTop: 6 }}><Block3 groups={breakdown.block3} /></div>
            </div>

            <div>
              <Text strong>月度趋势</Text>
              <div style={{ marginTop: 6 }}><TrendChart points={breakdown.trend} /></div>
            </div>
          </Space>
        )}
      </Drawer>
    </div>
  );
}
