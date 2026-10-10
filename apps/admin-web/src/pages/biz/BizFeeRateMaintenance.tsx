import {
  type CSSProperties, useCallback, useEffect, useMemo, useState,
} from 'react';
import {
  Alert, Button, Card, Checkbox, Col, DatePicker, Descriptions, Drawer, Empty, Form, Input, InputNumber, Modal,
  Row, Select, Space, Statistic, Table, Tabs, Tag, Typography, Upload, message,
} from 'antd';
import {
  CopyOutlined, DownloadOutlined, EyeOutlined, ReloadOutlined, SearchOutlined, ThunderboltOutlined, UploadOutlined,
} from '@ant-design/icons';
import type { UploadProps } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import {
  bizAdminCities, bizAdminProvinces, bizContractList,
  bizContractBatchFeeRates, bizContractDetail,
  bizFeeRateBulkApply, bizFeeRateCopy, bizFeeRateImportConfirm, bizFeeRateImportPreview,
  bizFeeRateImportTask, bizFeeRateImportTaskErrors, bizFeeRateMaintenance, bizFeeRateMaintenanceExport,
  FEE_RATE_IMPORT_STATUS_TEXT, FEE_RATE_MAINTENANCE_STATUS_TEXT,
  type BizFeeRateImportConfirmResult, type BizFeeRateImportPreview, type BizFeeRateImportTask,
  type BizFeeRateImportTaskRow, type BizFeeRateMaintenanceItem, type BizFeeRateMaintenanceStatus,
} from '@/api/biz.api';
import { useBizPermission } from '@/utils/biz-permission';

const { Title, Text } = Typography;

const STATUS_COLOR: Record<string, string> = {
  pending: 'red',
  partial: 'orange',
  maintained: 'green',
  import_pending: 'blue',
  import_error: 'volcano',
};

const OUTCOME_TEXT: Record<string, string> = {
  new: '新增', overwrite: '覆盖', skip: '跳过', error: '错误',
};

const FEE_STATUS_TEXT: Record<string, string> = {
  pending: '待维护', partial: '部分维护', maintained: '已维护',
  import_pending: '已导入待确认', import_error: '导入错误',
};

function fenToYuan(value: number | null | undefined): string {
  if (value == null) return '-';
  return (Number(value) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function errorText(error: unknown, fallback: string): string {
  const detail = (error as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
  if (Array.isArray(detail)) return detail.join('；');
  return detail ?? fallback;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

const cellKey = (cityId: string, month: string): string => `${cityId}|${month}`;

type FeeRateContractGroup = {
  contract: BizFeeRateMaintenanceItem;
  cities: BizFeeRateMaintenanceItem[];
  cityCount: number;
  missingMonthCount: number;
  orderCount: number;
  orderAmountFen: number;
  status: string;
};

export default function BizFeeRateMaintenance() {
  const [items, setItems] = useState<BizFeeRateMaintenanceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [provinceId, setProvinceId] = useState<string>();
  const [cityId, setCityId] = useState<string>();
  const [monthRange, setMonthRange] = useState<[Dayjs | null, Dayjs | null]>([null, null]);
  const [status, setStatus] = useState<BizFeeRateMaintenanceStatus | ''>('');
  const [onlyMissing, setOnlyMissing] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [provinces, setProvinces] = useState<Array<{ id: string; name: string }>>([]);
  const [cities, setCities] = useState<Array<{ id: string; name: string; provinceId: string; unitType?: string }>>([]);
  const [contractOptions, setContractOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [allContractCount, setAllContractCount] = useState(0);
  const [matrixOpen, setMatrixOpen] = useState(false);
  const [matrixLoading, setMatrixLoading] = useState(false);
  const [matrixSaving, setMatrixSaving] = useState(false);
  const [matrixContract, setMatrixContract] = useState<BizFeeRateMaintenanceItem | null>(null);
  const [matrixDetail, setMatrixDetail] = useState<Awaited<ReturnType<typeof bizContractDetail>> | null>(null);
  const [matrixDraft, setMatrixDraft] = useState<Record<string, number | null>>({});
  const [matrixOriginal, setMatrixOriginal] = useState<Record<string, number | null>>({});
  const [matrixOnlyMissing, setMatrixOnlyMissing] = useState(true);
  const [matrixSelected, setMatrixSelected] = useState<Set<string>>(new Set());
  const [fillValue, setFillValue] = useState<number | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const canRead = useBizPermission('operation.contract.read');
  const canWrite = useBizPermission('operation.contract.rate');
  const canExport = useBizPermission('operation.contract.export');

  const query = useMemo(() => ({
    keyword: keyword.trim() || undefined,
    provinceId,
    cityId,
    monthFrom: monthRange[0]?.format('YYYY-MM'),
    monthTo: monthRange[1]?.format('YYYY-MM'),
    status: status || undefined,
    onlyMissing,
  }), [cityId, keyword, monthRange, onlyMissing, provinceId, status]);

  const groupedContracts = useMemo<FeeRateContractGroup[]>(() => {
    const groups = new Map<string, { contract: BizFeeRateMaintenanceItem; cities: BizFeeRateMaintenanceItem[] }>();
    items.forEach((item) => {
      const existing = groups.get(item.contractId);
      if (existing) existing.cities.push(item);
      else groups.set(item.contractId, { contract: item, cities: [item] });
    });
    return [...groups.values()].map((group): FeeRateContractGroup => {
      const allMaintained = group.cities.every((item) => item.status === 'maintained');
      const anyPending = group.cities.some((item) => item.status === 'pending');
      const computedStatus = allMaintained ? 'maintained' : anyPending ? 'pending' : 'partial';
      return {
        ...group,
        cityCount: group.cities.length,
        missingMonthCount: group.cities.reduce((sum, item) => sum + item.missingMonthCount, 0),
        orderCount: group.cities.reduce((sum, item) => sum + item.orderCount, 0),
        orderAmountFen: group.cities.reduce((sum, item) => sum + item.orderAmountFen, 0),
        status: computedStatus,
      };
    });
  }, [items]);

  const stats = useMemo(() => ({
    contracts: groupedContracts.length,
    missingMonths: groupedContracts.reduce((sum, item) => sum + item.missingMonthCount, 0),
    orders: groupedContracts.reduce((sum, item) => sum + item.orderCount, 0),
    amountFen: groupedContracts.reduce((sum, item) => sum + item.orderAmountFen, 0),
  }), [groupedContracts]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const filter = {
        keyword: query.keyword,
        provinceId: query.provinceId,
        cityId: query.cityId,
        monthFrom: query.monthFrom,
        monthTo: query.monthTo,
        status: query.status,
        onlyMissing: query.onlyMissing,
      };
      const all: BizFeeRateMaintenanceItem[] = [];
      const fetchPageSize = 200;
      let pageNum = 1;
      let first = await bizFeeRateMaintenance({ ...filter, page: pageNum, pageSize: fetchPageSize });
      all.push(...(first.items ?? []));
      let guard = 0;
      while (all.length < (first.total ?? 0) && (first.items ?? []).length === fetchPageSize && guard < 20) {
        guard += 1;
        pageNum += 1;
        const next = await bizFeeRateMaintenance({ ...filter, page: pageNum, pageSize: fetchPageSize });
        all.push(...(next.items ?? []));
        first = next;
      }
      setItems(all);
    } catch (error: unknown) {
      message.error(errorText(error, '待维护清单加载失败'));
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    void Promise.all([bizAdminProvinces(), bizAdminCities()]).then(([provinceResult, cityResult]) => {
      setProvinces(provinceResult.items);
      setCities(cityResult.items);
    });
  }, []);
  useEffect(() => {
    void bizContractList({}).then((result) => setAllContractCount(result.items?.length ?? 0)).catch(() => {
      setAllContractCount(0);
    });
  }, []);

  const loadContracts = useCallback(async (search?: string) => {
    try {
      const result = await bizContractList({ keyword: search?.trim() || undefined });
      setContractOptions((result.items ?? []).map((item) => ({
        value: item.id,
        label: `${item.contractNo} / ${item.contractName ?? ''}`,
      })));
    } catch { /* 合同选项加载失败不阻断页面 */ }
  }, []);
  useEffect(() => { void loadContracts(); }, [loadContracts]);

  const onExport = async () => {
    try {
      const blob = await bizFeeRateMaintenanceExport({ ...query, page: 1, pageSize: 20000 });
      downloadBlob(blob, `管理费率待维护清单-${dayjs().format('YYYYMMDD')}.xlsx`);
      message.success('待维护清单已导出');
    } catch (error: unknown) {
      message.error(errorText(error, '导出失败'));
    }
  };

  // ---------------- 导入 ----------------
  const [importOpen, setImportOpen] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<BizFeeRateImportPreview | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmResult, setConfirmResult] = useState<BizFeeRateImportConfirmResult | null>(null);
  const [task, setTask] = useState<BizFeeRateImportTask | null>(null);
  const [taskRows, setTaskRows] = useState<BizFeeRateImportTaskRow[]>([]);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const runPreview = async (file: File) => {
    setPreviewing(true);
    try {
      const result = await bizFeeRateImportPreview(file);
      setPreview(result);
      setConfirmResult(null);
      setTask(null);
      setTaskRows([]);
    } catch (error: unknown) {
      setPreview(null);
      message.error(errorText(error, '费率 Excel 解析失败'));
    } finally {
      setPreviewing(false);
    }
  };

  const uploadProps: UploadProps = {
    accept: '.xlsx,.xls',
    maxCount: 1,
    showUploadList: false,
    beforeUpload: (file) => {
      setPendingFile(file);
      void runPreview(file);
      return false;
    },
  };

  const onConfirmImport = async () => {
    if (!preview) return;
    setConfirming(true);
    try {
      const result = await bizFeeRateImportConfirm(preview.taskId);
      setConfirmResult(result);
      const detail = await bizFeeRateImportTask(preview.taskId);
      setTask(detail);
      message.success(`导入完成：保存 ${result.savedCount} 条，重算订单 ${result.recalcOrderCount} 行`);
      setPage(1);
      await load();
    } catch (error: unknown) {
      message.error(errorText(error, '确认导入失败'));
    } finally {
      setConfirming(false);
    }
  };

  const refreshTask = async () => {
    if (!preview) return;
    try { setTask(await bizFeeRateImportTask(preview.taskId)); } catch { message.error('任务状态刷新失败'); }
  };

  const loadTaskErrors = async () => {
    if (!preview) return;
    try { setTaskRows((await bizFeeRateImportTaskErrors(preview.taskId)).items ?? []); } catch { message.error('失败明细加载失败'); }
  };

  // ---------------- 复制历史月份 ----------------
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyForm] = Form.useForm();
  const [copyRunning, setCopyRunning] = useState(false);
  const [copyResult, setCopyResult] = useState<string | null>(null);

  const submitCopy = async (values: {
    sourceMonth: Dayjs; targetMonth: Dayjs; contractIds: string[]; cityIds?: string[]; overwrite?: boolean;
  }) => {
    setCopyRunning(true);
    try {
      const result = await bizFeeRateCopy({
        sourceMonth: values.sourceMonth.format('YYYY-MM'),
        targetMonth: values.targetMonth.format('YYYY-MM'),
        contractIds: values.contractIds,
        cityIds: values.cityIds,
        overwrite: values.overwrite === true,
      });
      setCopyResult(`保存 ${result.savedCount} 条（新增 ${result.newCount} / 覆盖 ${result.overwriteCount} / 跳过 ${result.skipCount}），重算订单 ${result.recalcOrderCount} 行，失败 ${result.failedCount} 条`);
      message.success('历史费率复制完成');
      await load();
    } catch (error: unknown) {
      message.error(errorText(error, '复制历史费率失败'));
    } finally {
      setCopyRunning(false);
    }
  };

  // ---------------- 批量套用 ----------------
  const [applyOpen, setApplyOpen] = useState(false);
  const [applyForm] = Form.useForm();
  const [applyRunning, setApplyRunning] = useState(false);
  const [applyResult, setApplyResult] = useState<string | null>(null);

  const applyContracts = Form.useWatch('contractIds', applyForm) as string[] | undefined;
  const applyCities = Form.useWatch('cityIds', applyForm) as string[] | undefined;
  const applyMonth = Form.useWatch('effectiveMonth', applyForm) as Dayjs | undefined;

  const submitApply = async (values: {
    contractIds: string[]; cityIds: string[]; effectiveMonth: Dayjs; ratePercent: number; changeReason?: string; overwrite?: boolean;
  }) => {
    setApplyRunning(true);
    try {
      const result = await bizFeeRateBulkApply({
        contractIds: values.contractIds,
        cityIds: values.cityIds,
        effectiveMonth: values.effectiveMonth.format('YYYY-MM'),
        rateBp: Math.round(values.ratePercent * 100),
        changeReason: values.changeReason,
        overwrite: values.overwrite === true,
      });
      setApplyResult(`保存 ${result.savedCount} 条（新增 ${result.newCount} / 覆盖 ${result.overwriteCount} / 跳过 ${result.skipCount}），重算订单 ${result.recalcOrderCount} 行，失败 ${result.failedCount} 条`);
      message.success('统一费率已套用');
      await load();
    } catch (error: unknown) {
      message.error(errorText(error, '批量套用失败'));
    } finally {
      setApplyRunning(false);
    }
  };

  const monthList = useMemo(() => {
    if (!matrixContract) return [];
    const start = dayjs(matrixContract.firstOrderMonth, 'YYYY-MM');
    const end = dayjs(matrixContract.lastOrderMonth, 'YYYY-MM');
    if (!start.isValid() || !end.isValid() || end.isBefore(start)) {
      return [matrixContract.suggestedEffectiveMonth].filter(Boolean);
    }
    const months: string[] = [];
    let cursor = start.startOf('month');
    const last = end.startOf('month');
    while (!cursor.isAfter(last) && months.length < 36) {
      months.push(cursor.format('YYYY-MM'));
      cursor = cursor.add(1, 'month');
    }
    return months;
  }, [matrixContract]);

  const openMatrix = async (contract: BizFeeRateMaintenanceItem) => {
    setMatrixContract(contract);
    setMatrixOpen(true);
    setMatrixLoading(true);
    setMatrixSelected(new Set());
    setFillValue(null);
    setPreviewOpen(false);
    try {
      const detail = await bizContractDetail(contract.contractId);
      const original: Record<string, number | null> = {};
      detail.feeRates.forEach((rate) => { original[cellKey(rate.cityId, rate.effectiveMonth)] = rate.rateBp; });
      setMatrixDetail(detail);
      setMatrixOriginal(original);
      setMatrixDraft({ ...original });
    } catch (error: unknown) {
      message.error(errorText(error, '合同费率矩阵加载失败'));
      setMatrixOpen(false);
    } finally {
      setMatrixLoading(false);
    }
  };

  const toggleCell = (key: string, editable: boolean) => {
    if (!editable) return;
    setMatrixSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const applyFillToSelected = () => {
    if (fillValue == null) {
      message.warning('请先输入要填入的费率（%）');
      return;
    }
    if (matrixSelected.size === 0) {
      message.warning('请先在矩阵中点击选择单元格');
      return;
    }
    const bp = Math.round(fillValue * 100);
    setMatrixDraft((prev) => {
      const next = { ...prev };
      matrixSelected.forEach((key) => { next[key] = bp; });
      return next;
    });
    message.success(`已将选中 ${matrixSelected.size} 个单元格填入 ${fillValue}%`);
    setMatrixSelected(new Set());
  };

  const copyPreviousInMatrix = () => {
    if (!matrixDetail) return;
    setMatrixDraft((current) => {
      const next = { ...current };
      matrixDetail.allocations.forEach((allocation) => {
        monthList.forEach((month, index) => {
          if (index === 0) return;
          const currentKey = cellKey(allocation.cityId, month);
          if (next[currentKey] != null) return;
          const previous = next[cellKey(allocation.cityId, monthList[index - 1])];
          if (previous != null) next[currentKey] = previous;
        });
      });
      return next;
    });
    message.success('已按每个经营单位的上月费率填充空白月份（仅填充空白）');
  };

  const changedCells = useMemo(() => {
    if (!matrixDetail) return [];
    const rows: Array<{ cityId: string; cityName: string; month: string; from: number | null; to: number | null }> = [];
    matrixDetail.allocations.forEach((allocation) => {
      monthList.forEach((month) => {
        const key = cellKey(allocation.cityId, month);
        const from = matrixOriginal[key] ?? null;
        const to = matrixDraft[key] ?? null;
        if (from !== to) rows.push({ cityId: allocation.cityId, cityName: allocation.cityName, month, from, to });
      });
    });
    return rows;
  }, [matrixDetail, matrixOriginal, matrixDraft, monthList]);

  const saveMatrix = async () => {
    if (!matrixContract || !matrixDetail) return;
    const grouped = new Map<string, string[]>();
    Object.entries(matrixDraft).forEach(([key, value]) => {
      if (value == null || value === matrixOriginal[key]) return;
      const [city, month] = key.split('|');
      if (!city || !month) return;
      const groupKey = `${month}|${value}`;
      grouped.set(groupKey, [...(grouped.get(groupKey) ?? []), city]);
    });
    if (!grouped.size) {
      message.info('没有检测到费率变更');
      return;
    }
    setMatrixSaving(true);
    try {
      const results = await Promise.all([...grouped.entries()].map(([groupKey, cityIds]) => {
        const [effectiveMonth, rateBp] = groupKey.split('|');
        return bizContractBatchFeeRates(matrixContract.contractId, {
          cityIds,
          effectiveMonth,
          rateBp: Number(rateBp),
          overwrite: true,
        });
      }));
      const saved = results.reduce((sum, result) => sum + result.items.length, 0);
      message.success(`已保存 ${saved} 条费率（按生效月份 + 费率分组写入）`);
      setMatrixOpen(false);
      await load();
    } catch (error: unknown) {
      message.error(errorText(error, '合同费率保存失败'));
    } finally {
      setMatrixSaving(false);
    }
  };

  const matrixColumns = useMemo(() => {
    const base = [{
      title: '经营单位',
      dataIndex: 'cityName',
      key: 'cityName',
      fixed: 'left' as const,
      width: 140,
      render: (value: string) => <Text strong>{value}</Text>,
    }];
    const months = monthList.map((month) => ({
      title: month,
      key: month,
      width: 92,
      align: 'center' as const,
      render: (_: unknown, row: { cityId: string; cityName: string }) => {
        const key = cellKey(row.cityId, month);
        const value = matrixDraft[key] ?? null;
        const isMissing = matrixOriginal[key] == null;
        const editable = !matrixOnlyMissing || isMissing;
        const selected = matrixSelected.has(key);
        const display = value == null ? '缺失' : `${(value / 100).toFixed(2)}%`;
        const style: CSSProperties = {
          padding: '6px 4px',
          textAlign: 'center',
          cursor: editable ? 'pointer' : 'default',
          borderRadius: 4,
          backgroundColor: selected ? '#bae0ff' : value == null ? (editable ? '#fff1f0' : '#fafafa') : '#f6ffed',
          color: value == null ? '#cf1322' : '#389e0d',
          fontWeight: 500,
          border: selected ? '1px solid #1677ff' : '1px solid transparent',
        };
        return (
          <div onClick={() => toggleCell(key, editable)} style={style}>
            {display}
          </div>
        );
      },
    }));
    return [...base, ...months];
  }, [monthList, matrixDraft, matrixOriginal, matrixOnlyMissing, matrixSelected]);

  const columns = [
    {
      title: '合同编号 / 名称',
      key: 'contract',
      width: 240,
      fixed: 'left' as const,
      render: (_: unknown, row: FeeRateContractGroup) => (
        <Space direction="vertical" size={0}>
          <Button type="link" style={{ padding: 0, height: 'auto' }} onClick={() => void openMatrix(row.contract)}>
            {row.contract.contractNo}
          </Button>
          <Text type="secondary" ellipsis style={{ maxWidth: 210 }}>{row.contract.contractName}</Text>
        </Space>
      ),
    },
    { title: '经营单位', dataIndex: 'cityCount', key: 'cityCount', width: 110, render: (value: number) => `${value} 个` },
    {
      title: '缺失月份',
      dataIndex: 'missingMonthCount',
      key: 'missingMonthCount',
      width: 110,
      render: (value: number) => (value > 0 ? <Tag color="orange">{value} 个月</Tag> : <Tag color="green">已齐全</Tag>),
    },
    { title: '订单数量', dataIndex: 'orderCount', key: 'orderCount', width: 110 },
    { title: '订单金额（元）', dataIndex: 'orderAmountFen', key: 'orderAmountFen', width: 150, render: (value: number) => fenToYuan(value) },
    {
      title: '维护状态',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (value: string) => <Tag color={STATUS_COLOR[value] ?? 'default'}>{FEE_STATUS_TEXT[value] ?? value}</Tag>,
    },
    {
      title: '操作',
      key: 'actions',
      width: 110,
      fixed: 'right' as const,
      render: (_: unknown, row: FeeRateContractGroup) => (
        <Button type="link" onClick={() => void openMatrix(row.contract)}>打开矩阵</Button>
      ),
    },
  ];

  const previewRows = preview?.rows ?? [];
  const rowsOf = (outcome: string) => previewRows.filter((row) => row.outcome === outcome);

  return <div className="v3-content">
    <div className="v3-page-head">
      <div className="v3-page-titles">
        <Title level={4} style={{ margin: 0 }}>管理费率</Title>
        <Text type="secondary">按合同聚合维护「合同 + 经营单位 + 生效月份」维度的管理费率；待维护清单只统计存在有效订单的组合</Text>
      </div>
      <Space className="v3-page-head-actions">
        <Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button>
        {canExport === true && <Button icon={<DownloadOutlined />} onClick={() => void onExport()}>导出待维护清单</Button>}
        {canWrite === true && <>
          <Button icon={<CopyOutlined />} onClick={() => { setCopyResult(null); copyForm.resetFields(); setCopyOpen(true); }}>复制历史月份</Button>
          <Button icon={<ThunderboltOutlined />} onClick={() => { setApplyResult(null); applyForm.resetFields(); setApplyOpen(true); }}>批量套用统一费率</Button>
          <Button type="primary" icon={<UploadOutlined />} onClick={() => { setPreview(null); setConfirmResult(null); setTask(null); setTaskRows([]); setPendingFile(null); setImportOpen(true); }}>导入费率 Excel</Button>
        </>}
      </Space>
    </div>

    {canRead === false && <Alert style={{ marginBottom: 12 }} type="warning" showIcon message="当前账号没有合同查看权限，无法使用费率维护页面。" />}

    <Card style={{ marginBottom: 16 }}>
      <Space wrap>
        <Input allowClear prefix={<SearchOutlined />} placeholder="合同编号或合同名称" value={keyword} onChange={(event) => setKeyword(event.target.value)} onPressEnter={() => { setPage(1); void load(); }} style={{ width: 230 }} />
        <Select allowClear placeholder="省份" value={provinceId} onChange={(value) => { setProvinceId(value); setCityId(undefined); setPage(1); }} options={provinces.map((item) => ({ value: item.id, label: item.name }))} style={{ width: 150 }} />
        <Select allowClear placeholder="地市 / 经营单位" value={cityId} onChange={(value) => { setCityId(value); setPage(1); }} options={cities.filter((item) => !provinceId || item.provinceId === provinceId).map((item) => ({ value: item.id, label: `${item.name}${item.unitType === 'province_branch' ? '（省级直属）' : ''}` }))} style={{ width: 190 }} />
        <DatePicker.RangePicker picker="month" value={monthRange} onChange={(value) => { setMonthRange(value as [Dayjs | null, Dayjs | null]); setPage(1); }} placeholder={['订单月份起', '订单月份止']} />
        <Select allowClear placeholder="维护状态" value={status || undefined} onChange={(value) => { setStatus((value ?? '') as BizFeeRateMaintenanceStatus | ''); setPage(1); }} options={Object.keys(FEE_RATE_MAINTENANCE_STATUS_TEXT).map((key) => ({ value: key, label: FEE_RATE_MAINTENANCE_STATUS_TEXT[key] }))} style={{ width: 150 }} />
        <Checkbox checked={onlyMissing} onChange={(event) => { setOnlyMissing(event.target.checked); setPage(1); }}>仅显示缺失费率</Checkbox>
        <Button type="primary" icon={<SearchOutlined />} onClick={() => { setPage(1); void load(); }}>查询</Button>
      </Space>
    </Card>

    <Card style={{ marginBottom: 16 }}>
      <Row gutter={16}>
        <Col span={4}><Statistic title="全部合同" value={allContractCount} /></Col>
        <Col span={4}><Statistic title="待维护合同" value={stats.contracts} valueStyle={{ color: '#cf1322' }} /></Col>
        <Col span={4}><Statistic title="缺失月份合计" value={stats.missingMonths} valueStyle={{ color: '#cf1322' }} /></Col>
        <Col span={4}><Statistic title="订单数合计" value={stats.orders} /></Col>
        <Col span={4}><Statistic title="订单金额合计（元）" value={fenToYuan(stats.amountFen)} /></Col>
      </Row>
    </Card>

    <Card title={`待维护合同（${groupedContracts.length}）`}>
      <Table
        rowKey={(row) => row.contract.contractId}
        size="small"
        loading={loading}
        columns={columns}
        dataSource={groupedContracts}
        scroll={{ x: 940 }}
        pagination={{ current: page, pageSize, total: groupedContracts.length, showSizeChanger: true, onChange: (p, ps) => { setPage(p); setPageSize(ps); } }}
      />
    </Card>

    {/* ---------- 导入：两步（解析预览 → 确认写入） ---------- */}
    <Drawer
      title="导入费率 Excel"
      open={importOpen}
      onClose={() => setImportOpen(false)}
      width="86%"
      destroyOnClose={false}
    >
      <Alert
        style={{ marginBottom: 12 }}
        type="info"
        showIcon
        message="流程：上传解析（不写库） → 核对预览 → 点击「确认导入」后才会写入并重算订单。合同与经营单位以导出文件中的 ID 为准，请勿手工填写 UUID。上传命中已存在费率将直接覆盖，无需额外确认。"
      />
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <Upload.Dragger {...uploadProps} disabled={previewing}>
          <p className="ant-upload-drag-icon"><UploadOutlined /></p>
          <p className="ant-upload-text">点击或拖拽上传「管理费率待维护清单」Excel</p>
          <p className="ant-upload-hint">仅支持 .xlsx / .xls，不超过 10MB</p>
        </Upload.Dragger>
        {pendingFile && <Text type="secondary">已选择：{pendingFile.name}{preview && `（${preview.totalRows} 行）`}</Text>}
      </Space>

      {preview && <>
        <Card size="small" style={{ marginTop: 16 }} title="预览统计">
          <Row gutter={16}>
            <Col span={4}><Statistic title="总行数" value={preview.totalRows} /></Col>
            <Col span={4}><Statistic title="可新增" value={preview.newCount} valueStyle={{ color: '#52c41a' }} /></Col>
            <Col span={4}><Statistic title="将覆盖" value={preview.overwriteCount} valueStyle={{ color: '#faad14' }} /></Col>
            <Col span={4}><Statistic title="错误" value={preview.errorCount} valueStyle={{ color: '#cf1322' }} /></Col>
            <Col span={4}><Statistic title="跳过" value={preview.skipCount} /></Col>
            <Col span={4}><Statistic title="预计影响订单" value={preview.affectedOrderCount} suffix="行" /></Col>
          </Row>
          <Text type="secondary">预计影响金额 {fenToYuan(preview.affectedAmountFen)} 元 · 文件 {preview.fileName}</Text>
        </Card>

        {preview.warnings.length > 0 && <Alert style={{ marginTop: 12 }} type="warning" showIcon message={`${preview.warnings.length} 条警告`} description={<ul style={{ margin: 0, paddingLeft: 18 }}>{preview.warnings.slice(0, 20).map((item, index) => <li key={index}>第 {item.rowNo} 行 {item.contractNo} {item.cityName}：{item.message}</li>)}</ul>} />}

        <Tabs
          style={{ marginTop: 12 }}
          size="small"
          items={[
            { key: 'new', label: `新增费率（${rowsOf('new').length}）`, children: <PreviewTable rows={rowsOf('new')} /> },
            { key: 'overwrite', label: `覆盖已有费率（${rowsOf('overwrite').length}）`, children: <PreviewTable rows={rowsOf('overwrite')} /> },
            { key: 'error', label: `无效行（${rowsOf('error').length}）`, children: <PreviewTable rows={rowsOf('error')} /> },
            { key: 'skip', label: `跳过行（${rowsOf('skip').length}）`, children: <PreviewTable rows={rowsOf('skip')} /> },
          ]}
        />

        <Space style={{ marginTop: 12 }}>
          <Button type="primary" loading={confirming} disabled={preview.newCount + preview.overwriteCount === 0} onClick={() => void onConfirmImport()}>确认导入</Button>
          {pendingFile && <Button onClick={() => void runPreview(pendingFile)} loading={previewing}>重新解析</Button>}
          {task && <Button onClick={() => void refreshTask()}>刷新任务状态</Button>}
          {task && <Button onClick={() => void loadTaskErrors()}>查看失败/跳过明细</Button>}
        </Space>

        {task && <Card size="small" style={{ marginTop: 12 }} title="任务状态">
          <Descriptions size="small" column={3} bordered>
            <Descriptions.Item label="状态"><Tag>{FEE_RATE_IMPORT_STATUS_TEXT[task.status] ?? task.status}</Tag></Descriptions.Item>
            <Descriptions.Item label="新增">{task.newCount}</Descriptions.Item>
            <Descriptions.Item label="覆盖">{task.overwriteCount}</Descriptions.Item>
            <Descriptions.Item label="跳过">{task.skipCount}</Descriptions.Item>
            <Descriptions.Item label="失败">{task.errorCount}</Descriptions.Item>
            <Descriptions.Item label="触发订单重算">{task.recalculated ? '是' : '否'}</Descriptions.Item>
            <Descriptions.Item label="影响订单">{task.affectedOrderCount} 行</Descriptions.Item>
            <Descriptions.Item label="影响金额">{fenToYuan(task.affectedAmountFen)} 元</Descriptions.Item>
            <Descriptions.Item label="文件">{task.fileName}</Descriptions.Item>
            <Descriptions.Item label="失败原因摘要" span={3}>{task.errorSummary ?? '-'}</Descriptions.Item>
          </Descriptions>
        </Card>}

        {confirmResult && <Card size="small" style={{ marginTop: 12 }} title="导入结果">
          <Descriptions size="small" column={3} bordered>
            <Descriptions.Item label="费率保存数量">{confirmResult.savedCount}</Descriptions.Item>
            <Descriptions.Item label="重算订单数量">{confirmResult.recalcOrderCount}</Descriptions.Item>
            <Descriptions.Item label="成功数量">{confirmResult.successCount}</Descriptions.Item>
            <Descriptions.Item label="跳过数量">{confirmResult.skipCount}</Descriptions.Item>
            <Descriptions.Item label="失败数量">{confirmResult.failedCount}</Descriptions.Item>
            <Descriptions.Item label="结果状态">{FEE_RATE_IMPORT_STATUS_TEXT[confirmResult.status] ?? confirmResult.status}</Descriptions.Item>
          </Descriptions>
          {confirmResult.failureReasons.length > 0 && <Alert style={{ marginTop: 8 }} type="error" showIcon message="失败原因" description={<ul style={{ margin: 0, paddingLeft: 18 }}>{confirmResult.failureReasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>} />}
        </Card>}

        {taskRows.length > 0 && <Card size="small" style={{ marginTop: 12 }} title="失败 / 跳过明细">
          <Table size="small" rowKey="id" dataSource={taskRows} pagination={{ pageSize: 10 }} columns={[
            { title: '行号', dataIndex: 'rowNo', key: 'rowNo', width: 80 },
            { title: '生效月份', dataIndex: 'effectiveMonth', key: 'effectiveMonth', width: 110 },
            { title: '费率', dataIndex: 'rateBp', key: 'rateBp', width: 100, render: (value: number | null) => value == null ? '-' : `${(value / 100).toFixed(2)}%` },
            { title: '结果', dataIndex: 'outcome', key: 'outcome', width: 90, render: (value: string) => <Tag color={value === 'error' ? 'red' : 'default'}>{OUTCOME_TEXT[value] ?? value}</Tag> },
            { title: '原因', dataIndex: 'message', key: 'message', render: (value: string | null) => value ?? '-' },
          ]} />
        </Card>}
      </>}
    </Drawer>

    {/* ---------- 复制历史月份 ---------- */}
    <Modal
      title="复制历史月份"
      open={copyOpen}
      onCancel={() => setCopyOpen(false)}
      onOk={() => copyForm.submit()}
      confirmLoading={copyRunning}
      okText="执行复制"
      cancelText="取消"
      width={720}
      destroyOnClose
    >
      <Alert style={{ marginBottom: 12 }} type="info" showIcon message="默认只复制来源月份已有的费率，目标月份已有记录将跳过；勾选「允许覆盖」后才会覆盖目标月份。" />
      <Form form={copyForm} layout="vertical" onFinish={(values) => void submitCopy(values)}>
        <Form.Item name="sourceMonth" label="来源月份" rules={[{ required: true, message: '请选择来源月份' }]}>
          <DatePicker picker="month" style={{ width: '100%' }} placeholder="来源月份" />
        </Form.Item>
        <Form.Item name="targetMonth" label="目标月份" rules={[{ required: true, message: '请选择目标月份' }]}>
          <DatePicker picker="month" style={{ width: '100%' }} placeholder="目标月份" />
        </Form.Item>
        <Form.Item name="contractIds" label="合同范围" rules={[{ required: true, message: '请至少选择一个合同' }]}>
          <Select mode="multiple" showSearch allowClear placeholder="按合同编号或名称搜索" filterOption={false} onSearch={(value) => void loadContracts(value)} options={contractOptions} maxTagCount="responsive" />
        </Form.Item>
        <Form.Item name="cityIds" label="地市范围（留空表示来源月份全部已维护地市）">
          <Select mode="multiple" showSearch allowClear placeholder="选择经营单位" optionFilterProp="label" options={cities.map((item) => ({ value: item.id, label: item.name }))} maxTagCount="responsive" />
        </Form.Item>
        <Form.Item name="overwrite" valuePropName="checked">
          <Checkbox>允许覆盖目标月份已有费率（需二次确认）</Checkbox>
        </Form.Item>
      </Form>
      {copyResult && <Alert style={{ marginTop: 8 }} type="success" showIcon message={copyResult} />}
    </Modal>

    {/* ---------- 批量套用统一费率 ---------- */}
    <Modal
      title="批量套用统一费率"
      open={applyOpen}
      onCancel={() => setApplyOpen(false)}
      onOk={() => applyForm.submit()}
      confirmLoading={applyRunning}
      okText="执行套用"
      cancelText="取消"
      width={720}
      destroyOnClose
    >
      <Alert style={{ marginBottom: 12 }} type="warning" showIcon message="批量套用会将所选合同和地市设置为相同费率，请确认不同地市是否适用。" />
      <Alert
        style={{ marginBottom: 12 }}
        type="info"
        showIcon
        message={`作用范围：${applyContracts?.length ?? 0} 个合同 × ${applyCities?.length ?? 0} 个经营单位 × 生效月份 ${applyMonth?.format('YYYY-MM') ?? '-'}；默认不覆盖已有费率，仅补充缺失项，已存在记录将被跳过。`}
      />
      <Form form={applyForm} layout="vertical" onFinish={(values) => void submitApply(values)}>
        <Form.Item name="contractIds" label="合同范围" rules={[{ required: true, message: '请至少选择一个合同' }]}>
          <Select mode="multiple" showSearch allowClear placeholder="按合同编号或名称搜索" filterOption={false} onSearch={(value) => void loadContracts(value)} options={contractOptions} maxTagCount="responsive" />
        </Form.Item>
        <Form.Item name="cityIds" label="地市范围" rules={[{ required: true, message: '请至少选择一个经营单位' }]}>
          <Select mode="multiple" showSearch allowClear placeholder="选择经营单位" optionFilterProp="label" options={cities.map((item) => ({ value: item.id, label: item.name }))} maxTagCount="responsive" />
        </Form.Item>
        <Form.Item name="effectiveMonth" label="生效月份" rules={[{ required: true, message: '请选择生效月份' }]}>
          <DatePicker picker="month" style={{ width: '100%' }} placeholder="生效月份" />
        </Form.Item>
        <Form.Item name="ratePercent" label="统一管理费率" rules={[{ required: true, message: '请输入管理费率' }]}>
          <InputNumber min={0} max={100} precision={2} addonAfter="%" style={{ width: '100%' }} placeholder="例如 3.5 表示 3.5%" />
        </Form.Item>
        <Form.Item name="changeReason" label="修改说明">
          <Input placeholder="变更说明（可选）" />
        </Form.Item>
        <Form.Item name="overwrite" valuePropName="checked">
          <Checkbox>允许覆盖已有费率（不勾选时已存在记录跳过）</Checkbox>
        </Form.Item>
      </Form>
      {applyResult && <Alert style={{ marginTop: 8 }} type="success" showIcon message={applyResult} />}
    </Modal>

    {/* ---------- 费率矩阵抽屉 ---------- */}
    <Drawer
      title={matrixContract ? `费率矩阵 — ${matrixContract.contractNo} / ${matrixContract.contractName}` : '费率矩阵'}
      open={matrixOpen}
      onClose={() => setMatrixOpen(false)}
      width="94%"
      destroyOnClose
      footer={<Space wrap>
        <Checkbox checked={matrixOnlyMissing} onChange={(event) => { setMatrixOnlyMissing(event.target.checked); setMatrixSelected(new Set()); }}>只编辑缺失项</Checkbox>
        <Button icon={<CopyOutlined />} onClick={copyPreviousInMatrix}>复制上月费率（仅填空白）</Button>
        <Button icon={<EyeOutlined />} onClick={() => setPreviewOpen(true)}>预览变更（{changedCells.length}）</Button>
        <Button type="primary" loading={matrixSaving} onClick={saveMatrix}>保存</Button>
      </Space>}
    >
      {matrixLoading ? (
        <div style={{ padding: 48, textAlign: 'center' }}><Text type="secondary">加载中…</Text></div>
      ) : matrixDetail ? (
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Alert type="info" showIcon message="行=经营单位，列=生效月份。点击“缺失”单元格可多选，再统一填入费率；复制上月仅填充空白单元格。修改不同经营单位 / 月份的费率互不影响。" />
          {matrixSelected.size > 0 && (
            <Alert
              type="info"
              showIcon
              message={<Space wrap>
                <span>已选 {matrixSelected.size} 个单元格</span>
                <InputNumber min={0} max={100} precision={2} addonAfter="%" placeholder="统一费率" value={fillValue} onChange={setFillValue} style={{ width: 160 }} />
                <Button type="primary" onClick={applyFillToSelected}>填入选中</Button>
                <Button onClick={() => setMatrixSelected(new Set())}>清除选择</Button>
              </Space>}
            />
          )}
          {monthList.length === 0 ? (
            <Alert type="warning" showIcon message="该合同暂无订单月份数据，无法展示费率矩阵。" />
          ) : (
            <Table
              size="small"
              rowKey="cityId"
              bordered
              pagination={false}
              columns={matrixColumns}
              dataSource={matrixDetail.allocations}
              scroll={{ x: 200 + monthList.length * 92 }}
            />
          )}
          <Text type="secondary">
            缺失单元格：{monthList.reduce((count, month) => count + matrixDetail.allocations.filter((allocation) => matrixOriginal[cellKey(allocation.cityId, month)] == null).length, 0)} 个
            {' · '}已修改：{changedCells.length} 个
          </Text>
        </Space>
      ) : null}
    </Drawer>

    {/* ---------- 变更预览 ---------- */}
    <Modal open={previewOpen} title="变更预览" footer={null} onCancel={() => setPreviewOpen(false)} width={680}>
      {changedCells.length === 0 ? (
        <Empty description="没有检测到费率变更" />
      ) : (
        <Table
          size="small"
          rowKey={(_, index) => String(index)}
          dataSource={changedCells}
          pagination={false}
          columns={[
            { title: '经营单位', dataIndex: 'cityName', key: 'cityName' },
            { title: '生效月份', dataIndex: 'month', key: 'month', width: 110 },
            { title: '原费率', key: 'from', width: 110, render: (_: unknown, row) => (row.from == null ? '缺失' : `${(row.from / 100).toFixed(2)}%`) },
            { title: '新费率', key: 'to', width: 110, render: (_: unknown, row) => (row.to == null ? '缺失' : `${(row.to / 100).toFixed(2)}%`) },
          ]}
        />
      )}
    </Modal>
  </div>;
}

/** 预览明细表（新增 / 覆盖 / 无效 / 跳过共用） */
function PreviewTable({ rows }: { rows: BizFeeRateImportPreview['rows'] }) {
  return <Table
    size="small"
    rowKey={(row) => `${row.rowNo}-${row.contractId ?? ''}-${row.cityId ?? ''}`}
    dataSource={rows}
    pagination={{ pageSize: 8 }}
    scroll={{ x: 900 }}
    columns={[
      { title: '行号', dataIndex: 'rowNo', key: 'rowNo', width: 70 },
      { title: '合同编号', dataIndex: 'contractNo', key: 'contractNo', width: 160, ellipsis: true },
      { title: '经营单位', dataIndex: 'cityName', key: 'cityName', width: 120 },
      { title: '生效月份', dataIndex: 'effectiveMonth', key: 'effectiveMonth', width: 100, render: (value: string | null) => value ?? '-' },
      {
        title: '新费率',
        dataIndex: 'rateBp',
        key: 'rateBp',
        width: 100,
        render: (value: number | null) => value == null ? '-' : `${(value / 100).toFixed(2)}%`,
      },
      {
        title: '原费率',
        dataIndex: 'prevRateBp',
        key: 'prevRateBp',
        width: 100,
        render: (value: number | null) => value == null ? '-' : `${(value / 100).toFixed(2)}%`,
      },
      { title: '结果', dataIndex: 'outcome', key: 'outcome', width: 90, render: (value: string) => <Tag color={value === 'error' ? 'red' : value === 'overwrite' ? 'orange' : value === 'new' ? 'green' : 'default'}>{OUTCOME_TEXT[value] ?? value}</Tag> },
      { title: '说明', dataIndex: 'message', key: 'message', render: (value: string | null) => value ?? '-' },
    ]}
  />;
}
