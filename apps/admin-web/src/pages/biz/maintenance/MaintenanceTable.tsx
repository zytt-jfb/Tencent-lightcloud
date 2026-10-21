import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button, Card, DatePicker, Descriptions, Drawer, Form, Input, Modal, Select, Space, Table,
  Tabs, Tag, Tooltip, Upload, message, type TableColumnsType,
} from 'antd';
import dayjs from 'dayjs';
import { DownloadOutlined } from '@ant-design/icons';
import {
  maintenanceCreate, maintenanceDownloadDocument, maintenanceFacets, maintenanceList,
  maintenanceListDocuments, maintenanceRemove, maintenanceUpdate, maintenanceUploadDocument,
  type MaintenanceDocument, type MaintenanceFacets, type MaintenanceItem,
} from '@/api/maintenance.api';
import { bizCities, bizProvinces } from '@/api/biz.api';
import { useBizPermission } from '@/utils/biz-permission';
import { exportPageRows } from '@/utils/page-export-core';
import {
  DATE_FIELD_RE, FIELD_CONFIG, MASKED_FIELDS, REQUIRED_FIELDS, canUploadForField, cellText,
  mapOcrFields, toDayjs, uploadCategory, type Field, type Kind,
} from './maintenance-config';
import { complianceOf } from './maintenance-compliance';

const PAGE_SIZES = [20, 50, 100];

/**
 * 维护管理三类资产共用的列表壳。
 *
 * 原实现是 `MaintenanceHome.tsx` 里用 `location.pathname.split('/').pop()` 切 kind 的三合一页面，
 * 拆开的原因：三类的业务列、表单分区、合规口径都不一样，混在一个文件里改一处要读三百行，
 * 而且「资产管理」这个菜单名与实际内容对不上。
 *
 * 共享的部分留在本文件：筛选（含省市县三级级联）、表格、详情抽屉、编辑抽屉、附件上传、导出。
 * 差异的部分由三个页面从外部传入：业务列、详情列、表单分区。
 */

/** 组织名可能带「省/市」后缀，也可能不带（库里「四川」与「四川省」并存）。用短名做 LIKE 才能同时命中 */
const stripRegionSuffix = (name: string) => name.replace(/(省|市|自治区|特别行政区)$/u, '');

const LEVEL_COLOR: Record<'ok' | 'warn' | 'bad', string> = { ok: 'green', warn: 'orange', bad: 'red' };

export interface MaintenanceTableProps {
  kind: Kind;
  /** 业务列（不含合规、状态、操作） */
  businessColumns: readonly Field[];
  /** 详情抽屉与导出用的全字段 */
  detailFields: readonly Field[];
  /** 编辑表单分区 */
  sections: Array<{ key: string; label: string; fields: readonly Field[] }>;
}

export default function MaintenanceTable({ kind, businessColumns, detailFields, sections }: MaintenanceTableProps) {
  const { label } = FIELD_CONFIG[kind];
  const primary = businessColumns[0]?.[0] ?? 'id';

  const [items, setItems] = useState<MaintenanceItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [facets, setFacets] = useState<MaintenanceFacets>();
  const [filters, setFilters] = useState({ keyword: '', orgProvince: '', orgCity: '', orgRegion: '' });
  const [editing, setEditing] = useState<MaintenanceItem | null>(null);
  const [open, setOpen] = useState(false);
  const [documentIds, setDocumentIds] = useState<string[]>([]);
  const [documents, setDocuments] = useState<MaintenanceDocument[]>([]);
  // 表单字段由三类资产的配置动态决定，无法在编译期给出确定形状；
  // 用默认泛型（any）而不是 Record<string, unknown>，否则 setFieldsValue 的类型要求对不上
  const [form] = Form.useForm();
  const [cityDict, setCityDict] = useState<Array<{ value: string; label: string; provinceId: string }>>([]);
  const [provinceDict, setProvinceDict] = useState<Array<{ value: string; label: string; id: string }>>([]);
  const [selected, setSelected] = useState<MaintenanceItem | null>(null);

  const canWrite = useBizPermission('maintenance.data.write');
  const canDelete = useBizPermission('maintenance.data.delete');

  useEffect(() => {
    void Promise.all([bizCities(), bizProvinces()])
      .then(([cityResult, provinceResult]) => {
        // value 用短名（去「省/市」），label 用全名：库里「四川」与「四川省」两种写法都能被 LIKE 命中
        setCityDict(cityResult.items.map((city) => ({ value: stripRegionSuffix(city.name), label: city.name, provinceId: city.provinceId })));
        setProvinceDict(provinceResult.items.map((province) => ({ value: stripRegionSuffix(province.name), label: province.name, id: province.id })));
      })
      .catch(() => message.error('地市字典加载失败'));
  }, []);

  const load = useCallback(async (nextPage = 1, nextFilters = filters, nextPageSize = pageSize) => {
    setLoading(true);
    try {
      const result = await maintenanceList(kind, { ...nextFilters, page: nextPage, pageSize: nextPageSize });
      setItems(result.items);
      setTotal(result.total);
      setPage(nextPage);
      setPageSize(nextPageSize);
    } catch {
      message.error('维护数据加载失败');
    } finally {
      setLoading(false);
    }
  }, [kind, filters, pageSize]);

  /**
   * 区县下拉走服务端 distinct，且带上当前省/市做级联收敛。
   * 原先取的是「当前页 50 条」的区县，翻页就变；后来改成服务端 distinct 但仍是全省全集，
   * 选了「济宁市」还能看到「滕州市」，选出来必然空结果。
   */
  useEffect(() => {
    setFacets(undefined);
    void maintenanceFacets(kind, { orgProvince: filters.orgProvince || undefined, orgCity: filters.orgCity || undefined })
      .then(setFacets)
      .catch(() => undefined);
  }, [kind, filters.orgProvince, filters.orgCity]);

  useEffect(() => {
    setSelected(null);
    void load(1, { keyword: '', orgProvince: '', orgCity: '', orgRegion: '' }, pageSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  const provinceOptions = useMemo(
    () => provinceDict.map(({ value, label: text }) => ({ value, label: text })),
    [provinceDict],
  );
  const cityOptions = useMemo(() => {
    if (!filters.orgProvince) return cityDict.map(({ value, label: text }) => ({ value, label: text }));
    const provinceId = provinceDict.find((province) => province.value === filters.orgProvince)?.id;
    if (!provinceId) return cityDict.map(({ value, label: text }) => ({ value, label: text }));
    return cityDict.filter((city) => city.provinceId === provinceId).map(({ value, label: text }) => ({ value, label: text }));
  }, [cityDict, provinceDict, filters.orgProvince]);

  /** 导出：点导出才按 100/页拉全量；列表本身永远是单次分页请求 */
  const exportRows = async () => {
    setExporting(true);
    try {
      const rows: MaintenanceItem[] = [];
      for (let nextPage = 1; ; nextPage += 1) {
        const result = await maintenanceList(kind, { ...filters, page: nextPage, pageSize: 100 });
        rows.push(...result.items);
        if (!result.items.length || rows.length >= result.total) break;
      }
      const scopeLabel = [filters.orgProvince, filters.orgCity, filters.orgRegion].filter(Boolean).join(' / ') || '全部组织';
      // 导出带上合规结论：导出的表要能直接用来催办，不然还得自己比对日期
      const withCompliance = rows.map((row) => {
        const summary = complianceOf(kind, row);
        return { ...row, 合规状态: summary.text } as unknown as MaintenanceItem;
      });
      exportPageRows(`维护-${label}`, withCompliance, scopeLabel, [...detailFields.map(([name]) => name), '合规状态']);
      message.success(`已导出 ${rows.length} 条`);
    } catch {
      message.error('导出失败，请稍后重试');
    } finally {
      setExporting(false);
    }
  };

  const submit = async () => {
    try {
      const values = await form.validateFields();
      const payload = { ...values, documentFileIds: documentIds };
      if (editing) await maintenanceUpdate(kind, editing.id, payload);
      else await maintenanceCreate(kind, payload);
      message.success('保存成功，资料已关联');
      setOpen(false);
      form.resetFields();
      setDocumentIds([]);
      setEditing(null);
      void load(page);
    } catch (error) {
      // 403 是数据范围越界（地市账号改外市），跟字段校验失败要分开提示
      const detail = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
      message.error(detail ?? '保存失败，请检查字段');
    }
  };

  const handleUpload = async (field: string, file: File) => {
    try {
      const category = uploadCategory(kind, field);
      const result = await maintenanceUploadDocument(kind, category, file);
      setDocumentIds((ids) => [...ids, result.id]);
      setDocuments((rows) => [...rows, { id: result.id, category: result.category, fileName: result.fileName, mimeType: result.mimeType, fileSize: result.fileSize }]);
      if (result.fields.length) form.setFieldsValue(mapOcrFields(kind, category, result.fields));
      if (result.extractionError) message.warning(`文件已保存，识别失败：${result.extractionError}`);
      else if (!result.ocrAvailable) message.warning('文件已保存；当前未配置OCR密钥，请手工填写后保存');
      else message.success(result.fields.length ? '已识别并回填，请复核后保存' : '已完成文字识别，请核对内容并手工填写对应字段');
    } catch {
      message.error('资料上传失败，请检查文件格式和大小');
    }
    return false;
  };

  const isMaskedField = (name: string) =>
    MASKED_FIELDS.includes(name) && String((editing as Record<string, unknown> | null)?.[name] ?? '').includes('****');

  const downloadDocument = async (file: MaintenanceDocument) => {
    try {
      const blob = await maintenanceDownloadDocument(kind, file.id);
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement('a');
      anchor.href = url;
      anchor.download = file.fileName;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      message.error('资料下载失败');
    }
  };

  const openEdit = (row: MaintenanceItem) => {
    setEditing(row);
    form.setFieldsValue(row as Record<string, unknown>);
    setDocumentIds([]);
    setDocuments([]);
    setOpen(true);
    void maintenanceListDocuments(kind, row.id).then(setDocuments).catch(() => message.error('附件列表加载失败'));
  };

  const columns: TableColumnsType<MaintenanceItem> = [
    ...businessColumns.map(([dataIndex, title]) => ({
      key: dataIndex,
      dataIndex,
      title,
      ellipsis: true,
      width: 140,
      render: dataIndex === primary
        ? (value: unknown, row: MaintenanceItem) => <Button type="link" style={{ padding: 0 }} onClick={() => setSelected(row)}>{cellText(value)}</Button>
        : (value: unknown) => cellText(value),
    })),
    {
      title: '合规状态',
      key: 'compliance',
      width: 260,
      render: (_: unknown, row: MaintenanceItem) => {
        const summary = complianceOf(kind, row);
        return (
          <Tooltip
            title={<div>{summary.parts.map((part) => <div key={`${part.label}-${part.text}`}>{part.label}：{part.text}</div>)}</div>}
          >
            <Tag color={LEVEL_COLOR[summary.level]} style={{ whiteSpace: 'normal' }}>{summary.text}</Tag>
          </Tooltip>
        );
      },
    },
    { title: '状态', dataIndex: 'status', width: 90, render: (value: string) => <Tag color={value === 'active' ? 'green' : 'default'}>{value === 'active' ? '启用' : '停用'}</Tag> },
    {
      title: '操作',
      width: 150,
      fixed: 'right',
      render: (_: unknown, row: MaintenanceItem) => (
        <Space>
          {canWrite && <Button size="small" onClick={() => openEdit(row)}>编辑</Button>}
          {canDelete && (
            <Button
              danger
              size="small"
              onClick={() => Modal.confirm({
                title: `删除${label}`,
                content: '删除后该记录将从列表中隐藏，可由数据恢复流程处理。确定继续吗？',
                okText: '删除',
                okButtonProps: { danger: true },
                cancelText: '取消',
                onOk: async () => {
                  await maintenanceRemove(kind, row.id);
                  message.success('已删除');
                  void load(page);
                },
              })}
            >
              删除
            </Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <Card
      title={`${label}管理`}
      extra={(
        <Space>
          <Button icon={<DownloadOutlined />} loading={exporting} disabled={!total} onClick={() => void exportRows()}>导出 Excel</Button>
          {canWrite
            ? <Button type="primary" onClick={() => { setSelected(null); setEditing(null); form.resetFields(); setDocumentIds([]); setDocuments([]); setOpen(true); }}>新增{label}</Button>
            : <Tooltip title="当前账号没有维护数据的新增/编辑权限"><Button disabled>新增{label}</Button></Tooltip>}
        </Space>
      )}
    >
      <Space wrap style={{ marginBottom: 16, width: '100%' }}>
        <Input
          placeholder="关键词"
          value={filters.keyword}
          onChange={(event) => setFilters((prev) => ({ ...prev, keyword: event.target.value }))}
          onPressEnter={() => void load(1)}
          style={{ width: 170 }}
        />
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
          options={(facets?.regions ?? []).map((value) => ({ value, label: value }))}
          onChange={(value) => setFilters((prev) => ({ ...prev, orgRegion: value ?? '' }))}
          style={{ width: 170 }}
        />
        <Button type="primary" onClick={() => void load(1)}>筛选</Button>
        <Button onClick={() => { const next = { keyword: '', orgProvince: '', orgCity: '', orgRegion: '' }; setFilters(next); void load(1, next); }}>重置</Button>
      </Space>

      <Table
        rowKey="id"
        loading={loading}
        dataSource={items}
        columns={columns}
        scroll={{ x: 'max-content' }}
        pagination={{
          total,
          current: page,
          pageSize,
          showSizeChanger: true,
          pageSizeOptions: PAGE_SIZES,
          showTotal: (value) => `共 ${value} 条`,
          onChange: (nextPage, nextPageSize) => void load(nextPage, filters, nextPageSize),
        }}
      />

      <Drawer
        title={`${label}详情${selected ? ` · ${cellText(selected[primary])}` : ''}`}
        placement="right"
        width="50vw"
        open={selected !== null}
        onClose={() => setSelected(null)}
        mask={false}
        styles={{ wrapper: { maxWidth: '100vw' } }}
      >
        {selected && (
          <Descriptions
            size="small"
            column={1}
            bordered
            styles={{ content: { overflowWrap: 'anywhere' } }}
            items={[
              ...detailFields.map(([name, text]) => ({ key: name, label: text, children: cellText(selected[name]) })),
              { key: 'status', label: '状态', children: <Tag color={selected.status === 'active' ? 'green' : 'default'}>{selected.status === 'active' ? '启用' : '停用'}</Tag> },
              { key: 'updatedAt', label: '更新时间', children: cellText(selected.updatedAt) },
            ]}
          />
        )}
      </Drawer>

      <Drawer
        title={`${editing ? '编辑' : '新增'}${label}`}
        placement="right"
        width="50vw"
        open={open}
        onClose={() => setOpen(false)}
        mask={false}
        destroyOnClose
        styles={{ wrapper: { maxWidth: '100vw' } }}
        extra={<Space><Button onClick={() => setOpen(false)}>取消</Button><Button type="primary" onClick={() => void submit()}>保存</Button></Space>}
      >
        <Form form={form} layout="vertical">
          {documents.length > 0 && (
            <Card size="small" title="已上传资料" style={{ marginBottom: 16 }}>
              {documents.map((document) => (
                <div key={document.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                  <span>{document.fileName}</span>
                  <Button type="link" onClick={() => void downloadDocument(document)}>下载</Button>
                </div>
              ))}
            </Card>
          )}
          <Tabs
            items={sections.map((section) => ({
              key: section.key,
              label: section.label,
              children: (
                <div style={{ padding: '12px 8px' }}>
                  {section.fields.map(([name, text]) => (
                    <Form.Item
                      key={name}
                      name={name}
                      label={(
                        <Space>
                          {text}
                          {canWrite && canUploadForField(kind, section.key, name) && (
                            <Upload
                              showUploadList={false}
                              beforeUpload={(file) => { void handleUpload(name, file); return false; }}
                              accept=".pdf,.jpg,.jpeg,.png,.bmp,.webp"
                            >
                              <Button size="small">上传资料/证件</Button>
                            </Upload>
                          )}
                        </Space>
                      )}
                      rules={REQUIRED_FIELDS.includes(name) ? [{ required: true, message: `请选择或输入${text}` }] : undefined}
                      getValueProps={DATE_FIELD_RE.test(name) ? (value) => ({ value: toDayjs(value) }) : undefined}
                      normalize={DATE_FIELD_RE.test(name) ? (value) => (value && dayjs.isDayjs(value) ? value.format('YYYY-MM-DD') : '') : undefined}
                    >
                      {name === 'orgProvince'
                        ? <Select showSearch optionFilterProp="label" options={provinceOptions} placeholder="请选择省份" />
                        : name === 'orgCity'
                          ? <Select showSearch optionFilterProp="label" options={cityOptions} placeholder="请选择地市" />
                          : isMaskedField(name)
                            // 掩码值只读：无权限账号看不到明文，也就不能用掩码值把库里的真值盖掉（后端同样会丢弃）
                            ? <Tooltip title="当前账号只能查看脱敏后的号码，如需修改请联系管理员"><Input readOnly /></Tooltip>
                            : DATE_FIELD_RE.test(name)
                              ? <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" placeholder="请选择日期" />
                              : <Input />}
                    </Form.Item>
                  ))}
                </div>
              ),
            }))}
          />
        </Form>
      </Drawer>
    </Card>
  );
}
