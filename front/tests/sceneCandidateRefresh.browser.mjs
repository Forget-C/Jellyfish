import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'
import { makeWorkspace } from './directing-fixtures.mjs'
import { workbenchShot, selectWorkbenchOption, workbenchControl, locateCanvasNode } from './workbenchControls.mjs'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-instruction-video-')
const api = 'http://127.0.0.1:8267'
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.directing.scene_version_browser_server'], {
  cwd: join(root, '../backend'),
  env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', SCENE_BROWSER_TEST_DATABASE: join(output, 'browser.sqlite'), SCENE_BROWSER_TEST_PORT: '8267' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let backendOutput = ''
backend.stdout.on('data', data => { backendOutput += data })
backend.stderr.on('data', data => { backendOutput += data })
let server, browser, page
const cleanup = browserCleanup(() => ({ browser, server, backend }))
captureBackend(backend, output)
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
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4267, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  page = await context.newPage()
  page.setDefaultTimeout(10000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const create = await fetch(versionsUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), title: '覆盖编辑验收' }) })
  assert.equal(create.status, 200)
  const version = (await create.json()).data
  const note = text => ({ state: 'proposal', text, sources: [{ kind: 'human', reference: 'coverage-browser', version: '1' }] })
  const content = version.content
  content.design.direction.beats = ['beat-one', 'beat-two'].map((id, index) => ({ id, event_ids: [], objective: note(`目标 ${index + 1}`), obstacle: {}, expected_change: {}, must_show: note(`可拍变化 ${index + 1}`) }))
  content.design.events = [{ id: 'event-one', description: note('拆开信封') }]
  content.design.participants = [{ id: 'reader', name: '读信者' }]
  content.design.direction.shots = [{ id: 'shot-one', beat_ids: ['beat-one', 'beat-two'], event_ids: ['event-one'], blocking_state_ids: [], participant_ids: ['reader'], criterion_ids: [], narrative_function: {}, visible_result: note('读信反应') }]
  content.units = [{ id: 'unit-one', model_id: 'browser-video-model', duration_ms: 5000, ratio: '16:9', coverage: [
    { id: 'coverage-one', shot_id: 'shot-one', beat_ids: ['beat-one'], event_ids: [], action_scope: '拆开信封' },

  ] }]
  content.units.push({ ...structuredClone(content.units[0]), id: 'unit-two' })
  content.design.cinematography = content.design.direction.shots.map((shot, index) => ({ ...structuredClone(makeWorkspace().designs[0].content.cinematography[0]), id: `camera-${index}`, shot_id: shot.id, criterion_ids: [] }))
  const saved = await fetch(`${versionsUrl}/${version.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: version.revision, content }) })
  assert.equal(saved.status, 200, await saved.text())
  await page.goto(`http://127.0.0.1:4267/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${version.id}`)
  await (await workbenchShot(page, '镜头 1：读信反应')).click()
  await page.getByRole('button', { name: '单元画布', exact: true }).click()
  await selectWorkbenchOption(page, '当前单元', '单元 1')
  await page.getByRole('button', { name: '指令画布', exact: true }).click()
  const body = page.getByRole('textbox', { name: '当前单元指令正文', exact: true })
  await body.fill('拆开信封。')
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
  await page.getByRole('button', { name: '确认已按当前依据核对正文', exact: true }).click()
  await page.getByText('指令依据一致，尚不代表检查通过', { exact: true }).waitFor()
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
  await page.getByRole('button', { name: '检查当前指令', exact: true }).click()
  await page.getByText('检查任务：等待执行', { exact: true }).waitFor()
  const checksUrl = `${versionsUrl}/${version.id}/units/unit-one/instruction-checks`
  const checks = (await (await fetch(checksUrl)).json()).data
  assert.equal((await fetch(`${api}/browser-test/instruction-checks/${checks[0].task_id}/complete`, { method: 'POST' })).status, 200)
  await page.getByRole('button', { name: '查看检查结果', exact: true }).click()
  await page.getByRole('button', { name: '确认已核对检查结果', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
  await page.getByRole('button', { name: '按当前内容生成视频', exact: true }).click()
  await page.getByText('视频任务：等待执行', { exact: true }).waitFor()
  const videosUrl = `${versionsUrl}/${version.id}/units/unit-one/video`
  const video = (await (await fetch(videosUrl)).json()).data[0]
  await body.fill('任务期间修改后的指令。')
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
  await page.getByRole('button', { name: '编辑画布', exact: true }).click()
  await page.getByRole('button', { name: '浏览同场素材图', exact: true }).click()
  const beforeUrl=page.url()
  const before = (await (await fetch(`${versionsUrl}/${version.id}`)).json()).data
  assert.equal((await fetch(`${api}/browser-test/video-tasks/${video.task_id}/complete`, { method: 'POST' })).status, 200)
  const after = (await (await fetch(`${versionsUrl}/${version.id}`)).json()).data
  const take=after.edit_graph.nodes.find(n=>n.kind==='edit_take' && n.unit_id==='unit-one')
  assert.ok(take)
  await page.locator(`[data-canvas-node="${take.id}"]`).waitFor({timeout:15000})
  assert.equal(page.url(), beforeUrl, '后台完成保留当前浏览位置')
  assert.deepEqual(after.content.timeline, before.content.timeline, '候选不自动采用')
  const notice=page.getByRole('region', {name:`单元 1 视频任务 ${video.task_id} 通知`,exact:true})
  await notice.getByRole('button',{name:'查看候选视频',exact:true}).click()
  await page.getByText(`素材：${take.take_id} · 场次版本素材`,{exact:true}).waitFor()
  await page.getByRole('button', {name:'预览当前素材',exact:true}).click()
  await page.waitForFunction(() => document.querySelector('video[aria-label="当前素材视频"]')?.readyState >= 1)
  await page.getByRole('button', { name: '查看素材固定依据', exact: true }).click()
  await page.getByText('旧依据候选：当前正文或相关生成依据已变化', {exact:true}).waitFor()
  await page.getByRole('button', { name: '关闭详情', exact: true }).click()
  await (await workbenchControl(page, '保存设置', 'switch', '自动保存')).click()
  await page.getByRole('button', { name: '保存设置', exact: true }).click()
  const rationale=page.getByRole('textbox', {name:'素材审查说明',exact:true})
  await rationale.fill('保持未保存的人工审查输入')
  await page.getByRole('button',{name:'刷新图证据',exact:true}).click()
  assert.equal(await rationale.inputValue(), '保持未保存的人工审查输入')
  assert.deepEqual((await (await fetch(`${versionsUrl}/${version.id}`)).json()).data.content.timeline, before.content.timeline)
  await locateCanvasNode(page,'时间线')
  await page.getByRole('spinbutton',{name:'片段源入点毫秒',exact:true}).fill('100')
  await page.getByRole('spinbutton',{name:'片段源出点毫秒',exact:true}).fill('1200')
  await page.getByRole('spinbutton',{name:'片段时间线起点毫秒',exact:true}).fill('0')
  await page.getByRole('button',{name:'采用当前素材',exact:true}).click()
  await page.getByRole('button',{name:'保存',exact:true}).click()
  await page.getByRole('status').filter({hasText:'已保存'}).first().waitFor()
  const adopted=(await (await fetch(`${versionsUrl}/${version.id}`)).json()).data
  assert.equal(adopted.content.timeline.items.length,1)
  assert.equal(adopted.content.timeline.items[0].take_id,take.take_id)
  assert.deepEqual(adopted.content.timeline.items[0].media_range,{source_in_ms:100,source_out_ms:1200})
  await page.screenshot({path:join(output,'candidate-refresh.png'),animations:'disabled'})
  console.log(`PASS completed media refreshes candidates without automatic navigation or adoption; evidence: ${output}`)
} catch (error) {
  if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {})
  console.error(`Browser evidence: ${output}`)
  throw error
} finally {
  await cleanup()
}
