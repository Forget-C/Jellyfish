import { useEffect, useMemo, useRef, useState } from 'react'
import type { FC, Key } from 'react'
import { Card, Tree, Input, Row, Col, Tag, Pagination, Button, Modal, Form, Select, Switch, message } from 'antd'
import type { DataNode } from 'antd/es/tree'
import { StudioPromptsService } from '../../../services/generated'
import type { PromptCategory, PromptTemplateRead } from '../../../services/generated'

const fallbackCategoryLabels: Record<string, string> = {
  frame_head_image: '首帧图片',
  frame_tail_image: '尾帧图片',
  frame_key_image: '关键帧图片',
  frame_head_prompt: '首帧提示词',
  frame_tail_prompt: '尾帧提示词',
  frame_key_prompt: '关键帧提示词',
  video_prompt: '视频提示词',
  storyboard_prompt: '分镜',
  bgm: '配乐',
  sfx: '音效',
  character_image_front: '角色正面',
  character_image_other: '角色其他',
  actor_image: '演员设定图',
  prop_image_front: '道具正面',
  prop_image_other: '道具其他',
  scene_image_front: '场景正面',
  scene_image_other: '场景其他',
  costume_image_front: '服装正面',
  costume_image_other: '服装其他',
  combined: '综合提示词',
}

const PAGE_SIZE = 10

const defaultPromptCategories: PromptCategory[] = [
  'frame_head_image',
  'frame_tail_image',
  'frame_key_image',
  'frame_head_prompt',
  'frame_tail_prompt',
  'frame_key_prompt',
  'video_prompt',
  'storyboard_prompt',
  'bgm',
  'sfx',
  'character_image_front',
  'character_image_other',
  'actor_image',
  'prop_image_front',
  'prop_image_other',
  'scene_image_front',
  'scene_image_other',
  'costume_image_front',
  'costume_image_other',
  'combined',
]

type CreatePromptForm = {
  category: PromptCategory
  name: string
  content: string
  preview?: string
  variables?: string[]
  variable_defaults_json?: string
  is_default?: boolean
}

type PromptModalMode = 'create' | 'edit'

const groupOrder = [
  'frame',
  'video',
  'audio',
  'chapter',
  'actor',
  'scene',
  'prop',
  'costume',
  'combined',
  'other',
] as const

const groupTitles: Record<(typeof groupOrder)[number], string> = {
  frame: '首/尾/关键帧',
  video: '视频生成 / 分镜',
  audio: '配乐 / 音效 / 角色',
  chapter: '角色',
  actor: '角色形象',
  scene: '场景',
  prop: '道具',
  costume: '服装',
  combined: '综合提示词',
  other: '其他',
}

function getGroupKey(category: string): (typeof groupOrder)[number] {
  if (category.startsWith('frame_')) return 'frame'
  if (category === 'video_prompt' || category === 'storyboard_prompt') return 'video'
  if (['bgm', 'sfx'].includes(category)) return 'audio'
  if (category.startsWith('character_image_')) return 'chapter'
  if (category.startsWith('actor_image')) return 'actor'
  if (category.startsWith('scene_image_')) return 'scene'
  if (category.startsWith('prop_image_')) return 'prop'
  if (category.startsWith('costume_image_')) return 'costume'
  if (category === 'combined') return 'combined'
  return 'other'
}

const PromptTemplateManager: FC = () => {
  const [templates, setTemplates] = useState<PromptTemplateRead[]>([])
  const [selected, setSelected] = useState<PromptTemplateRead | null>(null)
  const [searchText, setSearchText] = useState('')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [categoryLabels, setCategoryLabels] = useState<Record<string, string>>(fallbackCategoryLabels)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [formOpen, setFormOpen] = useState(false)
  const [modalMode, setModalMode] = useState<PromptModalMode>('create')
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [categoryOptions, setCategoryOptions] = useState<Array<{ value: PromptCategory; label: string }>>(
    defaultPromptCategories.map((value) => ({
      value,
      label: fallbackCategoryLabels[value] || value,
    })),
  )
  const [createForm] = Form.useForm<CreatePromptForm>()
  const requestIdRef = useRef(0)

  const loadTemplates = async (nextPage: number, nextQuery: string) => {
    const requestId = ++requestIdRef.current
    setLoading(true)
    try {
      const res = await StudioPromptsService.listPromptTemplatesApiV1StudioPromptsGet({
        q: nextQuery.trim() || null,
        page: nextPage,
        pageSize: PAGE_SIZE,
      })
      if (requestId !== requestIdRef.current) return

      const items = res.data?.items ?? []
      const totalCount = res.data?.pagination?.total ?? 0

      // 空页时自动回退上一页，避免用户停留在无数据页。
      if (nextPage > 1 && items.length === 0 && totalCount > 0) {
        setPage(nextPage - 1)
        return
      }

      setTemplates(items)
      setTotal(totalCount)
    } catch {
      message.error('加载模板失败')
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false)
      }
    }
  }

  const loadCategories = async () => {
    try {
      const res = await StudioPromptsService.listPromptCategoriesApiV1StudioPromptsCategoriesGet()
      const options = res.data ?? []
      if (!options.length) return

      const nextLabels = { ...fallbackCategoryLabels }
      options.forEach((option) => {
        nextLabels[option.value] = option.label
      })
      setCategoryLabels(nextLabels)
      setCategoryOptions(
        options.map((option) => ({
          value: option.value,
          label: option.label,
        })),
      )
    } catch {
      // 类别接口失败时保留本地兜底映射。
    }
  }

  useEffect(() => {
    void loadCategories()
  }, [])

  useEffect(() => {
    void loadTemplates(page, query)
  }, [page, query])

  const treeData: DataNode[] = useMemo(() => {
    const grouped = new Map<(typeof groupOrder)[number], PromptTemplateRead[]>()
    groupOrder.forEach((key) => grouped.set(key, []))

    templates.forEach((template) => {
      const key = getGroupKey(template.category)
      grouped.get(key)?.push(template)
    })

    return groupOrder.map((groupKey) => ({
      title: groupTitles[groupKey],
      key: groupKey,
      children: (grouped.get(groupKey) ?? []).map((t) => ({
        title: t.name,
        key: t.id,
        isLeaf: true,
      })),
    }))
  }, [templates])

  const handleSearch = (value: string) => {
    setSelected(null)
    setPage(1)
    setQuery(value.trim())
  }

  const handlePageChange = (nextPage: number) => {
    setSelected(null)
    setPage(nextPage)
  }

  const onSelect = (_: Key[], info: { node: { key: Key } }) => {
    const id = String(info.node.key)
    const t = templates.find((x) => x.id === id)
    setSelected(t || null)
  }

  const openCreateModal = () => {
    createForm.resetFields()
    setModalMode('create')
    setEditingTemplateId(null)
    createForm.setFieldsValue({
      category: categoryOptions[0]?.value,
      is_default: false,
      variables: [],
    })
    setFormOpen(true)
  }

  const openEditModal = (template: PromptTemplateRead) => {
    setModalMode('edit')
    setEditingTemplateId(template.id)
    createForm.resetFields()
    createForm.setFieldsValue({
      category: template.category,
      name: template.name,
      preview: template.preview,
      content: template.content,
      variables: template.variables,
      variable_defaults_json: JSON.stringify(template.variable_defaults ?? {}, null, 2),
      is_default: template.is_default,
    })
    setFormOpen(true)
  }

  const buildPayload = (values: CreatePromptForm) => {
    let variableDefaults: Record<string, string> = {}
    const rawDefaults = values.variable_defaults_json?.trim()
    if (rawDefaults) {
      const parsed = JSON.parse(rawDefaults)
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
        throw new Error('变量默认值必须是 JSON 对象')
      }
      variableDefaults = Object.fromEntries(
        Object.entries(parsed).map(([key, value]) => [key, String(value)]),
      )
    }
    return {
      category: values.category,
      name: values.name.trim(),
      content: values.content.trim(),
      preview: values.preview?.trim() || undefined,
      variables: (values.variables ?? []).map((v) => v.trim()).filter(Boolean),
      variable_defaults: variableDefaults,
      is_default: values.is_default ?? false,
    }
  }

  const handleFormSubmit = async () => {
    try {
      const values = await createForm.validateFields()
      setSubmitting(true)
      const payload = buildPayload(values)

      if (modalMode === 'create') {
        const res = await StudioPromptsService.createPromptTemplateApiV1StudioPromptsPost({
          requestBody: payload,
        })
        if (!res.data) {
          message.error('添加提示词失败')
          return
        }

        message.success('提示词已添加')
        setFormOpen(false)
        createForm.resetFields()
        setSelected(null)
        setSearchText('')
        setQuery('')
        setPage(1)
        void loadTemplates(1, '')
        return
      }

      if (!editingTemplateId) {
        message.error('编辑目标不存在')
        return
      }

      const res = await StudioPromptsService.updatePromptTemplateApiV1StudioPromptsTemplateIdPatch({
        templateId: editingTemplateId,
        requestBody: payload,
      })
      if (!res.data) {
        message.error('更新提示词失败')
        return
      }
      const updatedTemplate = res.data

      message.success('提示词已更新')
      setFormOpen(false)
      setEditingTemplateId(null)
      createForm.resetFields()
      setSelected((prev) => (prev?.id === updatedTemplate.id ? updatedTemplate : prev))
      setTemplates((prev) => prev.map((item) => (item.id === updatedTemplate.id ? updatedTemplate : item)))
      void loadTemplates(page, query)
    } catch (error) {
      if (error && typeof error === 'object' && 'errorFields' in error) return
      message.error(modalMode === 'create' ? '添加提示词失败' : '更新提示词失败')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDeleteTemplate = (template: PromptTemplateRead) => {
    Modal.confirm({
      title: '删除提示词',
      content: `确定删除「${template.name}」吗？`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await StudioPromptsService.deletePromptTemplateApiV1StudioPromptsTemplateIdDelete({
            templateId: template.id,
          })
          message.success('提示词已删除')
          if (selected?.id === template.id) {
            setSelected(null)
          }

          if (templates.length === 1 && page > 1) {
            setPage(page - 1)
          } else {
            void loadTemplates(page, query)
          }
        } catch {
          message.error('删除提示词失败')
        }
      },
    })
  }

  const restoreSystemDefault = async (template: PromptTemplateRead) => {
    try {
      const res = await StudioPromptsService.updatePromptTemplateApiV1StudioPromptsTemplateIdPatch({
        templateId: template.id,
        requestBody: { is_default: true },
      })
      if (!res.data) return
      message.success('已恢复系统默认模板')
      setSelected(res.data)
      void loadTemplates(page, query)
    } catch {
      message.error('恢复系统默认模板失败')
    }
  }

  return (
    <div className="space-y-4">
      <Card
        title="提示词模板管理"
        loading={loading && templates.length === 0}
        extra={<Button type="primary" onClick={openCreateModal}>添加提示词</Button>}
      >
        <Input.Search
          placeholder="搜索模板名称或预览"
          allowClear
          className="mb-4 max-w-md"
          value={searchText}
          onSearch={handleSearch}
          onChange={(e) => {
            const value = e.target.value
            setSearchText(value)
            if (!value) {
              handleSearch('')
            }
          }}
        />
        <Row gutter={16}>
          <Col xs={24} md={10}>
            <Tree
              showLine
              defaultExpandAll
              blockNode
              treeData={treeData}
              onSelect={onSelect}
              fieldNames={{ title: 'title', key: 'key', children: 'children' }}
            />
            <div className="mt-4 flex justify-end">
              <Pagination
                current={page}
                pageSize={PAGE_SIZE}
                total={total}
                showSizeChanger={false}
                onChange={handlePageChange}
              />
            </div>
          </Col>
          <Col xs={24} md={14}>
            {selected ? (
              <Card
                title={selected.name}
                size="small"
                extra={(
                  <div className="flex gap-2">
                    {!selected.is_system && <Button size="small" onClick={() => openEditModal(selected)}>编辑</Button>}
                    {selected.is_system && !selected.is_default && (
                      <Button size="small" onClick={() => void restoreSystemDefault(selected)}>恢复默认</Button>
                    )}
                    {!selected.is_system && (
                      <Button size="small" danger onClick={() => handleDeleteTemplate(selected)}>
                        删除
                      </Button>
                    )}
                  </div>
                )}
              >
                <Tag>{categoryLabels[selected.category] || selected.category}</Tag>
                <p className="text-gray-600 text-sm mt-2">{selected.preview}</p>
                <pre className="mt-3 p-3 bg-gray-50 rounded text-xs overflow-auto max-h-48">
                  {selected.content}
                </pre>
                {selected.variables.length > 0 && (
                  <div className="mt-2 text-xs text-gray-500">
                    变量：{selected.variables.join(', ')}
                  </div>
                )}
                {Object.keys(selected.variable_defaults ?? {}).length > 0 && (
                  <pre className="mt-2 p-3 bg-gray-50 rounded text-xs overflow-auto max-h-32">
                    默认变量：{JSON.stringify(selected.variable_defaults, null, 2)}
                  </pre>
                )}
                <div className="mt-3 flex gap-2">
                  {selected.is_system && <Tag color="gold">系统预置</Tag>}
                  {selected.is_default && <Tag color="blue">默认提示词</Tag>}
                </div>
              </Card>
            ) : (
              <Card>
                <div className="text-gray-500 text-center py-8">
                  左侧选择模板查看详情
                </div>
              </Card>
            )}
          </Col>
        </Row>
      </Card>

      <Modal
        title={modalMode === 'create' ? '添加提示词' : '编辑提示词'}
        open={formOpen}
        onCancel={() => {
          setFormOpen(false)
          setEditingTemplateId(null)
        }}
        onOk={handleFormSubmit}
        okText="保存"
        cancelText="取消"
        confirmLoading={submitting}
        destroyOnClose
      >
        <Form layout="vertical" form={createForm}>
          <Form.Item
            label="模板类别"
            name="category"
            rules={[{ required: true, message: '请选择模板类别' }]}
          >
            <Select options={categoryOptions} placeholder="请选择类别" />
          </Form.Item>
          <Form.Item
            label="模板名称"
            name="name"
            rules={[{ required: true, message: '请输入模板名称' }]}
          >
            <Input maxLength={255} placeholder="例如：分镜基础提示词" />
          </Form.Item>
          <Form.Item label="预览文案" name="preview">
            <Input.TextArea rows={2} maxLength={500} placeholder="用于列表预览的简短说明" />
          </Form.Item>
          <Form.Item
            label="模板内容"
            name="content"
            rules={[{ required: true, message: '请输入模板内容' }]}
          >
            <Input.TextArea rows={6} placeholder="请输入提示词模板内容" />
          </Form.Item>
          <Form.Item label="变量（回车添加）" name="variables">
            <Select
              mode="tags"
              tokenSeparators={[',', '，']}
              open={false}
              placeholder="例如：subject, style, lighting"
            />
          </Form.Item>
          <Form.Item label="变量默认值（JSON 对象）" name="variable_defaults_json">
            <Input.TextArea rows={4} placeholder={'例如：{\n  "background_instruction": "Plain studio background"\n}'} />
          </Form.Item>
          <Form.Item label="设为默认提示词" name="is_default" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default PromptTemplateManager
