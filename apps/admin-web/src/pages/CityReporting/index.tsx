import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Spin,
  Statistic,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import CityImportWizard from './CityImportWizard';
import { CheckOutlined, DownloadOutlined, EyeOutlined, SaveOutlined } from '@ant-design/icons';
import type { DraftSaveRequest, SubmitPreviewResponse } from '@biz-reporting/shared-types';
import * as cityReportingApi from '@/api/city-reporting.api';
import * as ws6Api from '@/api/ws6.api';

const { Title, Text } = Typography;
const COST_CATEGORY_LABELS: Record<string, string> = {
  labor: '人工成本',
  utilities: '水电费',
  fuel: '燃油费',
  entertainment: '招待费',
  rent: '房租',
  reimbursement: '报销',
  other: '其他成本',
};

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: 6 }, (_, index) => CURRENT_YEAR - index)
  .map((value) => ({ value, label: value + ' 年' }));
const LOCK_REASON_LABELS: Record<string, string> = {
  'This month is already submitted. Please contact an admin to unlock it.': '本月已提交，如需修改请联系管理员解锁。',
};

function money(value: number | null | undefined): number {
  return Number(value ?? 0);
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message
    ? fallback + '：' + error.message
    : fallback;
}

function lockReasonText(reason: string | null): string {
  if (!reason) return '如需修改请联系管理员解锁。';
  return LOCK_REASON_LABELS[reason] ?? (/^[A-Za-z0-9 .,;:!?'-]+$/.test(reason) ? '本月已锁定，如需修改请联系管理员。' : reason);
}

interface CityReportingProps {
  view?: 'report' | 'cost';
}

export default function CityReporting({ view = 'report' }: CityReportingProps) {
  const isCostView = view === 'cost';
  const [year, setYear] = useState(CURRENT_YEAR);
  const [packageData, setPackageData] = useState<cityReportingApi.CityPackageResponse | null>(null);
  const [monthData, setMonthData] = useState<cityReportingApi.CityMonthResponse | null>(null);
  const [monthNo, setMonthNo] = useState(new Date().getMonth() + 1);
  const [preview, setPreview] = useState<SubmitPreviewResponse | null>(null);
  const [exporting, setExporting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function loadMonth(packageId: number, nextMonth: number) {
    setLoading(true);
    setMonthData(null);
    try {
      setMonthData(await cityReportingApi.getMonthData(packageId, nextMonth));
    } catch (error: unknown) {
      setMonthData(null);
      message.error(errorMessage(error, '月份数据加载失败'));
    } finally {
      setLoading(false);
    }
  }

  async function loadPackage(targetYear = year) {
    setLoading(true);
    setPackageData(null);
    setMonthData(null);
    try {
      const data = await cityReportingApi.getCurrentPackage(targetYear);
      setPackageData(data);
      const preferredMonth = data.months.find((item) => !item.submitted)?.monthNo ?? monthNo;
      setMonthNo(preferredMonth);
      await loadMonth(data.id, preferredMonth);
    } catch (error: unknown) {
      setPackageData(null);
      setMonthData(null);
      setLoading(false);
      message.error(errorMessage(error, '年度报表包加载失败'));
    }
  }

  useEffect(() => {
    void loadPackage(year);
  }, [year]);

  const payload = useMemo<DraftSaveRequest | null>(() => {
    if (!monthData) return null;
    return {
      monthNo,
      contractRows: monthData.contractRows.map((row) => ({
        contractId: row.contractId,
        completionAmount: money(row.completionAmount),
        acceptanceAmount: money(row.acceptanceAmount),
        invoiceAmount: money(row.invoiceAmount),
        orderAmount: money(row.orderAmount),
      })),
      costRows: monthData.costRows.map((row) => ({
        costCategoryCode: row.costCategoryCode,
        amount: money(row.amount),
      })),
      maintenanceRow: monthData.maintenanceRow ?? undefined,
    };
  }, [monthData, monthNo]);

  const liveCostSummary = useMemo(() => {
    const costTotal = monthData?.costRows.reduce((sum, row) => sum + money(row.amount), 0) ?? 0;
    const completionTotal = monthData?.contractRows.reduce(
      (sum, row) => sum + money(row.completionAmount),
      0,
    ) ?? 0;
    return {
      costTotal,
      costRate: completionTotal !== 0 ? costTotal / completionTotal : 0,
    };
  }, [monthData]);

  function updateContract(contractId: number, field: keyof cityReportingApi.CityContractRow, value: number | null) {
    setMonthData((current) => current && {
      ...current,
      contractRows: current.contractRows.map((row) => (
        row.contractId === contractId ? { ...row, [field]: money(value) } : row
      )),
    });
  }

  function updateCost(code: string, value: number | null) {
    setMonthData((current) => current && {
      ...current,
      costRows: current.costRows.map((row) => (
        row.costCategoryCode === code ? { ...row, amount: money(value) } : row
      )),
    });
  }
  async function exportCurrent() {
    if (!monthData) return;
    setExporting(true);
    try {
      const job = await ws6Api.createExportJob({
        exportMode: monthData.isLocked ? 'month_snapshot' : 'current_realtime',
        scopeType: 'city',
        cityId: monthData.cityId,
        reportYear: year,
        belongMonth: monthNo,
        snapshotRange: monthData.isLocked ? 'month_only' : null,
      });
      const blob = await ws6Api.downloadExport(job.jobId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${isCostView ? '成本填报' : '经营单元报表'}-${year}-${monthNo}.xlsx`;
      anchor.click();
      URL.revokeObjectURL(url);
      message.success('报表导出成功');
    } catch (error: unknown) {
      message.error(errorMessage(error, '报表导出失败'));
    } finally {
      setExporting(false);
    }
  }

  async function save() {
    if (!packageData || !payload || monthData?.isLocked) return;
    setSaving(true);
    try {
      await cityReportingApi.saveDraft(packageData.id, payload);
      message.success('草稿已保存');
      await loadMonth(packageData.id, monthNo);
    } catch (error: unknown) {
      message.error(errorMessage(error, '草稿保存失败'));
    } finally {
      setSaving(false);
    }
  }

  async function previewSubmit() {
    if (!packageData || !payload || monthData?.isLocked) return;
    setSaving(true);
    try {
      setPreview(await cityReportingApi.previewSubmit(packageData.id, payload));
    } catch (error: unknown) {
      message.error(errorMessage(error, '提交预览失败'));
    } finally {
      setSaving(false);
    }
  }

  async function confirmSubmit() {
    if (!packageData || !payload) return;
    setSaving(true);
    try {
      await cityReportingApi.submitMonth(packageData.id, payload);
      message.success('月份已提交');
      setPreview(null);
      await loadPackage(year);
    } catch (error: unknown) {
      message.error(errorMessage(error, '月份提交失败'));
    } finally {
      setSaving(false);
    }
  }

  if (loading && !monthData) return <Spin size="large" />;
  if (!packageData || !monthData) return <Alert type="error" message="无法加载当前报表包" />;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <Title level={3} style={{ margin: 0 }}>{isCostView ? '成本填报' : '报表填报'}</Title>
          <Text type="secondary">年度 {year} · 当前地市报表包 #{packageData.id}</Text>
        </div>
        <Space wrap>
          <Select
            aria-label="选择年份"
            value={year}
            style={{ width: 120 }}
            options={YEAR_OPTIONS}
            onChange={setYear}
          />
          <Select
            value={monthNo}
            style={{ width: 150 }}
            options={Array.from({ length: 12 }, (_, index) => {
              const value = index + 1;
              const status = packageData.months.find((item) => item.monthNo === value);
              return { value, label: `${value} 月${status?.submitted ? ' · 已提交' : ''}` };
            })}
            onChange={(value) => {
              setMonthNo(value);
              void loadMonth(packageData.id, value);
            }}
          />
          <Button icon={<SaveOutlined />} loading={saving} disabled={monthData.isLocked} onClick={() => void save()}>保存草稿</Button>
          <Button type="primary" icon={<EyeOutlined />} loading={saving} disabled={monthData.isLocked} onClick={() => void previewSubmit()}>提交预览</Button>
          <Button icon={<DownloadOutlined />} loading={exporting} disabled={!monthData} onClick={() => void exportCurrent()}>导出本页</Button>
        </Space>
      </div>
      <CityImportWizard reportYear={year} monthNo={monthNo} mode={isCostView ? 'cost' : 'report'} onImported={() => void loadPackage()} />

      {monthData.isLocked && <Alert type="info" showIcon message="本月已提交，当前为只读状态" description={lockReasonText(monthData.lockReason)} />}

      {isCostView && (
        <Row gutter={[16, 16]}>
          <Col xs={24} sm={12}>
            <Card size="small">
              <Statistic title="本月成本合计（实时）" value={liveCostSummary.costTotal} precision={2} />
            </Card>
          </Col>
          <Col xs={24} sm={12}>
            <Card size="small">
              <Statistic title="本月成本率（实时）" value={liveCostSummary.costRate * 100} precision={2} suffix="%" />
            </Card>
          </Col>
        </Row>
      )}

      {!isCostView && <Card title="合同填报">
        <Table
          rowKey="contractId"
          size="small"
          pagination={false}
          dataSource={monthData.contractRows}
          columns={[
            { title: '合同', dataIndex: 'contractName', width: 260 },
            { title: '合同编码', dataIndex: 'contractCode', width: 160 },
            ...(['completionAmount', 'acceptanceAmount', 'invoiceAmount', 'orderAmount'] as const).map((field) => ({
              title: field === 'completionAmount' ? '完工金额' : field === 'acceptanceAmount' ? '审定金额' : field === 'invoiceAmount' ? '开票金额' : '订单金额',
              dataIndex: field,
              render: (value: number | null, row: cityReportingApi.CityContractRow) => (
                <InputNumber min={0} precision={2} value={money(value)} disabled={monthData.isLocked} onChange={(next) => updateContract(row.contractId, field, next)} />
              ),
            })),
          ]}
        />
      </Card>}

      <Card title="成本填报">
        <Row gutter={[16, 12]}>
          {monthData.costRows.map((row) => (
            <Col xs={24} md={12} lg={8} key={row.costCategoryCode}>
              <Text>{COST_CATEGORY_LABELS[row.costCategoryCode] ?? '其他成本'}</Text>
              <InputNumber style={{ width: '100%' }} min={0} precision={2} value={money(row.amount)} disabled={monthData.isLocked} onChange={(value) => updateCost(row.costCategoryCode, value)} />
            </Col>
          ))}
        </Row>
      </Card>

      {!isCostView && monthData.maintenanceRow && (
        <Card title="综合代维">
          <Row gutter={[16, 12]}>
            <Col xs={24} md={8}><Text>上年度开票金额</Text><InputNumber style={{ width: '100%' }} min={0} precision={2} value={money(monthData.maintenanceRow.invoiceTotalPrevYear)} disabled /></Col>
            <Col xs={24} md={8}><Text>上年度开票月数</Text><InputNumber style={{ width: '100%' }} min={0} precision={0} value={money(monthData.maintenanceRow.invoiceMonthCountPrevYear)} disabled /></Col>
            <Col xs={24} md={8}><Text>本年度开票金额</Text><InputNumber style={{ width: '100%' }} min={0} precision={2} value={money(monthData.maintenanceRow.invoiceTotalCurrentYear)} disabled /></Col>
          </Row>
        </Card>
      )}

      <Modal title="提交预览" open={preview !== null} confirmLoading={saving} onCancel={() => setPreview(null)} onOk={() => void confirmSubmit()} okText="确认提交" okButtonProps={{ icon: <CheckOutlined /> }}>
        {preview && <Descriptions column={2} bordered size="small">
          <Descriptions.Item label="完工金额">{preview.completionTotal}</Descriptions.Item>
          <Descriptions.Item label="审定金额">{preview.acceptanceTotal}</Descriptions.Item>
          <Descriptions.Item label="成本">{preview.costTotal}</Descriptions.Item>
          <Descriptions.Item label="订单毛利">{preview.orderGrossProfit}</Descriptions.Item>
          <Descriptions.Item label="净利润">{preview.netProfit}</Descriptions.Item>
          <Descriptions.Item label="成本率">{(preview.costRate * 100).toFixed(2)}%</Descriptions.Item>
          <Descriptions.Item label="数据状态"><Tag color="orange">草稿待提交</Tag></Descriptions.Item>
        </Descriptions>}
      </Modal>
    </Space>
  );
}
