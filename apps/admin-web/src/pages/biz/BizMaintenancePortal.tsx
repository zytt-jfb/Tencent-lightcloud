import { useEffect, useState } from 'react';
import { Button, Card, Empty, Result, Spin, Typography } from 'antd';
import axios from 'axios';
import { ApartmentOutlined, BarChartOutlined, TeamOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { bizMe, bizPortalModules, type BizModuleItem } from '@/api/biz.api';
import { clearBizToken } from '@/utils/biz-auth';
import { clearBizPermissionCache } from '@/utils/biz-permission';

const { Title, Text } = Typography;

const MODULE_ICON: Record<string, React.ReactNode> = {
  operation: <BarChartOutlined style={{ fontSize: 28 }} />,
  asset: <ApartmentOutlined style={{ fontSize: 28 }} />,
  personnel: <TeamOutlined style={{ fontSize: 28 }} />,
};

/** 维护管理二级门户：经营管理已提升为一级门户，此处只保留其他二级模块。 */
export default function BizMaintenancePortal() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [modules, setModules] = useState<BizModuleItem[]>([]);
  const [userName, setUserName] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [me, data] = await Promise.all([bizMe(), bizPortalModules()]);
        setUserName(me.username);
        setModules(data.level2.filter((m) => m.code !== 'operation'));
        setLoading(false);
      } catch (error: unknown) {
        const status = axios.isAxiosError(error) ? error.response?.status : undefined;
        if (status === 401) {
          clearBizToken();
          clearBizPermissionCache();
          setError('登录已失效，请重新登录');
        } else if (status === 403) {
          setError('当前账号没有访问维护门户的权限，请联系管理员配置角色权限');
        } else {
          const detail = axios.isAxiosError(error)
            ? String(error.response?.data?.message ?? error.message ?? '')
            : '';
          setError(detail ? `门户加载失败：${detail}` : '门户加载失败，请稍后重试');
        }
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><Spin /></div>;
  if (error) return (
    <Result status="403" title={error} extra={<Button type="primary" onClick={() => { clearBizToken(); clearBizPermissionCache(); navigate('/biz/login'); }}>返回登录</Button>} />
  );

  return (
    <div className="v3-portal">
      <div className="v3-page-head">
        <div className="v3-page-titles">
          <Title level={3} style={{ margin: 0 }}>维护管理</Title>
        </div>
        <div className="v3-page-head-actions">
          <Button onClick={() => navigate('/biz/portal')}>返回一级门户</Button>
        </div>
      </div>
      {modules.length === 0 ? (
        <Empty description="当前账号无任何二级模块权限" />
      ) : (
        <div className="v3-portal-grid">
          {modules.map((m) => (
            <Card
              key={m.code}
              hoverable
              onClick={() => navigate(m.code === 'personnel' || m.code === 'asset' ? '/biz/maintenance/records' : `/biz/placeholder/${m.code}`)}
              style={{ textAlign: 'center', padding: 16 }}
            >
              <div className="biz-module-icon" style={{ marginBottom: 8 }}>{MODULE_ICON[m.code] ?? null}</div>
              <div className="biz-module-title">{m.name}</div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
