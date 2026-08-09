/**
 * Step 7 集成测试：证明 ShotRenderPanel 真的挂载在 EP001 工作台里，
 * 且选中/切换/取消选中都把正确的 production_shot_id 传给它。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import type * as CasApi from '../../../services/casWorkspaceApi'

vi.mock('../../../services/casWorkspaceApi', async () => {
  const actual = await vi.importActual<typeof CasApi>('../../../services/casWorkspaceApi')
  return {
    ...actual,
    fetchChapter: vi.fn(),
    fetchShotBundles: vi.fn(),
    fetchSubtitleFiles: vi.fn(),
    fetchSubtitleText: vi.fn(),
    fetchProductionJobs: vi.fn(),
    fetchProductionJob: vi.fn(),
    fetchProductionArtifacts: vi.fn(),
    startShotRender: vi.fn(),
  }
})

import * as api from '../../../services/casWorkspaceApi'
import Ep001Workspace from './Ep001Workspace'

const CHAPTER = {
  id: 'ch-1',
  project_id: 'proj-1',
  title: 'BTC Breaks Out',
  summary: '',
  storyboard_count: 2,
  status: 'draft',
}

function bundle(id: string, index: number, title: string) {
  return {
    shot: { id, chapter_id: 'ch-1', index, title, status: 'pending', script_excerpt: '' },
    detail: { id, duration: 3, camera_shot: 'MEDIUM', angle: 'EYE_LEVEL', movement: 'STATIC' },
    dialogLines: [],
  }
}

const JOB = {
  id: 'job-1',
  project_id: 'proj-1',
  episode_id: 'CAS-EP001',
  status: 'running',
  current_stage: 'video_generation',
  provider_mode: 'render',
  render_task: null,
  shots: [
    { id: 'pshot-1', source_shot_id: 'SC01', sequence: 1, status: 'pending' },
    { id: 'pshot-2', source_shot_id: 'SC02', sequence: 2, status: 'pending' },
  ],
}

function renderWorkspace() {
  return render(
    <MemoryRouter initialEntries={['/projects/proj-1/chapters/ch-1/cas']}>
      <Routes>
        <Route path="/projects/:projectId/chapters/:chapterId/cas" element={<Ep001Workspace />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.mocked(api.fetchChapter).mockResolvedValue(CHAPTER as never)
  vi.mocked(api.fetchShotBundles).mockResolvedValue([
    bundle('s1', 1, 'The premature toast'),
    bundle('s2', 2, 'Confirmation, please'),
  ] as never)
  vi.mocked(api.fetchSubtitleFiles).mockResolvedValue([] as never)
  vi.mocked(api.fetchProductionJobs).mockResolvedValue([JOB] as never)
  vi.mocked(api.fetchProductionJob).mockResolvedValue(JOB as never)
  vi.mocked(api.fetchProductionArtifacts).mockResolvedValue([] as never)
})

describe('Ep001Workspace → ShotRenderPanel mounting', () => {
  it('requests production jobs using the route chapterId, not a guessed episode id', async () => {
    renderWorkspace()
    await waitFor(() => expect(api.fetchProductionJobs).toHaveBeenCalled())
    // ChapterRead 不含 episode_id；权威映射由后端按 chapter_id 从导入台账解析。
    expect(api.fetchProductionJobs).toHaveBeenCalledWith('proj-1', { chapterId: 'ch-1' })
  })

  it('does not show the render panel until a shot is selected', async () => {
    renderWorkspace()
    await waitFor(() => expect(screen.getByTestId('shot-list')).toBeInTheDocument())
    expect(screen.queryByTestId('render-panel')).not.toBeInTheDocument()
  })

  it('renders the panel for the selected shot with its production_shot_id', async () => {
    renderWorkspace()
    await waitFor(() => expect(screen.getByTestId('shot-list')).toBeInTheDocument())
    fireEvent.click(screen.getAllByTestId('shot-row')[0])

    await waitFor(() => expect(screen.getByTestId('render-panel')).toBeInTheDocument())
    // sequence 1 → pshot-1（不是 chapter id、不是 episode id、不是 job id）
    await waitFor(() => expect(api.fetchProductionJob).toHaveBeenCalledWith('job-1'))
    expect(screen.getByTestId('generate-video')).toBeInTheDocument()
  })

  it('switching shots swaps the panel to the new production shot', async () => {
    renderWorkspace()
    await waitFor(() => expect(screen.getByTestId('shot-list')).toBeInTheDocument())

    fireEvent.click(screen.getAllByTestId('shot-row')[0])
    await waitFor(() => expect(screen.getByTestId('render-panel')).toBeInTheDocument())

    vi.mocked(api.startShotRender).mockResolvedValue({
      task_id: 't1',
      status: 'pending',
      is_terminal: false,
    } as never)
    fireEvent.click(screen.getByTestId('generate-video'))
    await waitFor(() => expect(api.startShotRender).toHaveBeenCalledWith('job-1', 'pshot-1', 'preview'))

    // 切换到第二个镜头（accordion 会关掉第一个）
    fireEvent.click(screen.getAllByTestId('shot-row')[1])
    await waitFor(() => expect(screen.getByTestId('render-panel')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('generate-video'))
    await waitFor(() => expect(api.startShotRender).toHaveBeenLastCalledWith('job-1', 'pshot-2', 'preview'))
  })

  it('shows a clear notice when no production shot maps to the selection', async () => {
    vi.mocked(api.fetchProductionJobs).mockResolvedValue([{ ...JOB, shots: [] }] as never)
    renderWorkspace()
    await waitFor(() => expect(screen.getByTestId('shot-list')).toBeInTheDocument())
    fireEvent.click(screen.getAllByTestId('shot-row')[0])
    await waitFor(() =>
      expect(screen.getByTestId('render-panel-unavailable')).toBeInTheDocument(),
    )
    expect(screen.queryByTestId('render-panel')).not.toBeInTheDocument()
  })

  it('shows the notice when the episode has no production job at all', async () => {
    vi.mocked(api.fetchProductionJobs).mockResolvedValue([] as never)
    renderWorkspace()
    await waitFor(() => expect(screen.getByTestId('shot-list')).toBeInTheDocument())
    fireEvent.click(screen.getAllByTestId('shot-row')[0])
    await waitFor(() =>
      expect(screen.getByTestId('render-panel-unavailable')).toBeInTheDocument(),
    )
  })
})
