import React from 'react';
import ReactDOM from 'react-dom/client';
import { App as AntdApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import './App.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 },
  },
});

async function bootstrap() {
  if (import.meta.env.DEV && import.meta.env.VITE_ENABLE_MSW === 'true') {
    const { worker } = await import('./mocks/browser');
    await worker.start({ onUnhandledRequest: 'bypass' });
    console.log('[MSW] Mock Service Worker 已启动');
  }

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <ConfigProvider
          locale={zhCN}
          theme={{
            token: {
              colorPrimary: '#2f9e62', colorInfo: '#2878b8', colorSuccess: '#2f9e62', colorWarning: '#c47b20', colorError: '#c64b4b',
              colorText: '#293238', colorTextSecondary: '#68737b',               colorBorder: '#dfe4e7', colorBgLayout: '#f6f8f9',
              borderRadius: 4, borderRadiusLG: 6, fontFamily: "Inter, 'Segoe UI', 'Microsoft YaHei', Arial, sans-serif",
            },
            components: {
              Button: { controlHeight: 34 },
              Card: { headerHeight: 44, bodyPadding: 16 },
              Table: { cellPaddingBlock: 10, cellPaddingInline: 12, headerBg: '#f7f9fa' },
            },
          }}
        >
          <AntdApp>
            <App />
          </AntdApp>
        </ConfigProvider>
      </QueryClientProvider>
    </React.StrictMode>,
  );
}

void bootstrap();
