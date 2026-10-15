import { Navigate, useLocation } from 'react-router-dom';
import { isAuthenticated } from '@/utils/auth';
import { getBizToken } from '@/utils/biz-auth';

interface AuthGuardProps {
  children: React.ReactNode;
}

export default function AuthGuard({ children }: AuthGuardProps) {
  const location = useLocation();

  const isBizRoute = location.pathname === '/biz' || location.pathname.startsWith('/biz/');
  const authenticated = isBizRoute ? Boolean(getBizToken()) : isAuthenticated();

  if (!authenticated) {
    const originalPath = `${location.pathname}${location.search}`;
    return (
      <Navigate
        to={`${isBizRoute ? '/biz/login' : '/login'}?redirect=${encodeURIComponent(originalPath)}`}
        replace
      />
    );
  }

  return <>{children}</>;
}
