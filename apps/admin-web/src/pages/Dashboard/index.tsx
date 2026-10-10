/**
 * Dashboard 页面。
 *
 * 顶部 KPI、表格和导出共同使用筛选后的经营事实汇总。
 */
import { useState } from 'react';
import { Button, Card, Col, DatePicker, Modal, Row, Select, Space, Spin, Statistic, Table, Typography, message, Checkbox, InputNumber } from 'antd';
import {
  BellOutlined,
  DownloadOutlined,
  FileTextOutlined,
  FundOutlined,
  PayCircleOutlined,
  RiseOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation } from '@tanstack/react-query';
import dayjs from 'dayjs';
import * as XLSX from 'xlsx';
import * as dashboardApi from '@/api/dashboard.api';
import * as remindersApi from '@/api/reminders.api';
import type { AdminBusinessSummaryItem, AdminBusinessSummaryResponse } from '@biz-reporting/shared-types';
import { auditPageExport, makeExportFileName } from '@/utils/page-export';

const { Title } = Typography;

// ============================================================
// 共享列定义（Table / CSV / Excel 三处复用）
// ============================================================

type ColumnType = 'text' | 'money' | 'percent' | 'number';

interface SummaryColumnDef {
  key: string;
  /** 列标题（根据 year 动态生成） */
  title: (year: number, suffix: string) => string;
  type: ColumnType;
  /** rows 取值字段名 */
  dataIndex: keyof AdminBusinessSummaryItem;
  /** totals 取值字段名（null = 无合计） */
  totalsKey: keyof AdminBusinessSummaryResponse['totals'] | null;
}

const SUMMARY_COLUMNS: SummaryColumnDef[] = [
  { key: 'cityName',          title: () => '地市',                     type: 'text',    dataIndex: 'cityName',          totalsKey: null },
  { key: 'dataStatus',        title: () => '数据状态',                 type: 'text',    dataIndex: 'dataStatus',        totalsKey: null },
  { key: 'completionTotal',   title: (y) => `${y}年立项完工金额`,      type: 'money',   dataIndex: 'completionTotal',   totalsKey: 'completionTotal' },
  { key: 'acceptanceTotal',   title: (y) => `${y}年验收审定金额`,      type: 'money',   dataIndex: 'acceptanceTotal',   totalsKey: 'acceptanceTotal' },
  { key: 'invoiceTotal', title: (y) => `${y}\u5e74\u7d2f\u8ba1\u5f00\u7968\u91d1\u989d`, type: 'money', dataIndex: 'invoiceTotal', totalsKey: 'invoiceTotal' },
  { key: 'orderTotal', title: (y) => `${y}\u5e74\u7d2f\u8ba1\u8ba2\u5355\u91d1\u989d`, type: 'money', dataIndex: 'orderTotal', totalsKey: 'orderTotal' },
  { key: 'orderGrossProfit',  title: (_, s) => `${s}年累计订单毛利`,   type: 'money',   dataIndex: 'orderGrossProfit',  totalsKey: 'orderGrossProfit' },
  { key: 'costTotal',         title: (_, s) => `${s}年累计成本`,       type: 'money',   dataIndex: 'costTotal',         totalsKey: 'costTotal' },
  { key: 'costRate',          title: () => '成本占比',                 type: 'percent', dataIndex: 'costRate',          totalsKey: 'costRate' },
  { key: 'costIncomeRate',    title: () => '成本收入占比',             type: 'percent', dataIndex: 'costIncomeRate',    totalsKey: 'costIncomeRate' },
  { key: 'netProfit',         title: () => '净利润',                   type: 'money',   dataIndex: 'netProfit',         totalsKey: 'netProfit' },
  { key: 'netProfitRate',     title: () => '净利率',                   type: 'percent', dataIndex: 'netProfitRate',     totalsKey: 'netProfitRate' },
  { key: 'submittedMonthCount', title: () => '有数据月份',             type: 'number',  dataIndex: 'submittedMonthCount', totalsKey: 'submittedMonthCount' },
  { key: 'contractCount',     title: () => '合同数',                   type: 'number',  dataIndex: 'contractCount',     totalsKey: 'contractCount' },
];

// ============================================================
// 格式化辅助函数
// ============================================================

function formatMoney(value: number): string {
  return value.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function netProfitColor(value: number): string | undefined {
  if (value < 0) return '#ff4d4f';
  if (value > 0) return '#52c41a';
  return undefined;
}

function dataStatusLabel(value: AdminBusinessSummaryItem['dataStatus']): string {
  return value === 'current' ? '数据完整' : value === 'partial' ? '部分数据' : '暂无数据';
}

/** 安全取数（含兜底） */
function safeVal(v: unknown, fallback: number): number {
  return Number.isFinite(v) ? (v as number) : fallback;
}

/** 仅值（保留小数，无千分位） */
function rawMoney(v: unknown): string {
  return safeVal(v, 0).toFixed(2);
}

/** 仅值百分比 */
function rawPercent(v: unknown): string {
  return `${(safeVal(v, 0) * 100).toFixed(2)}%`;
}

// ============================================================
// CSV 导出
// ============================================================

/** CSV 转义：含逗号/引号/换行的字段用双引号包裹 */
function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** 导出经营汇总 CSV */
function exportBusinessSummaryCsv(
  year: number,
  items: AdminBusinessSummaryItem[],
  totals: AdminBusinessSummaryResponse['totals'],
  fileName: string,
): void {
  const suffix = String(year).slice(2);
  const headers = SUMMARY_COLUMNS.map((c) => csvEscape(c.title(year, suffix)));

  function fmt(item: AdminBusinessSummaryItem, col: SummaryColumnDef): string {
    const v = item[col.dataIndex];
    if (col.key === 'dataStatus') return dataStatusLabel(v as AdminBusinessSummaryItem['dataStatus']);
    switch (col.type) {
      case 'money':   return rawMoney(v);
      case 'percent': return rawPercent(v);
      case 'number':  return String(safeVal(v, 0));
      default:        return csvEscape(String(v ?? ''));
    }
  }

  function fmtTotals(col: SummaryColumnDef): string {
    if (col.key === 'cityName') return csvEscape('合计');
    if (col.key === 'dataStatus') return csvEscape('按事实数据汇总');
    const v = col.totalsKey ? totals[col.totalsKey] : 0;
    switch (col.type) {
      case 'money':   return rawMoney(v);
      case 'percent': return rawPercent(v);
      case 'number':  return String(safeVal(v, 0));
      default:        return csvEscape(String(v ?? ''));
    }
  }

  const rows: string[] = [headers.join(',')];
  for (const item of items) {
    rows.push(SUMMARY_COLUMNS.map((c) => fmt(item, c)).join(','));
  }
  rows.push(SUMMARY_COLUMNS.map((c) => fmtTotals(c)).join(','));

  const bom = '\uFEFF';
  const blob = new Blob([bom + rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName.replace(/\.xlsx$/, '.csv');
  a.click();
  URL.revokeObjectURL(url);
}

// ============================================================
// Excel 导出
// ============================================================

/** 导出经营汇总 XLSX */
function exportBusinessSummaryXlsx(
  year: number,
  items: AdminBusinessSummaryItem[],
  totals: AdminBusinessSummaryResponse['totals'],
  fileName: string,
): void {
  const suffix = String(year).slice(2);
  const headers = SUMMARY_COLUMNS.map((c) => c.title(year, suffix));

  // 构建 SheetJS 二维数组
  const data: unknown[][] = [];

  // 标题行
  data.push([`经营汇总总览 - ${year}年`]);
  // 表头行
  data.push(headers);

  // 数据行
  for (const item of items) {
    const row: unknown[] = SUMMARY_COLUMNS.map((c) => {
      const v = item[c.dataIndex];
      switch (c.type) {
        case 'text':   return String(v ?? '');
        case 'money':  return safeVal(v, 0);
        case 'percent': return safeVal(v, 0);
        case 'number': return safeVal(v, 0);
        default:       return String(v ?? '');
      }
    });
    data.push(row);
  }

  // 合计行（用 Excel SUM 公式）
  // SheetJS 公式用 { f: 'SUM(...)' } 对象
  const totalRow: unknown[] = SUMMARY_COLUMNS.map((c, ci) => {
    if (c.key === 'cityName') return '合计';
    if (c.key === 'dataStatus') return '按事实数据汇总';
    // 数据行从索引 2 开始（0=标题, 1=表头），到 2+items.length-1
    const rowStart = 3;        // Excel 行号：标题=1, 表头=2, 第一条数据=3
    const rowEnd = rowStart + items.length - 1;
    const colLetter = XLSX.utils.encode_col(ci);
    return { f: `SUM(${colLetter}${rowStart}:${colLetter}${rowEnd})` };
  });
  data.push(totalRow);

  // 创建工作簿
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(data);

  // 列宽
  ws['!cols'] = [
    { wch: 10 },  // 地市
    { wch: 18 },  // 立项完工金额
    { wch: 18 },  // 验收审定金额
    { wch: 18 },  // 累计订单毛利
    { wch: 16 },  // 累计成本
    { wch: 12 },  // 成本占比
    { wch: 14 },  // 成本收入占比
    { wch: 16 },  // 净利润
    { wch: 10 },  // 净利率
    { wch: 12 },  // 已提交月份
    { wch: 10 },  // 合同数
  ];

  // 金额/百分比列数字格式
  for (let r = 2; r < data.length; r++) {
    for (let c = 0; c < SUMMARY_COLUMNS.length; c++) {
      const col = SUMMARY_COLUMNS[c];
      const cellRef = XLSX.utils.encode_cell({ r, c });
      const cell = ws[cellRef];
      if (!cell || cell.f) continue; // 跳过公式单元格
      switch (col.type) {
        case 'money':
          cell.z = '#,##0.00';   // 千分位两位小数
          break;
        case 'percent':
          cell.z = '0.00%';      // 存储为小数，显示为百分比
          break;
      }
    }
  }

  XLSX.utils.book_append_sheet(wb, ws, `经营汇总-${year}`);
  XLSX.writeFile(wb, fileName);
}

export function calculateSummaryTotals(items: AdminBusinessSummaryItem[]): AdminBusinessSummaryResponse['totals'] {
  const sum = (key: keyof AdminBusinessSummaryItem) => items.reduce((total, item) => total + Number(item[key] || 0), 0);
  const completionTotal = sum('completionTotal');
  const orderGrossProfit = sum('orderGrossProfit');
  const costTotal = sum('costTotal');
  const netProfit = sum('netProfit');
  return {
    completionTotal,
    acceptanceTotal: sum('acceptanceTotal'),
    invoiceTotal: sum('invoiceTotal'),
    orderTotal: sum('orderTotal'),
    orderGrossProfit,
    costTotal,
    netProfit,
    costRate: completionTotal ? costTotal / completionTotal : 0,
    costIncomeRate: orderGrossProfit ? costTotal / orderGrossProfit : 0,
    netProfitRate: completionTotal ? netProfit / completionTotal : 0,
    cityCount: items.length,
    submittedMonthCount: sum('submittedMonthCount'),
    contractCount: sum('contractCount'),
  };
}

// ============================================================
// Dashboard 组件
// ============================================================

export default function Dashboard() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [reminderModalOpen, setReminderModalOpen] = useState(false);
  const [reminderYear, setReminderYear] = useState(new Date().getFullYear());
  const [reminderMonth, setReminderMonth] = useState(new Date().getMonth() + 1);
  const [selectedCityIds, setSelectedCityIds] = useState<number[]>([]);
  const [filterCityIds, setFilterCityIds] = useState<number[]>([]);
  const [exporting, setExporting] = useState(false);
  const [selectAll, setSelectAll] = useState(false);

  const {
    data: businessSummary,
    isLoading: businessSummaryLoading,
  } = useQuery({
    queryKey: ['business-summary', year],
    queryFn: () => dashboardApi.getBusinessSummary(year),
    refetchInterval: 60000,
  });

  const sendReminderMutation = useMutation({
    mutationFn: () => remindersApi.sendReminders({
      year: reminderYear,
      month: reminderMonth,
      cityIds: selectedCityIds,
    }),
    onSuccess: (result) => {
      message.success(`提醒发送完成：成功 ${result.successCount} 条，失败 ${result.failCount} 条`);
      setReminderModalOpen(false);
    },
    onError: () => {
      message.error('发送提醒失败');
    },
  });

  if (businessSummaryLoading) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Spin size="large" />
      </div>
    );
  }

  const suffix = String(year).slice(2);
  const filteredItems = (businessSummary?.items ?? []).filter((item) => filterCityIds.length === 0 || filterCityIds.includes(item.cityId));
  const filteredTotals = calculateSummaryTotals(filteredItems);
  const stats = [
    { title: '立项完工', value: formatMoney(filteredTotals.completionTotal), icon: <FileTextOutlined style={{ fontSize: 32, color: '#1677ff' }} />, color: '#e6f4ff' },
    { title: '验收审定', value: formatMoney(filteredTotals.acceptanceTotal), icon: <FundOutlined style={{ fontSize: 32, color: '#389e0d' }} />, color: '#f6ffed' },
    { title: '实际成本', value: formatMoney(filteredTotals.costTotal), icon: <PayCircleOutlined style={{ fontSize: 32, color: '#d46b08' }} />, color: '#fff7e6' },
    { title: '实际净利润', value: formatMoney(filteredTotals.netProfit), icon: <RiseOutlined style={{ fontSize: 32, color: filteredTotals.netProfit < 0 ? '#cf1322' : '#08979c' }} />, color: filteredTotals.netProfit < 0 ? '#fff1f0' : '#e6fffb' },
  ];

  // 从共享列定义生成 Table columns
  const summaryColumns = SUMMARY_COLUMNS.map((c) => {
    const col: {
      title: string;
      dataIndex: keyof AdminBusinessSummaryItem;
      key: string;
      width: number;
      align: 'left' | 'right';
      render?: (v: unknown) => React.ReactNode;
    } = {
      title: c.title(year, suffix),
      dataIndex: c.dataIndex,
      key: c.key,
      width: c.type === 'text' ? 100 : c.type === 'number' ? 90 : 140,
      align: c.type === 'text' ? 'left' as const : 'right' as const,
    };

    if (c.key === 'dataStatus') {
      col.render = (v: unknown) => dataStatusLabel(v as AdminBusinessSummaryItem['dataStatus']);
    } else if (c.key === 'netProfit' || c.key === 'netProfitRate') {
      col.render = (v: unknown) => (
        <span style={{ color: netProfitColor(v as number) }}>
          {c.type === 'percent' ? formatPercent(v as number) : formatMoney(v as number)}
        </span>
      );
    } else if (c.type === 'money') {
      col.render = (v: unknown) => formatMoney(v as number);
    } else if (c.type === 'percent') {
      col.render = (v: unknown) => formatPercent(v as number);
    }

    return col;
  });

  function summaryTableSummary() {
    if (!businessSummary) return null;
    const t = filteredTotals;

    function cell(index: number, content: React.ReactNode, align?: 'right') {
      return (
        <Table.Summary.Cell index={index} align={align}>
          <strong>{content}</strong>
        </Table.Summary.Cell>
      );
    }

    return (
      <Table.Summary.Row>
        {SUMMARY_COLUMNS.map((c, i) => {
          if (c.key === 'cityName') return cell(i, '合计');
          if (c.key === 'dataStatus') return cell(i, '按事实数据汇总');
          const v = c.totalsKey ? t[c.totalsKey] : 0;
          const styled = (c.key === 'netProfit' || c.key === 'netProfitRate')
            ? <span style={{ color: netProfitColor(v as number) }}>{c.type === 'percent' ? formatPercent(v as number) : formatMoney(v as number)}</span>
            : (c.type === 'percent' ? formatPercent(v as number) : (c.type === 'money' ? formatMoney(v as number) : v));
          return cell(i, styled, 'right');
        })}
      </Table.Summary.Row>
    );
  }

  function handleExportCsv() {
    if (businessSummary) {
      const scope = filterCityIds.length === 0 ? '全省' : filteredItems.map((item) => item.cityName).join('_');
      exportBusinessSummaryCsv(year, filteredItems, filteredTotals, makeExportFileName('经营仪表盘', scope, `${year}年`));
    }
  }

  async function handleExportXlsx() {
    if (!businessSummary || exporting) return;
    const scope = filterCityIds.length === 0 ? '全省' : filteredItems.map((item) => item.cityName).join('_');
    const fileName = makeExportFileName('经营仪表盘', scope, `${year}年`);
    setExporting(true);
    try {
      exportBusinessSummaryXlsx(year, filteredItems, filteredTotals, fileName);
      await auditPageExport({ pageName: '经营仪表盘', scopeLabel: scope, filters: { year, cityIds: filterCityIds.join(',') }, rowCount: filteredItems.length, result: 'success', fileName });
    } catch {
      await auditPageExport({ pageName: '经营仪表盘', scopeLabel: scope, filters: { year, cityIds: filterCityIds.join(',') }, rowCount: filteredItems.length, result: 'failed', fileName, errorCode: 'CLIENT_EXPORT_FAILED' }).catch(() => undefined);
      message.error('导出失败，请稍后重试');
    } finally {
      setExporting(false);
    }
  }

  function handleOpenReminderModal() {
    if (!businessSummary) return;
    const now = new Date();
    setReminderYear(now.getFullYear());
    setReminderMonth(now.getMonth() + 1);
    setSelectedCityIds(businessSummary.items.map((i) => i.cityId));
    setSelectAll(true);
    setReminderModalOpen(true);
  }

  const hasData = filteredItems.length > 0;

  return (
    <div>
      <Row gutter={[16, 16]}>
        {stats.map((item) => (
          <Col xs={24} sm={12} lg={6} key={item.title}>
            <Card>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: 12,
                    background: item.color,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {item.icon}
                </div>
                <Statistic title={item.title} value={item.value} />
              </div>
            </Card>
          </Col>
        ))}
      </Row>

      <Card style={{ marginTop: 24 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 16,
          }}
        >
          <Title level={5} style={{ margin: 0 }}>
            经营汇总总览
          </Title>
          <Space>
            <Select
              mode="multiple"
              allowClear
              maxTagCount="responsive"
              placeholder="全部地市"
              value={filterCityIds}
              onChange={setFilterCityIds}
              style={{ minWidth: 220 }}
              options={(businessSummary?.items ?? []).map((item) => ({ value: item.cityId, label: item.cityName }))}
            />
            <Button
              icon={<DownloadOutlined />}
              size="small"
              disabled={!hasData}
              loading={businessSummaryLoading || exporting}
              onClick={handleExportCsv}
            >
              导出文本表格
            </Button>
            <Button
              icon={<DownloadOutlined />}
              size="small"
              disabled={!hasData}
              loading={businessSummaryLoading || exporting}
              onClick={handleExportXlsx}
            >
              导出本页
            </Button>
            <Button
              icon={<BellOutlined />}
              size="small"
              disabled={!hasData}
              onClick={handleOpenReminderModal}
            >
              发送提醒
            </Button>
            <DatePicker
              picker="year"
              value={dayjs(`${year}`, 'YYYY')}
              onChange={(d) => {
                if (d) setYear(d.year());
              }}
              allowClear={false}
            />
          </Space>
        </div>

        <Table<AdminBusinessSummaryItem>
          rowKey="cityId"
          columns={summaryColumns}
          dataSource={filteredItems}
          loading={businessSummaryLoading}
          size="small"
          pagination={false}
          scroll={{ x: 1400 }}
          summary={businessSummary ? summaryTableSummary : undefined}
          locale={{ emptyText: '暂无数据' }}
        />
      </Card>

      {/* 发送提醒 Modal */}
      <Modal
        title="发送填报提醒"
        open={reminderModalOpen}
        onOk={() => sendReminderMutation.mutate()}
        onCancel={() => setReminderModalOpen(false)}
        confirmLoading={sendReminderMutation.isPending}
        okText="发送"
        cancelText="取消"
        destroyOnClose
      >
        <div style={{ padding: '8px 0' }}>
          <div style={{ marginBottom: 16 }}>
            <span style={{ display: 'inline-block', width: 80, color: '#5b6778' }}>年份</span>
            <InputNumber
              min={2000}
              max={2100}
              value={reminderYear}
              onChange={(v) => v && setReminderYear(v)}
              style={{ width: 120 }}
            />
          </div>
          <div style={{ marginBottom: 16 }}>
            <span style={{ display: 'inline-block', width: 80, color: '#5b6778' }}>月份</span>
            <InputNumber
              min={1}
              max={12}
              value={reminderMonth}
              onChange={(v) => v && setReminderMonth(v)}
              style={{ width: 120 }}
            />
          </div>
          <div style={{ marginBottom: 8 }}>
            <Checkbox
              checked={selectAll}
              onChange={(e) => {
                const checked = e.target.checked;
                setSelectAll(checked);
                if (checked && businessSummary) {
                  setSelectedCityIds(businessSummary.items.map((i) => i.cityId));
                } else {
                  setSelectedCityIds([]);
                }
              }}
            >
              全选
            </Checkbox>
          </div>
          <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid #e4e7ed', borderRadius: 6, padding: '8px 12px' }}>
            {businessSummary?.items.map((item) => (
              <div key={item.cityId} style={{ marginBottom: 4 }}>
                <Checkbox
                  checked={selectedCityIds.includes(item.cityId)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedCityIds([...selectedCityIds, item.cityId]);
                    } else {
                      setSelectedCityIds(selectedCityIds.filter((id) => id !== item.cityId));
                      setSelectAll(false);
                    }
                  }}
                >
                  {item.cityName}
                </Checkbox>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12, fontSize: 13, color: '#5b6778' }}>
            已选 {selectedCityIds.length} 个城市
            {businessSummary && (
              <span>，
              预估收件人：
              {businessSummary.items
                .filter((i) => selectedCityIds.includes(i.cityId))
                .reduce((s) => s + 1, 0)}
              个城市</span>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}
