/**
 * 「补充 / 修改资产资料」入口（贴在每个资产的「生成依据」旁边）。
 *
 * 用户口径（这一轮点名）：
 * - 在每项资产的「生成依据」附近给一个**用户可见**的入口，能编辑并保存资料；
 * - 角色（性别年龄/外貌/发型/性格/服装配饰…）、场景（空间/陈设/时间天气/光线/氛围）、
 *   道具（材质/形状/尺寸/状态/所属/剧情作用）、服装（穿着人物/身份时代/款式/颜色/材质/配饰/场合）
 *   这些字段都要能改；
 * - 写入现有 `manual_overrides` / `user_notes`，保存后**立即刷新「生成依据」**；
 * - 重新分析**不得**覆盖人工内容（后端保证：受保护行只记 `pending_change`，等用户决定）；
 * - 该资产**已有图片提示词**时，只提示「建议重新生成提示词」——**不自动调模型、不覆盖原提示词**。
 *
 * 这一屏刻意只做"人工资料"这一件事：
 * - 不发任何生成类请求（不调用文本模型、不出图）；
 * - 保存后回调 `onSaved()`，由外层重新拉取资料与生成依据（页面数据始终来自后端）。
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Form, Input, Modal, Space, Spin, Tag, Typography, message } from 'antd'

import type { ChapterAssetProfileRecord } from '../../../../../services/llmPipelineApi'
import {
  fetchChapterAssetProfileRecords,
  updateChapterAssetProfileRecord,
} from '../../../../../services/llmPipelineApi'
// 阶段 B ①：后端原文不直渲 —— 三级管道（去 ID → 去内部术语 → 业务化改写 + 中文兜底）
import { toUserFacingText } from '../../../components/userFacingMessage.ts'
import {
  findRecordForAsset,
  profileFieldSpecs,
} from './assetProfileFields'

type AssetProfileEditEntryProps = {
  chapterId: string
  asset: { type: string; name: string; id?: string }
  /** 该资产是否已有已保存的图片提示词：有的话保存后只**提示**重新生成，不自动生成、不覆盖 */
  hasImagePrompt?: boolean
  /** 保存成功后回调：外层应重新拉资料与「生成依据」 */
  onSaved?: () => void
  /** 折叠面板/按钮上的说明文字（默认「补充/修改资产资料」） */
  label?: string
}

type FormValues = Record<string, string> & { user_notes_text?: string }

export function AssetProfileEditEntry(props: AssetProfileEditEntryProps) {
  const { chapterId, asset, hasImagePrompt, onSaved } = props
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [record, setRecord] = useState<ChapterAssetProfileRecord | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [form] = Form.useForm<FormValues>()

  const specs = useMemo(() => profileFieldSpecs(asset.type), [asset.type])

  const load = useCallback(async () => {
    if (!chapterId) return
    setLoading(true)
    setError('')
    try {
      const data = await fetchChapterAssetProfileRecords(chapterId)
      const hit = findRecordForAsset(data.items ?? [], asset)
      setRecord(hit ?? null)
    } catch (e) {
      // 模式 6：后端原文不直渲 —— 主区只放中文结论（原文已掩码并收进「技术详情」）
      setError(toUserFacingText(e, '资料读取失败：请稍后重试'))
    } finally {
      setLoaded(true)
      setLoading(false)
    }
  }, [asset, chapterId])

  useEffect(() => {
    if (open && !loaded) void load()
  }, [open, loaded, load])

  const openModal = () => {
    setOpen(true)
    if (!loaded) return
    // 打开时用**生效资料**预填（模型资料 ⊕ 人工修改），用户看到的就是当前出图会用到的值
    const values: FormValues = {}
    for (const spec of specs) values[spec.key] = String(record?.fields?.[spec.key] ?? '')
    values.user_notes_text = (record?.user_notes ?? []).join('\n')
    form.setFieldsValue(values)
  }

  const handleSave = async () => {
    if (!record) return
    const values = await form.validateFields().catch(() => null)
    if (!values) return
    setSaving(true)
    try {
      // 只提交"与生效值不同"的字段：避免把模型原值复制成人工覆盖（人工覆盖要能一眼看出改了哪几项）
      const fields: Record<string, string> = {}
      for (const spec of specs) {
        const next = String(values[spec.key] ?? '').trim()
        const current = String(record.fields?.[spec.key] ?? '').trim()
        if (next !== current) fields[spec.key] = next
      }
      const notes = String(values.user_notes_text ?? '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
      const saved = await updateChapterAssetProfileRecord(chapterId, record.id, { fields, notes })
      setRecord(saved)
      setOpen(false)
      message.success('资产资料已保存：这部分是人工资料，重新分析不会覆盖它。')
      if (hasImagePrompt) {
        message.info('该资产已有图片提示词：建议重新生成提示词以反映本次修改（不会自动生成、也不会覆盖原提示词）。')
      }
      onSaved?.()
    } catch (e) {
      // 模式 6：同上 —— 主区只放中文结论
      setError(toUserFacingText(e, '资料保存失败：请稍后重试'))
    } finally {
      setSaving(false)
    }
  }

  if (!chapterId) return null

  const manualCount = record ? Object.keys(record.manual_overrides ?? {}).length : 0
  const noteCount = record ? (record.user_notes ?? []).length : 0

  return (
    <>
      <Space size={8} wrap align="center" className="text-[11px]">
        <Button size="small" onClick={openModal} data-testid="asset-profile-edit-entry">
          {props.label ?? '补充/修改资产资料'}
        </Button>
        {manualCount > 0 ? (
          <Tag color="green" bordered={false}>{`已人工修改 ${manualCount} 项`}</Tag>
        ) : null}
        {noteCount > 0 ? <Tag color="blue" bordered={false}>{`用户补充 ${noteCount} 条`}</Tag> : null}
        {!loaded && loading ? <Typography.Text type="secondary">读取资料中…</Typography.Text> : null}
        {loaded && !record ? (
          <Typography.Text type="secondary">
            本章还没有这份资产的资料行（确认资产后即可在这里补充）
          </Typography.Text>
        ) : null}
      </Space>

      <Modal
        open={open}
        title={`补充 / 修改资产资料 · ${asset.name}`}
        onCancel={() => setOpen(false)}
        onOk={() => void handleSave()}
        okText="保存资料"
        cancelText="取消"
        confirmLoading={saving}
        destroyOnClose={false}
        width={760}
      >
        <Spin spinning={loading}>
          <div className="space-y-3">
            <Alert
              type="info"
              showIcon
              message="这里保存的是人工资料"
              description="保存后立即生效到「这次用了哪些资料」与后续出图；重新分析（重新提取）不会覆盖它。本操作不调用模型、不生成图片、不改动已有提示词。"
            />
            {hasImagePrompt ? (
              <Alert
                type="warning"
                showIcon
                message="该资产已有图片提示词"
                description="资料变化后建议重新生成提示词，让提示词与新资料一致（需要你手动点生成；不会自动调用模型，也不会覆盖原提示词）。"
              />
            ) : null}
            {error ? <Alert type="error" showIcon message={error} /> : null}
            {loaded && !record ? (
              <Alert
                type="warning"
                showIcon
                message="这一章还没有这份资产的资料行"
                description="请先在资产准备里确认该资产（会自动创建资料行），再回来补充资料。"
              />
            ) : null}

            <Form form={form} layout="vertical" size="small" disabled={!record}>
              <div className="grid grid-cols-1 gap-x-4 md:grid-cols-2">
                {specs.map((spec) => (
                  <Form.Item
                    key={spec.key}
                    name={spec.key}
                    label={
                      <Space size={6}>
                        <span>{spec.label}</span>
                        {spec.visual ? null : <Typography.Text type="secondary">（追溯用，可选）</Typography.Text>}
                      </Space>
                    }
                  >
                    <Input placeholder={spec.placeholder} data-testid={`asset-profile-field-${spec.key}`} />
                  </Form.Item>
                ))}
              </div>
              <Form.Item
                name="user_notes_text"
                label="用户补充（一行一条）"
                extra="自由补充：剧本没写、但你要它出现的信息（例如「按导演要求：杖身要有摩挲包浆」）。"
              >
                <Input.TextArea rows={3} data-testid="asset-profile-notes" />
              </Form.Item>
            </Form>

            <Typography.Text type="secondary" className="text-[11px]">
              这里填的内容和这份资产的资料一一对应；留空表示「这一项没有信息」，不会写成空话。
            </Typography.Text>
          </div>
        </Spin>
      </Modal>
    </>
  )
}
