/**
 * 图片生成实验室。
 *
 * 页面用于在不绑定项目资产的情况下验证图片模型、图片提示词模板与参考图效果；
 * 上传和资料库图片都会先转换为 FileItem，再以 file_id 提交给后端任务。
 */
import { useEffect, useMemo, useState } from 'react'
import { Button, Empty, Modal, Spin, Tag, Upload, message } from 'antd'
import { ClearOutlined, CloseOutlined, FolderOpenOutlined, PictureOutlined, UploadOutlined } from '@ant-design/icons'
import type { UploadFile } from 'antd'
import {
  FilmService,
  LlmService,
  StudioFilesService,
  StudioImageLabService,
  StudioPromptsService,
  type FileRead,
  type ModelRead,
  type PromptTemplateRead,
} from '../../../services/generated'
import { buildFileDownloadUrl } from '../assets/utils'
import { ExperimentComposer } from '../experiment/components/ExperimentComposer'
import { ExperimentEmptyState } from '../experiment/components/ExperimentEmptyState'
import { ExperimentLabLayout } from '../experiment/components/ExperimentLabLayout'
import { ExperimentOptionBar } from '../experiment/components/ExperimentOptionBar'
import { ExperimentPromptEditor } from '../experiment/components/ExperimentPromptEditor'
import { createPromptTemplateValues, renderPromptTemplate } from '../experiment/components/PromptTemplateForm'

const imagePromptCategories = [
  'frame_head_image',
  'frame_tail_image',
  'frame_key_image',
  'character_image',
  'actor_image',
  'prop_image',
  'scene_image_front',
  'scene_image_other',
  'costume_image',
] as const

const imagePromptCategoryLabels: Record<string, string> = {
  frame_head_image: '首帧图片',
  frame_tail_image: '尾帧图片',
  frame_key_image: '关键帧图片',
  character_image: '角色设定图',
  actor_image: '演员设定图',
  prop_image: '道具展示图',
  scene_image_front: '场景正面图片',
  scene_image_other: '场景侧面/背面图片',
  costume_image: '服装展示图',
}

/** 将图片任务结果转换为浏览器可直接预览的 URL。 */
function extractImageUrls(result: Record<string, unknown> | null | undefined): string[] {
  const images = result && Array.isArray(result.images) ? result.images : []
  return images.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const image = item as { url?: unknown; b64_json?: unknown }
    if (typeof image.url === 'string' && image.url) return [image.url]
    if (typeof image.b64_json === 'string' && image.b64_json) return [`data:image/png;base64,${image.b64_json}`]
    return []
  })
}

export default function ImageLabPage() {
  const [models, setModels] = useState<ModelRead[]>([])
  const [templates, setTemplates] = useState<PromptTemplateRead[]>([])
  const [files, setFiles] = useState<FileRead[]>([])
  const [modelId, setModelId] = useState<string | undefined>()
  const [templateId, setTemplateId] = useState<string | undefined>()
  const [templateValues, setTemplateValues] = useState<Record<string, string>>({})
  const [draft, setDraft] = useState('')
  const [referenceFileIds, setReferenceFileIds] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [taskId, setTaskId] = useState<string | null>(null)
  const [taskStatus, setTaskStatus] = useState<string | null>(null)
  const [resultUrls, setResultUrls] = useState<string[]>([])
  const [libraryOpen, setLibraryOpen] = useState(false)

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === templateId) ?? null,
    [templateId, templates],
  )
  const selectedReferences = useMemo(
    () => referenceFileIds.map((id) => files.find((file) => file.id === id)).filter((file): file is FileRead => Boolean(file)),
    [files, referenceFileIds],
  )
  const currentPrompt = selectedTemplate
    ? renderPromptTemplate(selectedTemplate.content, templateValues).trim()
    : draft.trim()

  useEffect(() => {
    /** 加载图片实验可选择的模型、模板和资料库图片。 */
    const loadOptions = async () => {
      setLoading(true)
      try {
        const [modelsResponse, filesResponse, ...templateResponses] = await Promise.all([
          LlmService.listModelsApiV1LlmModelsGet({ category: 'image', page: 1, pageSize: 100, order: 'updated_at', isDesc: true }),
          StudioFilesService.listFilesApiApiV1StudioFilesGet({ page: 1, pageSize: 100, order: 'updated_at', isDesc: true }),
          ...imagePromptCategories.map((category) => StudioPromptsService.listPromptTemplatesApiV1StudioPromptsGet({
            category,
            page: 1,
            pageSize: 100,
            order: 'updated_at',
            isDesc: true,
          })),
        ])
        const imageModels = modelsResponse.data?.items ?? []
        setModels(imageModels)
        setFiles((filesResponse.data?.items ?? []).filter((file) => file.type === 'image'))
        setTemplates(templateResponses.flatMap((response) => response.data?.items ?? []))
        if (imageModels.length === 1) setModelId(imageModels[0].id)
      } catch {
        message.error('加载图片实验室配置失败')
      } finally {
        setLoading(false)
      }
    }
    void loadOptions()
  }, [])

  useEffect(() => {
    if (!taskId || taskStatus === 'succeeded' || taskStatus === 'failed' || taskStatus === 'cancelled') return
    let cancelled = false
    const poll = async () => {
      try {
        const response = await FilmService.getTaskResultApiV1FilmTasksTaskIdResultGet({ taskId })
        if (cancelled) return
        const task = response.data
        setTaskStatus(task?.status ?? null)
        if (task?.status === 'succeeded') setResultUrls(extractImageUrls(task.result))
        if (task?.status === 'failed') message.error(task.error || '图片生成失败，请检查模型与供应商配置')
      } catch {
        if (!cancelled) message.error('获取图片生成任务状态失败')
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 1500)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [taskId, taskStatus])

  /** 选择模板时重置变量，并清空自由输入避免两种来源混用。 */
  const handleSelectTemplate = (nextTemplateId?: string) => {
    setTemplateId(nextTemplateId)
    const template = templates.find((item) => item.id === nextTemplateId)
    setTemplateValues(template ? createPromptTemplateValues(template) : {})
    if (template) setDraft('')
  }

  /** 上传图片后立即作为本轮参考图，同时加入本地资料库列表。 */
  const handleUploadReference = async (file: UploadFile) => {
    if (!file.type?.startsWith('image/')) {
      message.warning('只能上传图片作为参考图')
      return false
    }
    setUploading(true)
    try {
      const response = await StudioFilesService.uploadFileApiApiV1StudioFilesUploadPost({
        formData: { file: file as unknown as string },
      })
      const uploaded = response.data
      if (!uploaded) throw new Error('上传未返回文件信息')
      setFiles((current) => [uploaded, ...current.filter((item) => item.id !== uploaded.id)])
      setReferenceFileIds((current) => current.includes(uploaded.id) ? current : [...current, uploaded.id])
      message.success('参考图已上传')
    } catch {
      message.error('参考图上传失败')
    } finally {
      setUploading(false)
    }
    return false
  }

  /** 从资料库添加或移除参考图，维持提交顺序与界面顺序一致。 */
  const toggleReference = (fileId: string) => {
    setReferenceFileIds((current) => current.includes(fileId)
      ? current.filter((id) => id !== fileId)
      : [...current, fileId])
  }

  /** 创建图片任务，并由轮询逻辑持续显示运行状态与生成结果。 */
  const handleSubmit = async () => {
    if (!modelId) return message.warning('请选择图片模型')
    if (!currentPrompt) return message.warning(selectedTemplate ? '请填写模板变量，生成有效提示词' : '请输入图片提示词')
    setSubmitting(true)
    setTaskId(null)
    setTaskStatus('pending')
    setResultUrls([])
    try {
      const response = await StudioImageLabService.createImageLabTaskApiV1StudioImageLabTasksPost({
        requestBody: { model_id: modelId, prompt: currentPrompt, images: referenceFileIds },
      })
      const nextTaskId = response.data?.task_id
      if (!nextTaskId) throw new Error('创建图片任务失败')
      setTaskId(nextTaskId)
      message.success('图片生成任务已创建')
    } catch {
      setTaskStatus(null)
      message.error('创建图片生成任务失败，请检查模型、参考图和服务配置')
    } finally {
      setSubmitting(false)
    }
  }

  /** 清除当前实验结果，使图片实验室与文本会话拥有相同的重置入口。 */
  const handleClearResults = () => {
    setTaskId(null)
    setTaskStatus(null)
    setResultUrls([])
  }

  return (
    <ExperimentLabLayout
      title="图片实验室"
      extra={<Button icon={<ClearOutlined />} disabled={!resultUrls.length || submitting} onClick={handleClearResults}>清空结果</Button>}
      history={<>
        {loading ? <div className="h-72 flex items-center justify-center"><Spin /></div> : null}
          {!loading && resultUrls.length === 0 ? <ExperimentEmptyState description="选择图片模型并输入提示词，开始一轮图片实验" /> : null}
          {resultUrls.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {resultUrls.map((url, index) => <img key={`${url}-${index}`} src={url} alt={`生成结果 ${index + 1}`} className="w-full rounded-lg border border-gray-200 object-contain" />)}
            </div>
          ) : null}
          {taskStatus && taskStatus !== 'succeeded' ? <Tag color={taskStatus === 'failed' ? 'red' : 'blue'}>生成任务：{taskStatus === 'failed' ? '失败' : '进行中'}</Tag> : null}
      </>}
      composer={<ExperimentComposer
          submitting={submitting || Boolean(taskId && taskStatus && !['succeeded', 'failed', 'cancelled'].includes(taskStatus))}
          submitDisabled={loading}
          submitLabel="生成图片"
          onSubmit={() => void handleSubmit()}
          contextActions={
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 border-l border-slate-200 pl-2">
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600">
                <PictureOutlined />
                参考图
              </span>
              {selectedReferences.map((file) => (
                <div key={file.id} className="group relative h-9 w-9 overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm" title={file.name}>
                  <img src={buildFileDownloadUrl(file.id)} alt={file.name} className="h-full w-full object-cover" />
                  <button
                    type="button"
                    aria-label={`移除参考图：${file.name}`}
                    className="absolute inset-0 hidden items-center justify-center bg-slate-900/50 text-white group-hover:flex focus:flex"
                    onClick={() => toggleReference(file.id)}
                  >
                    <CloseOutlined />
                  </button>
                </div>
              ))}
              {!selectedReferences.length ? <span className="text-sm text-slate-400">添加图片</span> : null}
              <Upload accept="image/*" showUploadList={false} beforeUpload={handleUploadReference} disabled={uploading || submitting}>
                <Button size="small" icon={<UploadOutlined />} loading={uploading}>上传</Button>
              </Upload>
              <Button size="small" icon={<FolderOpenOutlined />} onClick={() => setLibraryOpen(true)} disabled={loading || submitting}>资料库</Button>
              {referenceFileIds.length ? <Button size="small" type="text" onClick={() => setReferenceFileIds([])} disabled={submitting}>清空</Button> : null}
            </div>
          }
          options={
            <ExperimentOptionBar
              models={models.map((model) => ({ id: model.id, name: model.name }))}
              templates={templates.map((template) => ({
                id: template.id,
                name: template.name,
                version: template.version,
                preview: template.preview,
                category: imagePromptCategoryLabels[template.category],
              }))}
              modelId={modelId}
              templateId={templateId}
              loading={loading}
              disabled={submitting}
              modelLabel="图片模型"
              modelPlaceholder="选择已登记的图片模型"
              onModelChange={setModelId}
              onTemplateChange={handleSelectTemplate}
            />
          }
        >
          <ExperimentPromptEditor
            template={selectedTemplate}
            templateValues={templateValues}
            draft={draft}
            placeholder="描述你想生成的图片…"
            minRows={5}
            disabled={submitting || loading}
            onDraftChange={setDraft}
            onTemplateValuesChange={setTemplateValues}
            onUseFreeInput={(renderedPrompt) => {
              setTemplateId(undefined)
              setTemplateValues({})
              setDraft(renderedPrompt)
            }}
          />
        </ExperimentComposer>}
      overlays={<Modal title="从资料库选择参考图" open={libraryOpen} onCancel={() => setLibraryOpen(false)} footer={<Button type="primary" onClick={() => setLibraryOpen(false)}>完成</Button>} width={820}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {files.map((file) => {
            const selected = referenceFileIds.includes(file.id)
            return (
              <button key={file.id} type="button" onClick={() => toggleReference(file.id)} className={`overflow-hidden rounded border text-left ${selected ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-200'}`}>
                <img src={buildFileDownloadUrl(file.id)} alt={file.name} className="h-28 w-full object-cover" />
                <div className="truncate p-2 text-xs">{file.name}</div>
              </button>
            )
          })}
        </div>
        {!files.length ? <Empty description="资料库中暂无图片" /> : null}
      </Modal>}
    />
  )
}
