import { useEffect, useState } from 'react';
import { Table, Tag, Button, Modal, Input, DatePicker, Space, message, Typography } from 'antd';
import { RollbackOutlined, UnlockOutlined, PlusCircleOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { AdminPackageItem, PaginatedResponse } from '@biz-reporting/shared-types';
import * as packagesApi from '@/api/packages.api';

const { Text } = Typography;

const statusColorMap: Record<string, string> = {
  draft: 'orange',
  submitted: 'green',
};

export default function Packages() {
  const [data, setData] = useState<PaginatedResponse<AdminPackageItem> | null>(null);
  const [loading, setLoading] = useState(false);

  const [returnModal, setReturnModal] = useState<{ open: boolean; pkg: AdminPackageItem | null }>({
    open: false,
    pkg: null,
  });
  const [returnMonth, setReturnMonth] = useState<number>(0);
  const [returnReason, setReturnReason] = useState('');

  const [unlockModal, setUnlockModal] = useState<{ open: boolean; pkg: AdminPackageItem | null }>({
    open: false,
    pkg: null,
  });
  const [unlockMonths, setUnlockMonths] = useState<number[]>([]);
  const [unlockExpire, setUnlockExpire] = useState<string>('');

  const [bulkUnlockModalOpen, setBulkUnlockModalOpen] = useState(false);
  const [bulkUnlockYear, setBulkUnlockYear] = useState<number>(new Date().getFullYear());
  const [bulkUnlockMonths, setBulkUnlockMonths] = useState<number[]>([]);
  const [bulkUnlockExpire, setBulkUnlockExpire] = useState<string>('');
  const [bulkUnlockReason, setBulkUnlockReason] = useState<string>('');

  const [openContractModal, setOpenContractModal] = useState<{
    open: boolean;
    pkg: AdminPackageItem | null;
  }>({ open: false, pkg: null });
  const [openMonth, setOpenMonth] = useState<number>(0);
  const [openContractId, setOpenContractId] = useState<number>(0);

  const fetchData = () => {
    setLoading(true);
    packagesApi
      .listPackages()
      .then(setData)
      .catch(() => message.error('获取报表包列表失败'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleReturnToDraft = () => {
    if (!returnModal.pkg || !returnMonth || !returnReason.trim()) {
      message.warning('请填写月份和退回原因');
      return;
    }

    packagesApi
      .returnToDraft(returnModal.pkg.id, { monthNo: returnMonth, reason: returnReason.trim() })
      .then(() => {
        message.success('已退回草稿');
        setReturnModal({ open: false, pkg: null });
        setReturnMonth(0);
        setReturnReason('');
        fetchData();
      })
      .catch(() => undefined);
  };

  const handleUnlock = () => {
    if (!unlockModal.pkg || unlockMonths.length === 0 || !unlockExpire) {
      message.warning('请填写解锁月份和过期时间');
      return;
    }

    packagesApi
      .unlockMonths(unlockModal.pkg.id, { months: unlockMonths, expiresAt: unlockExpire })
      .then(() => {
        message.success('已解锁月份');
        setUnlockModal({ open: false, pkg: null });
        setUnlockMonths([]);
        setUnlockExpire('');
        fetchData();
      })
      .catch(() => undefined);
  };

  const handleBulkUnlock = () => {
    if (!bulkUnlockYear || bulkUnlockMonths.length === 0 || !bulkUnlockExpire) {
      message.warning('请填写年度、解锁月份和过期时间');
      return;
    }

    packagesApi
      .bulkUnlockMonths({
        year: bulkUnlockYear,
        months: bulkUnlockMonths,
        expiresAt: bulkUnlockExpire,
        reason: bulkUnlockReason.trim() || undefined,
      })
      .then((res) => {
        message.success(
          `已处理 ${res.packageCount} 个报表包，新增 ${res.createdGrantCount} 条授权，跳过 ${res.skippedActiveGrantCount} 条未过期授权`,
        );
        setBulkUnlockModalOpen(false);
        setBulkUnlockMonths([]);
        setBulkUnlockExpire('');
        setBulkUnlockReason('');
        fetchData();
      })
      .catch(() => undefined);
  };

  const handleOpenContract = () => {
    if (!openContractModal.pkg || !openMonth || !openContractId) {
      message.warning('请填写月份和合同编号');
      return;
    }

    packagesApi
      .openCurrentMonthContract(openContractModal.pkg.id, {
        monthNo: openMonth,
        contractId: openContractId,
      })
      .then(() => {
        message.success('已开放合同填报权限');
        setOpenContractModal({ open: false, pkg: null });
        setOpenMonth(0);
        setOpenContractId(0);
        fetchData();
      })
      .catch(() => undefined);
  };

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            报表包管理
          </Typography.Title>
          <Text type="secondary">查看地市年度报表包状态，并处理退回、解锁和合同开放。</Text>
        </div>
        <Button
          icon={<UnlockOutlined />}
          onClick={() => {
            setBulkUnlockYear(new Date().getFullYear());
            setBulkUnlockMonths([]);
            setBulkUnlockExpire('');
            setBulkUnlockReason('');
            setBulkUnlockModalOpen(true);
          }}
        >
          批量解锁全部地市
        </Button>
      </div>

      <Table<AdminPackageItem>
        rowKey="id"
        loading={loading}
        dataSource={data?.items ?? []}
        pagination={{
          total: data?.total ?? 0,
          pageSize: data?.pageSize ?? 20,
          current: data?.page ?? 1,
          showSizeChanger: false,
        }}
        locale={{ emptyText: '暂无报表包数据' }}
        columns={[
          { title: '城市', dataIndex: 'cityName', key: 'cityName' },
          { title: '年度', dataIndex: 'reportYear', key: 'reportYear', width: 90 },
          {
            title: '状态',
            dataIndex: 'status',
            key: 'status',
            width: 100,
            render: (status: string) => (
              <Tag color={statusColorMap[status] ?? 'default'}>
                {status === 'submitted' ? '已提交' : '草稿'}
              </Tag>
            ),
          },
          {
            title: '当月提交',
            dataIndex: 'currentMonthSubmitted',
            key: 'currentMonthSubmitted',
            width: 110,
            render: (submitted: boolean) => (
              <Tag color={submitted ? 'green' : 'default'}>{submitted ? '已提交' : '未提交'}</Tag>
            ),
          },
          {
            title: '已提交月数',
            dataIndex: 'submittedMonthCount',
            key: 'submittedMonthCount',
            width: 120,
          },
          {
            title: '更新时间',
            dataIndex: 'lastUpdatedAt',
            key: 'lastUpdatedAt',
            width: 180,
            render: (value: string | null) => (value ? new Date(value).toLocaleString('zh-CN') : '-'),
          },
          {
            title: '操作',
            key: 'action',
            width: 260,
            render: (_, record) => (
              <Space>
                <Button
                  size="small"
                  icon={<RollbackOutlined />}
                  onClick={() => {
                    setReturnMonth(0);
                    setReturnReason('');
                    setReturnModal({ open: true, pkg: record });
                  }}
                >
                  退回
                </Button>
                <Button
                  size="small"
                  icon={<UnlockOutlined />}
                  onClick={() => {
                    setUnlockMonths([]);
                    setUnlockExpire('');
                    setUnlockModal({ open: true, pkg: record });
                  }}
                >
                  解锁
                </Button>
                <Button
                  size="small"
                  icon={<PlusCircleOutlined />}
                  onClick={() => {
                    setOpenMonth(0);
                    setOpenContractId(0);
                    setOpenContractModal({ open: true, pkg: record });
                  }}
                >
                  开放合同
                </Button>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        title="退回草稿"
        open={returnModal.open}
        onOk={handleReturnToDraft}
        onCancel={() => setReturnModal({ open: false, pkg: null })}
        okText="确认退回"
        cancelText="取消"
      >
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Text>城市：{returnModal.pkg?.cityName ?? '-'}</Text>
          <Input
            type="number"
            min={1}
            max={12}
            placeholder="月份，例如 7"
            value={returnMonth || undefined}
            onChange={(e) => setReturnMonth(Number(e.target.value))}
          />
          <Input.TextArea
            rows={4}
            placeholder="退回原因"
            value={returnReason}
            onChange={(e) => setReturnReason(e.target.value)}
          />
        </Space>
      </Modal>

      <Modal
        title="解锁月份"
        open={unlockModal.open}
        onOk={handleUnlock}
        onCancel={() => setUnlockModal({ open: false, pkg: null })}
        okText="确认解锁"
        cancelText="取消"
      >
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Text>城市：{unlockModal.pkg?.cityName ?? '-'}</Text>
          <Input
            placeholder="月份，逗号分隔，例如 1,2,3"
            value={unlockMonths.join(',')}
            onChange={(e) =>
              setUnlockMonths(
                e.target.value
                  .split(',')
                  .map((item) => Number(item.trim()))
                  .filter((month) => month >= 1 && month <= 12),
              )
            }
          />
          <DatePicker
            showTime
            style={{ width: '100%' }}
            value={unlockExpire ? dayjs(unlockExpire) : null}
            onChange={(date) => setUnlockExpire(date?.toISOString() ?? '')}
          />
        </Space>
      </Modal>

      <Modal
        title="批量解锁全部地市"
        open={bulkUnlockModalOpen}
        onOk={handleBulkUnlock}
        onCancel={() => setBulkUnlockModalOpen(false)}
        okText="确认批量解锁"
        cancelText="取消"
      >
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Text type="secondary">对所选年度下所有已有报表包批量开放指定月份的编辑权限。</Text>
          <Input
            type="number"
            min={2000}
            max={2100}
            placeholder="年度，例如 2026"
            value={bulkUnlockYear || undefined}
            onChange={(e) => setBulkUnlockYear(Number(e.target.value))}
          />
          <Input
            placeholder="月份，逗号分隔，例如 1,2,5"
            value={bulkUnlockMonths.join(',')}
            onChange={(e) =>
              setBulkUnlockMonths(
                e.target.value
                  .split(',')
                  .map((item) => Number(item.trim()))
                  .filter((month) => month >= 1 && month <= 12),
              )
            }
          />
          <DatePicker
            showTime
            style={{ width: '100%' }}
            value={bulkUnlockExpire ? dayjs(bulkUnlockExpire) : null}
            onChange={(date) => setBulkUnlockExpire(date?.toISOString() ?? '')}
          />
          <Input.TextArea
            rows={3}
            placeholder="解锁原因（可选）"
            value={bulkUnlockReason}
            onChange={(e) => setBulkUnlockReason(e.target.value)}
          />
        </Space>
      </Modal>
      <Modal
        title="开放合同填报权限"
        open={openContractModal.open}
        onOk={handleOpenContract}
        onCancel={() => setOpenContractModal({ open: false, pkg: null })}
        okText="确认开放"
        cancelText="取消"
      >
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Text>城市：{openContractModal.pkg?.cityName ?? '-'}</Text>
          <Text type="secondary">用于给指定月份补开放合同；若该月已提交，请先用「解锁月份」。</Text>
          <Input
            type="number"
            min={1}
            max={12}
            placeholder="月份，例如 7"
            value={openMonth || undefined}
            onChange={(e) => setOpenMonth(Number(e.target.value))}
          />
          <Input
            type="number"
            placeholder="合同编号"
            value={openContractId || undefined}
            onChange={(e) => setOpenContractId(Number(e.target.value))}
          />
        </Space>
      </Modal>
    </div>
  );
}
