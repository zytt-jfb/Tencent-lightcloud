import { useState } from 'react';
import { Button, Form, Input, Modal, Select, Space, Switch, Table, Tag, Typography, message } from 'antd';
import { CopyOutlined, KeyOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Role, UserStatus, type CreateManagedUserRequest, type UserListItem } from '@biz-reporting/shared-types';
import * as usersApi from '@/api/users.api';
import * as citiesApi from '@/api/cities.api';

const roleOptions = [
  { value: Role.CONTRACT_MANAGER, label: '合同管理员' },
  { value: Role.SYSTEM_ADMIN, label: '系统管理员' },
  { value: Role.CITY_USER, label: '地市用户' },
];

const roleLabels: Record<string, string> = {
  [Role.ROOT_ADMIN]: '根管理员',
  [Role.CONTRACT_MANAGER]: '合同管理员',
  [Role.SYSTEM_ADMIN]: '系统管理员',
  [Role.CITY_USER]: '地市用户',
};

export default function Users() {
  const client = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<UserListItem | null>(null);
  const [oneTimeSecret, setOneTimeSecret] = useState<{ title: string; value: string } | null>(null);
  const [createForm] = Form.useForm<CreateManagedUserRequest>();
  const [editForm] = Form.useForm<{ role: Role; cityId?: number }>();
  const { data, isLoading, refetch } = useQuery({ queryKey: ['users'], queryFn: usersApi.listUsers });
  const { data: cities = [] } = useQuery({ queryKey: ['admin-cities'], queryFn: citiesApi.listAdminCities });

  const refresh = () => client.invalidateQueries({ queryKey: ['users'] });
  const createMutation = useMutation({
    mutationFn: usersApi.createUser,
    onSuccess: (result) => {
      setCreateOpen(false);
      createForm.resetFields();
      setOneTimeSecret({ title: '一次性临时密码', value: result.temporaryPassword });
      void refresh();
    },
  });
  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: UserStatus }) => usersApi.updateUserStatus(id, { status }),
    onSuccess: () => { message.success('账号状态已更新'); void refresh(); },
  });
  const editMutation = useMutation({
    mutationFn: ({ id, role, cityId }: { id: number; role: Role; cityId?: number }) => usersApi.updateUserRole(id, { role, cityId: role === Role.CITY_USER ? cityId : null }),
    onSuccess: () => { message.success('角色与数据范围已更新，旧令牌已失效'); setEditUser(null); void refresh(); },
  });
  const resetMutation = useMutation({
    mutationFn: usersApi.resetUserPassword,
    onSuccess: (result) => setOneTimeSecret({ title: '一次性临时密码', value: result.temporaryPassword }),
  });

  function openEdit(user: UserListItem) {
    setEditUser(user);
    editForm.setFieldsValue({ role: user.role, cityId: user.cityId ?? undefined });
  }

  const columns = [
    { title: '姓名', dataIndex: 'name', width: 120 },
    { title: '角色', dataIndex: 'role', width: 130, render: (role: string) => <Tag>{roleLabels[role] || role}</Tag> },
    { title: '所属地市', dataIndex: 'cityName', width: 130, render: (value: string | null) => value || '全省范围' },
    { title: '首次改密', dataIndex: 'mustChangePassword', width: 100, render: (value: boolean) => value ? <Tag color="orange">待完成</Tag> : <Tag color="green">已完成</Tag> },
    {
      title: '状态', dataIndex: 'status', width: 100,
      render: (status: UserStatus, user: UserListItem) => (
        <Switch
          checked={status === UserStatus.ENABLED}
          disabled={user.role === Role.ROOT_ADMIN}
          onChange={(checked) => statusMutation.mutate({ id: user.id, status: checked ? UserStatus.ENABLED : UserStatus.DISABLED })}
        />
      ),
    },
    { title: '最后登录', dataIndex: 'lastLoginAt', width: 170, render: (value: string | null) => value ? new Date(value).toLocaleString('zh-CN') : '从未登录' },
    {
      title: '操作', key: 'actions', width: 310,
      render: (_: unknown, user: UserListItem) => user.role === Role.ROOT_ADMIN ? <Typography.Text type="secondary">系统保护账号</Typography.Text> : (
        <Space size={4}>
          <Button size="small" onClick={() => openEdit(user)}>角色与范围</Button>
          <Button size="small" icon={<KeyOutlined />} loading={resetMutation.isPending} onClick={() => resetMutation.mutate(user.id)}>重置密码</Button>
        </Space>
      ),
    },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Space>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>创建账号</Button>
        <Button icon={<ReloadOutlined />} loading={isLoading} onClick={() => void refetch()}>刷新</Button>
      </Space>
      <Table rowKey="id" columns={columns} dataSource={data?.items ?? []} loading={isLoading} scroll={{ x: 1100 }} pagination={{ pageSize: 20, showTotal: (total) => `共 ${total} 个账号` }} />

      <Modal title="创建普通账号" open={createOpen} confirmLoading={createMutation.isPending} onCancel={() => setCreateOpen(false)} onOk={() => void createForm.validateFields().then((values) => createMutation.mutate(values))}>
        <Form form={createForm} layout="vertical">
          <Form.Item name="username" label="用户名" rules={[{ required: true }, { min: 3, max: 100 }]}><Input autoComplete="off" /></Form.Item>
          <Form.Item name="name" label="姓名" rules={[{ required: true }, { max: 100 }]}><Input /></Form.Item>
          <Form.Item name="role" label="角色" rules={[{ required: true }]}><Select options={roleOptions} /></Form.Item>
          <Form.Item noStyle shouldUpdate>{({ getFieldValue }) => getFieldValue('role') === Role.CITY_USER ? (
            <Form.Item name="cityId" label="所属地市" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={cities.filter((item) => !item.isDeleted).map((item) => ({ value: item.id, label: item.name }))} /></Form.Item>
          ) : null}</Form.Item>
        </Form>
      </Modal>

      <Modal title="修改角色与数据范围" open={Boolean(editUser)} confirmLoading={editMutation.isPending} onCancel={() => setEditUser(null)} onOk={() => void editForm.validateFields().then((values) => editUser && editMutation.mutate({ id: editUser.id, ...values }))}>
        <Form form={editForm} layout="vertical">
          <Form.Item name="role" label="角色" rules={[{ required: true }]}><Select options={roleOptions} /></Form.Item>
          <Form.Item noStyle shouldUpdate>{({ getFieldValue }) => getFieldValue('role') === Role.CITY_USER ? (
            <Form.Item name="cityId" label="所属地市" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={cities.filter((item) => !item.isDeleted).map((item) => ({ value: item.id, label: item.name }))} /></Form.Item>
          ) : null}</Form.Item>
        </Form>
      </Modal>

      <Modal title={oneTimeSecret?.title} open={Boolean(oneTimeSecret)} footer={<Button type="primary" onClick={() => setOneTimeSecret(null)}>我已安全保存</Button>} closable={false} maskClosable={false}>
        <Typography.Paragraph type="warning">此内容只展示一次。请通过安全渠道交给目标用户，页面不会再次显示。</Typography.Paragraph>
        <Input value={oneTimeSecret?.value} readOnly addonAfter={<Button type="text" icon={<CopyOutlined />} onClick={() => void navigator.clipboard.writeText(oneTimeSecret?.value || '')} />} />
      </Modal>
    </Space>
  );
}
