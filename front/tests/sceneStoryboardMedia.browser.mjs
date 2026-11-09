import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'
import { closeCanvasDetails, closePrecheck, openCanvasCard } from './generationCanvasWorkbench.browser-helpers.mjs'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-storyboard-media-')
const fixture = join(output, 'clip.mp4')
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:d=1',
  '-c:v', 'libx264', '-y', fixture])
const api = 'http://127.0.0.1:8328', studio = api + '/api/v1/studio'
const project = 'canvas-project', chapter = 'storyboard-media-chapter', text = '前门的阿同拿着信封。后门的阿同等待。'
const base = studio + '/generation-canvases/' + project
const controls = api + '/test/runtime-controls'
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_runtime_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache',
    CANVAS_BROWSER_SCENE_OBJECTS: '1', CANVAS_BROWSER_SCENE_STORYBOARD: '1', CANVAS_BROWSER_STORYBOARD_VIDEO_FIXTURE: fixture,
    CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'),
    CANVAS_BROWSER_PORT: '8328' }, stdio: ['ignore', 'pipe', 'pipe'],
})
captureBackend(backend, output)
let server, browser, page
const cleanup = browserCleanup(() => ({ browser, server, backend }))
async function request(url, method = 'GET', body) {
  const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) })
  assert.ok(response.ok, await response.clone().text())
  const result = await response.json()
  return result.data ?? result
}

async function poll(read, predicate, description) {
  let current
  for (let attempt = 0; attempt < 160; attempt++) {
    current = await read()
    if (predicate(current)) return current
    await delay(100)
  }
  throw new Error(description + ' ' + JSON.stringify(current).slice(0, 1200))
}

try {
  await poll(async () => {
    if (backend.exitCode !== null) throw new Error('isolated backend exited')
    return fetch(base).then(response => response.ok, () => false)
  }, Boolean, 'isolated backend did not start')
  await request(studio + '/chapters', 'POST', { id: chapter, project_id: project, index: 0, title: '候车', raw_text: text })
  const scenes = `${studio}/projects/${project}/directing/chapters/${chapter}/sequences`
  const sequence = await request(scenes, 'POST', { title: '两人等候', position: 0,
    source_version: createHash('sha256').update(text).digest('hex'), span: { start: 0, end: Array.from(text).length } })
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: {
    host: '127.0.0.1', port: 4328, strictPort: true, proxy: { '/api': api },
  } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  page.setDefaultTimeout(16000)
  const projectUrl = `http://127.0.0.1:4328/projects/${project}`
  const prep = `${projectUrl}/chapters/${chapter}/sequences/${sequence.id}/canvas-workbench`
  const openScene = async () => {
    await page.goto(`${projectUrl}?tab=chapters&chapter=${chapter}`)
    await page.getByRole('button', { name: '打开场次工作台', exact: true }).click()
    await page.waitForURL(prep)
  }
  await openScene()
  await page.getByRole('button', { name: '提取对象', exact: true }).click()
  await page.getByRole('region', { name: '阿同 · 后门的阿同', exact: true }).waitFor()
  const preview = page.getByRole('dialog', { name: '运行预检', exact: true })
  const confirm = preview.getByRole('button', { name: '确认执行', exact: true })
  const warning = preview.getByRole('alert').filter({ hasText: 'CREATIVE_REFERENCE_IMAGE_MISSING' })
  let callCount = 0
  for (const [modality, modelName, outputTag, providerPath] of [
    ['image', '分镜测试图片模型', 'img', '/images/generations'],
    ['video', 'viduq2', 'video', '/text2video'],
  ]) {
    await openScene()
    await page.getByRole('button', { name: '生成分镜', exact: true }).click()
    const config = page.getByRole('dialog', { name: '生成分镜', exact: true })
    await config.getByText('忠实提取', { exact: true }).click()
    await config.getByRole('combobox', { name: '生产模型' }).click()
    await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').getByText(modelName, { exact: true }).click()
    await config.getByRole('button', { name: '开始提取', exact: true }).click()
    await page.getByRole('region', { name: '生成画布工作台' }).waitFor()
    const canvas = base + '/' + new URL(page.url()).searchParams.get('canvas')
    const state = await poll(() => request(canvas), data => data.document.storyboard, 'storyboard was not saved')
    const { shots, objects } = state.document.storyboard
    const shot = shots[1], cardId = shot.model_card_ids[0]
    const { reference_card_id: referenceId } = objects.find(item => item.object_id === shot.object_ids[0])
    assert.equal(state.document.cards.find(card => card.id === referenceId).image_binding, null)
    const readRuntime = () => request(canvas + '/runtime')
    const precheck = async () => {
      const detail = await openCanvasCard(page, cardId)
      await detail.getByRole('button', { name: '预检运行', exact: true }).click()
      await warning.waitFor()
      return detail
    }
    const detail = await precheck()
    assert.equal(await warning.count(), 1)
    assert.match(await warning.textContent(), /尚未选择创作参考图.*阻止：无/)
    assert.equal(await confirm.isEnabled(), true)
    await warning.getByRole('button', { name: '定位问题', exact: true }).click()
    await preview.waitFor({ state: 'hidden' })
    const badge = page.locator(`[data-card-id="${referenceId}"]`).getByRole('button', { name: '查看卡片问题', exact: true })
    await badge.press('Enter')
    const issues = page.getByRole('region', { name: '卡片问题', exact: true })
    await issues.getByText(/尚未选择创作参考图/).waitFor()
    await page.keyboard.press('Escape')
    await precheck()
    assert.deepEqual((await readRuntime()).runs, [])
    assert.equal((await request(controls)).media_calls.length, callCount)

    const run = async expected => {
      const accepted = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/runs'))
      await confirm.click()
      const response = await accepted
      assert.ok(response.ok(), await response.text())
      const { run_id: id } = (await response.json()).data
      const result = await poll(readRuntime, data => data.runs.some(item => item.id === id && item.lifecycle === 'finished'), 'media run did not finish')
      const { nodes } = result.runs.find(item => item.id === id)
      assert.equal(nodes.length, 1)
      const node = nodes[0]
      assert.equal(node.status, expected, JSON.stringify(node))
      assert.equal(node.card_id, cardId)
      assert.deepEqual(node.basis.input.media, [])
      const calls = (await request(controls)).media_calls
      assert.equal(calls.length, ++callCount)
      const call = calls.at(-1)
      assert.ok(call.path.endsWith(providerPath), call.path)
      assert.match(call.body.prompt, /后门的阿同等待/)
      assert.ok(!('images' in call.body) && !('subjects' in call.body))
      await closePrecheck(page)
      return { id, result, node }
    }

    const success = await run('succeeded')
    const file = success.node.outputs[0].file_id
    assert.ok(file)
    assert.deepEqual(Object.keys(success.result.current_outputs), [cardId])
    const formal = detail.getByRole('region', { name: '当前正式输出', exact: true })
    await formal.locator(outputTag).waitFor()
    if (modality === 'video') {
      await formal.locator('video').evaluate(async video => { video.muted = true; await video.play() })
    }
    await request(controls, 'POST', { media_fail_next: true })
    await precheck()
    const failure = await run('failed')
    assert.equal(failure.result.current_outputs[cardId][0].file_id, file)
    await closeCanvasDetails(page)
    await page.getByRole('button', { name: '运行历史', exact: true }).click()
    const history = page.getByRole('region', { name: '画布运行历史', exact: true })
    for (const [result, label] of [[success, '完整成果'], [failure, '未完成成果，未替换原正式输出']]) {
      const record = history.locator(`[data-history-run="${result.id}"]`)
      await record.locator(':scope > summary').click()
      await record.getByText(label, { exact: label.startsWith('未完成') }).waitFor()
      await record.getByText('本次实际输入与模型参数', { exact: true }).click()
      assert.match(await record.getByRole('region', { name: '历史实际输入' }).textContent(), /后门的阿同等待/)
      if (result === failure) await record.getByRole('alert').waitFor()
    }

    if (modality === 'video') {
      const current = await request(canvas)
      const model = current.document.cards.find(card => card.id === cardId)
      model.prompt.segments.push({ id: 'required-frame', kind: 'instruction', command: '首帧参考', references: [] })
      await request(canvas, 'PUT', { request_id: 'explicit-required-frame', expected_revision: current.revision, document: current.document })
      await page.reload()
      await precheck()
      await preview.getByRole('alert').filter({ hasText: 'INSTRUCTION_REFERENCE_REQUIRED' }).waitFor()
      assert.equal(await confirm.isDisabled(), true)
      assert.equal((await readRuntime()).runs.length, 2)
      assert.equal((await request(controls)).media_calls.length, callCount)
    }
  }
  console.log('scene storyboard media browser passed', output)
} catch (error) {
  await page?.screenshot({ path: join(output, 'failure.png') }).catch(() => {})
  throw error
} finally {
  await cleanup()
}
