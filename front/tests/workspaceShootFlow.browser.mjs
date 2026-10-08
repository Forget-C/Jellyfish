import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { makeWorkspace, revision } from './directing-fixtures.mjs'
const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
process.chdir(root)
const output = await mkdtemp(join(tmpdir(), 'jellyfish-shoot-flow-'))
const videoPath = join(output, 'sample.mp4'), imagePath = join(output, 'thumbnail.png')
assert.equal(spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=480x270:rate=10', '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', videoPath]).status, 0)
assert.equal(spawnSync('ffmpeg', ['-v', 'error', '-i', videoPath, '-frames:v', '1', imagePath]).status, 0)
const [video, image] = await Promise.all([readFile(videoPath), readFile(imagePath)])
const server = await createServer({ root, server: { host: '127.0.0.1', port: 4199, strictPort: true, open: false } })
const workspace = makeWorkspace(), writes = [], errors = [], mediaReads = [], results = []
workspace.plans = [workspace.plans[0]]; workspace.cuts = []; workspace.task_ids = ['running-old']
workspace.prompts = ['prompt1', 'prompt2'].map((id, index) => ({ ...revision(id, { plan_revision_id: 'p-old', unit_id: 'u1', text: `固定指令 ${index + 1}`, decisions: [], sources: [], format_version: 'v4' }), display_number: index + 1 }))
const template = workspace.takes[0]
workspace.takes = Array.from({ length: 25 }, (_, index) => ({ ...structuredClone(template), id: `take${index + 1}`, task_id: `complete${index + 1}`, display_number: index + 1, file_id: `file${index + 1}`, prompt_revision_id: index < 20 ? 'prompt1' : 'prompt2' }))
const roles = ['direction', 'performance', 'staging', 'cinematography', 'continuity', 'prompt']
const packet = { mode: 'formal', roles, occurrences: [{ id: 'o1', prompt_revision_id: 'prompt2', plan_revision_id: 'p-old', unit_id: 'u1', coverage_item_id: 'cover1', shot_id: 'shot1', local_number: 1 }], rows: roles.map(role => ({ role, occurrence_id: 'o1', verdict: 'pass', rationale: '符合固定依据', findings: [] })), context: { state: 'unset' } }
workspace.reviews = [revision('review1', packet), revision('review2', packet)]
let taskStatus = 'running', browser, page, failThumbnail = true, failMedia = false, deferTake1 = false, releaseMedia, receiveMedia
try {
  await server.listen(); browser = await chromium.launch({ headless: true })
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(15000)
  await page.addInitScript(() => {
    window.__ENV = { BACKEND_URL: location.origin }
    sessionStorage.setItem('directing-submitted-tasks:p1:s1', JSON.stringify([{ taskId: 'running-old', planId: 'p-old', unitId: 'u1', promptId: 'prompt1' }]))
  })
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    const respond = data => route.fulfill({ json: { success: true, data: structuredClone(data) } })
    if (request.method() !== 'GET' && !path.endsWith('/sources/resolve')) writes.push(path)
    if (path.endsWith('/s1')) return respond(workspace)
    if (path.endsWith('/tasks/running-old')) return respond({ task_id: 'running-old', kind: 'video_generation', status: taskStatus, error: taskStatus === 'failed' ? '供应商试拍失败' : null })
    if (path.endsWith('/continuity')) return respond({ active_cut_revision_id: null, frames: [], seams: [], units: [] })
    if (path.endsWith('/feedback')) return respond({ reviews: [], repairs: [], knowledge: [], active_cut_revision_id: null })
    if (path.endsWith('/media')) {
      const id = path.split('/').at(-2); mediaReads.push(id)
      if (deferTake1 && id === 'take1') { deferTake1 = false; await new Promise(resolve => { releaseMedia = resolve; receiveMedia() }) }
      if (failMedia && id === 'take1') return route.fulfill({ status: 503, json: { detail: '隔离媒体读取失败' } })
      return respond({ take_id: id, file_id: id, url: `/api/video/${id}`, duration_ms: id === 'take2' ? null : 1000, thumbnail_url: `/api/thumb/${id}` })
    }
    if (path.startsWith('/api/thumb/')) return path.endsWith('/take2') && failThumbnail ? route.fulfill({ status: 503 }) : route.fulfill({ contentType: 'image/png', body: image })
    if (path.startsWith('/api/video/')) return route.fulfill({ contentType: 'video/mp4', body: video })
    if (path.endsWith('/models/model1')) return respond({ id: 'model1', name: '测试视频模型', category: 'video' })
    if (path.endsWith('/models')) return respond({ items: [{ id: 'model1', name: '测试视频模型', category: 'video' }], total: 1 })
    if (path.endsWith('/model-settings')) return respond({ default_video_model_id: 'model1' })
    if (path.endsWith('/sources/resolve') || /\/(assets|styles|batches|categories)$/.test(path)) return respond([])
    return respond({ items: [], total: 0 })
  })
  const base = 'http://127.0.0.1:4199/projects/p1/chapters/ch1/sequences/s1?view=shoot&design=d1&plan=p-old&unit=u1'
  await page.goto(base + '&prompt=&review=&focus=prompt-review')
  await page.getByRole('region', { name: '选择本次指令' }).waitFor()
  assert.equal(await page.getByRole('button', { name: '使用此指令', exact: true }).count(), 2)
  await page.getByRole('button', { name: '使用此指令', exact: true }).nth(1).click()
  await page.getByRole('heading', { name: '选择当前指令的检查记录' }).waitFor()
  assert.equal(await page.getByRole('button', { name: '选择此检查', exact: true }).count(), 2)
  assert.equal(await page.getByRole('region', { name: '本次检查结论' }).count(), 0)
  await page.getByRole('button', { name: '选择此检查', exact: true }).first().click()
  await page.getByRole('button', { name: '进入试拍', exact: true }).click()
  const candidates = page.getByRole('region', { name: '本单元候选素材' })
  await candidates.getByRole('button', { name: '预览候选 01', exact: true }).waitFor()
  await page.locator('[data-inline-task-id="running-old"]').getByText('指令 v1', { exact: true }).waitFor()
  await page.getByRole('region', { name: '本次执行依据' }).getByText('指令 v2', { exact: true }).waitFor()
  assert.equal(await candidates.locator('article').count(), 12)
  assert.ok(new Set(mediaReads).size <= 12, 'grid only reads the first page')
  assert.equal(await page.locator('.shoot-candidates video').count(), 0, 'grid does not create video players')
  const gridWidth = await candidates.evaluate(element => element.getBoundingClientRect().width)
  await candidates.getByRole('button', { name: '预览候选 02', exact: true }).click()
  await page.getByRole('region', { name: '候选快速预览' }).getByText(/实际时长未知/).waitFor()
  assert.equal(await candidates.evaluate(element => element.getBoundingClientRect().width), gridWidth, 'opening preview preserves candidate grid width')
  const player = page.getByRole('region', { name: '候选快速预览' }).locator('video')
  assert.equal(await player.evaluate(node => node.autoplay), false)
  await candidates.getByRole('button', { name: '预览候选 01', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.shoot-candidate-preview video')?.getAttribute('src') === location.origin + '/api/video/take1')
  await page.getByRole('button', { name: '关闭候选预览' }).click()
  assert.equal(await page.locator('.shoot-candidate-preview video').count(), 0)
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '预览候选 01')
  await candidates.getByText('列表', { exact: true }).click()
  assert.equal(await candidates.locator('.is-list article').count(), 12)
  await candidates.getByText('当前指令', { exact: true }).click()
  assert.equal(await candidates.locator('article').count(), 5)
  assert.equal(await candidates.getByRole('button', { name: '预览候选 21', exact: true }).count(), 1)
  await candidates.getByText('全部候选 25', { exact: true }).click()
  await candidates.getByText('网格', { exact: true }).click()
  failThumbnail = false
  await candidates.getByRole('button', { name: '重试预览资源', exact: true }).first().click()
  await page.waitForFunction(() => [...document.querySelectorAll('.shoot-candidate-thumbnail img')].every(img => img.complete && img.naturalWidth > 0))
  taskStatus = 'failed'
  await page.reload()
  await page.locator('[data-inline-task-id="running-old"]').getByText('供应商试拍失败', { exact: true }).waitFor()
  assert.equal(await candidates.locator('article').count(), 12)
  assert.equal(await candidates.getByRole('button', { name: '预览候选 01', exact: true }).getAttribute('aria-pressed'), 'true')
  for (const width of [1440, 1024, 768, 375]) {
    await page.setViewportSize({ width, height: 1000 })
    await candidates.getByRole('button', { name: '预览候选 01', exact: true }).click()
    await page.getByRole('region', { name: '候选快速预览' }).waitFor()
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    if (width < 1280) await page.waitForFunction(() => { const box = document.querySelector('.ant-drawer-open .ant-drawer-content-wrapper')?.getBoundingClientRect(); return box && box.x >= -1 && box.right <= innerWidth + 1 })
    await page.waitForFunction(() => { const video = document.querySelector('.shoot-candidate-preview video'); return video?.readyState >= 2 && video.paused })
    await page.screenshot({ path: join(output, `candidate-preview-${width}.png`), animations: 'disabled' })
    await page.getByRole('button', { name: '关闭候选预览' }).click()
    if (width < 1280) await page.getByRole('dialog').filter({ has: page.locator('.production-inspector-content') }).waitFor({ state: 'hidden' })
    await page.screenshot({ path: join(output, `candidates-${width}.png`), animations: 'disabled' })
    results.push({ width, candidates: await candidates.locator('article').count() })
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await candidates.getByRole('button', { name: '预览候选 03', exact: true }).click()
  const beforeReturnScroll = await page.locator('.production-content').evaluate(element => { element.scrollTop = 180; return element.scrollTop })
  await page.getByRole('button', { name: '进入剪辑验收', exact: true }).click()
  await page.waitForURL(url => url.searchParams.get('view') === 'cut' && url.searchParams.get('take') === 'take3')
  await page.getByLabel('当前候选播放器', { exact: true }).waitFor()
  assert.ok((await page.getByLabel('当前候选播放器', { exact: true }).getAttribute('src')).endsWith('/api/video/take3'))
  await page.getByRole('button', { name: '返回试拍与候选', exact: true }).click()
  await candidates.waitFor()
  assert.equal(await candidates.getByRole('button', { name: '预览候选 03', exact: true }).getAttribute('aria-pressed'), 'true')
  assert.ok(Math.abs(await page.locator('.production-content').evaluate(element => element.scrollTop) - beforeReturnScroll) <= 1, 'return preserves the candidate workspace scroll')
  failMedia = true
  await page.reload()
  await candidates.getByRole('button', { name: '预览候选 01', exact: true }).click()
  await page.getByRole('region', { name: '候选快速预览' }).getByText('媒体读取失败', { exact: true }).waitFor()
  assert.equal(await page.locator('.shoot-candidate-preview video').count(), 0)
  failMedia = false
  await page.getByRole('button', { name: '重试读取媒体', exact: true }).click()
  await page.getByRole('region', { name: '候选快速预览' }).locator('video').waitFor()
  await page.getByRole('button', { name: '关闭候选预览' }).click()
  deferTake1 = true
  const held = new Promise(resolve => { receiveMedia = resolve })
  await page.reload(); await held
  await candidates.getByRole('button', { name: '预览候选 01', exact: true }).click()
  await page.getByRole('button', { name: '关闭候选预览' }).click()
  await candidates.locator('.ant-pagination-item-2').click()
  await candidates.getByRole('button', { name: '预览候选 13', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.shoot-candidate-preview video')?.getAttribute('src') === location.origin + '/api/video/take13')
  const late = page.waitForResponse(response => response.url().endsWith('/takes/take1/media'))
  releaseMedia(); await late
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  assert.ok((await page.locator('.shoot-candidate-preview video').getAttribute('src')).endsWith('/api/video/take13'), 'late previous-page media never replaces the selected candidate')
  await page.getByRole('button', { name: '关闭候选预览' }).click()
  await candidates.locator('.ant-pagination-item-1').click()
  taskStatus = 'running'
  await page.reload()
  for (const width of [1440, 1024, 768, 375]) {
    await page.setViewportSize({ width, height: 1000 })
    if (width < 1280) await page.getByRole('button', { name: '执行与候选详情', exact: true }).click()
    await page.locator('[data-inline-task-id="running-old"]').getByText('进行中', { exact: true }).waitFor()
    await page.screenshot({ path: join(output, `running-candidates-${width}.png`), animations: 'disabled' })
    if (width < 1280) { await page.keyboard.press('Escape'); await page.getByRole('dialog').filter({ has: page.locator('.production-inspector-content') }).waitFor({ state: 'hidden' }) }
  }
  workspace.takes = []
  await page.reload()
  for (const width of [1440, 1024, 768, 375]) {
    await page.setViewportSize({ width, height: 1000 })
    await candidates.getByText('本单元还没有候选视频，试拍成功后将在此显示', { exact: true }).waitFor()
    assert.equal(await candidates.locator('article').count(), 0)
    await page.screenshot({ path: join(output, `running-empty-${width}.png`), animations: 'disabled' })
  }
  assert.deepEqual(writes, []); assert.deepEqual(errors, [])
  await writeFile(join(output, 'results.json'), JSON.stringify({ results, writes, errors, mediaReads }, null, 2))
  console.log(JSON.stringify({ output, result: 'PASS inline unselected records, three-step action, frozen task identity, pagination, media preview, retry, filter, stable names, failed-task retention and four widths' }))
} catch (error) { if (page) { console.log(await page.locator('body').innerText()); await page.screenshot({ path: join(output, 'failure.png') }) } console.log(output); throw error } finally { await browser?.close(); await server.close() }
