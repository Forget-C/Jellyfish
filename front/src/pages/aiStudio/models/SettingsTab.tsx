import { useEffect, useRef, useState } from 'react'
import { Alert, Button, ConfigProvider, Form, InputNumber, Select, Skeleton } from 'antd'
import { WorkspaceScrollPanel } from '../../../components'
import { LlmService } from '../../../services/generated/services/LlmService'
import type { ModelSettingsRead, ModelSettingsUpdate } from '../../../services/generated'
import './runtime-settings.css'

type RuntimeValues = Pick<ModelSettingsUpdate, 'api_timeout' | 'log_level'>
type SettingsState =
  | { status: 'loading' | 'error' }
  | { status: 'loaded'; settings: ModelSettingsRead }

const runtimeTheme = { token: { controlHeight: 36 } }

export default function SettingsTab({ onOpenModels }: { onOpenModels: () => void }) {
  const [state, setState] = useState<SettingsState>({ status: 'loading' })
  const [retryCount, setRetryCount] = useState(0)
  const [saving, setSaving] = useState(false)
  const [saveFeedback, setSaveFeedback] = useState<'success' | 'error' | null>(null)
  const saveInFlight = useRef(false)
  const [form] = Form.useForm<RuntimeValues>()

  useEffect(() => {
    let active = true
    const request = LlmService.getModelSettingsApiV1LlmModelSettingsGet()
    void request.then(response => {
      if (!active) return
      if (!response.data || (response.code !== undefined && response.code >= 400)) {
        setState({ status: 'error' })
        return
      }
      setState({ status: 'loaded', settings: response.data })
    }).catch(() => {
      if (active) setState({ status: 'error' })
    })
    return () => {
      active = false
      request.cancel()
    }
  }, [retryCount])

  const save = async (values: RuntimeValues) => {
    if (state.status !== 'loaded' || saveInFlight.current) return
    saveInFlight.current = true
    setSaving(true)
    setSaveFeedback(null)
    try {
      const response = await LlmService.updateModelSettingsApiV1LlmModelSettingsPut({
        requestBody: { api_timeout: values.api_timeout, log_level: values.log_level },
      })
      if (!response.data || (response.code !== undefined && response.code >= 400)) {
        setSaveFeedback('error')
        return
      }
      form.setFieldsValue({
        api_timeout: response.data.api_timeout ?? values.api_timeout,
        log_level: response.data.log_level ?? values.log_level,
      })
      setSaveFeedback('success')
    } catch {
      setSaveFeedback('error')
    } finally {
      saveInFlight.current = false
      setSaving(false)
    }
  }

  return (
    <WorkspaceScrollPanel className="management-panel">
      <section className="management-surface runtime-settings" aria-label="模型运行设置">
        <div className="runtime-settings-note">
          <span>此处配置全局运行参数，默认模型在模型页维护。</span>
          <Button type="link" size="small" onClick={onOpenModels}>前往模型页</Button>
        </div>
        {state.status === 'loading' && (
          <div role="status" aria-label="正在读取运行设置"><Skeleton active paragraph={{ rows: 2 }} /></div>
        )}
        {state.status === 'error' && (
          <Alert
            type="error"
            showIcon
            message="读取运行设置失败"
            action={<Button size="small" onClick={() => {
              setState({ status: 'loading' })
              setRetryCount(count => count + 1)
            }}>重试</Button>}
          />
        )}
        {state.status === 'loaded' && (
          <ConfigProvider theme={runtimeTheme}>
            <Form<RuntimeValues>
              aria-label="运行参数"
              className="runtime-settings-form"
              form={form}
              layout="vertical"
              initialValues={state.settings}
              disabled={saving}
              onFinish={save}
              onValuesChange={() => setSaveFeedback(null)}
            >
              <Form.Item
                name="api_timeout"
                label="API 超时（秒）"
                rules={[{ type: 'integer', required: true, min: 5, max: 300, message: '请输入 5 至 300 之间的整数秒数' }]}
              >
                <InputNumber min={5} max={300} placeholder="未知，请填写" />
              </Form.Item>
              <Form.Item
                name="log_level"
                label="日志级别"
                rules={[{ required: true, message: '请选择日志级别' }]}
              >
                <Select
                  placeholder="未知，请选择"
                  options={[
                    { label: 'Debug', value: 'debug' },
                    { label: 'Info', value: 'info' },
                    { label: 'Warn', value: 'warn' },
                    { label: 'Error', value: 'error' },
                  ]}
                />
              </Form.Item>
              <div className="runtime-settings-actions">
                <Button type="primary" htmlType="submit" loading={saving}>保存设置</Button>
                {saveFeedback === 'success' && <span role="status">设置已保存</span>}
                {saveFeedback === 'error' && <span role="alert">保存运行设置失败，输入已保留，请重试。</span>}
              </div>
            </Form>
          </ConfigProvider>
        )}
      </section>
    </WorkspaceScrollPanel>
  )
}
