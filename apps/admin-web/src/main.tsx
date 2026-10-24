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
              // 白 + Apple 风：纯白底、Apple 蓝强调、中性石墨灰、发丝分隔线、大圆角、SF/PingFang 字体栈
              colorPrimary: '#0071e3', colorInfo: '#0071e3',
              colorSuccess: '#34c759', colorWarning: '#ff9f0a', colorError: '#ff3b30',
              colorText: '#1d1d1f', colorTextSecondary: '#86868b', colorTextTertiary: '#a1a1a6',
              colorBorder: '#e3e3e8', colorBorderSecondary: '#ececf0', colorBgLayout: '#ffffff',
              colorBgContainer: '#ffffff', colorBgElevated: '#ffffff',
              borderRadius: 8, borderRadiusLG: 12,
              fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', 'Noto Sans SC', 'Microsoft YaHei', Arial, sans-serif",
            },
            components: {
              Button: { controlHeight: 36 },
              Card: { headerHeight: 48, bodyPadding: 20 },
              Table: { cellPaddingBlock: 12, cellPaddingInline: 16, headerBg: '#f5f5f7', headerColor: '#6e6e73', headerSplitColor: '#e3e3e8', borderColor: '#ececf0' },
              Layout: { siderBg: '#fbfbfd', headerBg: '#ffffff', bodyBg: '#ffffff', triggerBg: '#ffffff', triggerColor: '#86868b' },
              Menu: { itemBg: '#fbfbfd', itemSelectedBg: '#e8f1fe', itemSelectedColor: '#0071e3', itemHoverBg: '#f5f5f7', itemHeight: 40, itemMarginInline: 4, itemBorderRadius: 8 },
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
