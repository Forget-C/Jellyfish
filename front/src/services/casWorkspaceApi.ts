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
import { get, post } from './http'

/** 任务终态集合：到达即停止轮询。 */
export const TERMINAL_TASK_STATUSES = ['succeeded', 'failed', 'cancelled'] as const

/**
 * Step 7 渲染相关类型。
 *
 * 这些字段是本步骤新增的后端契约（ProductionJobView.render_task 与
 * ProductionArtifactView 的可选字段）。在下一次 `pnpm run openapi:update`
 * 之前生成客户端尚不认识它们，因此此处以手写类型对齐后端 schema，
 * 而不是手工编辑生成代码。
 */
export interface RenderTaskView {
  task_id: string
  status: string
  progress?: number | null
  stage_message?: string | null
  provider_task_id?: string | null
  error_reason?: string | null
  attempt?: number | null
  is_terminal: boolean
}

export interface RenderArtifactView {
  id: string
  production_shot_id?: string | null
  artifact_type: string
  stage: string
  provider: string
  provider_model: string
  file_path: string
  mime_type: string
  checksum: string
  file_id?: string | null
  size_bytes?: number | null
  download_url?: string | null
  provider_job_id?: string | null
  attempt?: number | null
}

export interface ProductionJobSummary {
  id: string
  project_id: string
  episode_id: string
  status: string
  current_stage: string
  provider_mode: string
  render_task?: RenderTaskView | null
  shots?: Array<{ id: string; source_shot_id: string; sequence: number; status: string }>
}

/** 轮询间隔（毫秒）。 */
export const RENDER_POLL_INTERVAL_MS = 3000

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

// --------------------------------------------------------------------------- //
// Step 7：单镜头渲染
// --------------------------------------------------------------------------- //
const CAS_BASE = '/api/v1/crypto-animal-studio'

function unwrap<T>(res: unknown): T {
  return ((res as { data?: T })?.data ?? res) as T
}

/**
 * 按项目/剧集列出生产任务（最新在前）。
 *
 * 工作台必须据此定位 job_id：Jellyfish 的 Chapter/Shot 与 CAS 的
 * CasProductionJob/CasProductionShot 是不同实体，前端无法凭空得到 job_id。
 */
export async function fetchProductionJobs(
  projectId: string,
  filter: { episodeId?: string; chapterId?: string } = {},
): Promise<ProductionJobSummary[]> {
  const query = new URLSearchParams({ project_id: projectId })
  if (filter.episodeId) query.set('episode_id', filter.episodeId)
  // Jellyfish 的 ChapterRead 不含 episode_id（Chapter 不建模剧集）。
  // 权威映射在 cas_import_ledger 里，由后端按 chapter_id 解析。
  if (filter.chapterId) query.set('chapter_id', filter.chapterId)
  const data = unwrap<ProductionJobSummary[]>(
    await get(`${CAS_BASE}/production/jobs?${query.toString()}`),
  )
  return Array.isArray(data) ? data : []
}

/**
 * 从多个生产任务中确定性地选出工作台要用的那一个。
 *
 * **不依赖 API/数据库的返回顺序**：即使后端顺序变化，这里也会重新施加同一条规则
 * —— `created_at` 降序，并列时以 `id` 降序作次级键，构成稳定全序。
 * 因此更旧或无关的任务不会被选中（无关剧集已由 episode_id 过滤在服务端排除）。
 *
 * 局限：`cas_production_jobs` 没有自增列，`created_at` 在同一秒并列时，
 * 次级键 id 是随机 UUID —— 结果稳定可复现，但并非语义上的「最新」。
 */
export function selectActiveProductionJob(
  jobs: ProductionJobSummary[],
): ProductionJobSummary | null {
  if (!jobs.length) return null
  const sorted = [...jobs].sort((a, b) => {
    const createdA = (a as { created_at?: string }).created_at ?? ''
    const createdB = (b as { created_at?: string }).created_at ?? ''
    if (createdA !== createdB) return createdA < createdB ? 1 : -1
    return a.id < b.id ? 1 : -1
  })
  return sorted[0]
}

/**
 * 把工作台里选中的 Jellyfish 镜头映射到 CAS 生产镜头。
 *
 * 依据 sequence/index：导入器把 EpisodePackage 的 shot sequence 写入
 * Jellyfish ``Shot.index``，同时写入 ``CasProductionShot.sequence``，
 * 因此两者以序号对齐。ShotRead 本身不携带 source_shot_id。
 */
export function findProductionShotId(
  job: ProductionJobSummary | null,
  shotIndex: number | undefined,
): string | null {
  if (!job || typeof shotIndex !== 'number') return null
  const match = (job.shots ?? []).find((s) => s.sequence === shotIndex)
  return match?.id ?? null
}

/** 取某个生产任务的完整状态（含 render_task 投影）。 */
export async function fetchProductionJob(jobId: string): Promise<ProductionJobSummary> {
  return unwrap<ProductionJobSummary>(await get(`${CAS_BASE}/production/jobs/${jobId}`))
}

/** 取某个生产任务的全部产物。 */
export async function fetchProductionArtifacts(jobId: string): Promise<RenderArtifactView[]> {
  const data = unwrap<RenderArtifactView[]>(
    await get(`${CAS_BASE}/production/jobs/${jobId}/artifacts`),
  )
  return Array.isArray(data) ? data : []
}

/** 为单个生产镜头发起渲染；后端入队后立即返回。 */
/** 渲染档位。preview = 低分辨率试跑；final = 成片规格。 */
export type RenderProfile = 'preview' | 'final'

/**
 * 为单个生产镜头发起渲染；后端入队后立即返回。
 *
 * ``profile`` 一律显式传出：后端为了保持既有 API 兼容性，未传时默认 final
 * （1080×1920）。前端不依赖该默认值，避免误触发高负载渲染。
 * 具体像素由后端配置决定，前端只传档位名称。
 */
export async function startShotRender(
  jobId: string,
  productionShotId: string,
  profile: RenderProfile = 'preview',
): Promise<RenderTaskView> {
  const query = new URLSearchParams({ profile })
  return unwrap<RenderTaskView>(
    await post(
      `${CAS_BASE}/production/jobs/${jobId}/shots/${productionShotId}/render?${query.toString()}`,
      {},
    ),
  )
}

/** 只保留属于该生产镜头的产物，避免展示其它镜头的结果。 */
export function artifactsForShot(
  artifacts: RenderArtifactView[],
  productionShotId: string,
): RenderArtifactView[] {
  return artifacts.filter(
    (a) => a.production_shot_id === productionShotId && a.artifact_type === 'video',
  )
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
