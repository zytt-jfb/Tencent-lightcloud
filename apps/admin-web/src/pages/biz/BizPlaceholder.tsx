import { useEffect, useState } from 'react';
import { Button, Result, Spin, Typography } from 'antd';
import { useNavigate, useParams } from 'react-router-dom';
import { bizPlaceholder } from '@/api/biz.api';

const { Title } = Typography;

const MODULE_NAME: Record<string, string> = {
  engineering: '工程管理',
  asset: '资产管理',
  personnel: '人员管理',
};

/** 建设中占位页（新基线）：不读取任何经营管理数据 */
export default function BizPlaceholder() {
  const { code = '' } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [accessible, setAccessible] = useState(false);
  const [found, setFound] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const result = await bizPlaceholder(code);
        setAccessible(Boolean(result.accessible));
        setFound(result.found);
      } finally {
        setLoading(false);
      }
    })();
  }, [code]);

  if (loading) return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><Spin /></div>;

  if (!found) {
    return (
      <Result
        status="404"
        title="未知模块"
        subTitle="该模块不存在。"
        extra={<Button type="primary" onClick={() => navigate('/biz/portal')}>返回门户</Button>}
      />
    );
  }

  if (!accessible) {
    return (
      <Result
        status="403"
        title="无权限访问"
        subTitle={`当前账号无权进入「${MODULE_NAME[code] ?? code}」模块。`}
        extra={<Button type="primary" onClick={() => navigate('/biz/portal')}>返回门户</Button>}
      />
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#F5F7F8', padding: 48 }}>
      <Title level={3}>{MODULE_NAME[code] ?? code}</Title>
      <div style={{ background: '#FFFFFF', border: '1px solid #D8DEE3', borderRadius: 4, padding: 48, textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🚧</div>
        <div style={{ fontSize: 18, color: '#173A53', marginBottom: 8 }}>「{MODULE_NAME[code] ?? code}」建设中</div>
        <div style={{ color: '#68737B', marginBottom: 24 }}>本模块为首发占位模块，不承载经营管理数据。</div>
        <Button onClick={() => navigate('/biz/portal')}>返回门户</Button>
      </div>
    </div>
  );
}
