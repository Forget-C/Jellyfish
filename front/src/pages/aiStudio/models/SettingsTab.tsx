import { useEffect, useState } from 'react'
import { Alert, Card, Form, Select, InputNumber, Button, message } from 'antd'
import { LlmService } from '../../../services/generated/services/LlmService'
import type { ModelRead, ModelSettingsRead } from '../../../services/generated'

export default function SettingsTab() {
  const [settings, setSettings] = useState<ModelSettingsRead | null>(null)
  const [models, setModels] = useState<ModelRead[]>([])
  const [loading, setLoading] = useState(true)
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [form] = Form.useForm()

  const load = async () => {
    setLoading(true)
    try {
      const [settRes, modelsRes] = await Promise.all([
        LlmService.getModelSettingsApiV1LlmModelSettingsGet(),
        LlmService.listModelsApiV1LlmModelsGet({ page: 1, pageSize: 100 }),
      ])
      setSettings(settRes.data ?? null)
      setModels(modelsRes.data?.items ?? [])
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
        default_text_model_id: settings.default_text_model_id,
        fallback_text_model_id: settings.fallback_text_model_id,
        default_image_model_id: settings.default_image_model_id,
        default_video_model_id: settings.default_video_model_id,
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
          default_text_model_id: values.default_text_model_id,
          fallback_text_model_id: values.fallback_text_model_id,
          default_image_model_id: values.default_image_model_id,
          default_video_model_id: values.default_video_model_id,
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

  const textModels = models.filter((m) => m.category === 'text')
  const imageModels = models.filter((m) => m.category === 'image')
  const videoModels = models.filter((m) => m.category === 'video')

  return (
    <div className="flex-1 overflow-auto p-6 bg-gray-50">
      <Card title="全局默认模型与参数" className="max-w-2xl" loading={loading}>
        <Alert
          type="info"
          showIcon
          className="mb-4"
          message="默认模型仅在本页面统一维护，模型列表页不再提供“设为默认”操作。"
        />
        <Form form={form} layout="vertical" onFinish={handleSaveSettings}>
          <Form.Item name="default_text_model_id" label="默认文本生成模型">
            <Select
              allowClear
              placeholder="选择模型"
              options={textModels.map((m) => ({ label: m.name, value: m.id }))}
            />
          </Form.Item>
          <Form.Item
            name="fallback_text_model_id"
            label="文本失败回退模型"
            extra="本地主模型失败后最多自动升级到该模型一次；留空表示关闭回退。"
          >
            <Select
              allowClear
              placeholder="选择回退模型（可选）"
              options={textModels.map((m) => ({ label: m.name, value: m.id }))}
            />
          </Form.Item>
          <Form.Item name="default_image_model_id" label="默认图片生成模型">
            <Select
              allowClear
              placeholder="选择模型"
              options={imageModels.map((m) => ({ label: m.name, value: m.id }))}
            />
          </Form.Item>
          <Form.Item name="default_video_model_id" label="默认视频生成模型">
            <Select
              allowClear
              placeholder="选择模型"
              options={videoModels.map((m) => ({ label: m.name, value: m.id }))}
            />
          </Form.Item>
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
