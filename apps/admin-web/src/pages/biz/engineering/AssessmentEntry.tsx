import { useCallback, useEffect, useState } from 'react';
import {
  Button, Card, DatePicker, Drawer, Form, Input, InputNumber, Modal, Popconfirm, Radio, Select, Space, Table, Tag, Tooltip, Typography, message,
} from 'antd';
import { DownloadOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { exportPageRows } from '@/utils/page-export-core';
import { useBizPermission } from '@/utils/biz-permission';
import {
  assessmentCityOptions, assessmentContractOptions, assessmentEntries, assessmentEntryCreate,
  assessmentEntryDelete, assessmentEntryReturn, assessmentEntrySubmit, assessmentEntryUpdate,
  assessmentEntryVoid, assessmentEntryWithdraw, assessmentOptions,
  type AssessmentEntryRow,
} from '@/api/biz-assessment.api';

const { Title, Text } = Typography;

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  draft: { label: '草稿', color: 'default' },
  submitted: { label: '已提交', color: 'processing' },
  returned: { label: '已退回', color: 'warning' },
  voided: { label: '已作废', color: 'default' },
};

function formatMonth(value: string | null | undefined): string {
  const matched = /^(\d{4})-(\d{2})$/.exec(String(value ?? ''));
  return matched ? `${matched[1]}年${matched[2]}月` : (value ?? '-');
}

interface EntryFormValues {
  contractId: string;
  cityId?: string;
  evalMonth: dayjs.Dayjs;
  supplierName: string;
  score: number;
  evalMethod: 'online' | 'offline';
}

/**
 * 线下填报（工程管理 / 后评估管理）
 * 粒度：合同 × 后评价月份 × 供应商；必须关联合同，项目名与合同编号由合同带出
 * 状态：草稿 → 已提交；省管理员可退回/作废，退回后可修改再提交
 */
export default function AssessmentEntry() {
  const canReturn = useBizPermission('assessment.entry.return');
  const canCreate = useBizPermission('assessment.entry.create');

  const [rows, setRows] = useState<AssessmentEntryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [months, setMonths] = useState<string[]>([]);
  const [filter, setFilter] = useState<{ status?: string; months: string[]; supplierName?: string; contractNo?: string }>({ months: [] });

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<AssessmentEntryRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [contracts, setContracts] = useState<Array<{ id: string; contractNo: string; contractName: string }>>([]);
  const [cities, setCities] = useState<Array<{ id: string; name: string }>>([]);
  const [cityLoading, setCityLoading] = useState(false);
  const [form] = Form.useForm<EntryFormValues>();
  const selectedContractId = Form.useWatch('contractId', form);

  const [reasonModal, setReasonModal] = useState<{ id: string; type: 'return' | 'void' } | null>(null);
  const [reasonText, setReasonText] = useState('');
  const [reasonSaving, setReasonSaving] = useState(false);

  const loadRows = useCallback(async () => {
    setLoading(true);
    try {
      const result = await assessmentEntries({
        status: filter.status,
        months: filter.months,
        supplierName: filter.supplierName,
        contractNo: filter.contractNo,
      });
      setRows(result.items);
    } catch (error: unknown) {
      const detail = (error as { response?: { data?: { message?: string } } }).response?.data?.message;
      message.error(detail ?? '填报记录加载失败');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { void loadRows(); }, [loadRows]);

  useEffect(() => {
    // 月份下拉复用概览的选项接口（同口径、同数据范围）
    void assessmentOptions().then((result) => setMonths(result.months)).catch(() => setMonths([]));
  }, []);

  const loadContracts = useCallback(async (keyword?: string) => {
    try {
      const result = await assessmentContractOptions(keyword);
      setContracts(result.items.map((item) => ({ id: item.id, contractNo: item.contractNo, contractName: item.contractName })));
    } catch {
      setContracts([]);
    }
  }, []);

  const openCreate = async () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ evalMethod: 'offline', evalMonth: dayjs() });
    setCities([]);
    setDrawerOpen(true);
    await loadContracts();
  };

  const openEdit = async (row: AssessmentEntryRow) => {
    setEditing(row);
    form.setFieldsValue({
      contractId: row.contractId ?? undefined,
      cityId: row.cityId ?? undefined,
      evalMonth: dayjs(`${row.evalMonth}-01`),
      supplierName: row.supplierName,
      score: row.score,
      evalMethod: row.evalMethod,
    });
    setDrawerOpen(true);
    await loadContracts();
    if (row.contractId) await loadCities(row.contractId, row.cityId ?? undefined);
  };

  const loadCities = async (contractId: string, keepCityId?: string) => {
    setCityLoading(true);
    try {
      const result = await assessmentCityOptions(contractId);
      setCities(result.items);
      const current = form.getFieldValue('cityId') as string | undefined;
      const target = keepCityId ?? current;
      if (target && result.items.some((city) => city.id === target)) form.setFieldValue('cityId', target);
      else if (result.items.length === 1) form.setFieldValue('cityId', result.items[0].id);
      else if (!keepCityId) form.setFieldValue('cityId', undefined);
    } catch {
      setCities([]);
    } finally {
      setCityLoading(false);
    }
  };

  const onSubmit = async () => {
    const values = await form.validateFields();
    if (!values.evalMonth) { message.warning('请选择后评价月份'); return; }
    setSaving(true);
    try {
      const payload = {
        contractId: values.contractId,
        cityId: values.cityId,
        evalMonth: values.evalMonth.format('YYYY-MM'),
        supplierName: values.supplierName.trim(),
        score: Number(values.score),
        evalMethod: values.evalMethod,
      };
      if (editing) {
        await assessmentEntryUpdate(editing.id, payload);
        message.success('已保存修改');
      } else {
        await assessmentEntryCreate(payload);
        message.success('已保存为草稿');
      }
      setDrawerOpen(false);
      setEditing(null);
      form.resetFields();
      await loadRows();
    } catch (error: unknown) {
      const detail = (error as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
      if (Array.isArray(detail) || typeof detail === 'string') message.error(Array.isArray(detail) ? detail.join('；') : detail);
    } finally {
      setSaving(false);
    }
  };

  const run = async (fn: () => Promise<unknown>, okMessage: string) => {
    try {
      await fn();
      message.success(okMessage);
      await loadRows();
    } catch (error: unknown) {
      const detail = (error as { response?: { data?: { message?: string } } }).response?.data?.message;
      message.error(detail ?? '操作失败');
    }
  };

  const submitReason = async () => {
    if (!reasonModal) return;
    if (!reasonText.trim()) { message.warning('原因必填'); return; }
    setReasonSaving(true);
    try {
      if (reasonModal.type === 'return') await assessmentEntryReturn(reasonModal.id, reasonText.trim());
      else await assessmentEntryVoid(reasonModal.id, reasonText.trim());
      message.success(reasonModal.type === 'return' ? '已退回' : '已作废');
      setReasonModal(null);
      setReasonText('');
      await loadRows();
    } catch (error: unknown) {
      const detail = (error as { response?: { data?: { message?: string } } }).response?.data?.message;
      message.error(detail ?? '操作失败');
    } finally {
      setReasonSaving(false);
    }
  };

  const columns = [
    { title: '后评价月份', dataIndex: 'evalMonth', key: 'evalMonth', width: 100, render: (value: string) => formatMonth(value) },
    { title: '合同编号', dataIndex: 'contractNo', key: 'contractNo', width: 150, ellipsis: true, render: (value: string | null) => value ?? '-' },
    { title: '地市', dataIndex: 'cityName', key: 'cityName', width: 100 },
    { title: '供应商', dataIndex: 'supplierName', key: 'supplierName', width: 180, ellipsis: true },
    { title: '分数', dataIndex: 'score', key: 'score', width: 80, align: 'right' as const, render: (value: number) => Number(value).toFixed(2) },
    { title: '方式', dataIndex: 'evalMethod', key: 'evalMethod', width: 70, render: (value: string) => value === 'offline' ? '线下' : '线上' },
    {
      // 提交时间与退回原因收进状态标签的提示：主表不再为两列低频信息占位
      title: '状态', dataIndex: 'status', key: 'status', width: 95,
      render: (value: string, row: AssessmentEntryRow) => {
        const item = STATUS_LABEL[value] ?? { label: value, color: 'default' };
        const tips = [
          row.submittedAt ? `提交时间：${new Date(row.submittedAt).toLocaleString('zh-CN', { hour12: false })}` : '',
          row.returnReason ? `退回原因：${row.returnReason}` : '',
          row.returnedAt ? `退回时间：${new Date(row.returnedAt).toLocaleString('zh-CN', { hour12: false })}` : '',
        ].filter(Boolean);
        const tag = <Tag color={item.color}>{item.label}</Tag>;
        return tips.length ? <Tooltip title={tips.join('；')}>{tag}</Tooltip> : tag;
      },
    },
    { title: '项目名称', dataIndex: 'projectName', key: 'projectName', ellipsis: true },
    {
      title: '操作', key: 'action', width: 240, fixed: 'right' as const,
      render: (_: unknown, row: AssessmentEntryRow) => (
        <Space wrap size={4}>
          {canCreate && ['draft', 'returned'].includes(row.status) && (
            <Button size="small" onClick={() => void openEdit(row)}>编辑</Button>
          )}
          {['draft', 'returned'].includes(row.status) && (
            <Button size="small" type="primary" onClick={() => void run(() => assessmentEntrySubmit(row.id), '已提交')}>提交</Button>
          )}
          {row.status === 'draft' && (
            <Popconfirm title="删除该草稿？" okText="删除" cancelText="取消" onConfirm={() => void run(() => assessmentEntryDelete(row.id), '已删除')}>
              <Button size="small" danger>删除</Button>
            </Popconfirm>
          )}
          {row.status === 'submitted' && (
            <Button size="small" onClick={() => void run(() => assessmentEntryWithdraw(row.id), '已撤回为草稿')}>撤回</Button>
          )}
          {canReturn && row.status === 'submitted' && (
            <Button size="small" danger onClick={() => { setReasonModal({ id: row.id, type: 'return' }); setReasonText(''); }}>退回</Button>
          )}
          {canReturn && row.status !== 'voided' && (
            <Button size="small" danger type="text" onClick={() => { setReasonModal({ id: row.id, type: 'void' }); setReasonText(''); }}>作废</Button>
          )}
        </Space>
      ),
    },
  ];

  const onExport = () => {
    if (!rows.length) { message.warning('当前筛选没有可导出的数据'); return; }
    exportPageRows('线下填报', rows.slice(0, 10000) as unknown as Array<object>, filter.months.length ? filter.months.join('、') : '全部月份');
  };

  return (
    <div className="v3-content">
      <div className="v3-page-head">
        <div className="v3-page-titles">
          <Title level={4} style={{ margin: 0 }}>线下填报</Title>
          <Text type="secondary">按合同 + 后评价月份 + 供应商填报；提交后计入概览，草稿与已退回不计入</Text>
        </div>
        <Space className="v3-page-head-actions" wrap>
          <Button icon={<ReloadOutlined />} onClick={() => void loadRows()}>刷新</Button>
          <Button icon={<DownloadOutlined />} onClick={onExport}>导出 Excel</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => void openCreate()}>新建填报</Button>
        </Space>
      </div>

      <Card size="small" style={{ marginBottom: 12 }}>
        <Space wrap size={12}>
          <Select
            allowClear placeholder="状态" style={{ width: 130 }}
            value={filter.status}
            options={Object.entries(STATUS_LABEL).map(([value, item]) => ({ value, label: item.label }))}
            onChange={(value) => setFilter((prev) => ({ ...prev, status: value }))}
          />
          <Select
            mode="multiple" allowClear placeholder="后评价月份" style={{ minWidth: 200 }} maxTagCount={2}
            value={filter.months}
            options={months.map((month) => ({ value: month, label: formatMonth(month) }))}
            onChange={(values) => setFilter((prev) => ({ ...prev, months: values }))}
          />
          <Input.Search
            allowClear placeholder="合同编号" style={{ width: 200 }}
            onSearch={(value) => setFilter((prev) => ({ ...prev, contractNo: value || undefined }))}
          />
          <Input.Search
            allowClear placeholder="供应商" style={{ width: 200 }}
            onSearch={(value) => setFilter((prev) => ({ ...prev, supplierName: value || undefined }))}
          />
          <Button onClick={() => setFilter({ months: [] })}>重置</Button>
        </Space>
      </Card>

      <Card size="small" title={`填报记录（${rows.length} 条）`}>
        <Table
          rowKey="id" size="small" loading={loading}
          columns={columns} dataSource={rows}
          tableLayout="fixed"
          pagination={{ pageSize: 20, showSizeChanger: false, showTotal: (count) => `共 ${count} 条` }}
        />
      </Card>

      <Drawer
        title={editing ? '编辑填报（草稿）' : '新建线下填报'}
        open={drawerOpen}
        width={460}
        onClose={() => { if (!saving) { setDrawerOpen(false); setEditing(null); } }}
        extra={<Button type="primary" loading={saving} onClick={() => void onSubmit()}>保存草稿</Button>}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="contractId" label="关联合同" rules={[{ required: true, message: '请选择合同' }]}>
            <Select
              showSearch
              placeholder="输入合同编号或名称搜索"
              filterOption={false}
              onSearch={(value) => void loadContracts(value)}
              onChange={(value) => { form.setFieldValue('cityId', undefined); void loadCities(String(value)); }}
              options={contracts.map((contract) => ({ value: contract.id, label: `${contract.contractNo} ${contract.contractName}`.slice(0, 60) }))}
            />
          </Form.Item>
          <Form.Item
            name="cityId" label="地市"
            rules={[{ required: true, message: '请选择地市' }]}
            extra={selectedContractId && !cityLoading && cities.length === 0 ? '该合同暂无可填报地市（无分配记录且所属省份无可用地市）' : undefined}
          >
            <Select
              loading={cityLoading}
              disabled={!selectedContractId}
              placeholder={selectedContractId ? (cityLoading ? '地市加载中…' : '请选择地市') : '请先选择合同'}
              options={cities.map((city) => ({ value: city.id, label: city.name }))}
            />
          </Form.Item>
          <Form.Item name="evalMonth" label="后评价月份" rules={[{ required: true, message: '请选择后评价月份' }]}>
            <DatePicker picker="month" style={{ width: '100%' }} allowClear={false} />
          </Form.Item>
          <Form.Item name="supplierName" label="供应商" rules={[{ required: true, message: '请填写供应商名称' }]}>
            <Input placeholder="如：中屹技术有限公司" maxLength={200} />
          </Form.Item>
          <Form.Item name="score" label="后评价分数（0-100）" rules={[{ required: true, message: '请填写分数' }]}>
            <InputNumber min={0} max={100} precision={2} style={{ width: '100%' }} placeholder="如 96.00" />
          </Form.Item>
          <Form.Item name="evalMethod" label="后评价方式" rules={[{ required: true }]}>
            <Radio.Group>
              <Radio.Button value="offline">线下</Radio.Button>
              <Radio.Button value="online">线上</Radio.Button>
            </Radio.Group>
          </Form.Item>
        </Form>
      </Drawer>

      <Modal
        title={reasonModal?.type === 'return' ? '退回填报' : '作废填报'}
        open={Boolean(reasonModal)}
        confirmLoading={reasonSaving}
        okText={reasonModal?.type === 'return' ? '确认退回' : '确认作废'}
        okButtonProps={{ danger: true }}
        cancelText="取消"
        onCancel={() => { if (!reasonSaving) { setReasonModal(null); setReasonText(''); } }}
        onOk={() => void submitReason()}
      >
        <Text type="secondary">原因必填，会记录到操作日志并展示给填报人。</Text>
        <Input.TextArea
          rows={3}
          style={{ marginTop: 8 }}
          value={reasonText}
          maxLength={500}
          onChange={(event) => setReasonText(event.target.value)}
          placeholder="请填写原因"
        />
      </Modal>
    </div>
  );
}
