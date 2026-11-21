import { uiText } from './uiText'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import enUS from 'antd/locale/en_US'
import App from './App.tsx'
import 'antd/dist/reset.css'
import './index.css'
import './i18n'
import { initOpenAPI } from './services/openapi'
import { useTranslation } from 'react-i18next'

const RootApp: React.FC = () => {
  const { i18n } = useTranslation()
  const antdLocale = i18n.resolvedLanguage === 'en-US' ? enUS : zhCN

  return (
    <ConfigProvider
      locale={antdLocale}
      theme={{
        token: {
          colorPrimary: '#1677ff',
          borderRadius: 6,
          colorBgLayout: '#f7f9fc',
          colorBgContainer: '#ffffff',
          colorText: '#1f2937',
          colorTextSecondary: '#667085',
          colorBorderSecondary: '#e5eaf0',
          colorPrimaryBg: '#eaf3ff',
          controlHeight: 32,
          fontSize: 14,
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        },
      }}
    >
      <App />
    </ConfigProvider>
  )
}

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  state = { hasError: false, error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }

  render() {
    if (this.state.hasError && this.state.error) {
      return (
        <div style={{ padding: 24, fontFamily: 'sans-serif' }}>
          <h2>{uiText("页面加载出错")}</h2>
          <pre style={{ color: '#c00', overflow: 'auto' }}>
            {this.state.error.message}
          </pre>
        </div>
      )
    }
    return this.props.children
  }
}

function renderApp() {
  const root = document.getElementById('root')
  if (!root) return
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <AppErrorBoundary>
        <RootApp />
      </AppErrorBoundary>
    </React.StrictMode>,
  )
}

async function startMockApp() {
  initOpenAPI()
  try {
    const { worker } = await import('./mocks/browser')
    await worker.start({ onUnhandledRequest: 'bypass' })
  } catch (error) {
    console.error('MSW start failed:', error)
  }
  renderApp()
}

// 演示模式等待拦截器就绪，让首个项目读取与后续保存使用同一份演示数据。
if (import.meta.env.VITE_USE_MOCK === 'true') void startMockApp()
else renderApp()
