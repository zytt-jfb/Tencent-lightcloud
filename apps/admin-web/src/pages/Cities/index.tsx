import { useEffect, useState } from 'react';
import { Button, Form, Input, InputNumber, Modal, Popconfirm, Space, Table, Tag, Typography, message } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import * as citiesApi from '@/api/cities.api';

interface CityFormValues {
  name: string;
  code?: string;
  sortOrder?: number;
}

export default function Cities() {
  const [items, setItems] = useState<citiesApi.AdminCityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<citiesApi.AdminCityItem | null>(null);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<CityFormValues>();

  async function load() {
    setLoading(true);
    try {
      setItems(await citiesApi.listAdminCities());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  function openCreate() {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ sortOrder: 0 });
    setOpen(true);
  }

  function openEdit(item: citiesApi.AdminCityItem) {
    setEditing(item);
    form.setFieldsValue({ name: item.name, code: item.code ?? undefined, sortOrder: item.sortOrder });
    setOpen(true);
  }

  async function submit() {
    const values = await form.validateFields();
    if (editing) await citiesApi.updateCity(editing.id, values);
    else await citiesApi.createCity(values);
    message.success(editing ? '地市已更新' : '地市已创建');
    setOpen(false);
    await load();
  }

  async function remove(cityId: number) {
    await citiesApi.softDeleteCity(cityId);
    message.success('地市已软删除');
    await load();
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <div><Typography.Title level={3} style={{ margin: 0 }}>地市管理</Typography.Title><Typography.Text type="secondary">地市删除可恢复，历史数据不会被物理删除。</Typography.Text></div>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增地市</Button>
      </div>
      <Table
        rowKey="id"
        loading={loading}
        dataSource={items}
        columns={[
          { title: '名称', dataIndex: 'name' },
          { title: '编码', dataIndex: 'code', render: (value: string | null) => value || '-' },
          { title: '排序', dataIndex: 'sortOrder', width: 100 },
          { title: '状态', dataIndex: 'isDeleted', render: (deleted: boolean) => <Tag color={deleted ? 'default' : 'green'}>{deleted ? '已删除' : '启用'}</Tag> },
          { title: '操作', width: 180, render: (_: unknown, record: citiesApi.AdminCityItem) => <Space><Button icon={<EditOutlined />} onClick={() => openEdit(record)} disabled={record.isDeleted}>编辑</Button><Popconfirm title="确认软删除这个地市？" onConfirm={() => void remove(record.id)}><Button danger icon={<DeleteOutlined />} disabled={record.isDeleted}>删除</Button></Popconfirm></Space> },
        ]}
      />
      <Modal title={editing ? '编辑地市' : '新增地市'} open={open} onCancel={() => setOpen(false)} onOk={() => void submit()}>
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="地市名称" rules={[{ required: true, message: '请输入地市名称' }]}><Input /></Form.Item>
          <Form.Item name="code" label="地市编码"><Input /></Form.Item>
          <Form.Item name="sortOrder" label="排序"><InputNumber min={0} precision={0} style={{ width: '100%' }} /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
