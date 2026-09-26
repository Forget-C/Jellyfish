import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import enUS from 'antd/locale/en_US'
import App from './App.tsx'
import 'antd/dist/reset.css'
import './index.css'
import './i18n'
import './services/openapi'
import { useAppStore } from './store/useAppStore'

const RootApp: React.FC = () => {
  const language = useAppStore((state) => state.language)
  const antdLocale = language === 'en-US' ? enUS : zhCN

  return (
    <ConfigProvider
      locale={antdLocale}
      theme={{
        token: {
          colorPrimary: '#1677ff',
          borderRadius: 6,
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
      /**
       * 三层口径（审计 §5.5-A1 / R26）：主区只给中文结论（标题 + 一句话 + 刷新动作），
       * React 运行时的英文原文（`error.message` / `error.stack`）一律折进默认收起的
       * 「技术详情」，绝不进主区。
       *
       * 这里刻意用原生 `<details>/<summary>` 而不是 antd `Collapse`：本边界在
       * `RootApp` 的 `<ConfigProvider>` **之外**，拿不到 antd 的样式/上下文；
       * 同时也写全内联样式，不依赖 Tailwind 类名一定生效。
       */
      const { message, stack } = this.state.error
      return (
        <div style={{ padding: 24, fontFamily: 'sans-serif', lineHeight: 1.7 }}>
          <h2 style={{ margin: '0 0 12px', fontSize: 20, color: 'rgba(0, 0, 0, 0.88)' }}>页面出错了</h2>
          {/* 标题 + 这一句连起来读就是审计 §5.5-A1 的口径：「页面出错了，请刷新重试；若仍不行请回到项目列表重新进入」 */}
          <p style={{ margin: '0 0 16px', fontSize: 14, color: 'rgba(0, 0, 0, 0.65)' }}>
            请刷新重试；若仍不行请回到项目列表重新进入
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              padding: '4px 16px',
              fontSize: 14,
              color: '#ffffff',
              background: '#1677ff',
              border: '1px solid #1677ff',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            刷新
          </button>
          <details style={{ marginTop: 16 }}>
            <summary style={{ cursor: 'pointer', fontSize: 13, color: 'rgba(0, 0, 0, 0.65)' }}>
              技术详情（默认收起）
            </summary>
            <pre
              style={{
                margin: '8px 0 0',
                padding: 12,
                fontSize: 12,
                lineHeight: 1.5,
                color: 'rgba(0, 0, 0, 0.65)',
                background: 'rgba(0, 0, 0, 0.04)',
                borderRadius: 6,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
              }}
            >
              {stack ? `${message}\n\n${stack}` : message}
            </pre>
          </details>
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

// 先立即渲染，避免 MSW 启动阻塞导致白屏
renderApp()

async function enableMocking() {
  if (import.meta.env.VITE_USE_MOCK !== 'true') {
    return
  }
  try {
    const { worker } = await import('./mocks/browser')
    await worker.start({ onUnhandledRequest: 'bypass' })
  } catch (error) {
    console.error('MSW start failed:', error)
  }
}

void enableMocking()

