import { useUiText } from '../../../uiText'
import { apiErrorMessage } from '../../../services/apiErrorMessage'
import { PageToolbar, WorkspaceLayout, WorkspaceScrollPanel } from '../../../components'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FC } from 'react'
import { Alert, Skeleton, Input, Tag, Pagination, Button, Drawer, Modal, Form, Select, Switch, message } from 'antd'
import './prompt-manager.css'
import { StudioPromptsService } from '../../../services/generated'
import type { PromptCategory, PromptTemplateRead, PromptTemplateSummary } from '../../../services/generated'

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
  character_image: '角色设定图',
  actor_image: '演员设定图',
  prop_image: '道具展示图',
  scene_image_front: '场景正面',
  scene_image_other: '场景其他',
  costume_image: '服装展示图',
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
  'character_image',
  'actor_image',
  'prop_image',
  'scene_image_front',
  'scene_image_other',
  'costume_image',
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
  'character',
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
  audio: '配乐 / 音效',
  character: '角色设定',
  actor: '演员设定',
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
  if (category === 'character_image') return 'character'
  if (category === 'actor_image') return 'actor'
  if (category.startsWith('scene_image_')) return 'scene'
  if (category === 'prop_image') return 'prop'
  if (category === 'costume_image') return 'costume'
  if (category === 'combined') return 'combined'
  return 'other'
}

const PromptTemplateManager: FC = () => {
  const uiText = useUiText()
  const [templates, setTemplates] = useState<PromptTemplateSummary[]>([])
  const [selected, setSelected] = useState<PromptTemplateRead | null>(null)
  const [searchText, setSearchText] = useState('')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [categoryLabels, setCategoryLabels] = useState<Record<string, string>>(fallbackCategoryLabels)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState<number | undefined>()
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState(false)
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
  const submittingRef = useRef(false)
  const listRef = useRef<HTMLElement | null>(null)
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 1024px)').matches)
  const [readerOpen, setReaderOpen] = useState(false)
  const selectedButton = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)')
    const update = () => { setWide(media.matches); if (media.matches) setReaderOpen(false) }
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  const activeDetail = useRef<string | null>(null)
  const detailRequest = useRef(0)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [detailError, setDetailError] = useState(false)

  const clearDetail = useCallback(() => {
    activeDetail.current = null
    setDetailId(null)
    detailRequest.current += 1
    setSelected(null)
    setDetailError(false)
  }, [])

  const loadDetail = async (id: string) => {
    const request = ++detailRequest.current
    activeDetail.current = id
    setDetailId(id)
    setSelected(null)
    setDetailError(false)
    try {
      const { data } = await StudioPromptsService.getPromptTemplateApiV1StudioPromptsTemplateIdGet({ templateId: id })
      if (!data) throw new Error(uiText("模板详情响应无效"))
      if (request === detailRequest.current) setSelected(data)
    } catch {
      if (request === detailRequest.current) setDetailError(true)
    }
  }

  const loadTemplates = useCallback(async (nextPage: number, nextQuery: string) => {
    const requestId = ++requestIdRef.current
    setLoading(true)
    setLoadError(false)
    try {
      const { data } = await StudioPromptsService.listPromptSummariesApiV1StudioPromptsSummariesGet({
        page: nextPage, pageSize: PAGE_SIZE, q: nextQuery || undefined,
      })
      if (requestId !== requestIdRef.current) return
      if (!data) throw new Error(uiText("模板列表响应无效"))
      const { items, pagination } = data
      const totalCount = pagination.total

      // 空页时自动回退上一页，避免用户停留在无数据页。
      if (nextPage > 1 && items.length === 0 && totalCount !== undefined && totalCount > 0) {
        setPage(nextPage - 1)
        return
      }

      setTemplates(items)
      if (activeDetail.current && !items.some(item => item.id === activeDetail.current)) clearDetail()
      setTotal(totalCount)
      setLoaded(true)
    } catch {
      if (requestId === requestIdRef.current) setLoadError(true)
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false)
      }
    }
  }, [uiText, clearDetail])

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
    let current = true
    queueMicrotask(() => { if (current) void loadTemplates(page, query) })
    return () => { current = false; requestIdRef.current += 1 }
  }, [loadTemplates, page, query])

  const templateGroups = useMemo(() => {
    const grouped = new Map<(typeof groupOrder)[number], PromptTemplateSummary[]>()
    groupOrder.forEach((key) => grouped.set(key, []))

    templates.forEach((template) => {
      const key = getGroupKey(template.category)
      grouped.get(key)?.push(template)
    })

    return groupOrder
      .map((groupKey) => ({
        title: groupTitles[groupKey],
        key: groupKey,
        children: (grouped.get(groupKey) ?? []).map((t) => ({
          title: t.name,
          key: t.id,
          isLeaf: true,
        })),
      }))
      .filter((group) => group.children.length > 0)
  }, [templates])

  const handleSearch = (value: string) => {
    clearDetail()
    setPage(1)
    setQuery(value.trim())
  }

  const handlePageChange = (nextPage: number) => {
    clearDetail()
    setPage(nextPage)
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
        throw new Error(uiText("变量默认值必须是 JSON 对象"))
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
    if (submittingRef.current) return
    submittingRef.current = true
    setSubmitting(true)
    try {
      const values = await createForm.validateFields()
      const payload = buildPayload(values)

      if (modalMode === 'create') {
        const res = await StudioPromptsService.createPromptTemplateApiV1StudioPromptsPost({
          requestBody: payload,
        })
        if (!res.data) {
          message.error(uiText("添加提示词失败"))
          return
        }

        message.success(uiText("提示词已添加"))
        setFormOpen(false)
        createForm.resetFields()
        clearDetail()
        setSearchText('')
        setQuery('')
        setPage(1)
        if (page === 1 && !query) void loadTemplates(1, '')
        return
      }

      if (!editingTemplateId) {
        message.error(uiText("编辑目标不存在"))
        return
      }

      const res = await StudioPromptsService.updatePromptTemplateApiV1StudioPromptsTemplateIdPatch({
        templateId: editingTemplateId,
        requestBody: payload,
      })
      if (!res.data) {
        message.error(uiText("更新提示词失败"))
        return
      }
      const updatedTemplate = res.data

      message.success(uiText("提示词已更新"))
      setFormOpen(false)
      setEditingTemplateId(null)
      createForm.resetFields()
      setSelected((prev) => (prev?.id === updatedTemplate.id ? updatedTemplate : prev))
      setTemplates((prev) => prev.map((item) => (item.id === updatedTemplate.id ? updatedTemplate : item)))
      void loadTemplates(page, query)
    } catch (error) {
      if (error && typeof error === 'object' && 'errorFields' in error) return
      const reason = apiErrorMessage(error)
      message.error(reason === '请先将同类别的其他模板设为默认' ? uiText("请先将同类别的其他模板设为默认") : reason)
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  const handleDeleteTemplate = (template: PromptTemplateRead) => {
    Modal.confirm({
      title: uiText("删除提示词"),
      zIndex: 1100,
      content: uiText("确定删除「{{name}}」吗？此操作不可恢复。", { name: template.name }),
      okText: uiText("删除"),
      okType: 'danger',
      cancelText: uiText("取消"),
      onOk: async () => {
        try {
          await StudioPromptsService.deletePromptTemplateApiV1StudioPromptsTemplateIdDelete({
            templateId: template.id,
          })
          requestIdRef.current += 1
          if (templates.some(item => item.id === template.id)) {
            setTemplates(previous => previous.filter(item => item.id !== template.id))
            setTotal(previous => previous === undefined ? undefined : Math.max(0, previous - 1))
          }
          message.success(uiText("提示词已删除"))
          if (activeDetail.current === template.id) {
            clearDetail()
            selectedButton.current = null
            setReaderOpen(false)
          }

          if (templates.length === 1 && page > 1) {
            setPage(page - 1)
          } else {
            void loadTemplates(page, query)
          }
        } catch (error) {
          message.error(uiText("删除提示词失败"))
          throw error
        }
      },
    })
  }

  const restoreSystemDefault = (template: PromptTemplateRead) => {
    Modal.confirm({
      title: uiText("恢复系统默认模板"),
      zIndex: 1100,
      content: uiText("将「{{name}}」恢复为本类别的默认提示词，替换当前默认选择；不会修改模板正文。", { name: template.name }),
      okText: uiText("恢复默认"),
      cancelText: uiText("取消"),
      onOk: async () => {
        try {
          const res = await StudioPromptsService.updatePromptTemplateApiV1StudioPromptsTemplateIdPatch({
            templateId: template.id,
            requestBody: { is_default: true },
          })
          if (!res.data) throw new Error(uiText("缺少更新结果"))
          message.success(uiText("已恢复系统默认模板"))
          if (activeDetail.current === template.id) setSelected(res.data)
          void loadTemplates(page, query)
        } catch (error) {
          message.error(uiText("恢复系统默认模板失败"))
          throw error
        }
      },
    })
  }

  const restoreListFocus = () => {
    const target = selectedButton.current?.isConnected ? selectedButton.current : listRef.current
    target?.focus({ preventScroll: true })
  }

  const readerContent = selected ? <>
    <div className="management-prompt-reader-heading">
      <h2>{selected.name}</h2>
      <div className="management-prompt-reader-actions">
        {!selected.is_system && <Button size="small" onClick={() => openEditModal(selected)}>{uiText("编辑")}</Button>}
        {selected.is_system && !selected.is_default && <Button size="small" onClick={() => void restoreSystemDefault(selected)}>{uiText("恢复默认")}</Button>}
        {!selected.is_system && <Button size="small" danger onClick={() => handleDeleteTemplate(selected)}>{uiText("删除")}</Button>}
      </div>
    </div>
    <div className="management-prompt-reader-tags">
      <Tag bordered={false}>{uiText(categoryLabels[selected.category] || selected.category)}</Tag>
      {selected.is_system && <Tag bordered={false} color="gold">{uiText("系统预置")}</Tag>}
      {selected.is_default && <Tag bordered={false} color="blue">{uiText("默认提示词")}</Tag>}
    </div>
    <p className="management-prompt-reader-summary">{selected.preview || uiText("暂无简介")}</p>
    <h3>{uiText("正文")}</h3>
    <pre className="management-prompt-reader-content">{selected.content}</pre>
    <h3>{uiText("变量")}</h3>
    <p>{selected.variables.length ? selected.variables.join(', ') : uiText("暂无变量")}</p>
    <h3>{uiText("变量默认值")}</h3>
    {Object.keys(selected.variable_defaults ?? {}).length
      ? <pre className="management-prompt-reader-defaults">{JSON.stringify(selected.variable_defaults, null, 2)}</pre>
      : <p>{uiText("暂无默认值")}</p>}
  </> : detailId ? (detailError
    ? <Alert type="error" message={uiText("无法读取模板详情")} action={<Button onClick={() => void loadDetail(detailId)}>{uiText("重试")}</Button>} />
    : <Skeleton active />) : <p className="management-prompt-reader-empty">{uiText("选择模板阅读正文")}</p>

  return (
    <WorkspaceLayout className="management-page prompt-manager">
      <PageToolbar title={uiText("提示词模板")} className="management-toolbar">
        <span className="management-count">{loaded ? total === undefined ? uiText("已加载 {{length}} 项", { length: templates.length }) : uiText("共 {{total}} 项", { total }) : loading ? uiText("读取中") : uiText("数量未知")}</span>
        <div className="management-tools">
          <Input.Search aria-label={uiText("搜索模板名称或简介")} placeholder={uiText("搜索模板名称或简介")} allowClear
            value={searchText} onSearch={handleSearch} onChange={event => {
              setSearchText(event.target.value)
              if (!event.target.value) handleSearch('')
            }} />
          <Button onClick={() => { void loadTemplates(page, query); if (detailId) void loadDetail(detailId) }} disabled={loading}>{uiText("刷新模板")}</Button>
        </div>
        <Button type="primary" className="management-primary" onClick={openCreateModal}>{uiText("添加提示词")}</Button>
      </PageToolbar>
      <div className="management-panel prompt-columns">
        <section className="management-surface prompt-list" aria-label={uiText("模板列表")} tabIndex={-1} ref={listRef} aria-busy={loading}>
          {loadError && <Alert type="error" showIcon message={loaded ? uiText("刷新模板失败，已保留当前内容") : uiText("无法读取模板列表")}
            action={<Button size="small" disabled={loading} onClick={() => void loadTemplates(page, query)}>{uiText("重试")}</Button>} />}
          <WorkspaceScrollPanel>
            {!loaded && loading ? <Skeleton active paragraph={{ rows: 6 }} /> : !loadError && templates.length === 0 ? <div className="management-prompt-reader-empty">
              <p>{query ? uiText("没有匹配的模板") : uiText("暂无提示词模板")}</p>
              {query && <Button size="small" onClick={() => { setSearchText(''); handleSearch('') }}>{uiText("清除搜索")}</Button>}
            </div> : null}
            {templateGroups.map(group => <section key={group.key} className="prompt-group">
              <h2>{uiText(group.title)}</h2>
              {group.children.map(item => <button type="button" key={item.key} title={item.title}
                aria-pressed={detailId === item.key} onClick={event => {
                  selectedButton.current = event.currentTarget
                  void loadDetail(item.key)
                  if (!wide) setReaderOpen(true)
                }}>{item.title}</button>)}
            </section>)}
          </WorkspaceScrollPanel>
          {loaded && total !== undefined && <Pagination size="small" current={page} pageSize={PAGE_SIZE} total={total}
            disabled={loading} showSizeChanger={false} onChange={handlePageChange} />}
        </section>
        {wide && <WorkspaceScrollPanel className="management-surface management-prompt-reader" role="region" aria-label={uiText("模板阅读")}>
          {readerContent}
        </WorkspaceScrollPanel>}
      </div>
      {!wide && <Drawer title={uiText("模板阅读")} aria-label={uiText("模板阅读")} width="min(720px, 100vw)" open={readerOpen}
        onClose={() => {
          setReaderOpen(false)
          requestAnimationFrame(restoreListFocus)
        }} afterOpenChange={shown => {
          if (!shown) requestAnimationFrame(restoreListFocus)
        }} className="management-prompt-reader-drawer app-detail-drawer">
        <div className="management-prompt-reader">{readerContent}</div>
      </Drawer>}

      <Modal
        title={modalMode === 'create' ? uiText("添加提示词") : uiText("编辑提示词")}
        open={formOpen}
        zIndex={1100}
        closable={!submitting}
        maskClosable={!submitting}
        keyboard={!submitting}
        cancelButtonProps={{ disabled: submitting }}
        onCancel={() => {
          if (submittingRef.current) return
          setFormOpen(false)
          setEditingTemplateId(null)
        }}
        onOk={handleFormSubmit}
        okText={uiText("保存")}
        cancelText={uiText("取消")}
        confirmLoading={submitting}
        destroyOnClose
      >
        <Form layout="vertical" form={createForm}>
          <Form.Item
            label={uiText("模板类别")}
            name="category"
            rules={[{ required: true, message: uiText("请选择模板类别") }]}
          >
            <Select options={categoryOptions.map(option => ({ ...option, label: uiText(option.label) }))} placeholder={uiText("请选择类别")} />
          </Form.Item>
          <Form.Item
            label={uiText("模板名称")}
            name="name"
            rules={[{ required: true, message: uiText("请输入模板名称") }]}
          >
            <Input maxLength={255} placeholder={uiText("例如：分镜基础提示词")} />
          </Form.Item>
          <Form.Item label={uiText("预览文案")} name="preview">
            <Input.TextArea rows={2} maxLength={500} placeholder={uiText("用于列表预览的简短说明")} />
          </Form.Item>
          <Form.Item
            label={uiText("模板内容")}
            name="content"
            rules={[{ required: true, message: uiText("请输入模板内容") }]}
          >
            <Input.TextArea rows={6} placeholder={uiText("请输入提示词模板内容")} />
          </Form.Item>
          <Form.Item label={uiText("变量（回车添加）")} name="variables">
            <Select
              mode="tags"
              tokenSeparators={[',', '，']}
              open={false}
              placeholder={uiText("例如：subject, style, lighting")}
            />
          </Form.Item>
          <Form.Item label={uiText("变量默认值（JSON 对象）")} name="variable_defaults_json">
            <Input.TextArea rows={4} placeholder={uiText("例如：{\n  \"background_instruction\": \"Plain studio background\"\n}")} />
          </Form.Item>
          <Form.Item label={uiText("设为默认提示词")} name="is_default" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </WorkspaceLayout>
  )
}

export default PromptTemplateManager
