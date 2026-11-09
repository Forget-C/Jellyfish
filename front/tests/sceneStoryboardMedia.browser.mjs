import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'
import { closeCanvasDetails, closePrecheck, openCanvasCard, openReadyStoryboard } from './generationCanvasWorkbench.browser-helpers.mjs'

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
  const chapterApi = `${studio}/projects/${project}/directing/chapters/${chapter}`
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: {
    host: '127.0.0.1', port: 4328, strictPort: true, hmr: false, proxy: { '/api': api },
  } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  page.setDefaultTimeout(16000)
  const projectUrl = `http://127.0.0.1:4328/projects/${project}`
  const chapters = projectUrl + '?tab=chapters'
  await page.goto(chapters)
  await page.getByRole('textbox', { name: '搜索章节' }).fill('候车')
  await page.getByRole('button', { name: '工作台管理', exact: true }).press('Enter')
  await page.getByRole('region', { name: '完整章节原文' }).waitFor()
  await page.getByRole('button', { name: '新增场次', exact: true }).click()
  await page.getByRole('textbox', { name: '场次标题' }).fill('两人等候')
  await page.getByRole('button', { name: '键盘/触屏选区', exact: true }).click()
  await page.getByRole('textbox', { name: '键盘或触屏选择原文' }).evaluate((element, end) => {
    element.focus(); element.setSelectionRange(0, end); document.dispatchEvent(new Event('selectionchange'))
  }, text.length)
  await page.locator(`[aria-label="选中原文"][data-start="0"][data-end="${text.length}"]`).waitFor()
  await page.getByRole('button', { name: '保存新版本', exact: true }).click()
  await page.getByRole('button', { name: '保存本章划分', exact: true }).click()
  await page.getByRole('dialog', { name: '划分变更预览' }).waitFor({ state: 'hidden' })
  const { sequences: [sequence] } = await request(chapterApi)
  const sceneApi = `${chapterApi}/sequences/${sequence.id}`
  assert.equal(sequence.source_text, text)
  const management = `${projectUrl}/chapters/${chapter}/workbench-management?sequence=${sequence.id}&step=storyboard`
  await page.getByRole('button', { name: '对象与参考〔本场〕', exact: true }).click()
  await page.getByRole('button', { name: '提取对象', exact: true }).click()
  await page.getByRole('region', { name: '阿同 · 后门的阿同', exact: true }).waitFor()
  const prepared = page.getByRole('region', { name: '阿同 · 前门的阿同', exact: true })
  await prepared.getByRole('combobox', { name: '关联资产' }).click()
  await page.getByText('已有角色（提取建议）', { exact: true }).click()
  await prepared.getByRole('button', { name: '对象更多操作' }).click()
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'),
    page.getByRole('menuitem', { name: '上传参考图', exact: true }).click()])
  await chooser.setFiles({ name: '前门备用参考.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7WQAAAAASUVORK5CYII=', 'base64') })
  await prepared.getByText('已选参考图', { exact: true }).waitFor()
  await prepared.getByRole('button', { name: '选择参考图' }).click()
  await page.getByText('参考图 1', { exact: true }).click()
  await prepared.getByText('已选参考图', { exact: true }).waitFor()
  await poll(() => request(sceneApi + '/objects'), result => result.objects[0].image_file_id === 'object-browser-image', 'reference selection did not save')

  const preview = page.getByRole('dialog', { name: '运行预检', exact: true })
  const confirm = preview.getByRole('button', { name: '确认执行', exact: true })
  const warning = preview.getByRole('alert').filter({ hasText: 'CREATIVE_REFERENCE_IMAGE_MISSING' })
  let callCount = 0
  for (const [modality, modelName, outputTag, providerPath] of [
    ['image', '分镜测试图片模型', 'img', '/images/generations'],
    ['video', 'viduq2', 'video', '/text2video'],
  ]) {
    await page.goto(management)
    await page.getByRole('button', { name: '生成新分镜画布', exact: true }).click()
    const config = page.getByRole('region', { name: '生成新分镜画布配置', exact: true })
    await config.getByText('忠实提取', { exact: true }).click()
    if (modality === 'video') await config.getByRole('radio', { name: '视频模型卡', exact: true }).check()
    const defaultName = await config.getByRole('textbox', { name: '画布名称' }).inputValue()
    assert.match(defaultName, /^分镜画布-\d{8}-\d{6}$/)
    await config.getByRole('button', { name: '开始提取', exact: true }).click()
    const card = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: defaultName, exact: true }) })
    await card.getByText('分镜已就绪', { exact: true }).waitFor()
    assert.equal(page.url(), management)
    if (modality === 'image') {
      await page.getByRole('button', { name: '任务中心', exact: true }).click()
      await page.getByRole('button', { name: /^历\s*史$/ }).click()
      const taskRow = page.getByRole('row').filter({ hasText: '忠实提取分镜' })
      await taskRow.getByRole('button', { name: /查\s*看/ }).click()
      const task = page.getByRole('dialog', { name: '分镜任务详情', exact: true })
      await task.getByText(defaultName, { exact: true }).waitFor()
      await task.getByRole('button', { name: '打开此任务画布', exact: true }).click()
    } else await openReadyStoryboard(page, defaultName)
    await page.getByRole('region', { name: '生成画布工作台', exact: true }).waitFor()
    const canvas = base + '/' + new URL(page.url()).searchParams.get('canvas')
    const state = await poll(() => request(canvas), data => data.document.storyboard, 'storyboard was not saved')
    const { shots, objects } = state.document.storyboard
    if (modality === 'image') {
      const edited = '阿同继续拿着信封。'
      await openCanvasCard(page, shots[0].card_id)
      await page.getByRole('textbox', { name: '可见结果内容', exact: true }).fill(edited)
      await closeCanvasDetails(page)
      const noteSaved = row => row.document.cards.find(item => item.id === shots[0].card_id)?.visible_result?.text === edited
      await poll(() => request(canvas), noteSaved, 'edited storyboard did not auto-save')
      const opened = new URL(page.url())
      await page.getByRole('button', { name: '返回工作台管理', exact: true }).click()
      await card.getByText('当前定位', { exact: true }).waitFor()
      assert.equal(new URL(page.url()).searchParams.get('canvas'), opened.searchParams.get('canvas'))
      assert.equal(new URL(page.url()).searchParams.get('storyboardTask'), opened.searchParams.get('storyboardTask'))
      await card.getByRole('button', { name: '打开画布', exact: true }).press('Enter')
      await page.getByRole('region', { name: '生成画布工作台', exact: true }).waitFor()
      assert.ok(noteSaved(await request(canvas)))
    }
    const assign = async cardId => {
      const pending = state.document.cards.find(card => card.id === cardId)
      assert.equal(pending.type, 'model.' + modality)
      assert.equal(pending.model_id, null)
      const detail = await openCanvasCard(page, cardId)
      const chooser = detail.getByRole('combobox', { name: '选择模型', exact: true })
      await chooser.click()
      const popupId = await chooser.getAttribute('aria-controls')
      assert.ok(popupId, 'the opened model chooser exposes its list ID')
      const popup = page.locator('.ant-select-dropdown').filter({ has: page.locator(`[id=${JSON.stringify(popupId)}]`) })
      await popup.locator('.ant-select-item-option').getByText(modelName, { exact: true }).click()
      assert.equal(await chooser.getAttribute('aria-expanded'), 'false')
      await poll(() => request(canvas), saved => saved.document.cards.find(card => card.id === cardId)?.model_id,
        'first model assignment was not saved')
      return detail
    }
    const preparedModel = shots[0].model_card_ids[0]
    await assign(preparedModel)
    const preparedPreview = await request(canvas + '/precheck', 'POST', { card_id: preparedModel })
    assert.deepEqual(preparedPreview.input.media.map(media => media.file_id), ['object-browser-image'])
    await closeCanvasDetails(page)

    const shot = shots[1], cardId = shot.model_card_ids[0]
    await assign(cardId)
    await closeCanvasDetails(page)
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
    assert.deepEqual(Object.keys(success.result.current_outputs).filter(key => success.result.current_outputs[key].some(output => output.result_set_id)), [cardId])
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
  await page.getByRole('button', { name: '返回工作台管理', exact: true }).click()
  await page.getByRole('link', { name: '返回章节', exact: true }).click()
  await page.waitForURL(chapters)
  assert.equal(await page.getByRole('textbox', { name: '搜索章节' }).inputValue(), '候车')
  await page.getByRole('button', { name: '工作台管理', exact: true }).and(page.locator(':focus')).waitFor()
  console.log('scene storyboard media browser passed', output)
} catch (error) {
  await page?.screenshot({ path: join(output, 'failure.png') }).catch(() => {})
  throw error
} finally {
  if (backend.exitCode === null) await request(controls, 'POST', { disconnect: true }).catch(() => {})
  await cleanup()
}
