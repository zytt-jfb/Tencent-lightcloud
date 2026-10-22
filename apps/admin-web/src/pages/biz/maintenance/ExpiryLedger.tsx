import { BizPermissionCode } from '@/utils/biz-permission-code';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Card, Col, Input, Row, Select, Space, Statistic, Table, Tag, Tooltip, Typography, message } from 'antd';
import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import {
  maintenanceExpiryLedger,
  type ExpiryLedger as LedgerData,
  type ExpiryLedgerQuery,
  type MaintenanceReminder,
} from '@/api/maintenance.api';
import { bizCities, bizProvinces } from '@/api/biz.api';
import { useBizPermission } from '@/utils/biz-permission';
import { exportPageRows } from '@/utils/page-export-core';

/**
 * 到期台账。
 *
 * 为什么要单独一页：总览只回答「有多少条待办」，真正干活的人需要的是
 * 「哪一条、谁的、什么时候到期、点进去改哪个字段」。原来这些只能去三个列表页
 * 里逐条比对日期，等于没有台账。
 *
 * 数据来源 `GET /biz/maintenance/expiry-ledger`，与总览共用后端同一套到期判定
 * （service 里的 `compute`），所以「台账合计」恒等于「总览待办合计」，
 * 差异只可能来自筛选条件。想对齐数字时不必怀疑两边算法不同。
 */

const KIND_OPTIONS = [
  { value: 'all', label: '全部类别' },
  { value: 'personnel', label: '人员' },
  { value: 'vehicles', label: '车辆' },
  { value: 'generators', label: '油机' },
];

const STATUS_OPTIONS = [
  { value: 'all', label: '全部待办' },
  { value: 'expired', label: '已过期' },
  { value: 'dueSoon', label: '窗口内到期' },
  { value: 'anomaly', label: '日期异常' },
];

const WINDOW_OPTIONS = [7, 30, 60, 90].map((value) => ({ value, label: `${value} 天内` }));
const PAGE_SIZES = [20, 50, 100, 200];

type Filters = {
  kind: NonNullable<ExpiryLedgerQuery['kind']>;
  status: NonNullable<ExpiryLedgerQuery['status']>;
  windowDays: number;
  orgProvince: string;
  orgCity: string;
  orgRegion: string;
  keyword: string;
};

const EMPTY_FILTERS: Filters = { kind: 'all', status: 'all', windowDays: 30, orgProvince: '', orgCity: '', orgRegion: '', keyword: '' };

/** 组织名可能带「省/市」后缀，也可能不带（库里「四川」与「四川省」并存），传短名做匹配 */
const stripRegionSuffix = (name: string) => name.replace(/(省|市|自治区|特别行政区)$/u, '');

const KIND_ROUTE: Record<MaintenanceReminder['kind'], string> = {
  personnel: 'personnel',
  vehicles: 'vehicles',
  generators: 'generators',
};

function statusTag(row: MaintenanceReminder) {
  if (row.invalidDate || row.days === null) {
    return <Tooltip title={`原始值：${row.date}`}><Tag color="default">日期无法识别</Tag></Tooltip>;
  }
  if (row.days < 0) return <Tag color="red">逾期 {-row.days} 天</Tag>;
  if (row.days === 0) return <Tag color="orange">今天到期</Tag>;
  return <Tag color="orange">{row.days} 天后到期</Tag>;
}

export default function ExpiryLedger() {
  const navigate = useNavigate();
  const canWrite = useBizPermission(BizPermissionCode.MAINTENANCE_DATA_WRITE);

  const [data, setData] = useState<LedgerData>();
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  // 已提交的筛选：输入框改字不立刻查，点「筛选」或回车才生效，避免每敲一个字发一次请求
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const [cityDict, setCityDict] = useState<Array<{ value: string; label: string; provinceId: string }>>([]);
  const [provinceDict, setProvinceDict] = useState<Array<{ value: string; label: string; id: string }>>([]);

  useEffect(() => {
    void Promise.all([bizCities(), bizProvinces()])
      .then(([cityResult, provinceResult]) => {
        // value 用短名（去「省/市」），label 用全名 —— 与列表页同一套字典口径
        setCityDict(cityResult.items.map((city) => ({ value: stripRegionSuffix(city.name), label: city.name, provinceId: city.provinceId })));
        setProvinceDict(provinceResult.items.map((province) => ({ value: stripRegionSuffix(province.name), label: province.name, id: province.id })));
      })
      .catch(() => message.error('地市字典加载失败'));
  }, []);

  const load = useCallback(async (nextPage: number, nextFilters: Filters, nextPageSize: number) => {
    setLoading(true);
    try {
      const result = await maintenanceExpiryLedger({ ...nextFilters, page: nextPage, pageSize: nextPageSize });
      setData(result);
      // 后端会把越界页码夹到有效范围，前端跟着它走，避免显示「第 9 页 / 共 2 页」
      setPage(result.page);
      setPageSize(result.pageSize);
    } catch {
      message.error('到期台账加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(1, applied, pageSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applied, load]);

  const search = () => {
    setApplied(filters);
    setPage(1);
  };

  const reset = () => {
    setFilters(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setPage(1);
  };

  /** 点统计卡直接切状态：从「已过期 328」点进去看的就是那 328 条，不用再去下拉里找 */
  const focusStatus = (status: Filters['status']) => {
    const next = { ...filters, status };
    setFilters(next);
    setApplied(next);
    setPage(1);
  };

  const provinceOptions = useMemo(
    () => provinceDict.map(({ value, label }) => ({ value, label })),
    [provinceDict],
  );
  const cityOptions = useMemo(() => {
    const all = cityDict.map(({ value, label }) => ({ value, label }));
    if (!filters.orgProvince) return all;
    const provinceId = provinceDict.find((province) => province.value === filters.orgProvince)?.id;
    // 字典里找不到该省份时退回全量，而不是给一个空下拉（否则用户选了省份反而无市可选）
    if (!provinceId) return all;
    return cityDict.filter((city) => city.provinceId === provinceId).map(({ value, label }) => ({ value, label }));
  }, [cityDict, provinceDict, filters.orgProvince]);

  const counts = data?.counts;
  const windowDays = applied.windowDays;

  const goFix = (row: MaintenanceReminder) => {
    const params = new URLSearchParams({ focus: row.recordId, field: row.field });
    navigate(`/biz/maintenance/${KIND_ROUTE[row.kind]}?${params.toString()}`);
  };

  /** 导出：按 200/页拉全量，导出的是「当前筛选结果」而不是当前页 */
  const exportRows = async () => {
    setExporting(true);
    try {
      const rows: MaintenanceReminder[] = [];
      for (let nextPage = 1; ; nextPage += 1) {
        const result = await maintenanceExpiryLedger({ ...applied, page: nextPage, pageSize: 200 });
        rows.push(...result.items);
        if (!result.items.length || rows.length >= result.total) break;
      }
      const scopeLabel = [
        KIND_OPTIONS.find((option) => option.value === applied.kind)?.label,
        applied.orgProvince,
        applied.orgCity,
        applied.orgRegion,
      ].filter(Boolean).join(' / ') || '全部组织';
      // 先转成中文键再交给导出：导出件是拿去催办的，列名必须是中文
      const chineseRows = rows.map((row) => ({
        类别: row.category,
        '人员/资产': row.name,
        到期事项: row.title,
        到期日期: row.invalidDate ? `${row.date}（无法识别）` : row.date,
        剩余天数: row.invalidDate || row.days === null
          ? '日期无法识别'
          : row.days < 0 ? `逾期${-row.days}天` : row.days === 0 ? '今天到期' : `${row.days}天后到期`,
        省份: row.orgProvince,
        地市: row.orgCity,
        区县: row.orgRegion,
        公司: row.orgCompany,
      }));
      exportPageRows('维护-到期台账', chineseRows, scopeLabel);
      message.success(`已导出 ${rows.length} 条`);
    } catch {
      message.error('导出失败，请稍后重试');
    } finally {
      setExporting(false);
    }
  };

  return (
    <main style={{ padding: 24 }}>
      <Space style={{ marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>到期台账</Typography.Title>
        <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load(page, applied, pageSize)}>刷新</Button>
        <Button icon={<DownloadOutlined />} loading={exporting} disabled={!data?.total} onClick={() => void exportRows()}>导出 Excel</Button>
      </Space>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
        统计基准日 {data?.today ?? '-'}：已逾期不设下限，提前 {windowDays} 天预警。
        合计与「数据总览」的待办合计同源，未加筛选时两者必然相等。
      </Typography.Paragraph>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}>
          <Card size="small" hoverable onClick={() => focusStatus('expired')}>
            <Statistic title="已过期" value={counts?.expired ?? 0} valueStyle={{ color: '#cf1322' }} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small" hoverable onClick={() => focusStatus('dueSoon')}>
            <Statistic title={`${windowDays} 天内到期`} value={counts?.dueSoon ?? 0} valueStyle={{ color: '#d46b08' }} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small" hoverable onClick={() => focusStatus('anomaly')}>
            <Statistic title="日期异常" value={counts?.anomaly ?? 0} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small" hoverable onClick={() => focusStatus('all')}>
            <Statistic title="待办合计" value={counts?.pending ?? 0} />
          </Card>
        </Col>
      </Row>

      <Space wrap style={{ marginBottom: 16, width: '100%' }}>
        <Select value={filters.kind} options={KIND_OPTIONS} style={{ width: 130 }} onChange={(value) => setFilters((prev) => ({ ...prev, kind: value }))} />
        <Select value={filters.status} options={STATUS_OPTIONS} style={{ width: 140 }} onChange={(value) => setFilters((prev) => ({ ...prev, status: value }))} />
        <Select value={filters.windowDays} options={WINDOW_OPTIONS} style={{ width: 120 }} onChange={(value) => setFilters((prev) => ({ ...prev, windowDays: value }))} />
        <Select
          allowClear showSearch optionFilterProp="label" placeholder="省份"
          value={filters.orgProvince || undefined} options={provinceOptions}
          onChange={(value) => setFilters((prev) => ({ ...prev, orgProvince: value ?? '', orgCity: '', orgRegion: '' }))}
          style={{ width: 150 }}
        />
        <Select
          allowClear showSearch optionFilterProp="label" placeholder="地市"
          value={filters.orgCity || undefined} options={cityOptions}
          onChange={(value) => setFilters((prev) => ({ ...prev, orgCity: value ?? '', orgRegion: '' }))}
          style={{ width: 150 }}
        />
        <Select
          allowClear showSearch optionFilterProp="label" placeholder="区县"
          value={filters.orgRegion || undefined}
          options={(data?.regions ?? []).map((value) => ({ value, label: value }))}
          onChange={(value) => setFilters((prev) => ({ ...prev, orgRegion: value ?? '' }))}
          style={{ width: 160 }}
        />
        <Input
          placeholder="人员 / 车牌 / 到期事项"
          value={filters.keyword}
          onChange={(event) => setFilters((prev) => ({ ...prev, keyword: event.target.value }))}
          onPressEnter={search}
          style={{ width: 190 }}
        />
        <Button type="primary" onClick={search}>筛选</Button>
        <Button onClick={reset}>重置</Button>
      </Space>

      {counts?.anomaly ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={`有 ${counts.anomaly} 条有效期填了无法识别的文本（如「无」「2027-14-01」）`}
          description="这类记录不会被算成已过期，但同样无法判断是否有效，需要人工改成 YYYY-MM-DD。点上方「日期异常」卡片可只看这些。"
        />
      ) : null}

      <Table<MaintenanceReminder>
        rowKey="id"
        loading={loading}
        dataSource={data?.items ?? []}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: `当前筛选下没有需要处理的到期事项（统计基准日 ${data?.today ?? '-'}）` }}
        pagination={{
          total: data?.total ?? 0,
          current: page,
          pageSize,
          showSizeChanger: true,
          pageSizeOptions: PAGE_SIZES,
          showTotal: (value) => `共 ${value} 条待办`,
          onChange: (nextPage, nextPageSize) => void load(nextPage, applied, nextPageSize),
        }}
        columns={[
          { title: '类别', dataIndex: 'category', width: 80, fixed: 'left' },
          { title: '人员 / 资产', dataIndex: 'name', width: 180, ellipsis: true, fixed: 'left' },
          { title: '到期事项', dataIndex: 'title', width: 170, ellipsis: true },
          {
            title: '到期日期',
            dataIndex: 'date',
            width: 130,
            render: (value: string, row) => (row.invalidDate
              ? <Tooltip title="该值无法解析为日期"><Typography.Text type="secondary">{value}</Typography.Text></Tooltip>
              : value),
          },
          { title: '剩余天数', key: 'status', width: 140, render: (_: unknown, row) => statusTag(row) },
          { title: '所属组织', dataIndex: 'region', width: 300, ellipsis: true },
          {
            title: '操作',
            key: 'action',
            width: 110,
            fixed: 'right',
            render: (_: unknown, row) => (canWrite
              ? <Button size="small" type="link" onClick={() => goFix(row)}>去补录</Button>
              : <Tooltip title="当前账号没有维护数据的编辑权限"><Button size="small" type="link" disabled>去补录</Button></Tooltip>),
          },
        ]}
      />
    </main>
  );
}
