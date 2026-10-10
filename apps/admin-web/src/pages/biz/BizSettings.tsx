import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Form, Input, Select, Space, Switch, Table, TimePicker, Typography, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { DownloadOutlined } from '@ant-design/icons';
import { exportPageRows } from '@/utils/page-export-core';
import dayjs from 'dayjs';
import { bizSettingsList, bizSettingUpdate, type BizSnapshotMetadata } from '@/api/biz.api';
import { useBizSnapshot } from '@/components/biz/BizSnapshotContext';

const { Title } = Typography;

const SETTING_LABELS: Record<string, string> = {
  contract_expiry_warning_days: '合同到期预警提前天数',
  order_import_max_bytes: '订单文件最大字节数',
  order_import_max_rows: '订单文件最大数据行数',
};

/** 自动更新配置在 biz_system_settings 中的键（非新增权限码，复用 settings 读写权限） */
const AUTO_ENABLED_KEY = 'snapshot_auto_update_enabled';
const AUTO_TIME_KEY = 'snapshot_auto_update_time';

function fmtShort(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function nextRunText(enabled: boolean, time?: string): string {
  if (!enabled || !time || !/^\d{2}:\d{2}$/.test(time)) return '未启用';
  const [h, m] = time.split(':').map(Number);
  const next = new Date();
  next.setHours(h, m, 0, 0);
  if (next.getTime() <= Date.now()) next.setDate(next.getDate() + 1);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${next.getFullYear()}-${p(next.getMonth() + 1)}-${p(next.getDate())} ${p(next.getHours())}:${p(next.getMinutes())}`;
}

function statusText(meta: BizSnapshotMetadata | null): string {
  if (meta?.lastRun?.status === 'building') return '更新中';
  if (meta?.lastRun?.status === 'failed') return '最近更新失败';
  if (meta?.snapshotId) return '正常（已生成快照）';
  return '未生成统计数据';
}

/** 系统设置（新基线 M6）：到期预警阈值等配置（仅 super_admin 可改）+ 经营分析数据更新（自动更新） */
export default function BizSettings() {
  const navigate = useNavigate();
  const { meta, building, refreshMeta, requestUpdate } = useBizSnapshot();
  const [items, setItems] = useState<Array<{ key: string; value: string; description: string | null }>>([]);
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [autoEnabled, setAutoEnabled] = useState(false);
  const [autoTime, setAutoTime] = useState('03:00');
  const [autoSaving, setAutoSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await bizSettingsList();
      setItems(data.items);
      const map: Record<string, string> = {};
      for (const item of data.items) map[item.key] = item.value;
      setEditing(map);
      const enabled = data.items.find((it) => it.key === AUTO_ENABLED_KEY)?.value;
      const time = data.items.find((it) => it.key === AUTO_TIME_KEY)?.value;
      setAutoEnabled(enabled === 'true');
      setAutoTime(time && /^\d{2}:\d{2}$/.test(time) ? time : '03:00');
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { message?: string } } }).response?.data?.message;
      message.error(detail ?? '加载失败');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const onSave = async (key: string) => {
    try {
      await bizSettingUpdate(key, editing[key] ?? '');
      message.success('设置已保存');
      void load();
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { message?: string } } }).response?.data?.message;
      message.error(detail ?? '保存失败');
    }
  };

  const onSaveAuto = async () => {
    setAutoSaving(true);
    try {
      await bizSettingUpdate(AUTO_ENABLED_KEY, autoEnabled ? 'true' : 'false');
      await bizSettingUpdate(AUTO_TIME_KEY, autoTime || '03:00');
      // 后端 PUT settings/:key 已触发 scheduler.reschedule()，这里同步刷新顶部状态
      await refreshMeta();
      message.success('自动更新设置已保存');
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { message?: string } } }).response?.data?.message;
      message.error(detail ?? '保存失败');
    } finally {
      setAutoSaving(false);
    }
  };

  const columns = [
    { title: '设置项', dataIndex: 'key', key: 'key', render: (v: string) => <span>{SETTING_LABELS[v] ?? '未命名设置'}</span> },
    { title: '说明', dataIndex: 'description', key: 'description' },
    {
      title: '值', key: 'value', width: 220,
      render: (_: unknown, row: { key: string }) => (
        <Input
          value={editing[row.key] ?? ''}
          onChange={(e) => setEditing((prev) => ({ ...prev, [row.key]: e.target.value }))}
        />
      ),
    },
    {
      title: '操作', key: 'action', width: 100,
      render: (_: unknown, row: { key: string }) => <Button type="primary" size="small" onClick={() => onSave(row.key)}>保存</Button>,
    },
  ];

  // 自动更新配置独立成区，不混入通用设置表
  const genericItems = items.filter((it) => it.key !== AUTO_ENABLED_KEY && it.key !== AUTO_TIME_KEY);

  return (
    <div className="v3-content">
      <div className="v3-page-head">
        <div className="v3-page-titles">
          <Title level={4} style={{ margin: 0 }}>系统设置</Title>
        </div>
        <Space className="v3-page-head-actions" wrap>
          <Button onClick={() => navigate('/biz/operation')}>返回经营管理</Button>
          <Button icon={<DownloadOutlined />} disabled={!genericItems.length} onClick={() => exportPageRows('系统设置', genericItems.filter((item) => !/secret|token|password|key|密钥|密码|令牌/i.test(item.key)), '非敏感设置', ['key', 'description', 'value'])}>导出 Excel</Button><Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button>
        </Space>
      </div>
      <Card>
        <Table rowKey="key" columns={columns} dataSource={genericItems} pagination={false} />
      </Card>

      <Card title="经营分析数据更新" size="small" style={{ marginTop: 16 }}>
        <Form layout="vertical" style={{ maxWidth: 520 }}>
          <Form.Item label="启用自动更新">
            <Switch checked={autoEnabled} onChange={(v) => setAutoEnabled(v)} />
          </Form.Item>
          <Form.Item label="每日更新时间" extra="启用后，系统将在该时间自动生成最新统计数据（服务需保持运行）">
            <TimePicker
              format="HH:mm"
              minuteStep={5}
              value={autoTime ? dayjs(autoTime, 'HH:mm') : null}
              onChange={(v) => setAutoTime(v ? v.format('HH:mm') : '')}
              disabled={!autoEnabled}
            />
          </Form.Item>
          <Form.Item label="最近一次成功更新时间">
            <span>{meta?.lastSuccessfulAt ? fmtShort(meta.lastSuccessfulAt) : '—'}</span>
          </Form.Item>
          <Form.Item label="下一次预计更新时间">
            <span>{nextRunText(autoEnabled, autoTime)}</span>
          </Form.Item>
          <Form.Item label="当前状态">
            <span>{statusText(meta)}</span>
          </Form.Item>
          {meta?.lastRun?.status === 'failed' && (
            <Form.Item label="最近失败原因">
              <span style={{ color: '#cf1322' }}>{meta.lastRun.errorMessage ?? '未知错误'}</span>
            </Form.Item>
          )}
          <Space>
            <Button type="primary" loading={autoSaving} onClick={() => void onSaveAuto()}>保存设置</Button>
            <Button loading={building} onClick={() => void requestUpdate()}>立即更新</Button>
          </Space>
        </Form>
      </Card>
    </div>
  );
}
