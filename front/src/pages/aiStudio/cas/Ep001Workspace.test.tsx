import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UserEvent } from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

// 顶层 type-only 导入：运行时被擦除，因此不影响 vi.mock 的提升行为，
// 同时避免 consistent-type-imports 禁止的 `typeof import(...)` 内联注解。
import type * as CasWorkspaceApi from '../../../services/casWorkspaceApi'

vi.mock('../../../services/casWorkspaceApi', async () => {
  const actual = await vi.importActual<typeof CasWorkspaceApi>(
    '../../../services/casWorkspaceApi',
  )
  return {
    ...actual,
    fetchChapter: vi.fn(),
    fetchShotBundles: vi.fn(),
    fetchSubtitleFiles: vi.fn(),
    fetchSubtitleText: vi.fn(),
    fetchTaskStatus: vi.fn(),
    fetchTaskResult: vi.fn(),
    startAsyncImport: vi.fn(),
  }
})

import * as api from '../../../services/casWorkspaceApi'
import Ep001Workspace from './Ep001Workspace'

const CHAPTER = {
  id: 'ch-1',
  project_id: 'proj-1',
  title: 'BTC Breaks Out — Bruno Celebrates Too Early',
  summary: 'Bruno celebrates the breakout too early.',
  storyboard_count: 4,
  status: 'draft',
}

/** fetchShotBundles 已按 index 排序；这里保持已排序形态，顺序断言仍验证渲染顺序。 */
function bundle(
  id: string,
  index: number,
  title: string,
  duration: number,
  text: string,
  speaker: string,
) {
  return {
    shot: { id, chapter_id: 'ch-1', index, title, status: 'pending', script_excerpt: '' },
    detail: { id, duration, camera_shot: 'MEDIUM', angle: 'EYE_LEVEL', movement: 'STATIC' },
    dialogLines: [{ id: index, shot_detail_id: id, index: 1, text, speaker_name: speaker }],
  }
}

const SHOTS = [
  bundle('s1', 1, 'The premature toast', 3, 'Breakout! We are so back!', 'Bruno Bull'),
  bundle('s2', 2, 'Confirmation, please', 7, "The candle hasn't closed yet.", 'Boris Bear'),
  bundle('s3', 3, 'The dip', 7, "It's still green… right?", 'Bruno Bull'),
  bundle('s4', 4, 'Before the close', 5, 'Your confetti arrives before candle close.', 'Milo Cat'),
]

const SUBTITLE_FILE = {
  id: 'file-sub-1',
  name: 'CAS-EP001.zh-Hant.vtt',
  type: 'subtitle' as const,
  tags: ['cas', 'subtitle', 'zh-Hant'],
}

const VTT = `WEBVTT
Language: zh-Hant

NOTE cue=1 shot=SC01
c1
00:00:00.400 --> 00:00:02.000
突破了！我們回來了！
`

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/projects/proj-1/chapters/ch-1/cas']}>
      <Routes>
        <Route path="/projects/:projectId/chapters/:chapterId/cas" element={<Ep001Workspace />} />
      </Routes>
    </MemoryRouter>,
  )
}

/** 轮询间隔，与组件内 POLL_INTERVAL_MS 保持一致。 */
const POLL_INTERVAL_MS = 2000

/**
 * 填写导入表单。
 *
 * JSON 里的 `{` 会被 user-event 当作键盘描述符（如 `{enter}`），因此正文一律用
 * click + paste 输入字面量；不为了迁就测试而去转义产品输入或改动 JSON 解析。
 */
async function fillImportForm(user: UserEvent, json: string, key = 'k1') {
  const keyInput = screen.getByLabelText('idempotency_key')
  await user.click(keyInput)
  await user.paste(key)

  const jsonInput = screen.getByLabelText('Episode Package JSON')
  await user.click(jsonInput)
  await user.paste(json)
}

/**
 * 假定时器下的表单填写与提交。
 *
 * 不用 user-event：它的每一次交互内部都要 await 自己的 setTimeout，在假定时器下
 * 依赖 antd/rc-util 排入的 rAF 与延时被推进，容易挂起到测试超时。fireEvent 是同步的、
 * 不涉及定时器，因此在假定时器场景下更可靠。这是测试手法调整，产品代码未改。
 */
function fillAndSubmitSync(json: string, key = 'k1') {
  fireEvent.change(screen.getByLabelText('idempotency_key'), { target: { value: key } })
  fireEvent.change(screen.getByLabelText('Episode Package JSON'), { target: { value: json } })
  fireEvent.click(screen.getByTestId('import-submit'))
}

beforeEach(() => {
  vi.mocked(api.fetchChapter).mockResolvedValue(CHAPTER as never)
  vi.mocked(api.fetchShotBundles).mockResolvedValue(SHOTS as never)
  vi.mocked(api.fetchSubtitleFiles).mockResolvedValue([SUBTITLE_FILE] as never)
  vi.mocked(api.fetchSubtitleText).mockResolvedValue(VTT)
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('Ep001Workspace', () => {
  it('renders the episode summary once loaded', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByTestId('ep001-workspace')).toBeInTheDocument())
    expect(screen.getByText(/BTC Breaks Out/)).toBeInTheDocument()
    expect(screen.getByText('ch-1')).toBeInTheDocument()
    expect(screen.getByText('proj-1')).toBeInTheDocument()
  })

  it('lists exactly four shots in stored sequence order', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByTestId('shot-list')).toBeInTheDocument())
    const rows = screen.getAllByTestId('shot-row')
    expect(rows).toHaveLength(4)
    expect(rows.map((r) => r.textContent?.trim())).toEqual([
      '#1 The premature toast',
      '#2 Confirmation, please',
      '#3 The dip',
      '#4 Before the close',
    ])
  })

  it('renders English dialogue with its speaker', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(screen.getByTestId('shot-list')).toBeInTheDocument())
    await user.click(screen.getAllByTestId('shot-row')[0])
    await waitFor(() => {
      expect(screen.getByText(/Breakout! We are so back!/)).toBeInTheDocument()
    })
    expect(screen.getByText(/Bruno Bull/)).toBeInTheDocument()
  })

  it('shows subtitle artifact metadata and a download action', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByTestId('subtitle-meta')).toBeInTheDocument())
    const panel = screen.getByTestId('subtitle-panel')
    expect(within(panel).getByText('subtitle')).toBeInTheDocument()
    expect(within(panel).getByText('text/vtt')).toBeInTheDocument()
    expect(within(panel).getByText('file-sub-1')).toBeInTheDocument()
    // 直接取属性再断言，避免依赖 jest-dom 对非对称匹配器的支持差异。
    const href = screen.getByTestId('subtitle-download').getAttribute('href') ?? ''
    expect(href).toContain('/api/v1/studio/files/file-sub-1/download')
  })

  it('previews WebVTT cues as escaped text, never as markup', async () => {
    vi.mocked(api.fetchSubtitleText).mockResolvedValue(
      'WEBVTT\n\nc1\n00:00:00.000 --> 00:00:01.000\n<img src=x onerror="alert(1)">\n',
    )
    renderPage()
    await waitFor(() => expect(screen.getByTestId('subtitle-preview')).toBeInTheDocument())
    expect(screen.getByText('<img src=x onerror="alert(1)">')).toBeInTheDocument()
    // 字幕内容没有变成真实 DOM 元素
    expect(document.querySelector('img')).toBeNull()
  })

  it('shows an empty state when no subtitle artifact exists', async () => {
    vi.mocked(api.fetchSubtitleFiles).mockResolvedValue([])
    renderPage()
    await waitFor(() => expect(screen.getByTestId('subtitle-panel')).toBeInTheDocument())
    expect(screen.getByText(/尚未生成字幕产物/)).toBeInTheDocument()
  })

  it('renders a subtitle error state with a retry action', async () => {
    vi.mocked(api.fetchSubtitleFiles).mockRejectedValue(new Error('boom'))
    renderPage()
    await waitFor(() => expect(screen.getByText('字幕读取失败')).toBeInTheDocument())
    // antd Button 对「恰好两个中文字符」会自动插入一个空格（ConfigProvider
    // autoInsertSpace 默认开启），DOM 里实际是「重 试」而不是「重试」。
    // 因此用允许空白的正则匹配，而不是精确字符串或可访问名称。
    const panel = screen.getByTestId('subtitle-panel')
    expect(within(panel).getByText(/重\s*试/)).toBeInTheDocument()
  })

  it('renders a workspace load error', async () => {
    vi.mocked(api.fetchChapter).mockRejectedValue(new Error('chapter exploded') as never)
    renderPage()
    await waitFor(() => expect(screen.getByText('工作台加载失败')).toBeInTheDocument())
    expect(screen.getByText('chapter exploded')).toBeInTheDocument()
  })

  it('rejects malformed import JSON client-side without calling the API', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(screen.getByTestId('import-panel')).toBeInTheDocument())
    await fillImportForm(user, '{ not json')
    await user.click(screen.getByTestId('import-submit'))
    await waitFor(() => expect(screen.getByTestId('import-error')).toBeInTheDocument())
    expect(api.startAsyncImport).not.toHaveBeenCalled()
  })

  it('surfaces a backend import error', async () => {
    const user = userEvent.setup()
    vi.mocked(api.startAsyncImport).mockRejectedValue({ body: { message: 'QA gate failed' } })
    renderPage()
    await waitFor(() => expect(screen.getByTestId('import-panel')).toBeInTheDocument())
    await fillImportForm(user, '{"a":1}')
    await user.click(screen.getByTestId('import-submit'))
    await waitFor(() => expect(screen.getByText('QA gate failed')).toBeInTheDocument())
  })

  it('polls a pending task through to success and refreshes the workspace', async () => {
    vi.useFakeTimers()
    vi.mocked(api.startAsyncImport).mockResolvedValue({
      task_id: 't1',
      status: 'pending',
      reused: false,
      task_kind: 'cas_import_episode_package',
      relation_type: 'cas_episode_import',
      relation_entity_id: 'x'.repeat(64),
    })
    vi.mocked(api.fetchTaskStatus)
      .mockResolvedValueOnce({ id: 't1', status: 'running' })
      .mockResolvedValue({ id: 't1', status: 'succeeded' })
    vi.mocked(api.fetchTaskResult).mockResolvedValue({
      status: 'imported',
      chapter_id: 'ch-1',
      subtitle_artifacts: [
        {
          file_id: 'file-sub-1',
          language_tag: 'zh-Hant',
          storage_key: 'cas/subtitles/proj-1/CAS-EP001/zh-Hant.vtt',
          cue_count: 4,
          byte_size: 321,
          created: true,
        },
      ],
    } as never)

    renderPage()
    // 冲刷首屏加载的 mock promise（不推进定时器）
    await vi.advanceTimersByTimeAsync(0)
    expect(screen.getByTestId('import-panel')).toBeInTheDocument()

    fillAndSubmitSync('{"a":1}')

    // 提交与首次轮询都是已解决的 promise，冲刷微任务即可
    await vi.advanceTimersByTimeAsync(0)
    expect(api.fetchTaskStatus).toHaveBeenCalledTimes(1)
    expect(api.fetchTaskResult).not.toHaveBeenCalled()

    // 推进一个轮询周期 → 第二次轮询返回 succeeded
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    expect(api.fetchTaskStatus).toHaveBeenCalledTimes(2)
    expect(api.fetchTaskResult).toHaveBeenCalledWith('t1')
    // 成功后用返回的导入结果刷新工作台（最小必要的异步断言）
    await vi.waitFor(() => expect(screen.getByTestId('import-result')).toBeInTheDocument())
    expect(vi.mocked(api.fetchChapter).mock.calls.length).toBeGreaterThan(1)

    // 终态之后不再轮询
    const callsAfterSuccess = vi.mocked(api.fetchTaskStatus).mock.calls.length
    await vi.advanceTimersByTimeAsync(10 * POLL_INTERVAL_MS)
    expect(vi.mocked(api.fetchTaskStatus).mock.calls.length).toBe(callsAfterSuccess)
  })

  it('shows a failed task with its error detail', async () => {
    const user = userEvent.setup()
    vi.mocked(api.startAsyncImport).mockResolvedValue({
      task_id: 't2',
      status: 'pending',
      reused: false,
      task_kind: 'cas_import_episode_package',
      relation_type: 'cas_episode_import',
      relation_entity_id: 'y'.repeat(64),
    })
    vi.mocked(api.fetchTaskStatus).mockResolvedValue({
      id: 't2',
      status: 'failed',
      error: 'Project not found: nope',
    })

    renderPage()
    await waitFor(() => expect(screen.getByTestId('import-panel')).toBeInTheDocument())
    await fillImportForm(user, '{"a":1}')
    await user.click(screen.getByTestId('import-submit'))

    // failed 是终态，首次轮询即结束，无需推进定时器
    await waitFor(() => expect(screen.getByTestId('task-error')).toBeInTheDocument())
    expect(screen.getByText(/Project not found: nope/)).toBeInTheDocument()
    expect(api.fetchTaskResult).not.toHaveBeenCalled()
  })

  it('surfaces active-task reuse', async () => {
    const user = userEvent.setup()
    vi.mocked(api.startAsyncImport).mockResolvedValue({
      task_id: 't3',
      status: 'running',
      reused: true,
      task_kind: 'cas_import_episode_package',
      relation_type: 'cas_episode_import',
      relation_entity_id: 'z'.repeat(64),
    })
    vi.mocked(api.fetchTaskStatus).mockResolvedValue({ id: 't3', status: 'succeeded' })
    vi.mocked(api.fetchTaskResult).mockResolvedValue(null)

    renderPage()
    await waitFor(() => expect(screen.getByTestId('import-panel')).toBeInTheDocument())
    await fillImportForm(user, '{"a":1}')
    await user.click(screen.getByTestId('import-submit'))

    // succeeded 是终态，首次轮询即结束
    await waitFor(() => expect(screen.getByTestId('task-reused')).toBeInTheDocument())
  })

  it('stops polling when the component unmounts', async () => {
    vi.useFakeTimers()
    vi.mocked(api.startAsyncImport).mockResolvedValue({
      task_id: 't4',
      status: 'pending',
      reused: false,
      task_kind: 'cas_import_episode_package',
      relation_type: 'cas_episode_import',
      relation_entity_id: 'w'.repeat(64),
    })
    vi.mocked(api.fetchTaskStatus).mockResolvedValue({ id: 't4', status: 'running' })

    const { unmount } = renderPage()
    await vi.advanceTimersByTimeAsync(0)
    expect(screen.getByTestId('import-panel')).toBeInTheDocument()

    fillAndSubmitSync('{"a":1}')
    await vi.advanceTimersByTimeAsync(0)
    expect(api.fetchTaskStatus).toHaveBeenCalledTimes(1)

    // 此时组件已排入下一次轮询定时器；卸载必须清掉它。
    // 用「推进后调用次数不变」来证明轮询确实停止：这是行为层面的保证，
    // 且不会被 antd 内部可能存在的其它定时器干扰。
    unmount()
    const callsAtUnmount = vi.mocked(api.fetchTaskStatus).mock.calls.length
    await vi.advanceTimersByTimeAsync(10 * POLL_INTERVAL_MS)
    expect(vi.mocked(api.fetchTaskStatus).mock.calls.length).toBe(callsAtUnmount)
  })
})
