/**
 * 合同管理页面
 *
 * 功能：
 * - 分页表格（合同编号、名称、金额、费率、累计订单/发票、软删除标记）
 * - 顶部搜索：合同名称关键词
 * - 新建/编辑 Modal（严格对齐 CreateContractRequest DTO）
 * - 详情 Drawer（含城市分配列表 + 经营测算指标）
 * - 软删除操作（确认后执行）
 * - 城市分配管理：新增/编辑/删除（含 estimatedOrderAmount2026 等 4 字段）
 */
import { useState } from 'react';
import {
  Table,
  Button,
  Space,
  Input,
  Modal,
  Form,
  InputNumber,
  DatePicker,
  Tag,
  Drawer,
  Descriptions,
  Popconfirm,
  message,
  Card,
  Divider,
} from 'antd';
import {
  PlusOutlined,
  SearchOutlined,
  EyeOutlined,
  EditOutlined,
  DeleteOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as contractsApi from '@/api/contracts.api';
import type { Contract, ContractCityAllocation, CreateContractRequest, CreateAllocationRequest, UpdateContractRequest, UpdateAllocationRequest } from '@biz-reporting/shared-types';
import type { TablePagination } from '@/types';
import dayjs from 'dayjs';


export default function Contracts({ readOnly = false }: { readOnly?: boolean }) {
  const queryClient = useQueryClient();
  const [searchKeyword, setSearchKeyword] = useState('');
  const [pagination, setPagination] = useState<TablePagination>({
    page: 1,
    pageSize: 10,
    total: 0,
  });

  // ---- 合同 Modal 状态 ----
  const [contractModalOpen, setContractModalOpen] = useState(false);
  const [editingContract, setEditingContract] = useState<Contract | null>(null);
  const [contractForm] = Form.useForm();

  // ---- Drawer 状态 ----
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [detailContract, setDetailContract] = useState<Contract | null>(null);

  // ---- 分配 Modal 状态 ----
  const [allocModalOpen, setAllocModalOpen] = useState(false);
  const [editingAllocation, setEditingAllocation] = useState<ContractCityAllocation | null>(null);
  const [allocForm] = Form.useForm();

  // ---- 分配列表 ----
  const [allocations, setAllocations] = useState<ContractCityAllocation[]>([]);
  const [allocationsLoading, setAllocationsLoading] = useState(false);

  // ---- 列表查询 ----
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['contracts', pagination.page, pagination.pageSize],
    queryFn: () =>
      contractsApi.listContracts({
        page: pagination.page,
        pageSize: pagination.pageSize,
      }),
  });

  // 前端关键词过滤（Mock 模式下后端不支持搜索参数）
  const contracts = data?.items ?? [];
  const filteredContracts = searchKeyword
    ? contracts.filter(
        (c) =>
          c.contractName.includes(searchKeyword) ||
          c.contractCode.includes(searchKeyword),
      )
    : contracts;

  // ---- 创建/更新 Mutation ----
  const createMutation = useMutation({
    mutationFn: contractsApi.createContract,
    onSuccess: () => {
      message.success('合同创建成功');
      setContractModalOpen(false);
      contractForm.resetFields();
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<CreateContractRequest> }) =>
      contractsApi.updateContract(id, data as UpdateContractRequest),
    onSuccess: () => {
      message.success('合同更新成功');
      setContractModalOpen(false);
      setEditingContract(null);
      contractForm.resetFields();
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: contractsApi.softDeleteContract,
    onSuccess: () => {
      message.success('合同已删除');
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
    },
  });

  // ---- 分配 Mutation ----
  const createAllocMutation = useMutation({
    mutationFn: ({ contractId, data }: { contractId: number; data: Omit<CreateAllocationRequest, 'contractId'> }) =>
      contractsApi.createAllocation(contractId, data),
    onSuccess: () => {
      message.success('分配创建成功');
      setAllocModalOpen(false);
      allocForm.resetFields();
      if (detailContract) loadContractDetail(detailContract.id);
    },
  });

  const updateAllocMutation = useMutation({
    mutationFn: ({ allocId, data }: { allocId: number; data: UpdateAllocationRequest }) =>
      contractsApi.updateAllocation(allocId, data),
    onSuccess: () => {
      message.success('分配更新成功');
      setAllocModalOpen(false);
      setEditingAllocation(null);
      allocForm.resetFields();
      if (detailContract) loadContractDetail(detailContract.id);
    },
  });

  const deleteAllocMutation = useMutation({
    mutationFn: contractsApi.deleteAllocation,
    onSuccess: () => {
      message.success('分配已删除');
      if (detailContract) loadContractDetail(detailContract.id);
    },
  });

  // ---- 分配加载（从合同详情接口获取，不再单独调 allocations 路由） ----
  async function loadContractDetail(contractId: number) {
    setAllocationsLoading(true);
    try {
      const detail = await contractsApi.getContract(contractId);
      setDetailContract(detail);
      setAllocations(detail.allocations ?? []);
    } catch {
      setAllocations([]);
    } finally {
      setAllocationsLoading(false);
    }
  }

  // ---- 事件处理 ----
  function handleAdd() {
    setEditingContract(null);
    contractForm.resetFields();
    setContractModalOpen(true);
  }

  function handleEdit(contract: Contract) {
    setEditingContract(contract);
    contractForm.setFieldsValue({
      contractCode: contract.contractCode,
      contractName: contract.contractName,
      contractAmount: contract.contractAmount,
      rate: contract.rate,
      signDate: contract.signDate ? dayjs(contract.signDate) : undefined,
      expireDate: contract.expireDate ? dayjs(contract.expireDate) : undefined,
    });
    setContractModalOpen(true);
  }

  function handleView(contract: Contract) {
    setDetailContract(contract); // 先显示列表数据（快速展示）
    setDrawerOpen(true);
    loadContractDetail(contract.id); // 再异步拉详情含 allocations
  }

  function handleContractModalOk() {
    contractForm.validateFields().then((values) => {
      const formData: CreateContractRequest = {
        contractCode: values.contractCode,
        contractName: values.contractName,
        contractAmount: values.contractAmount,
        rate: values.rate,
        signDate: values.signDate
          ? (values.signDate as dayjs.Dayjs).format('YYYY-MM-DD')
          : undefined,
        expireDate: values.expireDate
          ? (values.expireDate as dayjs.Dayjs).format('YYYY-MM-DD')
          : undefined,
      };

      if (editingContract) {
        updateMutation.mutate({ id: editingContract.id, data: formData });
      } else {
        createMutation.mutate(formData);
      }
    });
  }

  function handleDelete(contractId: number) {
    deleteMutation.mutate(contractId);
  }

  // ---- 分配操作 ----
  function handleAddAllocation() {
    setEditingAllocation(null);
    allocForm.resetFields();
    setAllocModalOpen(true);
  }

  function handleEditAllocation(alloc: ContractCityAllocation) {
    setEditingAllocation(alloc);
    allocForm.setFieldsValue({
      cityId: alloc.cityId,
      cityContractAmount: alloc.cityContractAmount,
      rate: alloc.rate,
      estimatedOrderAmount2026: alloc.estimatedOrderAmount2026,
      estimatedIncomeAmount2026: alloc.estimatedIncomeAmount2026,
      remark: alloc.remark,
      sourceCityName: alloc.sourceCityName,
    });
    setAllocModalOpen(true);
  }

  function handleAllocModalOk() {
    allocForm.validateFields().then((values) => {
      const baseAllocData = {
        cityId: Number(values.cityId),
        cityContractAmount: Number(values.cityContractAmount || 0),
        rate: Number(values.rate || 0),
        estimatedOrderAmount2026: values.estimatedOrderAmount2026 != null ? Number(values.estimatedOrderAmount2026) : undefined,
        estimatedIncomeAmount2026: values.estimatedIncomeAmount2026 != null ? Number(values.estimatedIncomeAmount2026) : undefined,
        remark: values.remark || null,
        sourceCityName: values.sourceCityName || null,
      };

      if (editingAllocation) {
        updateAllocMutation.mutate({ allocId: editingAllocation.id, data: { ...baseAllocData, contractId: editingAllocation.contractId } });
      } else if (detailContract) {
        createAllocMutation.mutate({ contractId: detailContract.id, data: baseAllocData });
      }
    });
  }

  function handleDeleteAllocation(allocId: number) {
    deleteAllocMutation.mutate(allocId);
  }

  const isMutating = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending;
  const isAllocMutating = createAllocMutation.isPending || updateAllocMutation.isPending || deleteAllocMutation.isPending;

  // ---- 表格列定义 ----
  const columns = [
    {
      title: '合同编号',
      dataIndex: 'contractCode',
      key: 'contractCode',
      width: 140,
    },
    {
      title: '合同名称',
      dataIndex: 'contractName',
      key: 'contractName',
      ellipsis: true,
    },
    {
      title: '合同金额',
      dataIndex: 'contractAmount',
      key: 'contractAmount',
      width: 120,
      align: 'right' as const,
      render: (v: number) => v.toLocaleString(),
    },
    {
      title: '费率',
      dataIndex: 'rate',
      key: 'rate',
      width: 80,
      align: 'right' as const,
      render: (v: number) => `${(v * 100).toFixed(1)}%`,
    },
    {
      title: '分配城市',
      key: 'cities',
      width: 200,
      render: (_: unknown, record: Contract) => {
        const cities = (record as Contract & { cities?: Array<{ cityId: number; cityName: string }> }).cities;
        if (!cities || cities.length === 0) {
          return <Tag color="default">未分配</Tag>;
        }
        return cities.map((c) => <Tag key={c.cityId} color="blue">{c.cityName}</Tag>);
      },
    },
    {
      title: '累计订单金额',
      dataIndex: 'accumulatedOrderAmount',
      key: 'accumulatedOrderAmount',
      width: 130,
      align: 'right' as const,
      render: (v: number) => v.toLocaleString(),
    },
    {
      title: '累计发票金额',
      dataIndex: 'accumulatedInvoiceAmount',
      key: 'accumulatedInvoiceAmount',
      width: 130,
      align: 'right' as const,
      render: (v: number) => v.toLocaleString(),
    },
    {
      title: '状态',
      key: 'status',
      width: 80,
      render: (_: unknown, record: Contract) =>
        record.isDeleted ? (
          <Tag color="red">已删除</Tag>
        ) : (
          <Tag color="green">有效</Tag>
        ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 200,
      render: (_: unknown, record: Contract) => (
        <Space size="small">
          <Button
            type="link"
            size="small"
            icon={<EyeOutlined />}
            onClick={() => handleView(record)}
          >
            详情
          </Button>
          {!readOnly && !record.isDeleted && (
            <>
              <Button
                type="link"
                size="small"
                icon={<EditOutlined />}
                onClick={() => handleEdit(record)}
              >
                编辑
              </Button>
              <Popconfirm
                title="确定删除此合同？"
                description="删除后不影响已有快照数据"
                onConfirm={() => handleDelete(record.id)}
                okText="确定"
                cancelText="取消"
              >
                <Button type="link" size="small" danger icon={<DeleteOutlined />}>
                  删除
                </Button>
              </Popconfirm>
            </>
          )}
        </Space>
      ),
    },
  ];

  // ---- 分配表格列 ----
  const allocationColumns = [
    {
      title: '地市编号',
      dataIndex: 'cityId',
      key: 'cityId',
      width: 80,
    },
    {
      title: '城市合同金额',
      dataIndex: 'cityContractAmount',
      key: 'cityContractAmount',
      width: 130,
      align: 'right' as const,
      render: (v: number) => v.toLocaleString(),
    },
    {
      title: '费率',
      dataIndex: 'rate',
      key: 'rate',
      width: 80,
      align: 'right' as const,
      render: (v: number) => `${(v * 100).toFixed(1)}%`,
    },
    {
      title: '26年预估订单',
      dataIndex: 'estimatedOrderAmount2026',
      key: 'estimatedOrderAmount2026',
      width: 140,
      align: 'right' as const,
      render: (v: number) => (v != null ? v.toLocaleString() : '0'),
    },
    {
      title: '26年预计收入',
      dataIndex: 'estimatedIncomeAmount2026',
      key: 'estimatedIncomeAmount2026',
      width: 140,
      align: 'right' as const,
      render: (v: number) => (v != null ? v.toLocaleString() : '0'),
    },
    {
      title: '备注',
      dataIndex: 'remark',
      key: 'remark',
      ellipsis: true,
      render: (v: string | null) => v || '-',
    },
    {
      title: '来源城市',
      dataIndex: 'sourceCityName',
      key: 'sourceCityName',
      width: 100,
      render: (v: string | null) => v || '-',
    },
    {
      title: '操作',
      key: 'allocActions',
      width: 140,
      render: (_: unknown, record: ContractCityAllocation) => readOnly ? null : (
        <Space size="small">
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleEditAllocation(record)}
          >
            编辑
          </Button>
          <Popconfirm
            title="确定删除此分配？"
            onConfirm={() => handleDeleteAllocation(record.id)}
            okText="确定"
            cancelText="取消"
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      {/* 搜索栏 */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap>
          <Input
            placeholder="搜索合同名称/编号"
            prefix={<SearchOutlined />}
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            style={{ width: 240 }}
            allowClear
          />
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={isLoading}>
            刷新
          </Button>
          {!readOnly && <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
            新建合同
          </Button>}
        </Space>
      </Card>

      {/* 合同表格 */}
      <Table
        rowKey="id"
        columns={columns}
        dataSource={filteredContracts}
        loading={isLoading || isMutating}
        pagination={{
          current: pagination.page,
          pageSize: pagination.pageSize,
          total: data?.total ?? filteredContracts.length,
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 条`,
          onChange: (page, pageSize) => setPagination({ page, pageSize, total: data?.total ?? 0 }),
        }}
        scroll={{ x: 1100 }}
      />

      {/* ========== 合同新建/编辑 Modal ========== */}
      <Modal
        title={editingContract ? '编辑合同' : '新建合同'}
        open={contractModalOpen}
        onOk={handleContractModalOk}
        onCancel={() => {
          setContractModalOpen(false);
          setEditingContract(null);
          contractForm.resetFields();
        }}
        confirmLoading={isMutating}
        destroyOnClose
      >
        <Form form={contractForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="contractCode"
            label="合同编号"
            rules={[{ required: true, message: '请输入合同编号' }]}
          >
            <Input placeholder="如 HT-2026-010" />
          </Form.Item>
          <Form.Item
            name="contractName"
            label="合同名称"
            rules={[{ required: true, message: '请输入合同名称' }]}
          >
            <Input placeholder="合同名称" />
          </Form.Item>
          <Form.Item
            name="contractAmount"
            label="合同金额"
            rules={[{ required: true, message: '请输入合同金额' }]}
          >
            <InputNumber
              min={0}
              style={{ width: '100%' }}
              placeholder="合同金额（元）"
              formatter={(v) => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
            />
          </Form.Item>
          <Form.Item
            name="rate"
            label="费率"
            rules={[{ required: true, message: '请输入费率' }]}
            extra="请输入小数，如 0.03 表示 3%"
          >
            <InputNumber min={0} max={1} step={0.001} style={{ width: '100%' }} placeholder="如 0.03" />
          </Form.Item>
          <Form.Item name="signDate" label="签订日期">
            <DatePicker style={{ width: '100%' }} placeholder="选择签订日期" />
          </Form.Item>
          <Form.Item name="expireDate" label="到期日期">
            <DatePicker style={{ width: '100%' }} placeholder="选择到期日期" />
          </Form.Item>
        </Form>
      </Modal>

      {/* ========== 合同详情 Drawer ========== */}
      <Drawer
        title="合同详情"
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          setDetailContract(null);
          setAllocations([]);
        }}
        width={640}
      >
        {detailContract && (
          <>
            <Descriptions column={1} bordered size="small">
              <Descriptions.Item label="合同编号">
                {detailContract.contractCode}
              </Descriptions.Item>
              <Descriptions.Item label="合同名称">
                {detailContract.contractName}
              </Descriptions.Item>
              <Descriptions.Item label="合同金额">
                {detailContract.contractAmount.toLocaleString()} 元
              </Descriptions.Item>
              <Descriptions.Item label="费率">
                {(detailContract.rate * 100).toFixed(1)}%
              </Descriptions.Item>
              <Descriptions.Item label="累计订单金额">
                {detailContract.accumulatedOrderAmount.toLocaleString()} 元
              </Descriptions.Item>
              <Descriptions.Item label="累计发票金额">
                {detailContract.accumulatedInvoiceAmount.toLocaleString()} 元
              </Descriptions.Item>
              <Descriptions.Item label="签订日期">
                {detailContract.signDate
                  ? new Date(detailContract.signDate).toLocaleDateString('zh-CN')
                  : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="到期日期">
                {detailContract.expireDate
                  ? new Date(detailContract.expireDate).toLocaleDateString('zh-CN')
                  : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="状态">
                {detailContract.isDeleted ? (
                  <Tag color="red">已删除</Tag>
                ) : (
                  <Tag color="green">有效</Tag>
                )}
              </Descriptions.Item>
            </Descriptions>

            <Divider />

            {/* 城市分配列表 */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h4 style={{ margin: 0 }}>城市分配与经营测算</h4>
              {!readOnly && <Button
                type="primary"
                size="small"
                icon={<PlusOutlined />}
                onClick={handleAddAllocation}
                disabled={!!detailContract.isDeleted}
              >
                新增分配
              </Button>}
            </div>
            <Table
              rowKey="id"
              columns={allocationColumns}
              dataSource={allocations}
              loading={allocationsLoading || isAllocMutating}
              size="small"
              pagination={false}
              scroll={{ x: 800 }}
              locale={{ emptyText: '暂无城市分配' }}
            />
          </>
        )}
      </Drawer>

      {/* ========== 分配新建/编辑 Modal ========== */}
      <Modal
        title={editingAllocation ? '编辑城市分配' : '新增城市分配'}
        open={allocModalOpen}
        onOk={handleAllocModalOk}
        onCancel={() => {
          setAllocModalOpen(false);
          setEditingAllocation(null);
          allocForm.resetFields();
        }}
        confirmLoading={isAllocMutating}
        destroyOnClose
        width={520}
      >
        <Form form={allocForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="cityId"
            label="地市编号"
            rules={[{ required: true, message: '请输入地市编号' }]}
          >
            <InputNumber min={1} style={{ width: '100%' }} placeholder="地市编号" disabled={!!editingAllocation} />
          </Form.Item>
          <Form.Item
            name="cityContractAmount"
            label="城市合同金额"
            rules={[{ required: true, message: '请输入城市合同金额' }]}
          >
            <InputNumber
              min={0}
              style={{ width: '100%' }}
              placeholder="城市合同金额（元）"
              formatter={(v) => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
            />
          </Form.Item>
          <Form.Item
            name="rate"
            label="费率"
            rules={[{ required: true, message: '请输入费率' }]}
            extra="请输入小数，如 0.03 表示 3%"
          >
            <InputNumber min={0} max={1} step={0.001} style={{ width: '100%' }} placeholder="如 0.03" />
          </Form.Item>

          <Divider plain>经营测算指标</Divider>

          <Form.Item
            name="estimatedOrderAmount2026"
            label="26年预估订单"
          >
            <InputNumber
              min={0}
              style={{ width: '100%' }}
              placeholder="26年预估订单金额"
              formatter={(v) => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
            />
          </Form.Item>
          <Form.Item
            name="estimatedIncomeAmount2026"
            label="26年预计收入"
          >
            <InputNumber
              min={0}
              style={{ width: '100%' }}
              placeholder="26年预计收入金额"
              formatter={(v) => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
            />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={3} placeholder="备注信息" maxLength={500} showCount />
          </Form.Item>
          <Form.Item name="sourceCityName" label="来源城市">
            <Input placeholder="来源城市名称" maxLength={100} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
