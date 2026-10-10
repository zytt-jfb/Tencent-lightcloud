import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Empty,
  Select,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { V3_METRIC_SOURCE_MANIFEST } from '@biz-reporting/shared-types';
import type { Contract, ContractCityAllocation } from '@biz-reporting/shared-types';
import { getContract } from '@/api/contracts.api';
import { listPackages } from '@/api/packages.api';
import {
  getCityMonthData,
  listAdminContracts,
  listCities,
  type CityMonthContractRow,
  type CityMonthData,
} from '@/api/city-estimates.api';
import { exportPageWorkbook } from '@/utils/page-export';
import { factsApi } from '@/api/facts.api';

const { Text, Title } = Typography;
const MONTHS = Array.from({ length: 12 }, (_, index) => index + 1);
const COST_CATEGORIES = [
  { code: 'labor', label: '人工成本' },
  { code: 'utilities', label: '水电费' },
  { code: 'fuel', label: '油补' },
  { code: 'entertainment', label: '招待费' },
  { code: 'rent', label: '房租' },
  { code: 'reimbursement', label: '报销' },
  { code: 'other', label: '其他' },
] as const;

interface ContractViewRow {
  key: string;
  cityName: string;
  contractName: string;
  contractCode: string;
  contractAmount: number;
  taxRate: string;
  signDate: string | null;
  expireDate: string | null;
  managementFee: number;
  accumulatedOrderAmount: number;
  accumulatedInvoiceAmount: number;
  estimatedOrderAmount2026: number;
  estimatedIncomeAmount2026: number;
  completionTotal: number;
  acceptanceTotal: number;
  grossProfit: number;
}

interface MonthlyContractViewRow {
  key: string;
  cityName: string;
  contractName: string;
  contractCode: string;
  annualCompletion: number;
  annualAcceptance: number;
  annualInvoice: number;
  annualOrder: number;
  months: Record<number, { completion: number; acceptance: number; invoice: number; order: number }>;
}

interface CostViewRow {
  key: string;
  cityName: string;
  category: string;
  amounts: Record<number, number>;
  total: number;
}

interface MaintenanceViewRow {
  key: string;
  cityName: string;
  contractName: string;
  contractCode: string;
  contractAmount: number;
  taxRate: string;
  signDate: string | null;
  expireDate: string | null;
  managementFee: number;
  invoiceTotalPrevYear: number;
  invoiceMonthAveragePrevYear: number;
  invoiceTotalCurrentYear: number;
  invoiceMonthAverageCurrentYear: number;
  invoiceMonthAverageDifference: number;
  orderGrossProfit: number;
}

interface CityEstimateData {
  contractRows: ContractViewRow[];
  monthlyContractRows: MonthlyContractViewRow[];
  costRows: CostViewRow[];
  maintenanceRows: MaintenanceViewRow[];
  latestMonth: number;
}

function numeric(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoney(value: number): string {
  return numeric(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPercent(value: number): string {
  return `${(numeric(value) * 100).toFixed(2)}%`;
}

function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('zh-CN');
}

function getAllocation(contract: Contract, cityId: number): ContractCityAllocation | undefined {
  return contract.allocations?.find((allocation) => allocation.cityId === cityId);
}

function getMonthRow(month: CityMonthData, contract: Contract): CityMonthContractRow | undefined {
  return month.contractRows.find((row) => row.contractId === contract.id)
    ?? month.contractRows.find((row) => row.contractCode === contract.contractCode);
}

function isComprehensiveMaintenanceContract(contract: Contract): boolean {
  const source = (contract.contractName + ' ' + contract.contractCode).toLowerCase();
  return source.includes('\u7efc\u5408\u4ee3\u7ef4');
}
function buildViewData(cityName: string, cityId: number, months: CityMonthData[], contracts: Contract[]): CityEstimateData {
  const orderedContracts = [...contracts].sort((left, right) => left.contractCode.localeCompare(right.contractCode));
  const submittedMonths = months.filter((month) => month.isSubmitted);
  const dataMonths = months.filter((month) => {
    const hasContractData = month.contractRows.some((row) => [
      row.completionAmount,
      row.acceptanceAmount,
      row.invoiceAmount,
      row.orderAmount,
    ].some((value) => numeric(value) !== 0));
    const hasCostData = month.costRows.some((row) => numeric(row.amount) !== 0);
    return month.isSubmitted || hasContractData || hasCostData || month.maintenanceRow !== null;
  });
  const reportingMonths = dataMonths.length > 0 ? dataMonths : submittedMonths;
  const contractRows = orderedContracts.map((contract) => {
    const allocation = getAllocation(contract, cityId);
    const managementFee = numeric(allocation?.rate ?? contract.rate);
    const orderAmount = reportingMonths.reduce((total, month) => total + numeric(getMonthRow(month, contract)?.orderAmount), 0);
    const completionTotal = reportingMonths.reduce((total, month) => total + numeric(getMonthRow(month, contract)?.completionAmount), 0);
    const acceptanceTotal = reportingMonths.reduce((total, month) => total + numeric(getMonthRow(month, contract)?.acceptanceAmount), 0);
    const invoiceTotal = reportingMonths.reduce((total, month) => total + numeric(getMonthRow(month, contract)?.invoiceAmount), 0);
    return {
      key: `${cityId}:${contract.id}`,
      cityName,
      contractName: contract.contractName,
      contractCode: contract.contractCode,
      contractAmount: numeric(allocation?.cityContractAmount ?? contract.contractAmount),
      taxRate: '—',
      signDate: contract.signDate ? String(contract.signDate) : null,
      expireDate: contract.expireDate ? String(contract.expireDate) : null,
      managementFee,
      accumulatedOrderAmount: orderAmount,
      accumulatedInvoiceAmount: invoiceTotal,
      estimatedOrderAmount2026: numeric(allocation?.estimatedOrderAmount2026),
      estimatedIncomeAmount2026: numeric(allocation?.estimatedIncomeAmount2026),
      completionTotal,
      acceptanceTotal,
      grossProfit: acceptanceTotal * managementFee,
    };
  });

  const monthlyContractRows = orderedContracts.map((contract) => {
    const monthValues = Object.fromEntries(MONTHS.map((monthNo) => {
      const row = getMonthRow(months[monthNo - 1], contract);
      return [monthNo, {
        completion: numeric(row?.completionAmount),
        acceptance: numeric(row?.acceptanceAmount),
        invoice: numeric(row?.invoiceAmount),
        order: numeric(row?.orderAmount),
      }];
    })) as Record<number, { completion: number; acceptance: number; invoice: number; order: number }>;
    return {
      key: `${cityId}:${contract.id}`,
      cityName,
      contractName: contract.contractName,
      contractCode: contract.contractCode,
      annualCompletion: reportingMonths.reduce((total, month) => total + monthValues[month.monthNo].completion, 0),
      annualAcceptance: reportingMonths.reduce((total, month) => total + monthValues[month.monthNo].acceptance, 0),
      annualInvoice: reportingMonths.reduce((total, month) => total + monthValues[month.monthNo].invoice, 0),
      annualOrder: reportingMonths.reduce((total, month) => total + monthValues[month.monthNo].order, 0),
      months: monthValues,
    };
  });

  const costRows: CostViewRow[] = COST_CATEGORIES.map(({ code, label }) => {
    const amounts = Object.fromEntries(MONTHS.map((monthNo) => [
      monthNo,
      months[monthNo - 1].costRows
        .filter((row) => row.costCategoryCode === code)
        .reduce((total, row) => total + numeric(row.amount), 0),
    ])) as Record<number, number>;
    return { key: `${cityId}:${code}`, cityName, category: label, amounts, total: reportingMonths.reduce((total, month) => total + amounts[month.monthNo], 0) };
  });
  const totalAmounts = Object.fromEntries(MONTHS.map((monthNo) => [
    monthNo,
    costRows.reduce((total, row) => total + row.amounts[monthNo], 0),
  ])) as Record<number, number>;
  costRows.push({ key: `${cityId}:total`, cityName, category: '\u5df2\u63d0\u4ea4\u5408\u8ba1', amounts: totalAmounts, total: reportingMonths.reduce((total, month) => total + totalAmounts[month.monthNo], 0) });
  costRows.push({ key: `${cityId}:headcount`, cityName, category: '总人数（发工资）', amounts: {}, total: 0 });

  const maintenanceContracts = orderedContracts.filter(isComprehensiveMaintenanceContract);
  const maintenanceRows = maintenanceContracts.map((contract) => {
    const allocation = getAllocation(contract, cityId);
    const maintenance = [...reportingMonths].reverse().map((month) => month.maintenanceRow).find((row) => row !== null);
    const previousTotal = numeric(maintenance?.invoiceTotalPrevYear);
    const previousCount = numeric(maintenance?.invoiceMonthCountPrevYear);
    const currentTotal = numeric(maintenance?.invoiceTotalCurrentYear);
    const currentMonths = Math.max(1, reportingMonths.reduce((latest, month) => month.maintenanceRow !== null ? month.monthNo : latest, 0));
    const previousAverage = previousCount ? previousTotal / previousCount : 0;
    const currentAverage = currentTotal / currentMonths;
    const managementFee = numeric(allocation?.rate ?? contract.rate);
    const acceptanceTotal = reportingMonths.reduce((total, month) => total + numeric(getMonthRow(month, contract)?.acceptanceAmount), 0);
    return {
      key: `${cityId}:${contract.id}`,
      cityName,
      contractName: contract.contractName,
      contractCode: contract.contractCode,
      contractAmount: numeric(allocation?.cityContractAmount ?? contract.contractAmount),
      taxRate: '—',
      signDate: contract.signDate ? String(contract.signDate) : null,
      expireDate: contract.expireDate ? String(contract.expireDate) : null,
      managementFee,
      invoiceTotalPrevYear: previousTotal,
      invoiceMonthAveragePrevYear: previousAverage,
      invoiceTotalCurrentYear: currentTotal,
      invoiceMonthAverageCurrentYear: currentAverage,
      invoiceMonthAverageDifference: currentAverage - previousAverage,
      orderGrossProfit: acceptanceTotal * managementFee,
    };
  });

  const latestMonth = months.reduce((latest, month) => {
    const hasData = month.contractRows.some((row) => numeric(row.completionAmount) || numeric(row.acceptanceAmount))
      || month.costRows.some((row) => numeric(row.amount)) || month.maintenanceRow !== null;
    return hasData ? month.monthNo : latest;
  }, 0);
  return { contractRows, monthlyContractRows, costRows, maintenanceRows, latestMonth };
}

export default function CityEstimate() {
  const [selectedCityIds, setSelectedCityIds] = useState<number[]>([]);
  const [year, setYear] = useState(2026);
  const [exporting, setExporting] = useState(false);
  const citiesQuery = useQuery({ queryKey: ['admin', 'cities'], queryFn: listCities });
  const packagesQuery = useQuery({ queryKey: ['admin', 'packages'], queryFn: listPackages });

  useEffect(() => {
    if (selectedCityIds.length === 0 && citiesQuery.data?.length) setSelectedCityIds([citiesQuery.data[0].id]);
  }, [citiesQuery.data, selectedCityIds.length]);

  const selectedPackages = useMemo(
    () => (packagesQuery.data?.items ?? []).filter((item) => selectedCityIds.includes(item.cityId) && item.reportYear === year),
    [packagesQuery.data, selectedCityIds, year],
  );
  const estimateQuery = useQuery({
    queryKey: ['admin', 'city-estimate', selectedCityIds, year, selectedPackages.map((item) => item.id)],
    enabled: selectedCityIds.length > 0 && selectedPackages.length > 0,
    refetchInterval: 60000,
    queryFn: async () => {
      const [contractList, progressRows, orderPage] = await Promise.all([
        listAdminContracts(),
        factsApi.adminProgress({ cityIds: selectedCityIds, year }),
        factsApi.adminOrders({ cityIds: selectedCityIds, year, page: 1, pageSize: 10000 }),
      ]);
      const views = await Promise.all(selectedPackages.map(async (selectedPackage) => {
        const cityId = Number(selectedPackage.cityId);
        const legacyMonths = await Promise.all(MONTHS.map((monthNo) => getCityMonthData(selectedPackage.id, monthNo)));
        const months = legacyMonths.map((month) => {
          const monthProgress = progressRows.filter((row) => row.cityId === cityId && row.month === month.monthNo);
          const monthOrders = orderPage.items.filter((order) => order.cityId === cityId && order.periodMonth === month.monthNo);
          const contractIds = [...new Set([...monthProgress.map((row) => row.contractId), ...monthOrders.map((row) => row.contractId)])];
          return {
            ...month,
            contractRows: contractIds.map((contractId): CityMonthContractRow => {
              const progress = monthProgress.find((row) => row.contractId === contractId);
              const order = monthOrders.find((row) => row.contractId === contractId);
              return {
                contractId,
                contractCode: progress?.contractCode ?? order?.contractCode ?? '',
                contractName: progress?.contractName ?? order?.contractName ?? '',
                completionAmount: progress?.completionAmount ?? 0,
                acceptanceAmount: progress?.acceptanceAmount ?? 0,
                invoiceAmount: progress?.invoiceAmount ?? 0,
                orderAmount: monthOrders.filter((item) => item.contractId === contractId).reduce((sum, item) => sum + numeric(item.taxInclusiveAmount), 0),
              };
            }),
          };
        });
        const contractIds = new Set<number>(
          months.flatMap((month) => month.contractRows.map((row) => row.contractId).filter((id): id is number => id !== null)),
        );
        contractList.items
          .filter((item) => item.cities.some((city) => city.cityId === cityId))
          .forEach((item) => contractIds.add(item.id));
        const contracts = await Promise.all([...contractIds].map((contractId) => getContract(contractId)));
        const city = citiesQuery.data?.find((item) => item.id === cityId);
        return buildViewData(city?.name ?? selectedPackage.cityName, cityId, months, contracts);
      }));
      return {
        contractRows: views.flatMap((view) => view.contractRows),
        monthlyContractRows: views.flatMap((view) => view.monthlyContractRows),
        costRows: views.flatMap((view) => view.costRows),
        maintenanceRows: views.flatMap((view) => view.maintenanceRows),
        latestMonth: Math.max(0, ...views.map((view) => view.latestMonth)),
      };
    },
  });

  const years = [...new Set((packagesQuery.data?.items ?? []).map((item) => item.reportYear))].sort((left, right) => right - left);
  if (!years.includes(year)) years.unshift(year);
  const cityOptions = citiesQuery.data ?? [];
  const refresh = () => {
    void citiesQuery.refetch();
    void packagesQuery.refetch();
    void estimateQuery.refetch();
  };
  const exportCurrent = async () => {
    const data = estimateQuery.data;
    if (!data || selectedPackages.length === 0 || exporting) return;
    setExporting(true);
    const monthHeaders = MONTHS.flatMap((monthNo) => [`${monthNo}月立项完工`, `${monthNo}月验收审定`, `${monthNo}月开票`, `${monthNo}月订单`]);
    const scopeLabel = selectedPackages.map((item) => item.cityName).join('、');
    try {
      await exportPageWorkbook({
        pageName: '地市测算', scope: scopeLabel, period: `${year}年`, filters: { cityIds: selectedCityIds.join(','), year, sourceVersion: V3_METRIC_SOURCE_MANIFEST.version },
        rowCount: data.contractRows.length + data.monthlyContractRows.length + data.costRows.length + data.maintenanceRows.length,
        sheets: [
          { name: '合同测算', moneyColumns: [3, 8, 9, 10, 11, 12, 13, 14], percentColumns: [7], rows: [
            ['地市', '合同名称', '合同编码', '合同金额', '税率', '签订日期', '到期日期', '管理费率', '累计订单', '累计开票', '预估订单', '预计收入', '立项完工', '验收审定', '订单毛利润'],
            ...data.contractRows.map((row) => [row.cityName, row.contractName, row.contractCode, row.contractAmount, row.taxRate, row.signDate || '', row.expireDate || '', row.managementFee, row.accumulatedOrderAmount, row.accumulatedInvoiceAmount, row.estimatedOrderAmount2026, row.estimatedIncomeAmount2026, row.completionTotal, row.acceptanceTotal, row.grossProfit]),
          ] },
          { name: '月度合同', moneyColumns: Array.from({ length: 52 }, (_, index) => index + 3), rows: [
            ['地市', '合同名称', '合同编码', '年立项完工', '年验收审定', '年开票', '年订单', ...monthHeaders],
            ...data.monthlyContractRows.map((row) => [row.cityName, row.contractName, row.contractCode, row.annualCompletion, row.annualAcceptance, row.annualInvoice, row.annualOrder, ...MONTHS.flatMap((monthNo) => [row.months[monthNo].completion, row.months[monthNo].acceptance, row.months[monthNo].invoice, row.months[monthNo].order])]),
          ] },
          { name: '成本', moneyColumns: Array.from({ length: 13 }, (_, index) => index + 2), rows: [
            ['地市', '类别', ...MONTHS.map((monthNo) => `${monthNo}月`), '合计'],
            ...data.costRows.map((row) => [row.cityName, row.category, ...MONTHS.map((monthNo) => row.amounts[monthNo] ?? ''), row.total]),
          ] },
          { name: '综合代维', moneyColumns: [3, 8, 9, 10, 11, 12, 13], percentColumns: [7], rows: [
            ['地市', '合同名称', '合同编码', '合同金额', '税率', '签订日期', '到期日期', '管理费率', '上年开票', '上年月均', '本年开票', '本年月均', '月均差值', '订单毛利润'],
            ...data.maintenanceRows.map((row) => [row.cityName, row.contractName, row.contractCode, row.contractAmount, row.taxRate, row.signDate || '', row.expireDate || '', row.managementFee, row.invoiceTotalPrevYear, row.invoiceMonthAveragePrevYear, row.invoiceTotalCurrentYear, row.invoiceMonthAverageCurrentYear, row.invoiceMonthAverageDifference, row.orderGrossProfit]),
          ] },
        ],
      });
    } catch { message.error('导出失败，请稍后重试'); } finally { setExporting(false); }
  };

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div><Title level={3} style={{ margin: 0 }}>地市测算</Title><Text type="secondary">完工、审定、开票、订单与经营汇总复用统一事实口径；成本预算和综合代维暂为旧报表只读兼容。</Text></div>
        <Space wrap>
          <Select aria-label="选择地市" mode="multiple" maxCount={5} placeholder="选择 1–5 个地市" style={{ minWidth: 260, maxWidth: 520 }} value={selectedCityIds} loading={citiesQuery.isLoading} options={cityOptions.map((city) => ({ value: city.id, label: city.name }))} onChange={setSelectedCityIds} />
          <Select aria-label="选择年度" style={{ width: 110 }} value={year} options={years.map((item) => ({ value: item, label: `${item}年` }))} onChange={setYear} />
          <Button icon={<DownloadOutlined />} disabled={!estimateQuery.data} loading={exporting} onClick={() => void exportCurrent()}>导出本页</Button>
          <Button icon={<ReloadOutlined />} onClick={refresh} loading={estimateQuery.isFetching}>刷新</Button>
        </Space>
      </div>
      {citiesQuery.isLoading || packagesQuery.isLoading ? <Spin size="large" /> : null}
      {!citiesQuery.isLoading && !packagesQuery.isLoading && selectedCityIds.length > 0 && selectedPackages.length === 0 ? <Empty description={`所选地市暂无${year}年报表包`} /> : null}
      {selectedPackages.length > 0 && selectedPackages.length < selectedCityIds.length ? <Alert type="warning" showIcon message="部分所选地市在当前年度没有报表包，页面与导出仅包含有数据的地市。" style={{ marginBottom: 16 }} /> : null}
      {estimateQuery.isError ? <Alert type="error" showIcon message="获取地市测算数据失败，请刷新重试。" style={{ marginBottom: 16 }} /> : null}
      {selectedPackages.length > 0 && estimateQuery.data ? (
        <>
          <Card size="small" style={{ marginBottom: 16 }}>
            <Descriptions size="small" column={{ xs: 1, sm: 2, md: 4 }}>
              <Descriptions.Item label="地市">{selectedPackages.map((item) => item.cityName).join('、')}</Descriptions.Item>
              <Descriptions.Item label="年度">{year}</Descriptions.Item>
              <Descriptions.Item label="数据口径"><Tag color="blue">统一事实聚合</Tag></Descriptions.Item>
              <Descriptions.Item label="最近更新">{formatDate([...selectedPackages].sort((left, right) => new Date(right.lastUpdatedAt ?? 0).getTime() - new Date(left.lastUpdatedAt ?? 0).getTime())[0]?.lastUpdatedAt)}</Descriptions.Item>
              <Descriptions.Item label="兼容预算来源">旧报表包（只读）</Descriptions.Item>
              <Descriptions.Item label="最新有数据月份">{estimateQuery.data.latestMonth ? `${estimateQuery.data.latestMonth}月` : '暂无'}</Descriptions.Item>
            </Descriptions>
          </Card>
          <Tabs items={[
            { key: 'contracts', label: '合同转化测算', children: <ContractTable rows={estimateQuery.data.contractRows} /> },
            { key: 'orders', label: '合同订单明细表', children: <MonthlyContractTable rows={estimateQuery.data.monthlyContractRows} /> },
            { key: 'costs', label: '成本预算（兼容）', children: <CostTable rows={estimateQuery.data.costRows} /> },
            { key: 'maintenance', label: '综合代维（兼容）', children: <MaintenanceTable rows={estimateQuery.data.maintenanceRows} /> },
          ]} />
        </>
      ) : null}
    </div>
  );
}

function ContractTable({ rows }: { rows: ContractViewRow[] }) {
  const columns: ColumnsType<ContractViewRow> = [
    { title: '地市', dataIndex: 'cityName', fixed: 'left', width: 90 },
    { title: '合同名称', dataIndex: 'contractName', fixed: 'left', width: 220 },
    { title: '合同编码', dataIndex: 'contractCode', fixed: 'left', width: 190 },
    { title: '合同金额（含税，万元）', dataIndex: 'contractAmount', width: 150, render: formatMoney },
    { title: <Tooltip title="当前合同数据模型未存储税率">税率</Tooltip>, dataIndex: 'taxRate', width: 80 },
    { title: '签订日期', dataIndex: 'signDate', width: 110, render: formatDate },
    { title: '合同到期时间', dataIndex: 'expireDate', width: 120, render: formatDate },
    { title: '管理费', dataIndex: 'managementFee', width: 90, render: formatPercent },
    { title: '合同累计订单金额', dataIndex: 'accumulatedOrderAmount', width: 140, render: formatMoney },
    { title: '合同累计开票金额', dataIndex: 'accumulatedInvoiceAmount', width: 140, render: formatMoney },
    { title: '2026年预估订单金额', dataIndex: 'estimatedOrderAmount2026', width: 140, render: formatMoney },
    { title: '2026年预计订单收入', dataIndex: 'estimatedIncomeAmount2026', width: 140, render: formatMoney },
    { title: '2026年立项完工金额', dataIndex: 'completionTotal', width: 140, render: formatMoney },
    { title: '2026年验收审定金额', dataIndex: 'acceptanceTotal', width: 140, render: formatMoney },
    { title: '累计订单毛利润', dataIndex: 'grossProfit', width: 130, render: formatMoney },
  ];
  return <Table rowKey="key" size="small" bordered scroll={{ x: 2100 }} dataSource={rows} columns={columns} pagination={{ pageSize: 20 }} />;
}

function MonthlyContractTable({ rows }: { rows: MonthlyContractViewRow[] }) {
  const columns: ColumnsType<MonthlyContractViewRow> = [
    { title: '地市', dataIndex: 'cityName', fixed: 'left', width: 80 },
    { title: '合同名称', dataIndex: 'contractName', fixed: 'left', width: 210 },
    { title: '合同编码', dataIndex: 'contractCode', fixed: 'left', width: 190 },
    { title: '年累计', children: [
      { title: '立项完工金额', dataIndex: 'annualCompletion', width: 130, render: formatMoney },
      { title: '验收审定金额', dataIndex: 'annualAcceptance', width: 130, render: formatMoney },
        { title: '开票金额', dataIndex: 'annualInvoice', width: 130, render: formatMoney },
        { title: '订单金额', dataIndex: 'annualOrder', width: 130, render: formatMoney },
    ] },
    ...MONTHS.map((monthNo) => ({ title: `${monthNo}月`, children: [
      { title: '立项完工金额', key: `${monthNo}-completion`, width: 130, render: (_: unknown, row: MonthlyContractViewRow) => formatMoney(row.months[monthNo].completion) },
      { title: '验收审定金额', key: `${monthNo}-acceptance`, width: 130, render: (_: unknown, row: MonthlyContractViewRow) => formatMoney(row.months[monthNo].acceptance) },
        { title: '开票金额', key: `${monthNo}-invoice`, width: 130, render: (_: unknown, row: MonthlyContractViewRow) => formatMoney(row.months[monthNo].invoice) },
        { title: '订单金额', key: `${monthNo}-order`, width: 130, render: (_: unknown, row: MonthlyContractViewRow) => formatMoney(row.months[monthNo].order) },
    ] })),
  ];
  return <Table rowKey="key" size="small" bordered scroll={{ x: 3400 }} dataSource={rows} columns={columns} pagination={{ pageSize: 20 }} />;
}

function CostTable({ rows }: { rows: CostViewRow[] }) {
  const columns: ColumnsType<CostViewRow> = [
    { title: '地市', dataIndex: 'cityName', fixed: 'left', width: 90 },
    { title: '类别', dataIndex: 'category', fixed: 'left', width: 150 },
    ...MONTHS.map((monthNo) => ({ title: `${monthNo}月`, key: `month-${monthNo}`, width: 115, render: (_: unknown, row: CostViewRow) => row.key.endsWith(':headcount') ? '—' : formatMoney(row.amounts[monthNo] ?? 0) })),
    { title: '合计', dataIndex: 'total', width: 130, render: (value: number, row: CostViewRow) => row.key.endsWith(':headcount') ? '—' : formatMoney(value) },
  ];
  return <Table rowKey="key" size="small" bordered scroll={{ x: 1600 }} dataSource={rows} columns={columns} pagination={false} />;
}

function MaintenanceTable({ rows }: { rows: MaintenanceViewRow[] }) {
  const columns: ColumnsType<MaintenanceViewRow> = [
    { title: '地市', dataIndex: 'cityName', fixed: 'left', width: 80 },
    { title: '合同名称', dataIndex: 'contractName', fixed: 'left', width: 210 },
    { title: '合同编码', dataIndex: 'contractCode', fixed: 'left', width: 190 },
    { title: '合同金额（含税，万元）', dataIndex: 'contractAmount', width: 150, render: formatMoney },
    { title: <Tooltip title="当前合同数据模型未存储税率">税率</Tooltip>, dataIndex: 'taxRate', width: 80 },
    { title: '签订日期', dataIndex: 'signDate', width: 110, render: formatDate },
    { title: '合同到期时间', dataIndex: 'expireDate', width: 120, render: formatDate },
    { title: '管理费', dataIndex: 'managementFee', width: 90, render: formatPercent },
    { title: '2025年累计开票金额', dataIndex: 'invoiceTotalPrevYear', width: 150, render: formatMoney },
    { title: '2025年月平均开票金额', dataIndex: 'invoiceMonthAveragePrevYear', width: 160, render: formatMoney },
    { title: '2026年累计开票金额', dataIndex: 'invoiceTotalCurrentYear', width: 150, render: formatMoney },
    { title: '2026年月平均开票金额', dataIndex: 'invoiceMonthAverageCurrentYear', width: 160, render: formatMoney },
    { title: '月平均开票金额差值', dataIndex: 'invoiceMonthAverageDifference', width: 150, render: formatMoney },
    { title: '年累计订单毛利润', dataIndex: 'orderGrossProfit', width: 140, render: formatMoney },
  ];
  return <Table rowKey="key" size="small" bordered scroll={{ x: 2100 }} dataSource={rows} columns={columns} pagination={{ pageSize: 20 }} locale={{ emptyText: '暂无综合代维合同数据' }} />;
}
