import { useEffect, useState } from 'react';
import { Button, Card, Empty, Result, Spin, Typography } from 'antd';
import axios from 'axios';
import { ApartmentOutlined, BarChartOutlined, SettingOutlined, ToolOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { bizMe, bizPortalModules, type BizModuleItem } from '@/api/biz.api';
import { clearBizToken } from '@/utils/biz-auth';
import { clearBizPermissionCache } from '@/utils/biz-permission';

const { Title, Text } = Typography;

const MODULE_ICON: Record<string, React.ReactNode> = {
  engineering: <ToolOutlined style={{ fontSize: 28 }} />,
  maintenance: <ApartmentOutlined style={{ fontSize: 28 }} />,
  operation: <BarChartOutlined style={{ fontSize: 28 }} />,
  system: <SettingOutlined style={{ fontSize: 28 }} />,
};

/** 一级模块门户（新基线）：登录后始终进入；只展示有权模块 */
export default function BizPortal() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [modules, setModules] = useState<BizModuleItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [, data] = await Promise.all([bizMe(), bizPortalModules()]);
        const operation = data.level2.find((module) => module.code === 'operation');
        const level1 = operation && !data.level1.some((module) => module.code === operation.code)
          ? [...data.level1, { ...operation, level: 'level1', parentId: null }]
          : data.level1;
        // 经营管理排在第一行最后（系统设置仍保持末位）
        const rank = (code: string) => (code === 'operation' ? 1 : code === 'system' ? 2 : 0);
        level1.sort((a, b) => rank(a.code) - rank(b.code));
        setModules(level1);
        setLoading(false);
      } catch (error: unknown) {
        const status = axios.isAxiosError(error) ? error.response?.status : undefined;
        if (status === 401) {
          clearBizToken();
          clearBizPermissionCache();
          setError('登录已失效，请重新登录');
        } else if (status === 403) {
          setError('当前账号没有访问门户的权限，请联系管理员配置角色权限');
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
          <Title level={3} style={{ margin: 0 }}>一级模块门户</Title>
        </div>
        <div className="v3-page-head-actions">
          <Button onClick={() => { clearBizToken(); clearBizPermissionCache(); navigate('/biz/login'); }}>退出登录</Button>
        </div>
      </div>
      {modules.length === 0 ? (
        <Empty description="当前账号无任何一级门户入口权限">
          <Text type="secondary">请在“权限管理 → 模块权限”中先启用“一级门户入口”的“可进入/查看”，再按需配置二级门户和业务功能权限。</Text>
        </Empty>
      ) : (
        <div className="v3-portal-grid">
          {modules.map((m) => (
            <Card
              key={m.code}
              hoverable
              onClick={() => navigate(m.code === 'system' ? '/biz/system' : m.code === 'maintenance' ? '/biz/maintenance' : m.code === 'operation' ? '/biz/operation' : m.code === 'engineering' ? '/biz/engineering/assessment' : `/biz/placeholder/${m.code}`)}
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
