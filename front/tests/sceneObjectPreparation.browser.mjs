import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'
import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-scene-objects-')
const api = 'http://127.0.0.1:8258', studio = `${api}/api/v1/studio`
const project = 'canvas-project', chapter = 'object-test-chapter', excerpt = '前门的阿同拿着信封。后门的阿同等待。'
const raw = excerpt + '空镜。'
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_runtime_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache',
    CANVAS_BROWSER_SCENE_OBJECTS: '1', CANVAS_BROWSER_OBJECT_CANDIDATE: '1', CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'),
    CANVAS_BROWSER_PORT: '8258' }, stdio: ['ignore', 'pipe', 'pipe'],
})
captureBackend(backend, output)
let server, browser, page
const cleanup = browserCleanup(() => ({ browser, server, backend }))
const request = async (url, method = 'GET', body) => {
  const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) })
  assert.ok(response.ok, await response.clone().text())
  return (await response.json()).data
}
try {
  let ready = false
  for (let attempt = 0; attempt < 80; attempt++) {
    if (backend.exitCode !== null) throw new Error('isolated backend exited')
    try { if ((await fetch(`${studio}/generation-canvases/${project}`)).ok) { ready = true; break } } catch {}
    await delay(250)
  }
  assert.ok(ready)
  await request(`${studio}/chapters`, 'POST', { id: chapter, project_id: project, index: 0, title: '候车', raw_text: raw })
  const scenes = `${studio}/projects/${project}/directing/chapters/${chapter}/sequences`
  const sourceVersion = createHash('sha256').update(raw).digest('hex')
  const sequence = await request(scenes, 'POST', { title: '两人等候', position: 0,
    source_version: sourceVersion, span: { start: 0, end: excerpt.length } })
  const emptyScene = await request(scenes, 'POST', { title: '空镜', position: 1,
    source_version: sourceVersion, span: { start: excerpt.length, end: raw.length } })
  const objectsUrl = `${scenes}/${sequence.id}/objects`
  const read = () => request(objectsUrl)
  const canvas = await request(`${scenes}/${sequence.id}/canvases`, 'POST', { name: '已有方案' })
  const canvasUrl = `${studio}/generation-canvases/${project}/${canvas.id}`
  const canvasBefore = await request(canvasUrl)
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4258, strictPort: true, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  page.setDefaultTimeout(12000)
  const management = `http://127.0.0.1:4258/projects/${project}/chapters/${chapter}/workbench-management?sequence=${sequence.id}&step=objects`
  await page.goto(management)
  await page.getByRole('navigation', { name: '制作步骤' }).waitFor()
  const extract = page.getByRole('button', { name: '提取对象', exact: true })
  await page.getByText(/^尚未提取对象/).waitFor()
  await extract.focus()
  await page.keyboard.press('Enter')
  const front = page.getByRole('region', { name: '阿同 · 前门的阿同', exact: true })
  const back = page.getByRole('region', { name: '阿同 · 后门的阿同', exact: true })
  await front.waitFor()
  assert.equal(await front.locator('article, .ant-card').first().evaluate(node => getComputedStyle(node).borderRadius), '12px')
  await front.getByRole('button', { name: '上传参考图', exact: true }).waitFor()
  await front.getByText('未绑定参考图', { exact: true }).waitFor()
  assert.equal(await front.locator('img').count(), 0)
  assert.equal(page.url(), management)
  await front.getByText('尚未关联资产', { exact: true }).waitFor()
  await back.getByText('尚未关联资产', { exact: true }).waitFor()
  const baseline = await read()
  const backObject = baseline.objects.find(object => object.excerpt === '后门的阿同')
  await request(`${objectsUrl}/${backObject.id}`, 'PUT', { expected_revision: baseline.revision, asset_id: 'object-browser-character' })
  const associationFilter = page.getByRole('combobox', { name: '关联状态' })
  await associationFilter.press('ArrowDown')
  await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').getByText('未关联', { exact: true }).click()
  await front.getByRole('combobox', { name: '关联资产' }).click()
  await page.getByText('已有角色（提取建议）', { exact: true }).click()
  await page.getByRole('button', { name: '核对后重试选择', exact: true }).click()
  await front.waitFor({ state: 'detached' })
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '关联资产')
  await associationFilter.press('ArrowDown')
  await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').getByText('全部关联状态', { exact: true }).click()
  await front.getByText('未绑定参考图', { exact: true }).waitFor()
  await front.getByRole('button', { name: '选择参考图', exact: true }).click()
  await page.getByText('参考图 1', { exact: true }).click()
  await front.getByText('已选参考图', { exact: true }).waitFor()
  await front.getByRole('button', { name: '更换参考图', exact: true }).press('Enter')
  await page.getByRole('menuitem', { name: /参考图 1.*当前已选/ }).waitFor()
  await page.keyboard.press('Escape')
  await front.getByRole('button', { name: '对象更多操作' }).click()
  await page.getByRole('menuitem', { name: '清除参考图', exact: true }).click()
  await front.getByText('未绑定参考图', { exact: true }).waitFor()
  assert.equal((await read()).objects[0].asset_id, 'object-browser-character')
  await front.getByRole('button', { name: '选择参考图', exact: true }).click()
  await page.getByText('参考图 1', { exact: true }).click()
  await front.getByText('已选参考图', { exact: true }).waitFor()
  await front.getByRole('button', { name: '对象更多操作' }).click()
  await page.getByRole('menuitem', { name: '准备图片', exact: true }).click()
  const asset = page.getByRole('region', { name: '本场资产详情' })
  await asset.getByRole('button', { name: '返回对象参考', exact: true }).waitFor()
  await asset.getByRole('button', { name: '返回对象参考', exact: true }).press('Enter')
  await asset.waitFor({ state: 'hidden' })

  const prop = page.getByRole('region', { name: '信封 · 拿着信封', exact: true })
  await prop.getByRole('button', { name: '对象更多操作' }).click()
  await page.getByRole('menuitem', { name: '新建并关联', exact: true }).click()
  const create = page.getByRole('dialog', { name: '新建并关联资产' })
  await page.setViewportSize({ width: 1024, height: 440 })
  const createBounds = await create.getByRole('button', { name: '创建并关联', exact: true }).boundingBox()
  assert.ok(createBounds.y >= 0 && createBounds.y + createBounds.height <= 440)
  await page.getByRole('menuitem', { name: '新建并关联', exact: true }).waitFor({ state: 'hidden' })
  await create.getByRole('button', { name: '创建并关联', exact: true }).click()
  await page.setViewportSize({ width: 1440, height: 900 })
  await prop.getByText('未绑定参考图', { exact: true }).waitFor()
  await back.getByRole('button', { name: '选择参考图', exact: true }).click()
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('menuitem', { name: '上传参考图', exact: true }).click()])
  await chooser.setFiles({ name: '后门参考.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7WQAAAAASUVORK5CYII=', 'base64') })
  await back.getByText('已选参考图', { exact: true }).waitFor()
  const prepared = await read()
  assert.equal(prepared.objects[0].image_file_id, 'object-browser-image')
  assert.equal(prepared.objects[1].asset_id, 'object-browser-character')
  assert.ok(prepared.objects[1].image_file_id && prepared.objects[1].image_file_id !== 'object-browser-image')
  assert.equal(prepared.objects[2].image_file_id, null)
  assert.deepEqual(await request(canvasUrl), canvasBefore, 'candidate changes never rewrite a canvas')
  const tasks = await request(`${api}/api/v1/film/tasks?project_id=${project}`)
  assert.deepEqual(tasks.items.map(task => task.task_kind), ['directing_object_extract'])
  await page.reload()
  await front.getByRole('img', { name: '阿同已选参考图' }).waitFor()
  await front.getByRole('button', { name: '预览阿同参考图', exact: true }).press('Enter')
  const imagePreview = page.getByRole('dialog').filter({ has: page.getByRole('img', { name: '阿同已选参考图' }) })
  await imagePreview.waitFor()
  await page.locator('.ant-image-preview-close:visible').click()
  await imagePreview.waitFor({ state: 'hidden' })
  await back.getByRole('img', { name: '阿同已选参考图' }).waitFor()
  const referenceDownload = '**/files/object-browser-image/download'
  await page.route(referenceDownload, route => route.abort('failed'))
  await page.reload()
  await front.getByText('图片加载失败', { exact: true }).waitFor()
  assert.equal(await front.locator('img').count(), 0)
  assert.equal((await read()).objects[0].image_file_id, 'object-browser-image')
  await page.unroute(referenceDownload)
  await page.reload()
  await front.getByRole('img', { name: '阿同已选参考图' }).waitFor()
  await front.getByText('描述与出处', { exact: true }).press('Enter')
  await front.getByText('出处：前门的阿同', { exact: true }).waitFor()
  await front.getByText('描述与出处', { exact: true }).press('Enter')
  await page.getByText('道具', { exact: true }).first().click()
  await front.waitFor({ state: 'detached' })
  await prop.waitFor()
  await page.getByText('全部', { exact: true }).click()
  const referenceFilter = page.getByRole('button', { name: '参考筛选', exact: true })
  await referenceFilter.click()
  await page.getByRole('menuitem', { name: '未选参考图', exact: true }).click()
  await front.waitFor({ state: 'detached' })
  await back.waitFor({ state: 'detached' })
  await prop.waitFor()
  await referenceFilter.click()
  await page.getByRole('menuitem', { name: '全部参考状态', exact: true }).click()
  await front.waitFor()
  for (const appearance of ['雾蓝微渐变', '雾蓝纯色']) {
    await page.getByRole('button', { name: '用户与语言设置' }).click()
    await page.getByRole('menuitemradio', { name: appearance }).click()
    await page.getByRole('menuitemradio', { name: appearance }).waitFor({ state: 'hidden' })
    for (const [width, height] of [[1440, 900], [1366, 768], [1024, 440], [375, 768]]) {
      await page.setViewportSize({ width, height })
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      await page.screenshot({ path: join(output, `objects-${appearance}-${width}.png`), animations: 'disabled' })
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.screenshot({ path: join(output, 'objects-desktop.png'), animations: 'disabled' })
  await page.setViewportSize({ width: 390, height: 844 })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  const directAsset = front.getByRole('button', { name: '查看已有角色资产', exact: true })
  await directAsset.click()
  const directDetail = page.getByRole('region', { name: '本场资产详情' })
  await directDetail.getByRole('button', { name: '返回对象参考', exact: true }).click()
  await directDetail.waitFor({ state: 'hidden' })
  await directAsset.and(page.locator(':focus')).waitFor()
  await front.getByRole('button', { name: '对象更多操作' }).press('Enter')
  const actions = page.getByRole('menuitem', { name: '准备图片', exact: true })
  await actions.waitFor()
  await actions.click()
  const inlineAsset = page.getByRole('region', { name: '本场资产详情' })
  await inlineAsset.waitFor()
  assert.equal(page.url(), management)
  assert.equal(await page.getByRole('dialog', { name: /准备角色图片/ }).count(), 0)
  const assetPanel = page.locator('.management-workspace .management-panel')
  await assetPanel.evaluate(element => { element.scrollTop = element.scrollHeight })
  const toolbarBounds = await inlineAsset.locator('.management-asset-toolbar').boundingBox()
  const panelBounds = await assetPanel.boundingBox()
  const panelPadding = await assetPanel.evaluate(element => parseFloat(getComputedStyle(element).paddingTop))
  assert.ok(Math.abs(toolbarBounds.y - panelBounds.y - panelPadding) < 3, '资产工具栏在正文滚动后保持可达')
  const assetName = inlineAsset.getByRole('textbox', { name: '名称', exact: true })
  await assetName.fill('尚未保存的角色名')
  await inlineAsset.getByRole('button', { name: '返回对象参考', exact: true }).click()
  const leaveAsset = page.getByRole('dialog', { name: '离开资产详情', exact: true })
  await leaveAsset.getByRole('button', { name: '继续编辑', exact: true }).click()
  assert.equal(await assetName.inputValue(), '尚未保存的角色名')
  await inlineAsset.getByRole('button', { name: '返回对象参考', exact: true }).click()
  await page.route('**' + new URL(objectsUrl).pathname, async route => {
    const response = await route.fetch()
    const body = await response.json()
    body.data.objects = body.data.objects.filter(object => object.excerpt !== '前门的阿同')
    await route.fulfill({ response, json: body })
  }, { times: 1 })
  await leaveAsset.getByRole('button', { name: '放弃修改并离开', exact: true }).click()
  await inlineAsset.waitFor({ state: 'hidden' })
  await page.getByRole('combobox', { name: '对象类型' }).and(page.locator(':focus')).waitFor()
  await page.reload()
  await front.waitFor()

  await page.screenshot({ path: join(output, 'objects-mobile.png'), animations: 'disabled' })
  if (await page.getByRole('button', { name: '制作步骤', exact: true }).count()) await page.getByRole('button', { name: '制作步骤', exact: true }).click()
  await page.getByRole('navigation', { name: '制作步骤' }).getByRole('button', { name: /分镜画布/ }).click()
  await page.waitForURL(url => url.searchParams.get('step') === 'storyboard')
  await page.getByRole('list', { name: '本场画布', exact: true }).getByRole('button', { name: '已有方案', exact: true }).click()
  await page.getByRole('region', { name: '生成画布工作台' }).waitFor()
  await page.goto(management)
  await page.getByRole('button', { name: '重新提取对象', exact: true }).click()
  const reviewButton = page.getByRole('button', { name: '核对对象差异', exact: true })
  await reviewButton.waitFor()
  await page.getByRole('button', { name: '对象步骤更多操作' }).click()
  await page.getByRole('menuitem', { name: '重新提取对象', exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('menuitem', { name: '重新提取对象', exact: true }).waitFor({ state: 'hidden' })
  await reviewButton.click()
  const review = page.getByRole('dialog', { name: '核对对象差异', exact: true })
  await review.getByRole('heading', { name: '新增 1 项', exact: true }).waitFor()
  await review.getByRole('heading', { name: '移除 1 项', exact: true }).waitFor()
  await review.getByRole('heading', { name: '保留人工选择 2 项', exact: true }).waitFor()
  const pending = await read()
  assert.equal(pending.revision, prepared.revision)
  assert.deepEqual(pending.objects, prepared.objects)
  await review.getByRole('button', { name: '暂不应用', exact: true }).click()
  await review.waitFor({ state: 'hidden' })
  await page.goto(`${management}&objectTask=${pending.candidate_task_id}`)
  const apply = review.getByRole('button', { name: '应用整批对象', exact: true })
  await apply.waitFor()
  await review.getByRole('heading', { name: '保留人工选择 2 项', exact: true }).waitFor()
  const previousBack = pending.objects.find(object => object.id === backObject.id)
  await request(`${objectsUrl}/${backObject.id}`, 'PUT', { expected_revision: pending.revision,
    asset_id: null, image_file_id: previousBack.image_file_id })
  await apply.click()
  await review.getByText(/重新核对差异/).waitFor()
  await review.getByText('保留参考图', { exact: true }).waitFor()

  const applicationPath = `**/objects/extractions/${pending.candidate_task_id}/apply`
  let confirmedBody
  await page.route(applicationPath, async route => {
    confirmedBody = route.request().postDataJSON()
    const response = await route.fetch()
    assert.ok(response.ok(), await response.text())
    await route.abort('failed')
  }, { times: 1 })
  await apply.click()
  const verify = review.getByRole('button', { name: '核实应用结果', exact: true })
  await verify.waitFor()
  const adopted = await read()
  assert.equal(adopted.revision, pending.revision + 2)
  assert.equal(adopted.candidate_task_id, null)
  assert.equal(adopted.objects.find(object => object.id === backObject.id).asset_id, null)
  assert.equal(adopted.objects.find(object => object.id === backObject.id).image_file_id, previousBack.image_file_id)
  assert.equal(adopted.objects.find(object => object.kind === 'scene').name, '前门')
  assert.ok(adopted.assets.some(asset => asset.name === '信封'))
  assert.deepEqual(await request(canvasUrl), canvasBefore)
  const replay = page.waitForRequest(req => req.method() === 'POST' && req.url().endsWith('/apply'))
  await verify.click()
  assert.deepEqual((await replay).postDataJSON(), confirmedBody)
  await review.waitFor({ state: 'hidden' })
  assert.equal((await read()).revision, adopted.revision)

  // Keep a real pending candidate when this scene becomes historical.
  await request(`${objectsUrl}/extractions`, 'POST', { request_id: 'historical-candidate' })
  let historicalCandidate
  for (let attempt = 0; attempt < 80; attempt++) {
    historicalCandidate = (await read()).candidate_task_id
    if (historicalCandidate) break
    await delay(100)
  }
  assert.ok(historicalCandidate)
  const assetUrl = `${studio}/entities/character/object-browser-character`
  await request(assetUrl, 'DELETE')
  await page.goto(management)
  await front.getByText('参考图不可用', { exact: true }).waitFor()
  await front.getByText('关联资产不可用，请更换或解除关联', { exact: true }).waitFor()
  assert.equal(await front.locator('img').count(), 0)
  await back.getByText('已选参考图', { exact: true }).waitFor()

  await page.goto(management.replace(`sequence=${sequence.id}`, `sequence=${emptyScene.id}`))
  await page.getByText(/^尚未提取对象/).waitFor()
  await page.getByRole('button', { name: '提取对象', exact: true }).click()
  await page.getByText(/^本场未提取到对象/).waitFor()
  if (await page.getByRole('button', { name: '制作步骤', exact: true }).count()) await page.getByRole('button', { name: '制作步骤', exact: true }).click()
  await page.getByRole('navigation', { name: '制作步骤' }).getByRole('button', { name: /分镜画布/ }).click()
  await page.waitForURL(url => url.searchParams.get('step') === 'storyboard')

  const chapterPath = scenes.slice(0, -'/sequences'.length)
  const draft = { source_version: sourceVersion,
    baseline: [sequence, emptyScene].map(row => ({ sequence_id: row.id, version: row.version })),
    members: [{ key: 'empty', sequence_id: emptyScene.id, title: emptyScene.title, span: emptyScene.span }],
    lineage: [{ sequence_id: sequence.id, target_keys: [] }, { sequence_id: emptyScene.id, target_keys: ['empty'] }],
    exited_sequence_ids: [sequence.id] }
  const preview = await request(`${chapterPath}/division/preview`, 'POST', draft)
  await request(`${chapterPath}/division`, 'PUT', { request_id: 'archive-prepared-scene', draft,
    preview_token: preview.preview_token, identity_changes_confirmed: true })
  await page.goto(management)
  await front.waitFor()
  const historicalReview = page.getByRole('button', { name: '核对对象差异', exact: true })
  assert.equal(await historicalReview.isEnabled(), true)
  await historicalReview.click()
  await review.getByRole('button', { name: '应用整批对象', exact: true }).waitFor()
  assert.equal(await review.getByRole('button', { name: '应用整批对象', exact: true }).isDisabled(), true)
  await review.getByRole('button', { name: '暂不应用', exact: true }).click()
  await review.waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: '对象步骤更多操作' }).click()
  const archivedExtract = page.getByRole('menuitem', { name: '重新提取对象', exact: true })
  await archivedExtract.waitFor()
  assert.equal(await archivedExtract.getAttribute('aria-disabled'), 'true')
  await page.keyboard.press('Escape')
  await archivedExtract.waitFor({ state: 'hidden' })
  assert.equal(await front.getByRole('combobox', { name: '关联资产' }).isDisabled(), true)
  assert.equal(await front.getByRole('button', { name: '对象更多操作' }).isDisabled(), true)
  const rejected = (url, method, body) => fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  assert.equal((await rejected(`${objectsUrl}/extractions`, 'POST', { request_id: 'archive-extract' })).status, 422)
  assert.equal((await rejected(`${objectsUrl}/${backObject.id}`, 'PUT', { expected_revision: adopted.revision, asset_id: null })).status, 422)
  assert.equal((await read()).revision, adopted.revision)
  // Opening a failed task from history must show its own error without candidate actions.
  const liveScene = (await request(chapterPath)).sequences.find(row => row.id === emptyScene.id)
  const emptyPath = `${scenes}/${emptyScene.id}`
  await request(emptyPath, 'PUT', { title: liveScene.title, position: liveScene.position,
    expected_version: liveScene.version, source_version: sourceVersion,
    span: { start: excerpt.length, end: excerpt.length + 1 } })
  const failedTask = await request(`${emptyPath}/objects/extractions`, 'POST', { request_id: 'failed-object-link' })
  await page.goto(management.replace(`sequence=${sequence.id}`, `sequence=${emptyScene.id}`) + `&objectTask=${failedTask.task_id}`)
  const taskDialog = page.getByRole('dialog', { name: '对象提取任务', exact: true })
  await taskDialog.getByText('对象提取失败', { exact: true }).waitFor()
  assert.equal(await taskDialog.getByRole('button', { name: '应用整批对象', exact: true }).count(), 0)
  await taskDialog.getByRole('button', { name: /^关\s*闭$/ }).click()
  await page.waitForURL(url => !url.searchParams.has('objectTask'))
  console.log(JSON.stringify({ output, passed: true }))
} catch (reason) {
  if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true })
  throw reason
} finally { await cleanup() }
