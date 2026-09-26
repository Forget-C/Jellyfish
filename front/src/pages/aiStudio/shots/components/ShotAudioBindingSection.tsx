/**
 * 镜头「声音绑定」区块（关联绑定步骤的第 3 类素材）。
 *
 * 用户要求：「绑定素材（图片 / 声音 file_id）进入导出内容及实际生成请求」，并且
 * 「不要让用户手填内部 ID」。所以这里只做两件事：
 * 1. 上传音频（或从素材库挑一条已上传的音频）→ 拿到 file_id；
 * 2. 通过现有 `PATCH /api/v1/studio/shot-details/{id}` 把 `audio_file_id` 写到这条分镜上。
 *
 * 边界说明（与后端口径一致，别把"接上了"说过头）：
 * - 声音绑定的落点是镜头级的 `shot_details.audio_file_id`（不是资产关联表）；
 * - 音频素材必须 `files.type=audio`，后端按后缀/Content-Type 判定，前端只负责别传错文件；
 * - 上传走本地存储驱动时无外部费用，因此本区块**不受** DRY_RUN 付费守卫管辖；
 * - 声音**一定**会进入交付内容（【绑定素材·实际文件】里的 `声音：` 行）。交付清单 ≠ 进请求，也 ≠ 进成片音轨；
 * - 声音**是否进入视频生成请求**（= 作为「参考音频」）取决于两件事，口径来源是仓库
 *   `SIX_STEP_ACCEPTANCE.md` 第 128 行的官方协议要点（`audio_urls`：最多 3 条、总时长 ≤15s、
 *   需与参考图/参考视频一起用、只收公网 URL 或 `asset://`、与首尾帧图片互斥）：
 *   1. 生成服务要支持参考音频：seedance 支持，字段是 `audio_urls`；
 *   2. 我们这边的音频地址必须是**公网 http(s)** 或 **`asset://`** —— 本机/相对地址（如 `/files/xxx.mp3`）、
 *      内网地址、生成服务不接受的 data URL 都会在请求计划层被排除。
 *
 * ⚠️ 上面这些实现细节（协议文件名 / `audio_urls` / `asset://` / `/files/...`）**只留在本注释里**，
 * 不许再出现在用户可见文案中（审计 §4.3 模式 4/5 点名了这条长段落）。
 *   任一条件不满足时，计划预览与本区块会**明确说明"本次未携带"以及原因**（带修法），不会静默丢弃。
 * - 术语（三处口径必须一致，见 `audioAdmissionCore.ts` 与 `docs/reference-audio-scope.md`）：
 *   「参考音频」是**输入**（本轮只验证到"会被带进请求"，供应商是否据此影响结果**尚无证据**）；
 *   「最终成片的音轨」是**输出**侧 —— 来自供应商 `generate_audio`（"视频带 AI 生成配套音频"，
 *   seedance **默认就是开**）；把已生成的配音混流/回贴成成片音轨是**另一条路径，当前未实现**。
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Empty, Input, Modal, Space, Table, Tag, Typography, Upload, message } from 'antd'
import type { TableColumnsType } from 'antd'
import { DeleteOutlined, ReloadOutlined, SoundOutlined, UploadOutlined } from '@ant-design/icons'
import { OpenAPI, StudioFilesService } from '../../../../services/generated'
import {
  REFERENCE_AUDIO_VS_FINAL_TRACK,
  describeAudioAdmission,
  type AudioAudit,
} from './audioAdmissionCore'
// 阶段 B ③（审计 §4.3 模式 6）：本区块此前 `maskInternalIds` 引用数为 0，全部出口统一接管道
import { showUserError, toUserFacingText } from '../../components/userFacingMessage'
/* 阶段 B 第 3 批收尾（审计 §4.3 模式 4 / §3.4）：`admission.technicalDetail` 里是
   **本次请求实际携带的地址**（可能是 `asset://` / `data:` / `/files/...` / 本机内网地址）——
   它是第三层内容，只能渲染进默认收起的「技术详情」。
   折叠壳复用全仓唯一实现（`TechnicalDetailCollapse.tsx`），不另建一套。 */
import { TechnicalDetailSection } from '../../project/ProjectWorkbench/components/workbench/TechnicalDetailCollapse'

const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.oga', '.opus', '.wma', '.aiff', '.aif']

type StudioAudioFile = {
  id: string
  name: string
  type?: string
  thumbnail?: string
}

type ShotAudioBindingSectionProps = {
  shotId: string
  /** 当前绑定的 file_id（来自 shot_detail.audio_file_id），空表示未绑定。 */
  audioFileId: string | null | undefined
  /** 是否已**明确标记**本镜无需声音（`shot_details.audio_opt_out`）。 */
  audioOptOut?: boolean
  /**
   * 写入绑定。交给宿主页面（工作室的 `onPatchShotDetailImmediate`）：
   * 它写完会用服务端返回体刷新详情，从而保证"界面看到的 = 刷新后仍在的"。
   */
  onSave: (fileId: string | null) => Promise<void>
  /**
   * 明确标记 / 取消"本镜无需声音"。交给宿主页面写 `audio_opt_out`：
   * 后端与 `audio_file_id` 互斥（标记无需声音会解绑音频，反之亦然）。
   */
  onSaveOptOut?: (optOut: boolean) => Promise<void>
  /** 可选：上传时把音频挂到项目/章节下，便于素材库按项目筛选。 */
  projectId?: string | null
  chapterId?: string | null
  /**
   * 后端生成计划里的**参考音频审计**（`VideoSubmitPlanRead.audio`）。
   *
   * 为什么要传进来：光知道"绑了 file_id"说明不了供应商取不取得到 —— 本地/相对路径、
   * 内网地址、供应商不接受内嵌 base64 都会被后端在**请求计划层**排除。
   * 传进来之后，这里就能在**提交之前**显示「已绑定，但供应商无法访问」及原因，
   * 而不是等生成失败才说。缺省（计划未加载）时退回"状态未知"，不猜。
   */
  audioAudit?: AudioAudit | null
}

function isAudioFileName(name: string): boolean {
  const lower = (name || '').toLowerCase()
  return AUDIO_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

function fileNameFromId(fileId: string | null | undefined, files: StudioAudioFile[]): string {
  const id = (fileId ?? '').trim()
  if (!id) return ''
  return files.find((item) => item.id === id)?.name ?? id
}

export function ShotAudioBindingSection({
  shotId,
  audioFileId,
  audioOptOut = false,
  onSave,
  onSaveOptOut,
  projectId,
  chapterId,
  audioAudit = null,
}: ShotAudioBindingSectionProps) {
  const [files, setFiles] = useState<StudioAudioFile[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [keyword, setKeyword] = useState('')

  const boundId = (audioFileId ?? '').trim()

  /** 拉素材库里的音频（后端列表暂无 type 过滤，这里取最近 100 条再筛 audio）。 */
  const loadAudioFiles = useCallback(async () => {
    setLoading(true)
    try {
      const res = await StudioFilesService.listFilesApiApiV1StudioFilesGet({
        page: 1,
        pageSize: 100,
        order: 'created_at',
        isDesc: true,
      })
      const items = (res.data?.items ?? []) as unknown as StudioAudioFile[]
      setFiles(items.filter((item) => String(item.type ?? '') === 'audio'))
      setError('')
    } catch (e) {
      setError(toUserFacingText(e, '音频素材加载失败'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadAudioFiles()
  }, [loadAudioFiles])

  const boundName = useMemo(() => fileNameFromId(boundId, files), [boundId, files])

  /**
   * 绑定状态文案：**由后端计划里的审计字段驱动**（`audio.included` / `excluded_reason`）。
   * 绑定本身（file_id 存在）与"供应商能不能取到"是两件事 —— 这里如实分开显示。
   */
  const admission = useMemo(() => describeAudioAdmission(audioAudit), [audioAudit])

  const bindFile = useCallback(
    async (fileId: string | null) => {
      if (!shotId) return
      setSaving(true)
      try {
        await onSave(fileId)
        message.success(fileId ? '已绑定声音到这条分镜' : '已解绑声音')
      } catch (e) {
        void showUserError(e, '保存声音绑定失败')
      } finally {
        setSaving(false)
      }
    },
    [onSave],
  )

  /** 明确标记/取消"本镜无需声音"（避免被当成漏绑）。 */
  const toggleOptOut = useCallback(
    async (next: boolean) => {
      if (!shotId || !onSaveOptOut) return
      setSaving(true)
      try {
        await onSaveOptOut(next)
        message.success(next ? '已标记：本镜无需声音' : '已取消"无需声音"标记')
      } catch (e) {
        void showUserError(e, '保存失败')
      } finally {
        setSaving(false)
      }
    },
    [onSaveOptOut, shotId],
  )

  const handleUpload = useCallback(
    async (file: File) => {
      if (!isAudioFileName(file.name)) {
        message.error(`请上传音频文件（${AUDIO_EXTENSIONS.slice(0, 6).join(' / ')} 等）`)
        return
      }
      setUploading(true)
      try {
        const res = await StudioFilesService.uploadFileApiApiV1StudioFilesUploadPost({
          formData: {
            file: file as unknown as string,
            project_id: projectId ?? null,
            chapter_id: chapterId ?? null,
            shot_id: shotId,
            usage_kind: projectId ? 'upload' : null,
          },
          name: file.name.replace(/\.[^.]+$/, ''),
        })
        const created = res.data as unknown as { id?: string } | undefined
        const fileId = String(created?.id ?? '').trim()
        if (!fileId) {
          message.error('上传成功但没有拿到文件编号，请刷新后重试')
          return
        }
        await loadAudioFiles()
        await bindFile(fileId)
      } catch (e) {
        void showUserError(e, '音频上传失败（请确认是音频文件）')
      } finally {
        setUploading(false)
      }
    },
    [bindFile, chapterId, loadAudioFiles, projectId, shotId],
  )

  const columns: TableColumnsType<StudioAudioFile> = [
    { title: '名称', dataIndex: 'name', render: (name: string) => name || '（未命名）' },
    {
      title: '试听',
      dataIndex: 'thumbnail',
      width: 200,
      render: (url: string) => {
        const src = url || ''
        if (!src) return <span className="text-slate-400 text-xs">无地址</span>
        const absolute = src.startsWith('http') ? src : `${OpenAPI.BASE}${src}`
        return <audio controls preload="none" src={absolute} className="h-8 w-44" />
      },
    },
    {
      title: '操作',
      key: 'action',
      width: 88,
      render: (_: unknown, row) => (
        <Button
          size="small"
          type="link"
          onClick={() => {
            void bindFile(row.id)
            setPickerOpen(false)
          }}
        >
          绑定
        </Button>
      ),
    },
  ]

  const filtered = keyword.trim()
    ? files.filter((item) => (item.name || '').toLowerCase().includes(keyword.trim().toLowerCase()))
    : files

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-slate-900">声音绑定</div>
          <Typography.Text type="secondary" className="text-[11px]">
            给这条分镜绑定配音 / 台词音频。绑定后它一定会出现在交付内容的
            「绑定素材·实际文件」里。「能不能进视频生成请求」（参考音频）是另一件事，
            看两点：①生成服务要支持参考音频；②地址必须是公网可访问的地址，或已登记的素材引用。
            不满足时这里会直接显示「已绑定，但当前服务取不到这条声音」及原因，不用等生成失败。
            参考音频的数量与时长按当前生成服务的规定执行（超出范围会被排除并给原因）。
            {REFERENCE_AUDIO_VS_FINAL_TRACK}
          </Typography.Text>
        </div>
        <Space size={8}>
          <Upload
            showUploadList={false}
            accept="audio/*"
            beforeUpload={(file) => {
              void handleUpload(file as unknown as File)
              return false
            }}
          >
            <Button size="small" type="primary" icon={<UploadOutlined />} loading={uploading} disabled={saving}>
              上传音频并绑定
            </Button>
          </Upload>
          <Button size="small" icon={<SoundOutlined />} disabled={saving} onClick={() => setPickerOpen(true)}>
            从素材库选择
          </Button>
          <Button
            size="small"
            disabled={saving || !onSaveOptOut || audioOptOut}
            onClick={() => void toggleOptOut(true)}
          >
            本镜无需声音
          </Button>
          <Button
            size="small"
            icon={<ReloadOutlined />}
            disabled={saving}
            onClick={() => void loadAudioFiles()}
          >
            刷新
          </Button>
        </Space>
      </div>

      {error ? <Alert type="error" showIcon message="音频素材加载失败" description={error} /> : null}

      {audioOptOut && !boundId ? (
        <Alert
          type="info"
          showIcon
          message="已明确标记：本镜无需声音"
          description={
            <div className="space-y-2">
              <div className="text-xs text-slate-500">
                这条分镜不会被当成"漏绑声音"；导出交付文本里也会写明"本镜明确标记：无需声音"。
              </div>
              <Space size={8}>
                <Button size="small" loading={saving} disabled={!onSaveOptOut} onClick={() => void toggleOptOut(false)}>
                  取消该标记
                </Button>
              </Space>
            </div>
          }
        />
      ) : boundId ? (
        <Alert
          type={admission.blocked ? 'warning' : admission.tone === 'success' ? 'success' : 'info'}
          showIcon
          message={
            admission.blocked
              ? `已绑定声音：${boundName} —— ${admission.title}`
              : admission.tone === 'success'
                ? `已绑定声音：${boundName}（会作为参考音频进入本次请求）`
                : `已绑定声音：${boundName}`
          }
          description={
            <div className="space-y-2">
              {admission.blocked ? (
                <>
                  <div className="text-xs text-orange-700">{admission.detail}</div>
                  {admission.fix ? <div className="text-xs text-slate-600">怎么修：{admission.fix}</div> : null}
                  <div className="text-[11px] text-slate-400">{admission.terminology}</div>
                </>
              ) : (
                <>
                  <div className="text-[11px] text-slate-500">{admission.tag}</div>
                  {admission.detail ? <div className="text-xs text-slate-600">{admission.detail}</div> : null}
                  {admission.tone === 'success' && admission.fix ? (
                    <div className="text-[11px] text-slate-400">{admission.fix}</div>
                  ) : null}
                </>
              )}
              <div className="text-xs text-slate-500">
                <span className="text-gray-500">已绑定（内部 ID 见工作区「技术详情」）</span>
              </div>
              {admission.technicalDetail ? (
                /* 第 3 批收尾（审计 §4.3 模式 4 / §3.4）：主区的 `detail` 只说"地址是什么形态"，
                   **具体地址 / 协议形态只在这里**（默认收起，展开才看得到）。 */
                <TechnicalDetailSection testId="audio-admission-technical-detail" hint="生成服务这次会收到哪个地址">
                  <div className="break-all text-[11px]">{admission.technicalDetail}</div>
                </TechnicalDetailSection>
              ) : null}
              <Space size={8}>
                <Button size="small" danger icon={<DeleteOutlined />} loading={saving} onClick={() => void bindFile(null)}>
                  解绑
                </Button>
              </Space>
            </div>
          }
        />
      ) : (
        <div className="rounded border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-xs text-slate-500">
          这条分镜还没有绑定声音。上传一条台词音频、从素材库挑一条，或点右上角「本镜无需声音」明确表态。
        </div>
      )}

      {!loading && files.length === 0 ? (
        <div className="text-[11px] text-slate-400">
          素材库里目前没有音频文件。上面的「上传音频并绑定」会同时完成上传与绑定。
        </div>
      ) : null}

      <Modal
        title="选择音频素材"
        open={pickerOpen}
        footer={null}
        onCancel={() => setPickerOpen(false)}
        width={680}
      >
        <Space direction="vertical" className="w-full" size="middle">
          <Input
            allowClear
            placeholder="按名称筛选"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>{`素材库里共 ${files.length} 条音频${keyword.trim() ? `，命中 ${filtered.length} 条` : ''}`}</span>
            <Tag color="blue">音频素材</Tag>
          </div>
          {filtered.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的音频素材" />
          ) : (
            <Table<StudioAudioFile>
              rowKey="id"
              size="small"
              loading={loading}
              columns={columns}
              dataSource={filtered}
              pagination={{ pageSize: 6, size: 'small' }}
            />
          )}
        </Space>
      </Modal>
    </div>
  )
}

export default ShotAudioBindingSection
