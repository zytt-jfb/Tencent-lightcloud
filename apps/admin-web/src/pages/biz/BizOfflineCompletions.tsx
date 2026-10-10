import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Card, Drawer, Form, Input, InputNumber, Modal, Select, Space, Table, Tag, Typography, message } from 'antd';
import { DownloadOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { exportPageRows } from '@/utils/page-export-core';
import { bizOfflineList, bizOfflineCreate, bizOfflineSubmit, bizOfflineApprove, bizOfflineReject, bizOfflineVoid, bizOfflineRestore, bizContractList, bizContractDetail } from '@/api/biz.api';

const { Title, Text } = Typography;

const STATUS: Record<string, { label: string; color: string }> = {
  draft: { label: '草稿', color: 'default' },
  pending: { label: '待审核', color: 'processing' },
  approved: { label: '已通过', color: 'success' },
  rejected: { label: '已驳回', color: 'error' },
  voided: { label: '已作废', color: 'default' },
};


/** 显示层月份统一 yyyy年mm月（数据库/接口保留 YYYY-MM） */
function formatMonth(v: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})$/.exec(String(v ?? ''));
  return m ? `${m[1]}年${m[2]}月` : (v ?? '-');
}

function fenToYuan(fen: number | null): string {
  return fen == null ? '-' : (fen / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** 线下完工（新基线 M5） */
export default function BizOfflineCompletions() {
  const navigate = useNavigate();
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [contracts, setContracts] = useState<Array<{ id: string; contractNo: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [form] = Form.useForm();
  const selectedContractId = Form.useWatch('contractId', form);

  // 地市选项：不调用无权限的管理员城市字典接口，改由所选合同的详情 allocations 生成
  // （后端已按数据范围过滤，city_user 只能看到其范围内的地市）。
  const [cityOptions, setCityOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [cityLoading, setCityLoading] = useState(false);
  // 前端 cityName 缓存（cityId -> cityName），复用合同详情数据，供列表"地市"列显示名称。
  const cityNameRef = useRef<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [off, c] = await Promise.all([bizOfflineList(), bizContractList()]);
      setItems(off.items);
      setContracts(c.items.map((x) => ({ id: x.id, contractNo: x.contractNo })));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  /** 选择合同后加载该合同可见地市（仅 status === 'active' 的分配） */
  const loadContractCities = useCallback(async (contractId: string) => {
    setCityLoading(true);
    setCityOptions([]);
    form.setFieldValue('cityId', undefined); // 切换合同必须清空旧 cityId
    try {
      const detail = await bizContractDetail(contractId);
      const allocs = (detail.allocations ?? []).filter((a) => a.status === 'active');
      for (const a of allocs) cityNameRef.current[a.cityId] = a.cityName;
      const opts = allocs.map((a) => ({ id: a.cityId, name: a.cityName }));
      setCityOptions(opts);
      // 合同只有一个可见地市时自动选中
      if (opts.length === 1) form.setFieldValue('cityId', opts[0].id);
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { message?: string } } }).response?.data?.message;
      message.error(detail ?? '合同地市加载失败');
    } finally {
      setCityLoading(false);
    }
  }, [form]);

  const cityPlaceholder = !selectedContractId
    ? '请先选择合同'
    : cityLoading
      ? '地市加载中…'
      : cityOptions.length === 0
        ? '该合同暂无可填报地市'
        : '请选择地市';

  const onCreate = async (values: Record<string, unknown>) => {
    try {
      await bizOfflineCreate({
        contractId: String(values.contractId),
        cityId: String(values.cityId),
        businessMonth: String(values.businessMonth),
        amountFen: Math.round(Number(values.amountFen) * 100),
        summary: String(values.summary ?? ''),
      });
      message.success('完工记录已创建（草稿）');
      setCreateOpen(false);
      form.resetFields();
      void load();
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
      message.error(Array.isArray(detail) ? detail.join('；') : (detail ?? '创建失败'));
    }
  };

  const run = async (fn: () => Promise<unknown>, okMsg: string) => {
    try {
      await fn();
      message.success(okMsg);
      void load();
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { message?: string } } }).response?.data?.message;
      message.error(detail ?? '操作失败');
    }
  };

  const onReject = (id: string) => {
    Modal.confirm({
      title: '驳回',
      onOk: () => new Promise<void>((resolve, reject) => {
        const comment = window.prompt('驳回原因（必填）：');
        if (!comment?.trim()) { message.warning('驳回原因必填'); reject(); return; }
        bizOfflineReject(id, comment).then(() => { message.success('已驳回'); void load(); resolve(); }).catch((e) => { message.error('驳回失败'); reject(e); });
      }),
    });
  };

  const onVoid = (id: string) => {
    Modal.confirm({
      title: '作废（退出统计）',
      okText: '确认作废',
      okButtonProps: { danger: true },
      onOk: () => new Promise<void>((resolve, reject) => {
        const reason = window.prompt('作废原因（必填）：');
        if (!reason?.trim()) { message.warning('作废原因必填'); reject(); return; }
        bizOfflineVoid(id, reason).then(() => { message.success('已作废'); void load(); resolve(); }).catch((e) => { message.error('作废失败'); reject(e); });
      }),
    });
  };

  const columns = [
    { title: '合同编号', dataIndex: 'contractId', key: 'contractId', render: (v: string) => contracts.find((c) => c.id === v)?.contractNo ?? v?.slice(0, 8) ?? '-' },
    { title: '地市', dataIndex: 'cityName', key: 'cityName', render: (v: string, row: Record<string, unknown>) => v ?? cityNameRef.current[String(row.cityId)] ?? '-' },
    { title: '业务月份', dataIndex: 'businessMonth', key: 'businessMonth', width: 110, render: (v: string) => formatMonth(v) },
    { title: '金额（元）', dataIndex: 'amountFen', key: 'amountFen', render: (v: number) => fenToYuan(Number(v)) },
    { title: '说明', dataIndex: 'summary', key: 'summary', ellipsis: true },
    { title: '状态', dataIndex: 'status', key: 'status', render: (v: string) => { const s = STATUS[v] ?? { label: v, color: 'default' }; return <Tag color={s.color}>{s.label}</Tag>; } },
    { title: '审核意见', dataIndex: 'reviewComment', key: 'reviewComment', ellipsis: true, render: (v: string | null) => v ?? '-' },
    {
      title: '操作', key: 'action', width: 260,
      render: (_: unknown, row: Record<string, unknown>) => (
        <Space wrap>
          {['draft', 'rejected'].includes(String(row.status)) && <Button size="small" type="primary" onClick={() => run(() => bizOfflineSubmit(String(row.id)), '已提交审核')}>提交</Button>}
          {String(row.status) === 'pending' && <Button size="small" onClick={() => run(() => bizOfflineApprove(String(row.id)), '已审核通过')}>通过</Button>}
          {String(row.status) === 'pending' && <Button size="small" danger onClick={() => onReject(String(row.id))}>驳回</Button>}
          {String(row.status) === 'approved' && <Button size="small" danger onClick={() => onVoid(String(row.id))}>作废</Button>}
          {String(row.status) === 'voided' && <Button size="small" onClick={() => run(() => bizOfflineRestore(String(row.id)), '已恢复')}>恢复</Button>}
        </Space>
      ),
    },
  ];

  return (
    <div className="v3-content">
      <div className="v3-page-head">
        <div className="v3-page-titles">
          <Title level={4} style={{ margin: 0 }}>线下完工</Title>
        </div>
        <Space className="v3-page-head-actions" wrap>
          <Button onClick={() => navigate('/biz/operation')}>返回经营管理</Button>
          <Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button>
          <Button icon={<DownloadOutlined />} disabled={!items.length} onClick={() => exportPageRows('线下完工', items)}>导出 Excel</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>新建完工</Button>
        </Space>
      </div>
      <Card>
        <Table scroll={{ x: "max-content" }}  rowKey="id" loading={loading} columns={columns} dataSource={items} pagination={{ pageSize: 10 }} />
      </Card>

      <Drawer title="新建线下完工（草稿）" open={createOpen} onClose={() => setCreateOpen(false)} width={420}>
        <Form form={form} layout="vertical" onFinish={onCreate}>
          <Form.Item name="contractId" label="合同" rules={[{ required: true }]}>
            <Select
              data-testid="offline-contract-select"
              showSearch optionFilterProp="label"
              options={contracts.map((c) => ({ value: c.id, label: c.contractNo }))}
              onChange={(v) => { if (v) void loadContractCities(String(v)); }}
            />
          </Form.Item>
          <Form.Item name="cityId" label="地市" rules={[{ required: true }]}>
            <Select
              data-testid="offline-city-select"
              loading={cityLoading}
              disabled={!selectedContractId}
              placeholder={cityPlaceholder}
              options={cityOptions.map((c) => ({ value: c.id, label: c.name }))}
              notFoundContent={!cityLoading && selectedContractId && cityOptions.length === 0 ? '该合同暂无可填报地市' : undefined}
            />
          </Form.Item>
          <Form.Item name="businessMonth" label="业务月份（YYYY-MM）" rules={[{ required: true }]}><Input placeholder="2026-06" /></Form.Item>
          <Form.Item name="amountFen" label="完工金额（元）" rules={[{ required: true }]}><InputNumber min={0.01} precision={2} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="summary" label="说明" rules={[{ required: true }]}><Input.TextArea rows={2} /></Form.Item>
          <Button type="primary" htmlType="submit" block>保存草稿</Button>
        </Form>
      </Drawer>
    </div>
  );
}
