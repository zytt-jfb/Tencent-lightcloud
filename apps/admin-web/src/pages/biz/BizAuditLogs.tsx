import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, DatePicker, Input, Select, Space, Table, Tag, Typography, message } from 'antd';
import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import { exportPageRows } from '@/utils/page-export-core';
import dayjs, { type Dayjs } from 'dayjs';
import { bizAdminListUsers, bizOperationLogs } from '@/api/biz.api';
import { useBizPermission } from '@/utils/biz-permission';

const { Title, Text } = Typography;

const ROLE_LABEL: Record<string, string> = {
  admin: '省级运营管理员',
  contract_manager: '合同管理员',
  city_user: '地市用户',
};

const ACTION_LABEL: Record<string, string> = {
  'auth.login.failed': '登录失败',
  'auth.login.success': '登录成功',
  'user.permission_overrides': '调整账号权限',
  'user.access.update': '调整账号范围',
  'auth.password.changed': '修改登录密码',
  'auth.password.reset': '重置登录密码',
  'user.create': '新增系统账号', 'user.status.update': '调整账号状态', 'user.delete': '删除系统账号',
  'user.permission.update': '调整账号权限', 'user.data_scope.update': '调整数据范围',
  'settings.update': '修改系统设置', 'region.create': '新增省市信息', 'region.update': '修改省市信息',
  'contract.create': '新增合同', 'contract.update': '修改合同', 'contract.void': '作废合同',
  'order_batch.delete_failed': '删除订单批次失败', 'order_batch.void': '作废订单批次',
  'cost.create': '新增成本记录', 'cost.update': '修改成本记录', 'cost.void': '作废成本记录',
  'offline.approve': '审核线下完工', 'offline.submit': '提交线下完工',
};
const OBJECT_LABEL: Record<string, string> = { user: '系统账号', permission: '账号权限', contract: '合同', order_batch: '订单批次', order_row: '订单明细', cost_entry: '成本记录', offline_completion: '线下完工记录', settings: '系统设置', announcement: '公告', message: '站内消息', maintenance_personnel: '维护人员', maintenance_vehicle: '维护车辆', maintenance_generator: '维护油机' };

type LogRow = Record<string, unknown>;

function formatAction(value: unknown, summary?: unknown): string {
  const code = String(value ?? '');
  if (ACTION_LABEL[code]) return ACTION_LABEL[code];
  const parts = code.split('.');
  const action = ({ create: '新增', update: '修改', delete: '删除', void: '作废', submit: '提交', approve: '审核', reject: '退回', publish: '发布', login: '登录', read: '查看' } as Record<string, string>)[parts[parts.length - 1] ?? ''];
  const object = OBJECT_LABEL[parts[0]] ?? parts[0];
  const readableSummary = String(summary ?? '').replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '').replace(/\b[a-z0-9_-]{24,}\b/gi, '').replace(/[{}"\[\]]/g, '').trim();
  return action ? `${action}${object}` : (readableSummary || '其他操作');
}

function readableObject(value: unknown) { const raw = String(value ?? ''); return OBJECT_LABEL[raw] ?? OBJECT_LABEL[raw.replace(/-/g, '_')] ?? '业务记录'; }

export default function BizAuditLogs() {
  const canRead = useBizPermission('operation.user.manage');
  const [users, setUsers] = useState<LogRow[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [username, setUsername] = useState<string>();
  const [actionType, setActionType] = useState<string>();
  const [targetType, setTargetType] = useState<string>();
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [exporting, setExporting] = useState(false);

  const loadUsers = useCallback(async () => {
    const data = await bizAdminListUsers();
    setUsers((data.items ?? []).filter((item) => String(item.roleCode) !== 'super_admin'));
  }, []);

  const loadLogs = useCallback(async (nextPage: number, nextPageSize: number) => {
    setLoading(true);
    try {
      const data = await bizOperationLogs({
        page: nextPage,
        pageSize: nextPageSize,
        ...(username ? { operatorUserId: username } : {}),
        ...(actionType ? { actionType } : {}),
        ...(targetType ? { targetType } : {}),
        ...(dateRange?.[0] ? { dateFrom: dateRange[0].startOf('day').toISOString() } : {}),
        ...(dateRange?.[1] ? { dateTo: dateRange[1].endOf('day').toISOString() } : {}),
      });
      setLogs(data.items ?? []);
      setTotal(Number(data.total ?? 0));
      setPage(Number(data.page ?? nextPage));
      setPageSize(Number(data.pageSize ?? nextPageSize));
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { message?: string } } }).response?.data?.message;
      message.error(detail ?? '日志加载失败');
    } finally {
      setLoading(false);
    }
  }, [actionType, dateRange, targetType, username]);

  const exportLogs = async () => {
    setExporting(true);
    try {
      const filters = {
        ...(username ? { operatorUserId: username } : {}), ...(actionType ? { actionType } : {}), ...(targetType ? { targetType } : {}),
        ...(dateRange?.[0] ? { dateFrom: dateRange[0].startOf('day').toISOString() } : {}), ...(dateRange?.[1] ? { dateTo: dateRange[1].endOf('day').toISOString() } : {}),
      };
      const first = await bizOperationLogs({ ...filters, page: 1, pageSize: 100 });
      const pages = await Promise.all(Array.from({ length: Math.ceil(first.total / first.pageSize) - 1 }, (_, index) => bizOperationLogs({ ...filters, page: index + 2, pageSize: first.pageSize })));
      exportPageRows('审计日志', [first.items, ...pages.map((result) => result.items)].flat(), '当前筛选');
    } finally { setExporting(false); }
  };

  useEffect(() => {
    if (canRead === true) {
      void loadUsers();
      void loadLogs(1, pageSize);
    }
  }, [canRead, loadUsers]);

  const accountSummary = useMemo(() => {
    const map = new Map<string, { key: string; username: string; name: string; roleCode: string; cityName: string; count: number; latest: string }>();
    for (const row of logs) {
      const key = String(row.username ?? row.operatorName ?? '未知账号');
      const current = map.get(key) ?? {
        key,
        username: String(row.username ?? row.operatorName ?? '未知账号'),
        name: String(row.operatorName ?? '-'),
        roleCode: String(row.roleCode ?? ''),
        cityName: String(row.cityName ?? '-'),
        count: 0,
        latest: String(row.createdAt ?? ''),
      };
      current.count += 1;
      if (String(row.createdAt ?? '') > current.latest) current.latest = String(row.createdAt ?? '');
      map.set(key, current);
    }
    return Array.from(map.values());
  }, [logs]);

  if (canRead === null) return null;
  if (!canRead) return <Card>当前账号无日志查看权限</Card>;

  return (
    <div className="v3-content">
      <div className="v3-page-head">
        <div className="v3-page-titles">
          <Title level={4} style={{ margin: 0 }}>审计日志</Title>
          <Text type="secondary">按账号查看登录与业务操作记录，super 账号不展示。</Text>
        </div>
        <Space wrap>
          <Button icon={<DownloadOutlined />} loading={exporting} disabled={!total} onClick={() => void exportLogs()}>导出 Excel</Button><Button icon={<ReloadOutlined />} onClick={() => void loadLogs(1, pageSize)}>刷新</Button>
        </Space>
      </div>
      <Card style={{ marginBottom: 12 }}>
        <Space wrap>
          <Select
            allowClear
            placeholder="操作账号"
            style={{ width: 190 }}
            options={users.map((item) => ({ value: String(item.id), label: `${String(item.username)} · ${String(item.name ?? '')}` }))}
            onChange={(value) => { setUsername(value); setPage(1); }}
          />
          <Select
            allowClear
            placeholder="动作类型"
            style={{ width: 170 }}
            options={[
              { value: 'auth.login.success', label: '登录成功' },
              { value: 'auth.login.failed', label: '登录失败' },
              { value: 'contract.create', label: '新增合同' },
              { value: 'contract.update', label: '修改合同' },
              { value: 'order_batch.delete_failed', label: '删除订单批次' },
              { value: 'cost.create', label: '新增成本' },
              { value: 'cost.update', label: '修改成本' },
            ]}
            onChange={(value) => { setActionType(value); setPage(1); }}
          />
          <Select
            allowClear
            placeholder="对象类型"
            style={{ width: 150 }}
            options={[
              { value: 'user', label: '账号' },
              { value: 'contract', label: '合同' },
              { value: 'order_batch', label: '订单批次' },
              { value: 'order_row', label: '订单行' },
              { value: 'cost_entry', label: '成本' },
            ]}
            onChange={(value) => { setTargetType(value); setPage(1); }}
          />
          <DatePicker.RangePicker
            value={dateRange}
            onChange={(value) => { setDateRange(value as [Dayjs, Dayjs] | null); setPage(1); }}
            allowClear
          />
          <Button type="primary" onClick={() => void loadLogs(1, pageSize)}>查询</Button>
        </Space>
      </Card>
      <Card title={`账号概览（当前页 ${accountSummary.length} 个账号）`} style={{ marginBottom: 12 }}>
        <Table
          size="small"
          rowKey="key"
          pagination={false}
          dataSource={accountSummary}
          columns={[
            { title: '账号', dataIndex: 'username' },
            { title: '姓名', dataIndex: 'name' },
            { title: '角色', dataIndex: 'roleCode', render: (value: string) => <Tag color="blue">{ROLE_LABEL[value] ?? value}</Tag> },
            { title: '地市', dataIndex: 'cityName' },
            { title: '本页记录数', dataIndex: 'count' },
            { title: '最近记录', dataIndex: 'latest' },
          ]}
        />
      </Card>
      <Card title="登录与操作明细">
        <Table
          size="small"
          rowKey={(row) => String(row.id)}
          loading={loading}
          dataSource={logs}
          scroll={{ x: 'max-content' }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50, 100],
            onChange: (nextPage, nextPageSize) => { void loadLogs(nextPage, nextPageSize); },
          }}
          columns={[
            { title: '时间', dataIndex: 'createdAt', width: 180 },
            { title: '账号', dataIndex: 'username', width: 150 },
            { title: '姓名', dataIndex: 'operatorName', width: 120 },
            { title: '角色', dataIndex: 'roleCode', render: (value: string) => ROLE_LABEL[value] ?? value },
            { title: '地市', dataIndex: 'cityName' },
            { title: '动作', dataIndex: 'actionType', render: formatAction },
            { title: '对象', dataIndex: 'targetType', render: readableObject },
            { title: '操作对象', dataIndex: 'targetDisplay', width: 260, render: (value: string) => <Text ellipsis={{ tooltip: value }}>{value}</Text> },
            { title: '结果', dataIndex: 'resultStatus', render: (value: string) => <Tag color={value === 'success' ? 'green' : 'red'}>{value === 'success' ? '成功' : value === 'failed' ? '失败' : value === 'rejected' ? '已拒绝' : '处理中'}</Tag> },
          ]}
        />
      </Card>
    </div>
  );
}
