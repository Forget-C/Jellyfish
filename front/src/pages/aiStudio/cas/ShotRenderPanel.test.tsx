import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import type * as CasApi from '../../../services/casWorkspaceApi'

vi.mock('../../../services/casWorkspaceApi', async () => {
  const actual = await vi.importActual<typeof CasApi>('../../../services/casWorkspaceApi')
  return {
    ...actual,
    fetchProductionJob: vi.fn(),
    fetchProductionArtifacts: vi.fn(),
    startShotRender: vi.fn(),
  }
})

import * as api from '../../../services/casWorkspaceApi'
import ShotRenderPanel from './ShotRenderPanel'

const JOB = 'job-1'
const SHOT = 'pshot-1'

function job(renderTask: Partial<CasApi.RenderTaskView> | null) {
  return {
    id: JOB,
    project_id: 'p',
    episode_id: 'CAS-EP001',
    status: 'running',
    current_stage: 'video_generation',
    provider_mode: 'render',
    render_task: renderTask
      ? {
          task_id: 't1',
          status: 'running',
          progress: 20,
          stage_message: 'Submitted to render provider',
          provider_task_id: null,
          error_reason: null,
          attempt: 1,
          is_terminal: false,
          ...renderTask,
        }
      : null,
  }
}

function artifact(over: Partial<CasApi.RenderArtifactView> = {}) {
  return {
    id: 'a1',
    production_shot_id: SHOT,
    artifact_type: 'video',
    stage: 'video_generation',
    provider: 'comfyui',
    provider_model: '',
    file_path: 'cas/renders/job-1/pshot-1/v.mp4',
    mime_type: 'video/mp4',
    checksum: '',
    file_id: 'file-1',
    size_bytes: null,
    download_url: '/api/v1/studio/files/file-1/download',
    provider_job_id: 'prompt-1',
    attempt: 1,
    ...over,
  }
}

function renderPanel(shotId = SHOT) {
  return render(<ShotRenderPanel jobId={JOB} productionShotId={shotId} />)
}

beforeEach(() => {
  vi.mocked(api.fetchProductionJob).mockResolvedValue(job(null) as never)
  vi.mocked(api.fetchProductionArtifacts).mockResolvedValue([] as never)
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('ShotRenderPanel', () => {
  it('recovers state from the backend on initial load', async () => {
    vi.mocked(api.fetchProductionJob).mockResolvedValue(
      job({ status: 'succeeded', progress: 100, is_terminal: true }) as never,
    )
    vi.mocked(api.fetchProductionArtifacts).mockResolvedValue([artifact()] as never)
    renderPanel()
    await waitFor(() => expect(screen.getByTestId('render-status')).toBeInTheDocument())
    expect(screen.getByTestId('render-status-tag').textContent).toContain('succeeded')
    expect(screen.getByTestId('artifact-list')).toBeInTheDocument()
    expect(api.fetchProductionJob).toHaveBeenCalledWith(JOB)
  })

  it('shows the empty state when no attempt exists', async () => {
    renderPanel()
    await waitFor(() => expect(screen.getByTestId('render-empty')).toBeInTheDocument())
    expect(screen.getByTestId('artifacts-empty')).toBeInTheDocument()
  })

  it('only shows artifacts belonging to the selected shot', async () => {
    vi.mocked(api.fetchProductionArtifacts).mockResolvedValue([
      artifact(),
      artifact({ id: 'a2', production_shot_id: 'other-shot' }),
    ] as never)
    renderPanel()
    await waitFor(() => expect(screen.getByTestId('artifact-list')).toBeInTheDocument())
    expect(screen.getAllByTestId('artifact-item')).toHaveLength(1)
  })

  it('sends profile=preview by default', async () => {
    vi.mocked(api.startShotRender).mockResolvedValue({
      task_id: 't9', status: 'pending', is_terminal: false, attempt: 1,
    } as never)
    renderPanel()
    await waitFor(() => expect(screen.getByTestId('generate-video')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('generate-video'))
    // 预览档是默认值：一般 Render 操作必须显式传 preview，不依赖后端默认
    await waitFor(() => expect(api.startShotRender).toHaveBeenCalledWith(JOB, SHOT, 'preview'))
  })

  it('sends profile=final after selecting the final option', async () => {
    vi.mocked(api.startShotRender).mockResolvedValue({
      task_id: 't10', status: 'pending', is_terminal: false, attempt: 1,
    } as never)
    renderPanel()
    await waitFor(() => expect(screen.getByTestId('render-profile')).toBeInTheDocument())
    fireEvent.click(screen.getByText(/正式渲染/))
    fireEvent.click(screen.getByTestId('generate-video'))
    await waitFor(() => expect(api.startShotRender).toHaveBeenCalledWith(JOB, SHOT, 'final'))
  })

  it('shows both resolutions so the heavier option is explicit', async () => {
    renderPanel()
    await waitFor(() => expect(screen.getByTestId('render-profile')).toBeInTheDocument())
    expect(screen.getByText(/432×768/)).toBeInTheDocument()
    expect(screen.getByText(/1080×1920/)).toBeInTheDocument()
    expect(screen.getByText(/高负载/)).toBeInTheDocument()
  })

  it('starts a render and disables the button while active', async () => {
    vi.mocked(api.startShotRender).mockResolvedValue({
      task_id: 't9',
      status: 'pending',
      progress: 0,
      stage_message: 'Queued',
      is_terminal: false,
      attempt: 1,
    } as never)
    renderPanel()
    await waitFor(() => expect(screen.getByTestId('generate-video')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('generate-video'))
    await waitFor(() => expect(api.startShotRender).toHaveBeenCalledWith(JOB, SHOT, 'preview'))
    await waitFor(() =>
      expect(screen.getByTestId('generate-video').closest('button')).toBeDisabled(),
    )
  })

  it('renders determinate progress when a number is provided', async () => {
    vi.mocked(api.fetchProductionJob).mockResolvedValue(job({ progress: 80 }) as never)
    renderPanel()
    await waitFor(() =>
      expect(screen.getByTestId('render-progress-determinate')).toBeInTheDocument(),
    )
  })

  it('renders indeterminate progress when progress is null', async () => {
    vi.mocked(api.fetchProductionJob).mockResolvedValue(job({ progress: null }) as never)
    renderPanel()
    await waitFor(() =>
      expect(screen.getByTestId('render-progress-indeterminate')).toBeInTheDocument(),
    )
  })

  it('shows provider-processing between submit and download', async () => {
    vi.mocked(api.fetchProductionJob).mockResolvedValue(job({ progress: 20 }) as never)
    renderPanel()
    await waitFor(() => expect(screen.getByTestId('provider-processing')).toBeInTheDocument())
  })

  it('displays the stage message', async () => {
    vi.mocked(api.fetchProductionJob).mockResolvedValue(
      job({ stage_message: 'Downloading generated video', progress: 80 }) as never,
    )
    renderPanel()
    await waitFor(() =>
      expect(screen.getByTestId('render-stage').textContent).toBe('Downloading generated video'),
    )
  })

  it('shows only the safe failure reason and offers retry', async () => {
    vi.mocked(api.fetchProductionJob).mockResolvedValue(
      job({
        status: 'failed',
        is_terminal: true,
        error_reason: 'provider: The render provider reported an execution failure.',
      }) as never,
    )
    renderPanel()
    await waitFor(() => expect(screen.getByTestId('render-failure')).toBeInTheDocument())
    const text = screen.getByTestId('render-failure').textContent || ''
    expect(text).not.toContain('Traceback')
    expect(text).not.toContain('sk-')
    expect(screen.getByTestId('retry-render')).toBeInTheDocument()
  })

  it('keeps earlier artifacts visible after starting a retry', async () => {
    vi.mocked(api.fetchProductionJob).mockResolvedValue(
      job({ status: 'failed', is_terminal: true, error_reason: 'provider: failed' }) as never,
    )
    vi.mocked(api.fetchProductionArtifacts).mockResolvedValue([artifact()] as never)
    vi.mocked(api.startShotRender).mockResolvedValue({
      task_id: 't2',
      status: 'pending',
      is_terminal: false,
      attempt: 2,
    } as never)
    renderPanel()
    await waitFor(() => expect(screen.getByTestId('artifact-list')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('retry-render'))
    await waitFor(() => expect(api.startShotRender).toHaveBeenCalled())
    expect(screen.getAllByTestId('artifact-item')).toHaveLength(1)
  })

  it('plays the artifact via download_url and never from storage_key', async () => {
    vi.mocked(api.fetchProductionArtifacts).mockResolvedValue([artifact()] as never)
    renderPanel()
    await waitFor(() => expect(screen.getByTestId('artifact-video')).toBeInTheDocument())
    const src = screen.getByTestId('artifact-video').getAttribute('src') || ''
    expect(src).toBe('/api/v1/studio/files/file-1/download')
    expect(src).not.toContain('cas/renders')
  })

  it('renders safely when size_bytes is null', async () => {
    vi.mocked(api.fetchProductionArtifacts).mockResolvedValue([artifact()] as never)
    renderPanel()
    await waitFor(() => expect(screen.getByTestId('artifact-size')).toBeInTheDocument())
    expect(screen.getByTestId('artifact-size').textContent).toBe('大小未知')
  })

  it('shows an unplayable notice when download_url is absent', async () => {
    vi.mocked(api.fetchProductionArtifacts).mockResolvedValue([
      artifact({ download_url: null, file_id: null }),
    ] as never)
    renderPanel()
    await waitFor(() => expect(screen.getByTestId('artifact-unplayable')).toBeInTheDocument())
  })

  it('polls while non-terminal and stops at a terminal state', async () => {
    vi.useFakeTimers()
    vi.mocked(api.fetchProductionJob)
      .mockResolvedValueOnce(job({ progress: 20 }) as never)
      .mockResolvedValue(job({ status: 'succeeded', progress: 100, is_terminal: true }) as never)

    renderPanel()
    await vi.advanceTimersByTimeAsync(0)
    expect(api.fetchProductionJob).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(3000)
    expect(api.fetchProductionJob).toHaveBeenCalledTimes(2)

    const callsAtTerminal = vi.mocked(api.fetchProductionJob).mock.calls.length
    await vi.advanceTimersByTimeAsync(30000)
    expect(vi.mocked(api.fetchProductionJob).mock.calls.length).toBe(callsAtTerminal)
  })

  it('never issues overlapping poll requests', async () => {
    vi.useFakeTimers()
    let release: (v: unknown) => void = () => undefined
    const pending = new Promise((resolve) => {
      release = resolve
    })
    vi.mocked(api.fetchProductionJob).mockImplementation(
      () => pending.then(() => job({ progress: 20 })) as never,
    )
    renderPanel()
    await vi.advanceTimersByTimeAsync(0)
    // 首个请求仍未完成时推进多个轮询周期
    await vi.advanceTimersByTimeAsync(30000)
    expect(vi.mocked(api.fetchProductionJob).mock.calls.length).toBe(1)
    release(null)
  })

  it('stops polling on unmount', async () => {
    vi.useFakeTimers()
    vi.mocked(api.fetchProductionJob).mockResolvedValue(job({ progress: 20 }) as never)
    const { unmount } = renderPanel()
    await vi.advanceTimersByTimeAsync(0)
    const before = vi.mocked(api.fetchProductionJob).mock.calls.length
    unmount()
    await vi.advanceTimersByTimeAsync(30000)
    expect(vi.mocked(api.fetchProductionJob).mock.calls.length).toBe(before)
  })

  it('resets and ignores stale responses when the selected shot changes', async () => {
    vi.mocked(api.fetchProductionArtifacts).mockResolvedValue([artifact()] as never)
    const { rerender } = renderPanel()
    await waitFor(() => expect(screen.getByTestId('artifact-list')).toBeInTheDocument())

    // 切到另一个镜头：旧镜头的产物不得残留
    vi.mocked(api.fetchProductionArtifacts).mockResolvedValue([
      artifact({ id: 'a9', production_shot_id: 'pshot-2' }),
    ] as never)
    rerender(<ShotRenderPanel jobId={JOB} productionShotId="pshot-2" />)
    await waitFor(() => expect(screen.getAllByTestId('artifact-item')).toHaveLength(1))
    expect(within(screen.getByTestId('artifact-list')).getByTestId('artifact-video')).toBeInTheDocument()
  })

  it('shows a recoverable API-error state without a tight retry loop', async () => {
    vi.useFakeTimers()
    vi.mocked(api.fetchProductionJob).mockRejectedValue(new Error('backend down') as never)
    renderPanel()
    await vi.advanceTimersByTimeAsync(0)
    await vi.waitFor(() => expect(screen.getByTestId('render-api-error')).toBeInTheDocument())
    const calls = vi.mocked(api.fetchProductionJob).mock.calls.length
    await vi.advanceTimersByTimeAsync(30000)
    expect(vi.mocked(api.fetchProductionJob).mock.calls.length).toBe(calls)
  })
})
