import { makeWorkspace } from './directing-fixtures.mjs'
import { locateCanvasNode, workbenchShot, workbenchControl, closeWorkbenchDetails, selectWorkbenchOption } from './workbenchControls.mjs'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await mkdtemp(join(tmpdir(), 'jellyfish-scene-version-'))
const api = 'http://127.0.0.1:8193'
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.directing.scene_version_browser_server'], {
  cwd: join(root, '../backend'),
  env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', SCENE_BROWSER_TEST_DATABASE: join(output, 'browser.sqlite'), SCENE_BROWSER_TEST_PORT: '8193' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let backendOutput = ''
backend.stdout.on('data', data => { backendOutput += data })
backend.stderr.on('data', data => { backendOutput += data })
let server, browser, page
try {
  let chapter
  for (let attempt = 0; attempt < 80; attempt++) {
    if (backend.exitCode !== null) throw new Error(backendOutput)
    try {
      const response = await fetch(`${api}/api/v1/studio/projects/canvas-project/directing/chapters/canvas-chapter`)
      if (response.ok) { chapter = (await response.json()).data; break }
    } catch { /* The dedicated test server is still starting. */ }
    await delay(250)
  }
  assert.ok(chapter, `test backend did not become ready: ${backendOutput}`)
  const sequenceId = chapter.sequences[0].id
  const versionsUrl = `${api}/api/v1/studio/projects/canvas-project/directing/sequences/${sequenceId}/versions`
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4193, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  page = await context.newPage()
  let takeHistoryReads = 0
  page.on('request', request => { if (request.method() === 'GET' && request.url().endsWith('/take-reviews')) takeHistoryReads++ })
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const create = await fetch(versionsUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), title: '覆盖编辑验收' }) })
  assert.equal(create.status, 200)
  const version = (await create.json()).data
  const note = text => ({ state: 'proposal', text, sources: [{ kind: 'human', reference: 'coverage-browser', version: '1' }] })
  const content = version.content
  content.design.direction.beats = ['beat-one', 'beat-two'].map((id, index) => ({ id, event_ids: [], objective: note(`目标 ${index + 1}`), obstacle: {}, expected_change: {}, must_show: {} }))
  content.design.events = [{ id: 'event-one', description: note('拆开信封') }]
  content.design.participants = [{ id: 'reader', name: '读信者' }]
  content.design.direction.shots = [{ id: 'shot-one', beat_ids: ['beat-one', 'beat-two'], event_ids: ['event-one'], blocking_state_ids: [], participant_ids: ['reader'], criterion_ids: [], narrative_function: {}, visible_result: note('读信反应') }]
  content.units = [{ id: 'unit-one', model_id: 'browser-video-model', duration_ms: 5000, ratio: '16:9', coverage: [
    { id: 'coverage-one', shot_id: 'shot-one', beat_ids: ['beat-one'], event_ids: [], action_scope: '拆开信封' },

  ] }]
  content.units.push({ ...structuredClone(content.units[0]), id: 'unit-two' })
  content.design.direction.beats.forEach(beat => { beat.must_show = note('手指拆开信封') })
  content.design.cinematography = content.design.direction.shots.map((shot, index) => ({ ...structuredClone(makeWorkspace().designs[0].content.cinematography[0]), id: `camera-${index}`, shot_id: shot.id, criterion_ids: [] }))
  const saved = await fetch(`${versionsUrl}/${version.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: version.revision, content }) })
  assert.equal(saved.status, 200, await saved.text())
  await page.goto(`http://127.0.0.1:4193/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${version.id}`)
  await (await workbenchShot(page, '镜头 1：读信反应')).click()
  await page.getByRole('button', { name: '单元画布', exact: true }).click()
  await selectWorkbenchOption(page, '当前单元', '单元 1')
  await page.getByRole('button', { name: '指令画布', exact: true }).click()
  const body = page.getByRole('textbox', { name: '当前单元指令正文', exact: true })
  await body.fill('历史场次的原指令。')
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  await page.getByRole('button', { name: '确认已按当前依据核对正文', exact: true }).click()
  await page.getByText('指令依据一致，尚不代表检查通过', { exact: true }).waitFor()
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  await page.getByRole('button', { name: '检查当前指令', exact: true }).click({ timeout: 5000 })
  await page.getByText('检查任务：等待执行', { exact: true }).waitFor()
  const checksUrl = `${versionsUrl}/${version.id}/units/unit-one/instruction-checks`
  const tasks = (await (await fetch(checksUrl)).json()).data
  assert.equal(tasks.length, 1)
  assert.equal((await fetch(`${api}/browser-test/instruction-checks/${tasks[0].task_id}/complete`, { method: 'POST' })).status, 200)
  await page.getByRole('button', { name: '查看检查结果', exact: true }).click()
  await page.getByText('六岗检查均通过，尚待明确核对结果', { exact: true }).waitFor()
  assert.equal(await page.getByText('检查夹具：动作表达一致', { exact: true }).count(), 6)
  await (await workbenchControl(page, '保存设置', 'switch', '自动保存')).click()
  await page.getByRole('button', { name: '保存设置', exact: true }).click()
  await page.getByRole('button', { name: '确认已核对检查结果', exact: true }).click()
  await page.getByText('当前指令检查结果已确认', { exact: true }).waitFor()
  await page.getByRole('status').filter({ hasText: '未保存' }).waitFor()
  await page.getByRole('button', { name: '保存并生成视频', exact: true }).click()
  await page.getByText('视频任务：等待执行', { exact: true }).waitFor()
  const videoUrl = `${versionsUrl}/${version.id}/units/unit-one/video`
  const original = (await (await fetch(videoUrl)).json()).data[0]
  const completed = await fetch(`${api}/browser-test/video-tasks/${original.task_id}/complete`, { method: 'POST' })
  assert.equal(completed.status, 200, await completed.text())
  const take = (await (await fetch(videoUrl)).json()).data[0].takes[0]
  await page.getByRole('alert').filter({ hasText: '视频任务已提交' }).getByRole('button', { name: 'close', exact: true }).click()
  await page.getByRole('button', { name: '编辑画布', exact: true }).click({ timeout: 5000 })
  await page.getByRole('button', { name: '浏览同场次素材', exact: true }).click()
  await page.getByRole('button', { name: '选择素材 1', exact: true }).click()
  await page.getByRole('button', { name: '查看素材固定依据', exact: true }).click()
  await page.getByText('素材生成输入与当前单元一致，仍需人工审片', { exact: true }).waitFor({ timeout: 5000 })
  await closeWorkbenchDetails(page)
  assert.equal(await page.locator('video').count(), 0)
  await page.getByRole('button', { name: '预览当前素材', exact: true }).click()
  const video = page.getByLabel('当前素材视频', { exact: true })
  await video.waitFor()
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 1)
  assert.equal(await video.evaluate(node => node.paused), true)
  assert.equal(await video.evaluate(node => node.duration), 2)
  await page.setViewportSize({ width: 390, height: 844 })
  if (await page.getByRole('button', { name: '收起关系树', exact: true }).isVisible()) await page.getByRole('button', { name: '收起关系树', exact: true }).click()
  const completionNotice = page.getByRole('button', { name: '关闭通知', exact: true })
  const noticeBounds = await completionNotice.boundingBox()
  assert.ok(noticeBounds.x >= 0 && noticeBounds.x + noticeBounds.width <= 390, '窄屏通知关闭入口必须完整可见')
  await completionNotice.click()
  await locateCanvasNode(page, '方案判断')
  await page.getByRole('combobox', { name: '当前方案素材审查', exact: true }).click()
  await page.getByText('保留', { exact: true }).click()
  await page.getByRole('textbox', { name: '素材审查说明', exact: true }).fill('A 方案保留开头')
  await page.getByRole('button', { name: '新增可用区间', exact: true }).click()
  const beforeInvalidRange = (await (await fetch(`${versionsUrl}/${version.id}`)).json()).data
  await page.getByRole('spinbutton', { name: '可用区间 1 出点毫秒', exact: true }).fill('2500')
  await page.getByText('可用区间 1 无效：须满足 0 ≤ 入点 < 出点 ≤ 2000 毫秒', { exact: true }).waitFor({ timeout: 5000 })
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByText('保存失败，输入已保留', { exact: true }).waitFor()
  assert.equal(await page.getByRole('spinbutton', { name: '可用区间 1 出点毫秒', exact: true }).inputValue(), '2500')
  assert.deepEqual((await (await fetch(`${versionsUrl}/${version.id}`)).json()).data, beforeInvalidRange)
  await page.getByRole('button', { name: '导演画布', exact: true }).click()
  await page.getByRole('button', { name: '编辑画布', exact: true }).click()
  await locateCanvasNode(page, '同场次素材')
  await page.getByRole('button', { name: '定位素材 1：可用区间 1 无效', exact: true }).click({ timeout: 5000 })
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '可用区间 1 出点毫秒')
  assert.equal(await page.getByRole('spinbutton', { name: '可用区间 1 出点毫秒', exact: true }).inputValue(), '2500')
  for (const [start, end] of [[-1, 1000], [1000, 1000], [0, 1000.5]]) {
    await page.getByRole('spinbutton', { name: '可用区间 1 入点毫秒', exact: true }).fill(String(start))
    await page.getByRole('spinbutton', { name: '可用区间 1 出点毫秒', exact: true }).fill(String(end))
    await page.getByText('可用区间 1 无效：须满足 0 ≤ 入点 < 出点 ≤ 2000 毫秒', { exact: true }).waitFor()
    assert.equal(await page.getByRole('spinbutton', { name: '可用区间 1 出点毫秒', exact: true }).getAttribute('aria-invalid'), 'true')
    assert.equal(await page.getByRole('spinbutton', { name: '可用区间 1 出点毫秒', exact: true }).inputValue(), String(end))
  }
  await page.getByRole('spinbutton', { name: '可用区间 1 入点毫秒', exact: true }).fill('0')
  await page.getByRole('spinbutton', { name: '可用区间 1 出点毫秒', exact: true }).fill('1000')
  await locateCanvasNode(page, '同场次素材')
  await locateCanvasNode(page, '方案判断')
  await page.getByRole('combobox', { name: '实际覆盖动作', exact: true }).click()
  await page.getByText('单元 2 · 动作 1：拆开信封', { exact: true }).click()
  await page.getByRole('textbox', { name: '实际覆盖观察', exact: true }).fill('只看到接触信封，未完成拆开')
  await page.getByRole('spinbutton', { name: '实际覆盖入点毫秒', exact: true }).fill('250')
  await page.getByRole('spinbutton', { name: '实际覆盖出点毫秒', exact: true }).fill('2250')
  await page.getByText('区间须满足 0 ≤ 入点 < 出点 ≤ 2000 毫秒', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '记录实际覆盖', exact: true }).isDisabled(), true)
  await page.getByRole('spinbutton', { name: '实际覆盖出点毫秒', exact: true }).fill('1250')
  await page.getByRole('button', { name: '记录实际覆盖', exact: true }).click()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  await page.getByLabel('固定素材审片记录', { exact: true }).scrollIntoViewIfNeeded()
  await page.getByRole('button', { name: '查看完整素材审片历史', exact: true }).click()
  await page.getByText('当前判断与固定审片依据一致', { exact: true }).waitFor({ timeout: 5000 })
  await page.screenshot({ path: join(output, 'narrow-review.png'), fullPage: true })
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.getByRole('button', { name: '适应画布', exact: true }).click()
  const a = (await (await fetch(`${versionsUrl}/${version.id}`)).json()).data
  assert.equal(a.content.take_judgments.length, 1)
  assert.equal(a.content.take_judgments[0].take_id, take.id)
  assert.equal(a.content.take_judgments[0].annotation.verdict, 'retain')
  const observed = a.content.take_judgments[0].annotation.coverage
  assert.equal(observed.length, 1)
  assert.equal(observed[0].unit_id, 'unit-two')
  assert.equal(observed[0].coverage_item_id, 'coverage-one')
  assert.equal(observed[0].observation, '只看到接触信封，未完成拆开')
  assert.deepEqual(observed[0].media_range, { source_in_ms: 250, source_out_ms: 1250 })
  assert.equal(observed[0].source.file_id, take.file_id)
  assert.deepEqual(observed[0].source.media_range, observed[0].media_range)

  assert.deepEqual(a.content.take_judgments[0].annotation.retained_ranges, [{ source_in_ms: 0, source_out_ms: 1000 }])
  await page.getByRole('button', { name: '指令画布', exact: true }).click()
  await selectWorkbenchOption(page, '指令所属单元', '单元 1')
  await page.getByRole('textbox', { name: '当前单元指令正文', exact: true }).fill('后来修改的原单元正文')
  await page.getByRole('button', { name: '编辑画布', exact: true }).click()
  if (await page.getByRole('button', { name: '打开剪辑工作区', exact: true }).isVisible()) await page.getByRole('button', { name: '打开剪辑工作区', exact: true }).click()
  await page.getByRole('button', { name: '选择素材 1', exact: true }).click()
  await page.getByRole('button', { name: '查看素材固定依据', exact: true }).click()
  await page.getByText('旧依据候选：当前正文或相关生成依据已变化', { exact: true }).waitFor()
  assert.equal(await page.getByRole('textbox', { name: '素材审查说明', exact: true }).inputValue(), 'A 方案保留开头')
  await page.route('**/instruction-basis', route => route.abort())
  await (await workbenchControl(page, '编辑历史', 'button', '撤销')).click()
  await page.getByText('素材生成依据核对失败', { exact: true }).waitFor()
  assert.equal(await page.getByText('素材生成输入与当前单元一致，仍需人工审片', { exact: true }).count(), 0)
  await page.unroute('**/instruction-basis')
  await page.getByRole('button', { name: '重试素材依据核对', exact: true }).click()
  await page.getByText('素材生成输入与当前单元一致，仍需人工审片', { exact: true }).waitFor()
  await closeWorkbenchDetails(page)
  await locateCanvasNode(page, '方案判断')
  await page.getByRole('button', { name: '查看完整素材审片历史', exact: true }).click()
  await page.getByRole('button', { name: '适应画布', exact: true }).click()
  for (const invalid of ['range', 'target', 'source']) {
    const rejectedContent = structuredClone(a.content)
    const item = rejectedContent.take_judgments[0].annotation.coverage[0]
    if (invalid === 'range') { item.media_range.source_out_ms = 2001; item.source.media_range.source_out_ms = 2001 }
    if (invalid === 'target') item.coverage_item_id = 'missing-action'
    if (invalid === 'source') item.source.file_id = 'different-file'
    const rejected = await fetch(`${versionsUrl}/${version.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: a.revision, content: rejectedContent }) })
    assert.equal(rejected.status, 422, await rejected.text())
    assert.deepEqual((await (await fetch(`${versionsUrl}/${version.id}`)).json()).data, a)
  }
  await page.getByRole('button', { name: '编辑覆盖 1', exact: true }).click()
  await page.getByRole('textbox', { name: '实际覆盖观察', exact: true }).fill('修改后的真实观察')
  await page.getByRole('button', { name: '更新实际覆盖', exact: true }).click()
  await page.getByText('250–1250 毫秒：修改后的真实观察', { exact: true }).waitFor()
  await page.getByText('审片依据已变，请重新核对当前判断', { exact: true }).waitFor()
  await (await workbenchControl(page, '编辑历史', 'button', '撤销')).click()
  await page.getByText('250–1250 毫秒：只看到接触信封，未完成拆开', { exact: true }).waitFor()
  await page.getByRole('button', { name: '删除覆盖 1', exact: true }).click()
  await page.getByText('尚未记录实际覆盖。', { exact: true }).waitFor()
  await (await workbenchControl(page, '编辑历史', 'button', '撤销')).click()
  await page.getByText('250–1250 毫秒：只看到接触信封，未完成拆开', { exact: true }).waitFor()
  await page.route('**/take-library', route => route.abort())
  await page.getByRole('button', { name: '刷新素材库', exact: true }).click()
  await page.getByText('素材库读取失败', { exact: true }).waitFor()
  assert.equal(await page.getByRole('textbox', { name: '素材审查说明', exact: true }).inputValue(), 'A 方案保留开头')
  assert.equal(await page.getByRole('textbox', { name: '素材审查说明', exact: true }).isDisabled(), true)
  await page.unroute('**/take-library')
  await page.getByRole('button', { name: '刷新素材库', exact: true }).click()
  await page.getByText('素材库读取失败', { exact: true }).waitFor({ state: 'hidden' })
  await page.route('**/files/*/download', route => route.abort())
  await page.getByRole('button', { name: '预览当前素材', exact: true }).click()
  await page.getByText('原素材无法读取或解码，请重试；素材身份和当前判断保留。', { exact: true }).waitFor()
  assert.equal(await page.getByRole('textbox', { name: '素材审查说明', exact: true }).inputValue(), 'A 方案保留开头')
  await page.unroute('**/files/*/download')
  await page.getByRole('button', { name: '重试当前素材预览', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 1)
  assert.equal(await video.evaluate(node => node.paused), true)
  await page.getByRole('textbox', { name: '素材审查说明', exact: true }).fill('A 临时修改')
  await page.getByRole('button', { name: '导演画布', exact: true }).click()
  await page.getByRole('button', { name: '编辑画布', exact: true }).click()
  if (await page.getByRole('button', { name: '打开剪辑工作区', exact: true }).isVisible()) await page.getByRole('button', { name: '打开剪辑工作区', exact: true }).click()
  await page.getByRole('button', { name: '选择素材 1', exact: true }).click()
  assert.equal(await page.getByRole('textbox', { name: '素材审查说明', exact: true }).inputValue(), 'A 临时修改')
  await (await workbenchControl(page, '编辑历史', 'button', '撤销')).click()
  assert.equal(await page.getByRole('textbox', { name: '素材审查说明', exact: true }).inputValue(), 'A 方案保留开头')
  const second = await fetch(versionsUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), title: 'B 素材方案' }) })
  assert.equal(second.status, 200)
  const b = (await second.json()).data
  await page.goto(`http://127.0.0.1:4193/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${b.id}`)
  await page.getByRole('button', { name: '编辑画布', exact: true }).click()
  if (await page.getByRole('button', { name: '打开剪辑工作区', exact: true }).isVisible()) await page.getByRole('button', { name: '打开剪辑工作区', exact: true }).click()
  await page.getByRole('button', { name: '选择素材 1', exact: true }).click()
  await page.getByRole('combobox', { name: '当前方案素材审查', exact: true }).click()
  await page.getByText('需修复', { exact: true }).click()
  await page.getByRole('button', { name: '查看素材固定依据', exact: true }).click()
  await page.getByText('原生成单元不在当前方案，作为旧依据候选人工核对', { exact: true }).waitFor()
  await closeWorkbenchDetails(page)
  await page.getByRole('textbox', { name: '素材审查说明', exact: true }).fill('B 方案需要修复')
  await page.getByRole('button', { name: '新增可用区间', exact: true }).click()
  await page.getByRole('spinbutton', { name: '可用区间 1 入点毫秒', exact: true }).fill('1000')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  await page.reload()
  await page.getByRole('button', { name: '编辑画布', exact: true }).click()
  if (await page.getByRole('button', { name: '打开剪辑工作区', exact: true }).isVisible()) await page.getByRole('button', { name: '打开剪辑工作区', exact: true }).click()
  await page.getByRole('button', { name: '选择素材 1', exact: true }).click()
  assert.equal(await page.getByRole('textbox', { name: '素材审查说明', exact: true }).inputValue(), 'B 方案需要修复')
  const storedB = (await (await fetch(`${versionsUrl}/${b.id}`)).json()).data
  assert.equal(storedB.content.take_judgments[0].annotation.verdict, 'repair')
  assert.deepEqual(storedB.content.take_judgments[0].annotation.coverage, [])
  assert.deepEqual(storedB.content.take_judgments[0].annotation.retained_ranges, [{ source_in_ms: 1000, source_out_ms: 2000 }])
  const bReviews = (await (await fetch(`${versionsUrl}/${b.id}/take-reviews`)).json()).data
  assert.equal(bReviews.length, 1)
  const changedBasis = structuredClone(storedB.content)
  changedBasis.design.direction.viewpoint = note('B 后来改变的视点')
  const changedResponse = await fetch(`${versionsUrl}/${b.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: storedB.revision, content: changedBasis }) })
  assert.equal(changedResponse.status, 200, await changedResponse.text())
  const beforeConfirm = (await (await fetch(`${versionsUrl}/${b.id}`)).json()).data
  await page.reload()
  await page.getByRole('button', { name: '编辑画布', exact: true }).click()
  if (await page.getByRole('button', { name: '打开剪辑工作区', exact: true }).isVisible()) await page.getByRole('button', { name: '打开剪辑工作区', exact: true }).click()
  await page.getByRole('button', { name: '选择素材 1', exact: true }).click()
  await locateCanvasNode(page, '方案判断')
  await page.getByRole('button', { name: '查看完整素材审片历史', exact: true }).click()
  await page.getByText('审片依据已变，请重新核对当前判断', { exact: true }).waitFor()
  assert.deepEqual((await (await fetch(`${versionsUrl}/${b.id}/take-reviews`)).json()).data, [{ ...bReviews[0], matches_current: false }])
  const confirmReview = page.getByRole('button', { name: '确认已按当前依据复核', exact: true })
  await confirmReview.waitFor({ timeout: 5000 })
  await page.getByRole('textbox', { name: '素材审查说明', exact: true }).fill('尚未保存的修改')
  assert.equal(await confirmReview.isDisabled(), true)
  await (await workbenchControl(page, '编辑历史', 'button', '撤销')).click()
  const historyBeforeConfirmation = takeHistoryReads
  const confirmations = []
  await page.route('**/take-reviews', async route => {
    if (route.request().method() !== 'POST') return route.continue()
    confirmations.push(route.request().postDataJSON())
    await route.fetch()
    await route.abort()
  })
  await confirmReview.click()
  await page.getByText('复核结果待核实', { exact: true }).waitFor()
  await page.getByRole('textbox', { name: '素材审查说明', exact: true }).fill('核实期间继续编辑的内容')
  await page.unroute('**/take-reviews')
  await page.route('**/take-reviews', async route => {
    if (route.request().method() === 'POST') confirmations.push(route.request().postDataJSON())
    await route.continue()
  })
  await page.getByRole('button', { name: '核实原复核记录', exact: true }).click()
  await page.getByText('复核结果待核实', { exact: true }).waitFor({ state: 'hidden' })
  assert.equal(await page.getByRole('textbox', { name: '素材审查说明', exact: true }).inputValue(), '核实期间继续编辑的内容')
  await page.getByText('审片依据已变，请重新核对当前判断', { exact: true }).waitFor()
  await (await workbenchControl(page, '编辑历史', 'button', '撤销')).click()
  await page.getByText('当前判断与固定审片依据一致', { exact: true }).waitFor()
  assert.equal(takeHistoryReads, historyBeforeConfirmation, '成功复核直接显示返回记录，不借graph刷新再取全历史')
  assert.equal(confirmations.length, 2)
  assert.deepEqual(confirmations[1], confirmations[0])
  await page.unroute('**/take-reviews')
  assert.equal(await page.getByRole('textbox', { name: '素材审查说明', exact: true }).inputValue(), 'B 方案需要修复')
  const afterConfirm = (await (await fetch(`${versionsUrl}/${b.id}`)).json()).data
  assert.deepEqual(afterConfirm.content, beforeConfirm.content)
  assert.equal(afterConfirm.revision, beforeConfirm.revision)
  await page.reload()
  await page.getByRole('button', { name: '编辑画布', exact: true }).click()
  if (await page.getByRole('button', { name: '打开剪辑工作区', exact: true }).isVisible()) await page.getByRole('button', { name: '打开剪辑工作区', exact: true }).click()
  await page.getByRole('button', { name: '选择素材 1', exact: true }).click()
  await locateCanvasNode(page, '方案判断')
  await page.getByRole('button', { name: '查看完整素材审片历史', exact: true }).click()
  await page.getByText('当前判断与固定审片依据一致', { exact: true }).waitFor()
  const newReviews = (await (await fetch(`${versionsUrl}/${b.id}/take-reviews`)).json()).data
  assert.equal(newReviews.length, 2)
  assert.deepEqual(newReviews[0], { ...bReviews[0], matches_current: false })
  assert.equal(newReviews[1].matches_current, true)
  assert.deepEqual((await (await fetch(`${versionsUrl}/${version.id}`)).json()).data, a)
  const source = (await (await fetch(videoUrl)).json()).data[0]
  assert.equal(source.takes.length, 1)
  assert.deepEqual(source.preparation, original.preparation)
  console.log(`PASS take preview and independent version judgments; evidence: ${output}`)
} catch (error) {
  if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {})
  console.error(`Browser evidence: ${output}`)
  throw error
} finally {
  await browser?.close()
  await server?.close()
  backend.kill('SIGTERM')
}
