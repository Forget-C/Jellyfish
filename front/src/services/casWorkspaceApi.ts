/**
 * CAS EP001 工作台的数据访问层。
 *
 * 纪律：
 * - **全部**请求走生成客户端（src/services/generated），不保留任何手写的并行实现；
 * - 复用既有任务中心状态接口（FilmService），不新建任务系统；
 * - 字幕按既有 FileItem + FileUsage 关联检索（usage_kind=subtitle），不新增字幕表。
 */
import {
  CryptoAnimalStudioService,
  FilmService,
  StudioChaptersService,
  StudioFilesService,
  StudioShotDetailsService,
  StudioShotDialogLinesService,
  StudioShotsService,
} from './generated'
import type {
  CasImportTaskAccepted,
  ChapterRead,
  FileRead,
  ImportResult,
  ShotDetailRead,
  ShotDialogLineRead,
  ShotRead,
  SubtitleArtifact,
} from './generated'
import { buildFileDownloadUrl } from '../pages/aiStudio/assets/utils'

/** 任务终态集合：到达即停止轮询。 */
export const TERMINAL_TASK_STATUSES = ['succeeded', 'failed', 'cancelled'] as const

export type TaskStatusValue =
  | 'pending'
  | 'running'
  | 'streaming'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

export interface TaskStatusView {
  id: string
  status: TaskStatusValue
  progress?: number
  error?: string
}

/** 单个镜头在工作台中的聚合视图（Shot + ShotDetail + 对白）。 */
export interface ShotBundle {
  shot: ShotRead
  detail: ShotDetailRead | null
  dialogLines: ShotDialogLineRead[]
}

export function isTerminalStatus(status: string | undefined): boolean {
  return !!status && (TERMINAL_TASK_STATUSES as readonly string[]).includes(status)
}

/** WebVTT 的 MIME 类型（产物生成时写入的 content-type）。 */
export const WEBVTT_MIME_TYPE = 'text/vtt'

/** 取章节详情（Chapter 即剧集实体）。 */
export async function fetchChapter(chapterId: string): Promise<ChapterRead | null> {
  const res = await StudioChaptersService.getChapterApiV1StudioChaptersChapterIdGet({ chapterId })
  return res.data ?? null
}

/**
 * 取章节下的镜头，并聚合各自的 ShotDetail 与对白。
 *
 * ShotRead 不内嵌 detail/对白，因此分别调用既有子资源接口再按 index 排序。
 */
export async function fetchShotBundles(chapterId: string): Promise<ShotBundle[]> {
  const listed = await StudioShotsService.listShotsApiV1StudioShotsGet({
    chapterId,
    pageSize: 100,
    order: 'index',
  })
  const shots = (listed.data?.items ?? []).slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0))

  return Promise.all(
    shots.map(async (shot) => {
      let detail: ShotDetailRead | null = null
      let dialogLines: ShotDialogLineRead[] = []
      try {
        const detailRes =
          await StudioShotDetailsService.getShotDetailApiV1StudioShotDetailsShotIdGet({
            shotId: shot.id,
          })
        detail = detailRes.data ?? null
      } catch {
        detail = null // 细节缺失不应让整页失败
      }
      if (detail) {
        try {
          const lines =
            await StudioShotDialogLinesService.listShotDialogLinesApiV1StudioShotDialogLinesGet({
              shotDetailId: detail.id,
              pageSize: 100,
              order: 'index',
            })
          dialogLines = (lines.data?.items ?? [])
            .slice()
            .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
        } catch {
          dialogLines = []
        }
      }
      return { shot, detail, dialogLines }
    }),
  )
}

/**
 * 按章节取字幕产物（usage_kind=subtitle）。
 *
 * 用 chapter_id 而不是 chapter_title：标题不唯一，ID 才能稳定定位。
 */
export async function fetchSubtitleFiles(
  projectId: string,
  chapterId: string,
): Promise<FileRead[]> {
  const res = await StudioFilesService.listFilesApiApiV1StudioFilesGet({
    projectId,
    chapterId,
    usageKind: 'subtitle',
    pageSize: 50,
  })
  return res.data?.items ?? []
}

/**
 * 下载字幕原文（文本），用于只读预览。
 *
 * 生成客户端对非 JSON 响应返回 `response.text()`，因此这里直接得到 WebVTT 字符串。
 */
export async function fetchSubtitleText(fileId: string): Promise<string> {
  const res = await StudioFilesService.downloadFileApiApiV1StudioFilesFileIdDownloadGet({ fileId })
  return typeof res === 'string' ? res : String(res ?? '')
}

/** 既有下载端点的绝对地址（复用仓库既有的 buildFileDownloadUrl）。 */
export function subtitleDownloadUrl(fileId: string): string {
  return buildFileDownloadUrl(fileId) ?? ''
}

/** 发起异步导入（既有 CAS 端点，经生成客户端调用）。 */
export async function startAsyncImport(payload: {
  project_id: string
  idempotency_key: string
  episode_package: unknown
  dry_run?: boolean
}): Promise<CasImportTaskAccepted> {
  const res =
    await CryptoAnimalStudioService.importEpisodeAsyncEndpointApiV1CryptoAnimalStudioImportAsyncPost(
      { requestBody: payload as never },
    )
  const data = res.data
  if (!data) {
    throw new Error('import/async returned no data')
  }
  return data
}

/** 查询任务状态（既有任务中心）。 */
export async function fetchTaskStatus(taskId: string): Promise<TaskStatusView> {
  const res = await FilmService.getTaskStatusApiV1FilmTasksTaskIdStatusGet({ taskId })
  const data = (res as { data?: unknown })?.data
  return (data ?? res) as TaskStatusView
}

/** 查询任务结果（成功后拿 ImportResult，含 subtitle_artifacts）。 */
export async function fetchTaskResult(taskId: string): Promise<ImportResult | null> {
  const res = await FilmService.getTaskResultApiV1FilmTasksTaskIdResultGet({ taskId })
  const data = (res as { data?: unknown })?.data
  return (data as ImportResult | null) ?? null
}

export type {
  CasImportTaskAccepted,
  ChapterRead,
  FileRead,
  ImportResult,
  ShotDetailRead,
  ShotDialogLineRead,
  ShotRead,
  SubtitleArtifact,
}
