import { Alert, Tabs, Typography } from 'antd';
import Users from '@/pages/Users';
import Versions from '@/pages/Versions';

const { Title, Text } = Typography;
export default function AccessControl() {
  return <div><Title level={3} style={{ marginBottom: 0 }}>账号与权限</Title><Text type="secondary">仅 root_admin 可访问，服务端继续复核角色和权限目录。</Text><Alert style={{ marginTop: 16 }} showIcon type="info" message="权限边界" description="账号、角色与数据范围由系统定义目录控制；前端菜单隐藏不构成安全边界。" /><Tabs style={{ marginTop: 12 }} items={[{ key: 'accounts', label: '账号管理', children: <Users /> }, { key: 'audit', label: '权限审计', children: <Versions admin /> }]} /></div>;
}
