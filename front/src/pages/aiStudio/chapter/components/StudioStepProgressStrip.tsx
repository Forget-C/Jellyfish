/**
 * 章节工作室「三步」顶部进度条（只读）。
 *
 * 为什么放在工作室里：项目工作台的后三步导航会**直接跳进工作室**（这是主流程该有的速度），
 * 所以在工作台上放的那些进度卡片只有在直接打开 `?step=video_prompt` 这类深链时才看得到。
 * 用户真正干活的地方是工作室，因此把「本集还差什么」压缩成一行放在步骤切换器下面。
 *
 * 数据来自出口 A 的只读接口（`previewPromptDelivery`，scope=episode）：
 * 不写库、不触网、不花钱。三一步的侧重点不同：
 * - 视频提示词：有正文 / 来源已确认（模板拼装不算来源）的镜头数；
 * - 关联绑定：已绑定资产的镜头数、已绑声音的镜头数；
 * - 生成与交付：可交付 / 跳过条数，并提供「复制交付文本」。
 */

import { useCallback, useEffect, useState } from 'react'
import { Button, Space, Tag, Tooltip, Typography, message } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import {
  downloadDeliveryTxt,
  previewPromptDelivery,
  type PromptDeliveryPreview,
  type PromptDeliveryRow,
} from '../../../../services/llmPipelineApi'
// 阶段 B ③（审计 §4.3 模式 6）：后端原文 → 主区中文结论（掩码 → 洗句 → 业务化改写）
import { toUserFacingText } from '../../components/userFacingMessage'

export type StudioStepProgressStep = 'video_prompt' | 'binding' | 'deliver'

type StudioStepProgressStripProps = {
  projectId?: string
  chapterId?: string | null
  step: StudioStepProgressStep
  /**
   * 工作室里勾选的分镜。给了就按**选中范围**判就绪/导出，
   * 避免"一镜试通就显示整集已就绪"。
   */
  selectedShotIds?: string[]
}

/**
 * 出口 A 的 TXT 下载地址（后端既有端点，UTF-8 BOM，直接给浏览器下载）。
 *
 * 必须带上 `OpenAPI.BASE`：前端 dev server 没有 `/api` 代理，写成相对路径会被
 * Vite 的 SPA fallback 吃掉（返回 index.html），表现就是"点了导出没下载到东西"。
 */
import { OpenAPI } from '../../../../services/generated'


export function buildDeliveryExportUrl(
  projectId: string,
  chapterId: string | null | undefined,
  selectedShotIds: string[],
): string {
  const params = new URLSearchParams()
  const selected = selectedShotIds.filter(Boolean)
  if (selected.length) {
    params.set('scope', 'episode')
    params.set('shot_ids', selected.join(','))
  } else {
    params.set('scope', chapterId ? 'episode' : 'episodes')
  }
  if (chapterId) params.set('chapter_id', chapterId)
  params.set('include_bindings', 'true')
  const query = params.toString()
  const base = String(OpenAPI.BASE ?? '').replace(/\/+$/, '')
  return `${base}/api/v1/studio/prompt-delivery/${encodeURIComponent(projectId)}/export?${query}`
}

function bindingCount(row: PromptDeliveryRow): number {
  const assets = Object.values(row.bound_assets ?? {}).reduce((sum, list) => sum + (list?.length ?? 0), 0)
  return assets + (row.bound_files?.length ?? 0)
}

function hasAudio(row: PromptDeliveryRow): boolean {
  return (row.bound_files ?? []).some((file) => String(file?.slot ?? '') === 'audio')
}

export function StudioStepProgressStrip({ projectId, chapterId, step, selectedShotIds = [] }: StudioStepProgressStripProps) {
  const [data, setData] = useState<PromptDeliveryPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!projectId || !chapterId) return
    setLoading(true)
    setError('')
    try {
      setData(await previewPromptDelivery(projectId, chapterId, 'episode', selectedShotIds))
    } catch (e) {
      setError(toUserFacingText(e, '进度加载失败'))
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [chapterId, projectId, selectedShotIds])

  useEffect(() => {
    void load()
  }, [load])

  if (!projectId || !chapterId) return null

  const rows = data?.rows ?? []
  const total = rows.length
  const withPrompt = rows.filter((row) => (row.video_prompt ?? '').trim() !== '').length
  const withSource = rows.filter((row) => (row.video_prompt_source ?? '').trim() !== '').length
  const withBinding = rows.filter((row) => bindingCount(row) > 0).length
  const withAudio = rows.filter(hasAudio).length

  const tags = (() => {
    if (total === 0) return [<Tag key="empty" bordered={false}>{loading ? '加载中…' : '本集还没有镜头'}</Tag>]
    if (step === 'video_prompt') {
      return [
        <Tag key="total" bordered={false}>{`共 ${total} 镜`}</Tag>,
        <Tag key="body" color={withPrompt < total ? 'gold' : 'green'} bordered={false}>
          {`有正文 ${withPrompt}`}
        </Tag>,
        <Tag key="src" color={withSource < total ? 'gold' : 'green'} bordered={false}>
          {`来源已确认 ${withSource}`}
        </Tag>,
        <Tag key="gap" color={withSource < total ? 'orange' : 'green'} bordered={false}>
          {withSource < total ? `还差 ${total - withSource} 镜未确认来源` : '来源已齐'}
        </Tag>,
      ]
    }
    if (step === 'binding') {
      return [
        <Tag key="total" bordered={false}>{`共 ${total} 镜`}</Tag>,
        <Tag key="bind" color={withBinding < total ? 'gold' : 'green'} bordered={false}>
          {`已绑定资产 ${withBinding}`}
        </Tag>,
        <Tag key="audio" color={withAudio > 0 ? 'cyan' : 'default'} bordered={false}>
          {`已绑声音 ${withAudio}`}
        </Tag>,
        <Tag key="gap" color={withBinding < total ? 'orange' : 'green'} bordered={false}>
          {withBinding < total ? `还差 ${total - withBinding} 镜未绑定` : '绑定已齐'}
        </Tag>,
      ]
    }
    return [
      <Tag key="ok" color="green" bordered={false}>{`可交付 ${data?.exportable_count ?? 0} 条`}</Tag>,
      <Tag key="skip" color={(data?.skipped_count ?? 0) > 0 ? 'orange' : 'default'} bordered={false}>
        {`跳过 ${data?.skipped_count ?? 0} 条`}
      </Tag>,
      <Tag key="bind" color="geekblue" bordered={false}>
        {`带出绑定素材 ${data?.include_bindings ? '是' : '否'}`}
      </Tag>,
    ]
  })()

  return (
    <div className="px-3 pb-2 border-b border-gray-100">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Space size={6} wrap>
          <Typography.Text type="secondary" className="text-[11px]">
            {selectedShotIds.filter(Boolean).length
              ? `选中 ${selectedShotIds.filter(Boolean).length} 镜进度`
              : '本集进度'}
          </Typography.Text>
          {tags}
        </Space>
        <Space size={6}>
          {step === 'deliver' ? (
            <Button
              size="small"
              type="link"
              disabled={!data?.text}
              onClick={() => {
                const text = data?.text ?? ''
                if (!text) {
                  message.warning('当前没有可复制的交付文本')
                  return
                }
                void navigator.clipboard
                  .writeText(text)
                  .then(() => message.success(`已复制交付文本（${text.length} 字）`))
                  .catch(() => message.error('复制失败，请到「提示词导入/交付」页手动复制'))
              }}
            >
              复制交付文本
            </Button>
          ) : null}
          {step === 'deliver' && projectId ? (
            <Tooltip title="下载绑定提示词 TXT（后端既有导出端点；按勾选范围，带出绑定素材的实际文件）">
              <Button
                size="small"
                type="link"
                disabled={!selectedShotIds.filter(Boolean).length && !chapterId}
                onClick={() => {
                  // 走 fetch+Blob 的真实下载：失败会提示错误，不会打开一个 404 页面
                  void downloadDeliveryTxt(projectId, chapterId, selectedShotIds)
                    .then((result) => message.success(`已下载：${result.filename}（${result.bytes} 字节）`))
                    .catch((error) => message.error(toUserFacingText(error, '导出失败')))
                }}
              >
                {`下载 TXT${selectedShotIds.filter(Boolean).length ? `（选中 ${selectedShotIds.filter(Boolean).length} 镜）` : ''}`}
              </Button>
            </Tooltip>
          ) : null}
          <Tooltip title="只读刷新（不写库、不触网、不花钱）">
            <Button size="small" type="text" icon={<ReloadOutlined />} loading={loading} onClick={() => void load()} />
          </Tooltip>
        </Space>
      </div>
      {error ? (
        <div className="mt-1 text-[11px] text-red-500">{error}</div>
      ) : step === 'video_prompt' ? (
        <div className="mt-1 text-[11px] text-gray-400">
          只有正式保存过的提示词才算（大模型生成 / 外部导入 / 人工编辑 / 一键技能生成）；临时拼装的模板不计入，也不会进交付导出。
        </div>
      ) : null}
    </div>
  )
}

export default StudioStepProgressStrip
