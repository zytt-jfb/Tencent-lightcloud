import { Alert, Button, Card, Descriptions, Form, Input, Tag, message } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { changeOwnPassword } from '@/api/auth.api';
import { isAdminRole } from '@/auth/role-routing';
import { clearToken } from '@/utils/auth';
import type { CurrentUser } from '@/types';

interface PasswordForm {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export default function Settings({ currentUser }: { currentUser: CurrentUser }) {
  const [form] = Form.useForm<PasswordForm>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const required = currentUser.mustChangePassword || searchParams.get('required') === 'temporary-password';
  const admin = isAdminRole(currentUser.role);

  async function submit(values: PasswordForm) {
    if (values.newPassword !== values.confirmPassword) {
      form.setFields([{ name: 'confirmPassword', errors: ['两次输入的新密码不一致'] }]);
      return;
    }
    await changeOwnPassword(values);
    clearToken();
    message.success('密码已修改，请使用新密码重新登录');
    navigate('/login?reason=password-changed', { replace: true });
  }

  return (
    <div className="v3-page-stack">
      <header className="v3-page-head"><div><div className="v3-eyebrow">安全与运行规则</div><h1>{admin ? '系统设置' : '用户设置'}</h1><span className="v3-page-description">查看当前账号、安全状态与系统现行运行规则。</span></div><Tag color="success">账号正常</Tag></header>
      {required && <Alert type="warning" showIcon message="首次登录必须修改临时密码" description="修改完成后当前会话将退出，旧密码与所有旧令牌立即失效。" />}
      <div className="v3-settings-grid">
        <Card size="small" title="账号信息">
          <Descriptions size="small" column={1} items={[
            { key: 'name', label: '姓名', children: currentUser.name },
            { key: 'role', label: '角色', children: currentUser.role },
            { key: 'city', label: '所属地市', children: currentUser.cityName || '全省范围' },
            { key: 'status', label: '账号状态', children: <Tag color="success">正常</Tag> },
          ]} />
        </Card>
        {admin && <Card size="small" title="现行运行策略">
          <Descriptions size="small" column={1} items={[
            { key: 'import', label: '数据接入', children: '校验通过后自动生效' },
            { key: 'warning', label: '非阻塞警告', children: '保留证据并进入有效版本' },
            { key: 'conflict', label: '并发修改', children: '版本号校验，冲突返回 409' },
            { key: 'audit', label: '审计留痕', children: '导入、编辑、冲销、导出全量记录' },
          ]} />
        </Card>}
        <Card size="small" title="修改密码" className="v3-password-card">
          <Form form={form} layout="vertical" onFinish={(values) => void submit(values)} requiredMark={false}>
            <Form.Item name="currentPassword" label="原密码" rules={[{ required: true, message: '请输入原密码' }]}><Input.Password prefix={<LockOutlined />} autoComplete="current-password" /></Form.Item>
            <Form.Item name="newPassword" label="新密码" rules={[{ required: true, message: '请输入新密码' }, { min: 8, max: 128, message: '密码长度必须为 8-128 位' }]}><Input.Password prefix={<LockOutlined />} autoComplete="new-password" /></Form.Item>
            <Form.Item name="confirmPassword" label="确认新密码" rules={[{ required: true, message: '请再次输入新密码' }]}><Input.Password prefix={<LockOutlined />} autoComplete="new-password" /></Form.Item>
            <Button type="primary" htmlType="submit">修改密码并退出</Button>
          </Form>
        </Card>
      </div>
    </div>
  );
}
