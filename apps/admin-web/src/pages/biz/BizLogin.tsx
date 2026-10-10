import { useMemo, useState } from 'react';
import { Alert, Button, Checkbox, Form, Input, Typography } from 'antd';
import { LockOutlined, LoginOutlined, SafetyOutlined, UserOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { bizLogin } from '@/api/biz.api';
import { setBizToken } from '@/utils/biz-auth';
import { clearBizPermissionCache } from '@/utils/biz-permission';
import './BizLogin.css';

const { Title, Text } = Typography;
const REMEMBERED_USERNAME_KEY = 'biz-login-remembered-username';

interface LoginValues {
  username: string;
  password: string;
  rememberUsername?: boolean;
}

function readRememberedUsername(): string {
  try {
    return localStorage.getItem(REMEMBERED_USERNAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export default function BizLogin() {
  const navigate = useNavigate();
  const rememberedUsername = useMemo(readRememberedUsername, []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFinish = async (values: LoginValues) => {
    setLoading(true);
    setError(null);
    try {
      const username = values.username.trim();
      const result = await bizLogin(username, values.password);
      setBizToken(result.accessToken);
      clearBizPermissionCache();
      try {
        if (values.rememberUsername) localStorage.setItem(REMEMBERED_USERNAME_KEY, username);
        else localStorage.removeItem(REMEMBERED_USERNAME_KEY);
      } catch {
        // Storage may be disabled in a private browser window; login still succeeds.
      }
      navigate('/biz/portal', { replace: true });
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
      setError(Array.isArray(detail) ? detail.join('；') : (detail ?? '登录失败，请检查账号和密码'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="biz-login-page">
      <section className="biz-login-shell" aria-label="经营数据中台登录">
        <div className="biz-login-brand">
          <div className="biz-login-brand-lockup">
            <span className="biz-login-logo"><img src={`${import.meta.env.BASE_URL}logo.jpg`} alt="中屹技术有限公司" /></span>
            <div className="biz-login-company">
              <strong>中屹技术有限公司</strong>
            </div>
          </div>
          <div className="biz-login-product-copy">
            <span className="biz-login-eyebrow">经营协同 · 数据治理</span>
            <Title level={1}>中屹技术有限公司欢迎您！</Title>
            <Text>低调 · 谦逊 · 谨慎 · 务实</Text>
          </div>
        </div>

        <div className="biz-login-form-panel">
          <header className="biz-login-form-heading">
            <Title level={2}>登录工作台</Title>
            <Text>请输入系统管理员分配的账号和密码</Text>
          </header>
          {error && <Alert className="biz-login-alert" type="error" showIcon message={error} closable onClose={() => setError(null)} />}
          <Form<LoginValues>
            layout="vertical"
            requiredMark={false}
            initialValues={{ username: rememberedUsername, rememberUsername: Boolean(rememberedUsername) }}
            onFinish={onFinish}
            disabled={loading}
            autoComplete="on"
          >
            <Form.Item name="username" label="账号" rules={[{ required: true, whitespace: true, message: '请输入账号' }]}>
              <Input data-testid="biz-login-username" prefix={<UserOutlined />} placeholder="请输入用户名" autoComplete="username" maxLength={80} />
            </Form.Item>
            <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
              <Input.Password data-testid="biz-login-password" prefix={<LockOutlined />} placeholder="请输入密码" autoComplete="current-password" />
            </Form.Item>
            <div className="biz-login-options">
              <Form.Item name="rememberUsername" valuePropName="checked" className="biz-login-remember">
                <Checkbox>记住账号</Checkbox>
              </Form.Item>
              <Text>仅保存用户名</Text>
            </div>
            <Button data-testid="biz-login-submit" className="biz-login-submit" type="primary" htmlType="submit" block loading={loading} icon={<LoginOutlined />}>
              登录
            </Button>
          </Form>
          <p className="biz-login-boundary">当前支持系统管理员与地市用户账号。账号创建、停用与密码重置由系统管理员统一处理。</p>
          <div className="biz-login-security"><SafetyOutlined /><span>身份验证与业务权限由系统统一管理</span></div>
        </div>
      </section>
      <footer className="biz-login-footer">中屹技术有限公司 · 内部业务系统</footer>
    </main>
  );
}
