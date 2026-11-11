import { useEffect, useState } from 'react'
import { Alert, Button, Form, Input, InputNumber, Select, Space, Switch, message } from 'antd'
import { type ProjectRead, type ProjectUpdate } from '../../../../../services/generated'
import { directingError } from '../../../directing/common'
import { ProjectVisualStyleAndStyleFields } from '../../ProjectVisualStyleAndStyleFields'
import { ProjectContentToolbar } from '../ProjectContentToolbar'
import './project-settings.css'
import { useProjectStyleOptions } from '../../useProjectStyleOptions'

function settingsValues(project: ProjectRead): ProjectUpdate {
  return {
    name: project.name,
    description: project.description ?? '',
    visual_style: project.visual_style ?? '现实',
    style: project.style,
    seed: project.seed ?? 0,
    unify_style: project.unify_style ?? true,
    default_video_ratio: project.default_video_ratio ?? null,
  }
}

/** 保存现有项目配置，服务端返回值同时更新项目标题和表单基准。 */
export function SettingsTab({ project, saving, onSave }: {
  project: ProjectRead
  saving: boolean
  onSave: (values: ProjectUpdate) => Promise<boolean>
}) {
  const [form] = Form.useForm<ProjectUpdate>()
  const { options, videoRatioOptions } = useProjectStyleOptions()
  const [error, setError] = useState('')
  const saved = settingsValues(project)
  const values = Form.useWatch([], form)
  const dirty = values && Object.entries(saved).some(([key, value]) =>
    (values[key as keyof ProjectUpdate] ?? null) !== (value ?? null))

  useEffect(() => { form.setFieldsValue(settingsValues(project)) }, [form, project])

  async function save(values: ProjectUpdate) {
    if (!dirty || saving) return
    setError('')
    try {
      if (await onSave({ ...values, default_video_ratio: values.default_video_ratio ?? null })) {
        message.success('项目已更新')
      }
    } catch (cause) {
      setError(directingError(cause))
    }
  }

  function cancel() {
    form.resetFields()
    form.setFieldsValue(saved)
    setError('')
  }

  return (
    <>
      <ProjectContentToolbar><h1 className="app-page-title">项目设置</h1></ProjectContentToolbar>
      <Form aria-label="项目设置表单" form={form} layout="vertical" className="app-settings-form project-settings-form" initialValues={saved} onFinish={save} disabled={saving}>
        {error && <Alert type="error" showIcon message={error} className="mb-4" />}
        <section className="project-settings-group" aria-labelledby="project-settings-basic">
        <h2 id="project-settings-basic">基本信息</h2>
        <Form.Item name="name" label="项目名称" rules={[{ required: true, whitespace: true, message: '请输入项目名称' }]}>
          <Input />
        </Form.Item>
        <Form.Item name="description" label="项目简介">
          <Input.TextArea rows={3} />
        </Form.Item>
        </section>
        <section className="project-settings-group" aria-labelledby="project-settings-generation">
        <h2 id="project-settings-generation">生成默认设置</h2>
        <ProjectVisualStyleAndStyleFields form={form} options={options} />
        <Form.Item name="seed" label="全局种子值" rules={[{ required: true, type: 'integer', min: 0, message: '请输入非负整数' }]} tooltip="固定种子可确保整部短剧视觉调性一致">
          <InputNumber min={0} className="w-full" />
        </Form.Item>
        <Form.Item name="default_video_ratio" label="默认视频比例">
          <Select allowClear placeholder="未设置时由模型/供应商决定" options={videoRatioOptions} />
        </Form.Item>
        <Form.Item name="unify_style" label="风格统一" valuePropName="checked" tooltip="开启后所有章节继承项目风格">
          <Switch />
        </Form.Item>
        </section>
        <Space size={8} className="project-settings-actions">
          <Button disabled={!dirty || saving} onClick={cancel}>取消</Button>
          <Button type="primary" htmlType="submit" disabled={!dirty || saving} loading={saving}>保存</Button>
        </Space>
      </Form>
    </>
  )
}
