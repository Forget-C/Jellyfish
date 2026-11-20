import { useRef, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Alert, Button, Form, Input, InputNumber, Select, Switch, message } from 'antd'
import { StudioProjectsService, type ProjectCreate } from '../../../services/generated'
import { apiErrorMessage } from '../../../services/apiErrorMessage'
import { ResourceEditorFrame } from '../assets/components/ResourceEditorFrame'
import { ProjectVisualStyleAndStyleFields } from './ProjectVisualStyleAndStyleFields'
import type { useProjectStyleOptions } from './useProjectStyleOptions'
import '../assets/components/resourceEditor.css'
import './ProjectWorkbench/tabs/project-settings.css'

type Fields = Omit<ProjectCreate, 'id' | 'stats' | 'progress'>

export function ProjectCreateDrawer({ styleOptions, onClose }: {
  styleOptions: ReturnType<typeof useProjectStyleOptions>
  onClose: () => void
}) {
  const [form] = Form.useForm<Fields>()
  const { options, defaultVisualStyle, getDefaultStyle, videoRatioOptions, defaultVideoRatio } = styleOptions
  const [defaults] = useState(() => ({
    visual_style: defaultVisualStyle,
    style: getDefaultStyle(defaultVisualStyle),
    seed: Math.floor(Math.random() * 99999),
    unify_style: true,
    default_video_ratio: defaultVideoRatio,
  }))
  const pending = useRef(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [createdId, setCreatedId] = useState('')

  async function create(values: Fields) {
    if (pending.current) return
    pending.current = true
    setSaving(true)
    setError('')
    try {
      const id = globalThis.crypto?.randomUUID?.() ?? `p_${Date.now()}_${Math.random().toString(16).slice(2)}`
      const { data } = await StudioProjectsService.createProjectApiV1StudioProjectsPost({
        requestBody: { ...values, id, description: values.description ?? '', default_video_ratio: values.default_video_ratio || null, progress: 0 },
      })
      if (!data?.id) throw new Error('创建项目失败')
      message.success('项目创建成功')
      setCreatedId(data.id)
    } catch (cause) {
      setError(apiErrorMessage(cause))
      pending.current = false
      setSaving(false)
    }
  }

  if (createdId) return <Navigate to={`/projects/${createdId}`} />
  return (
    <ResourceEditorFrame id="project-create-drawer" className="project-create-drawer" open drawer drawerWidth={720}
      title="新建短剧项目" backLabel="返回" onClose={() => { if (!pending.current) onClose() }}
      actions={<Button type="primary" htmlType="submit" form="project-create-form" loading={saving}>创建并进入</Button>}>
      <Form id="project-create-form" className="app-settings-form project-settings-form" form={form}
        layout="vertical" initialValues={defaults} onFinish={create} disabled={saving} scrollToFirstError>
        {error && <Alert type="error" showIcon message={error} />}
        <section className="project-settings-group" aria-labelledby="project-create-basic">
          <h2 id="project-create-basic">基本信息</h2>
          <Form.Item name="name" label="项目名称" rules={[{ required: true, whitespace: true, message: '请输入项目名称' }]}>
            <Input placeholder="例如：现实都市爱情短剧" />
          </Form.Item>
          <Form.Item name="description" label="项目简介（选填）">
            <Input.TextArea rows={3} placeholder="项目简介与风格说明，建议 80–120 字" />
          </Form.Item>
        </section>
        <section className="project-settings-group" aria-labelledby="project-create-generation">
          <h2 id="project-create-generation">生成默认设置</h2>
          <div className="project-settings-short-fields">
            <ProjectVisualStyleAndStyleFields form={form} options={options} />
          </div>
          <div className="project-settings-short-fields">
            <Form.Item name="seed" label="全局种子值" tooltip="固定种子可确保整部短剧视觉调性一致">
              <InputNumber min={0} className="w-full" />
            </Form.Item>
            <Form.Item name="default_video_ratio" label="默认视频比例">
              <Select allowClear placeholder="未设置时由模型/供应商决定" options={videoRatioOptions} />
            </Form.Item>
          </div>
          <div className="project-settings-switch-row">
            <div><span>风格统一</span><p>所有章节继承项目风格</p></div>
            <Form.Item name="unify_style" valuePropName="checked" noStyle><Switch aria-label="风格统一" /></Form.Item>
          </div>
        </section>
      </Form>
    </ResourceEditorFrame>
  )
}
