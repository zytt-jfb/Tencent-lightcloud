import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Alert, Button, Checkbox, Form, Input } from 'antd';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getMe, loginWithPassword } from '@/api/auth.api';
import { clearToken, getRememberedUsername, getToken, setRememberedUsername, setToken } from '@/utils/auth';
import { resetAuthErrorState } from '@/utils/request';
import { isSupportedRole, resolvePostLoginPath } from '@/auth/role-routing';
import './index.css';

interface LoginFormValues {
  username: string;
  password: string;
  rememberUsername: boolean;
}

function getLoginError(error: unknown): string {
  if (!axios.isAxiosError(error)) return '登录失败，请稍后重试';
  if (!error.response || (error.response.status >= 500 && error.response.status <= 599)) return '认证服务暂时不可用，请稍后重试';
  if ([401, 403].includes(error.response.status)) return '账号或密码错误';
  return '登录失败，请稍后重试';
}

export default function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const rememberedUsername = useMemo(() => getRememberedUsername(), []);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(Boolean(getToken()));
  const [errorMessage, setErrorMessage] = useState<string | null>(() => searchParams.get('reason') === 'unsupported-role' ? '当前账号未配置可用角色，请联系管理员' : null);

  useEffect(() => {
    resetAuthErrorState();
    if (!getToken()) return;
    let active = true;
    void getMe().then((user) => {
      if (!active) return;
      if (user.mustChangePassword) {
        navigate('/admin/settings?required=temporary-password', { replace: true });
        return;
      }
      const target = resolvePostLoginPath(user.role, searchParams.get('redirect'));
      if (!target) {
        clearToken();
        setErrorMessage('当前账号未配置可用角色，请联系管理员');
        return;
      }
      navigate(target, { replace: true });
    }).catch(() => {
      if (active) clearToken();
    }).finally(() => {
      if (active) setRestoring(false);
    });
    return () => { active = false; };
  }, [navigate, searchParams]);

  async function handleFinish(values: LoginFormValues) {
    setLoading(true);
    setErrorMessage(null);
    try {
      const response = await loginWithPassword({ username: values.username.trim(), password: values.password });
      if (!isSupportedRole(response.user.role)) {
        clearToken();
        setErrorMessage('当前账号未配置可用角色，请联系管理员');
        return;
      }
      resetAuthErrorState();
      setToken(response.token);
      setRememberedUsername(values.rememberUsername ? values.username : null);
      if (response.user.mustChangePassword) {
        navigate('/admin/settings?required=temporary-password', { replace: true });
        return;
      }
      const target = resolvePostLoginPath(response.user.role, searchParams.get('redirect'));
      navigate(target || '/login?reason=unsupported-role', { replace: true });
    } catch (error) {
      clearToken();
      setErrorMessage(getLoginError(error));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-page" data-testid="login-page">
      <section className="login-shell" aria-label="经营数据中台登录">
        <div className="login-brand-panel">
          <header className="login-company">
            <img src={`${import.meta.env.BASE_URL}logo.jpg`} alt="中屹技术有限公司" />
            <strong>中屹技术有限公司</strong>
          </header>
          <div className="login-brand-copy">
            <span className="login-brand-kicker">经营协同 · 数据治理</span>
            <h1>中屹技术欢迎您！</h1>
            <p>低调&nbsp;&nbsp;谦逊&nbsp;&nbsp;谨慎&nbsp;&nbsp;务实</p>
          </div>
          <p className="login-trust-note">身份验证与业务权限由系统统一管理</p>
        </div>
        <div className="login-form-panel">
          <header className="login-form-heading">
            <span>经营数据中台</span>
            <h2>登录工作台</h2>
            <p>请输入系统管理员分配的账号和密码</p>
          </header>
          {errorMessage && <Alert className="login-alert" type="error" showIcon message={errorMessage} closable onClose={() => setErrorMessage(null)} />}
          <Form<LoginFormValues>
            name="login"
            layout="vertical"
            requiredMark={false}
            initialValues={{ username: rememberedUsername, password: '', rememberUsername: Boolean(rememberedUsername) }}
            onFinish={handleFinish}
            autoComplete="on"
            disabled={restoring}
          >
            <Form.Item name="username" label="账号" rules={[{ required: true, whitespace: true, message: '请输入账号' }]}>
              <Input prefix={<UserOutlined />} placeholder="请输入账号" autoComplete="username" maxLength={100} />
            </Form.Item>
            <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
              <Input.Password prefix={<LockOutlined />} placeholder="请输入密码" autoComplete="current-password" />
            </Form.Item>
            <Form.Item name="rememberUsername" valuePropName="checked" className="login-remember-row"><Checkbox>记住账号</Checkbox></Form.Item>
            <Button type="primary" htmlType="submit" block loading={loading || restoring} className="login-submit">
              {restoring ? '正在恢复登录状态' : '登录'}
            </Button>
          </Form>
          <p className="login-form-note">仅限获授权人员使用，操作将记录至审计日志</p>
        </div>
      </section>
    </main>
  );
}
