import { useEffect, useState } from 'react'
import { Alert, Card, Form, Select, InputNumber, Button, message } from 'antd'
import { LlmService } from '../../../services/generated/services/LlmService'
import type { ModelSettingsRead } from '../../../services/generated'

export default function SettingsTab() {
  const [settings, setSettings] = useState<ModelSettingsRead | null>(null)
  const [loading, setLoading] = useState(true)
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [form] = Form.useForm()

  const load = async () => {
    setLoading(true)
    try {
      const settRes = await LlmService.getModelSettingsApiV1LlmModelSettingsGet()
      setSettings(settRes.data ?? null)
    } catch {
      message.error('加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  useEffect(() => {
    if (settings) {
      form.setFieldsValue({
        api_timeout: settings.api_timeout,
        log_level: settings.log_level,
      })
    }
  }, [settings, form])

  const handleSaveSettings = async () => {
    try {
      const values = await form.validateFields()
      setSettingsSaving(true)
      await LlmService.updateModelSettingsApiV1LlmModelSettingsPut({
        requestBody: {
          api_timeout: values.api_timeout,
          log_level: values.log_level,
        },
      })
      message.success('设置已保存')
      void load()
    } catch {
      message.error('保存失败')
    } finally {
      setSettingsSaving(false)
    }
  }

  return (
    <div className="flex-1 overflow-auto p-6 bg-gray-50">
      <Card title="运行设置" className="max-w-2xl" loading={loading}>
        <Alert
          type="info"
          showIcon
          className="mb-4"
          message="默认模型已在“模型”页统一维护；此处仅配置全局运行参数。"
        />
        <Form form={form} layout="vertical" onFinish={handleSaveSettings}>
          <Form.Item name="api_timeout" label="API 超时（秒）">
            <InputNumber min={5} max={300} className="w-full" />
          </Form.Item>
          <Form.Item name="log_level" label="日志级别">
            <Select
              options={[
                { label: 'Debug', value: 'debug' },
                { label: 'Info', value: 'info' },
                { label: 'Warn', value: 'warn' },
                { label: 'Error', value: 'error' },
              ]}
            />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={settingsSaving}>
            保存设置
          </Button>
        </Form>
      </Card>
    </div>
  )
}
