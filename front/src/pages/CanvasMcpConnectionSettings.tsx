import { useEffect, useState } from 'react'
import { Alert, Button, Form, Input, Space } from 'antd'
import { useTranslation } from 'react-i18next'
import { CanvasMcpService, OpenAPI } from '../services/generated'
import type { CanvasMcpConnection } from '../services/generated'

export function CanvasMcpConnectionSettings() {
  const { t, i18n } = useTranslation('settings')
  const [expiresAt, setExpiresAt] = useState<string | null>()
  const [statusAttempt, setStatusAttempt] = useState(0)
  const [connection, setConnection] = useState<CanvasMcpConnection | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    const request = CanvasMcpService.canvasMcpConnectionStatus()
    let active = true
    void request.then(result => {
      if (!result.data) throw new Error('Missing MCP connection status')
      if (active) setExpiresAt(result.data.expires_at)
    }).catch(() => {
      if (active) setError(true)
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => {
      active = false
      request.cancel()
    }
  }, [statusAttempt])

  useEffect(() => {
    if (!expiresAt) return
    const timer = window.setTimeout(() => {
      setExpiresAt(null)
      setConnection(null)
    }, Math.max(0, Date.parse(expiresAt) - Date.now()))
    return () => window.clearTimeout(timer)
  }, [expiresAt])

  const updateConnection = async () => {
    setLoading(true)
    setError(false)
    try {
      if (expiresAt) {
        await CanvasMcpService.canvasMcpCloseConnection()
        setExpiresAt(null)
        setConnection(null)
      } else {
        const { data } = await CanvasMcpService.canvasMcpOpenConnection()
        if (!data?.expires_at) throw new Error('Missing MCP connection expiry')
        setExpiresAt(data.expires_at)
        setConnection(data)
      }
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  const retryStatus = () => {
    setLoading(true)
    setError(false)
    setStatusAttempt(attempt => attempt + 1)
  }

  const statusUnknown = expiresAt === undefined
  const address = connection
    ? new URL(
      OpenAPI.BASE.replace(/\/+$/, '') + (connection.path ?? '/mcp'),
      window.location.origin,
    ).href
    : ''
  return (
    <section aria-labelledby="canvas-mcp-heading" className="app-settings-form">
      <h2 id="canvas-mcp-heading">{t('mcp.title')}</h2>
      <Space orientation="vertical" size="middle" style={{ display: 'flex' }}>
        {expiresAt && (
          <p role="status">
            {t('mcp.expiresAt', { date: new Date(expiresAt).toLocaleString(i18n.resolvedLanguage) })}
          </p>
        )}
        {error && <Alert type="error" message={t(statusUnknown ? 'mcp.statusError' : 'mcp.error')} />}
        {connection && (
          <Form layout="vertical">
            <Form.Item label={t('mcp.address')} htmlFor="canvas-mcp-address">
              <Input id="canvas-mcp-address" value={address} readOnly onFocus={event => event.currentTarget.select()} />
            </Form.Item>
            <Form.Item label={t('mcp.credential')} htmlFor="canvas-mcp-credential" extra={t('mcp.bearer')}>
              <Input id="canvas-mcp-credential" value={connection.credential} readOnly autoComplete="off"
                onFocus={event => event.currentTarget.select()} />
            </Form.Item>
          </Form>
        )}
        {statusUnknown
          ? <Button loading={loading} onClick={retryStatus}>{t('mcp.retryStatus')}</Button>
          : (
            <Button type={expiresAt ? 'default' : 'primary'} loading={loading} onClick={() => void updateConnection()}>
              {t(expiresAt ? 'mcp.close' : 'mcp.open')}
            </Button>
          )}
      </Space>
    </section>
  )
}
