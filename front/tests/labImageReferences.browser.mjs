import { openLabAddition } from './lab-composer-actions.mjs'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { browserCleanup, browserOutput } from './browser-runtime.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
process.chdir(root)
const output = await browserOutput('jellyfish-lab-image-references-')
const origin = 'http://127.0.0.1:4803'
const timestamp = '2026-11-10T08:00:00Z'
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aR2kAAAAASUVORK5CYII=', 'base64')
const sessions = ['image-a', 'image-b'].map((id, index) => ({ id, lab_type: 'image', title: `图片会话 ${index + 1}`, created_at: timestamp, updated_at: timestamp }))
const longName = '参考图片 5 '.repeat(12).trim()
const files = Array.from({ length: 6 }, (_, index) => ({ id: `file-${index + 1}`, name: index === 4 ? longName : `参考图片 ${index + 1}`, type: 'image' }))
const submissions = []
const deletions = []
let failLibrary = true
let failUpload = false
let libraryGate
let releaseLibrary
let uploadGate
let uploadCount = 0

const server = await createServer({ root, cacheDir: join(output, 'vite'), server: { host: '127.0.0.1', port: 4803, strictPort: true, open: false } })
let browser
let page
const cleanup = browserCleanup(() => ({ browser, server }))
try {
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1440, height: 900 } })
  page.setDefaultTimeout(5000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: location.origin } })
  await page.route('**/api/**', async route => {
    const request = route.request()
    const url = new URL(request.url())
    const respond = data => route.fulfill({ json: { success: true, data } })
    if (request.method() === 'DELETE') deletions.push(url.pathname)
    if (url.pathname.endsWith('/experiment-sessions')) return respond(url.searchParams.get('lab_type') === 'image' ? sessions : [])
    if (url.pathname.endsWith('/models')) return respond({ items: [{ id: 'model-1', name: '验收图片模型', category: 'image' }] })
    if (url.pathname.endsWith('/files/upload')) {
      const attempt = ++uploadCount
      await uploadGate
      if (failUpload) return route.fulfill({ status: 503, json: { detail: '上传失败' } })
      const file = { id: `uploaded-${attempt}`, name: `上传图片 ${attempt}`, type: 'image' }
      files.push(file)
      return respond(file)
    }
    if (url.pathname.endsWith('/files')) {
      if (failLibrary) return route.fulfill({ status: 503, json: { detail: '资料库不可用' } })
      const snapshot = structuredClone(files)
      await libraryGate
      return respond({ items: snapshot, total: snapshot.length })
    }
    if (url.pathname.endsWith('/download')) {
      if (url.pathname.includes('/file-6/')) return route.fulfill({ status: 404 })
      return route.fulfill({ body: png, contentType: 'image/png' })
    }
    const run = url.pathname.match(/\/labs\/image\/sessions\/([^/]+)\/tasks$/)
    if (run) {
      const body = request.postDataJSON()
      submissions.push({ session: run[1], body })
      const taskId = `task-${submissions.length}`
      return respond({ task_id: taskId, messages: [{ id: taskId, session_id: run[1], role: 'task', content: '已完成', sequence: 1, task_id: taskId, status: 'succeeded', created_at: timestamp, updated_at: timestamp }] })
    }
    if (url.pathname.endsWith('/film/tasks')) return respond({ items: [], next_cursor: null })
    return respond([])
  })

  await page.goto(origin + '/lab?session=image-a')
  const trigger = page.getByRole('button', { name: '添加内容', exact: true })
  const panel = page.getByRole('dialog', { name: '配置参考图', exact: true })
  const choose = async name => panel.getByRole('checkbox', { name, exact: true }).check()
  await openLabAddition(page, '添加参考图')
  await panel.getByText('上传文件保留在资料库，应用后用于本轮实验', { exact: true }).waitFor()
  await panel.getByRole('tab', { name: '资料库', exact: true }).click()
  await panel.getByText('图片资料库读取失败', { exact: true }).waitFor()
  assert.equal(await panel.getByText('资料库中暂无图片', { exact: true }).count(), 0)
  failLibrary = false
  await panel.getByRole('button', { name: '重试读取', exact: true }).click()
  await choose('参考图片 2')
  await choose('参考图片 1')
  assert.equal(submissions.length, 0)
  await panel.getByRole('button', { name: '应用参考图', exact: true }).click()
  await panel.waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: '预览参考图：参考图片 2', exact: true }).waitFor()

  await openLabAddition(page, '添加参考图')
  await panel.getByRole('button', { name: '移除参考图：参考图片 2', exact: true }).click()
  await panel.getByRole('tab', { name: '资料库', exact: true }).click()
  await choose('参考图片 3')
  await panel.getByRole('button', { name: '取消参考配置', exact: true }).click()
  await panel.waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: '预览参考图：参考图片 2', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '预览参考图：参考图片 3', exact: true }).count(), 0)

  await page.getByRole('button', { name: /选择模型/ }).click()
  await page.getByRole('button', { name: /验收图片模型/ }).waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('textbox', { name: '图片提示词', exact: true }).fill('参考图次序验证')
  await Promise.all([
    page.waitForResponse(response => response.url().endsWith('/image-a/tasks')),
    page.getByRole('button', { name: /^发\s*送$/, exact: true }).click(),
  ])
  assert.deepEqual(submissions.map(({ session, body }) => [session, body.media.references]), [[
    'image-a', [{ file_id: 'file-2', media_kind: 'image', ordinal: 0 }, { file_id: 'file-1', media_kind: 'image', ordinal: 1 }],
  ]])

  // 展开、重载和关闭预览不改变选择或创建任务。
  await openLabAddition(page, '添加参考图')
  await panel.getByRole('tab', { name: '资料库', exact: true }).click()
  const broken = panel.getByRole('button', { name: '预览资料库图片：参考图片 6', exact: true })
  await broken.click()
  const preview = page.getByRole('dialog', { name: '预览参考图：参考图片 6', exact: true })
  await preview.getByText('图片不可用', { exact: true }).waitFor()
  await Promise.all([
    page.waitForResponse(response => response.url().endsWith('/file-6/download')),
    preview.getByRole('button', { name: '重试加载', exact: true }).click(),
  ])
  await page.keyboard.press('Escape')
  await preview.waitFor({ state: 'hidden' })
  await broken.and(page.locator(':focus')).waitFor()
  assert.ok(await panel.isVisible())
  await page.keyboard.press('Escape')
  await panel.waitFor({ state: 'hidden' })
  await trigger.and(page.locator(':focus')).waitFor()
  for (const dismiss of [() => panel.getByRole('button', { name: /^(Close|关闭)$/ }).click(), () => page.mouse.click(20, 120)]) {
    await openLabAddition(page, '添加参考图')
    await panel.getByRole('button', { name: '移除参考图：参考图片 1', exact: true }).click()
    await dismiss()
    await panel.waitFor({ state: 'hidden' })
    await page.getByRole('button', { name: '预览参考图：参考图片 1', exact: true }).waitFor()
  }

  // 上传失败可用原文件重试；成功仅写入资料库和打开的面板草稿。
  await page.getByRole('textbox', { name: '图片提示词', exact: true }).fill('上传失败后保留提示词')
  await openLabAddition(page, '添加参考图')
  const pickUpload = () => panel.getByLabel('上传参考图文件').setInputFiles({ name: 'reference.png', mimeType: 'image/png', buffer: png })
  failUpload = true
  await pickUpload()
  await panel.getByText('参考图上传失败', { exact: true }).waitFor()
  await panel.getByRole('button', { name: '移除参考图：参考图片 2', exact: true }).waitFor()
  failUpload = false
  await panel.getByRole('button', { name: '重试上传', exact: true }).click()
  await panel.getByText('上传图片 2 已上传，尚未应用', { exact: true }).waitFor()
  await panel.getByRole('button', { name: '取消参考配置', exact: true }).click()
  await panel.waitFor({ state: 'hidden' })
  assert.equal(await page.getByRole('textbox', { name: '图片提示词', exact: true }).inputValue(), '上传失败后保留提示词')
  await openLabAddition(page, '添加参考图')
  await panel.getByRole('tab', { name: '资料库', exact: true }).click()
  const uploaded = panel.getByRole('checkbox', { name: '上传图片 2', exact: true })
  await uploaded.waitFor()
  assert.equal(await uploaded.isChecked(), false)
  await uploaded.check()
  await uploaded.check()
  await panel.getByRole('tab', { name: '已选素材（3）', exact: true }).waitFor()
  await panel.getByRole('button', { name: '取消参考配置', exact: true }).click()
  await panel.waitFor({ state: 'hidden' })

  // 取消、重开后的慢上传只能进入资料库，新面板没有该项的应用选择。
  await openLabAddition(page, '添加参考图')
  let releaseUpload
  uploadGate = new Promise(resolve => { releaseUpload = resolve })
  await pickUpload()
  await panel.getByText('正在上传参考图', { exact: true }).waitFor()
  await panel.getByRole('button', { name: '取消参考配置', exact: true }).click()
  await panel.waitFor({ state: 'hidden' })
  await openLabAddition(page, '添加参考图')
  await panel.getByRole('tab', { name: '资料库', exact: true }).click()
  releaseUpload()
  const late = panel.getByRole('checkbox', { name: '上传图片 3', exact: true })
  await late.waitFor()
  assert.equal(await late.isChecked(), false)
  await panel.getByRole('tab', { name: '已选素材（2）', exact: true }).waitFor()
  await panel.getByRole('button', { name: '取消参考配置', exact: true }).click()
  await panel.waitFor({ state: 'hidden' })

  // 浏览器返回切换会话时，迟到响应不会重开面板或污染当前选择。
  await page.getByRole('button', { name: '图片会话 2', exact: true }).click()
  await page.getByRole('button', { name: '放弃未发送内容并离开', exact: true }).click()
  await page.waitForURL(url => url.searchParams.get('session') === 'image-b')
  await openLabAddition(page, '添加参考图')
  uploadGate = new Promise(resolve => { releaseUpload = resolve })
  await pickUpload()
  await panel.getByText('正在上传参考图', { exact: true }).waitFor()
  await page.goBack()
  await page.waitForURL(url => url.searchParams.get('session') === 'image-a')
  await panel.waitFor({ state: 'hidden' })
  await openLabAddition(page, '添加参考图')
  await Promise.all([
    page.waitForResponse(response => response.url().endsWith('/files/upload')),
    releaseUpload(),
  ])
  await panel.getByRole('tab', { name: '已选素材（0）', exact: true }).waitFor()
  await panel.getByRole('button', { name: '取消参考配置', exact: true }).click()
  await page.reload()
  await openLabAddition(page, '添加参考图')
  await panel.getByRole('tab', { name: '资料库', exact: true }).click()
  const lateFromOtherSession = panel.getByRole('checkbox', { name: '上传图片 4', exact: true })
  await lateFromOtherSession.waitFor()
  assert.equal(await lateFromOtherSession.isChecked(), false)

  await choose('参考图片 2')
  await choose('参考图片 1')
  await choose('参考图片 3')
  await choose('参考图片 4')
  await choose(longName)
  await panel.getByRole('button', { name: '应用参考图', exact: true }).click()
  await panel.waitFor({ state: 'hidden' })
  const summary = page.getByRole('list', { name: '本轮参考图', exact: true })
  assert.equal(await summary.getByRole('listitem').count(), 3)
  await page.getByRole('button', { name: '查看全部 5 项素材', exact: true }).click()
  await panel.getByRole('button', { name: `预览参考图：${longName}`, exact: true }).waitFor()
  await page.screenshot({ path: join(output, 'image-reference-desktop.png'), animations: 'disabled' })
  await panel.getByRole('button', { name: '取消参考配置', exact: true }).click()
  await panel.waitFor({ state: 'hidden' })
  await page.setViewportSize({ width: 1024, height: 440 })
  await page.getByRole('button', { name: '查看全部 5 项素材', exact: true }).waitFor()
  await summary.waitFor({ state: 'hidden' })
  assert.equal(await summary.isVisible(), false)
  await page.setViewportSize({ width: 375, height: 812 })
  await openLabAddition(page, '添加参考图')
  await panel.waitFor()
  assert.equal(Math.round((await panel.boundingBox()).width), 375)
  const remove = await panel.getByRole('button', { name: '移除参考图：参考图片 2', exact: true }).boundingBox()
  assert.ok(remove.width >= 44 && remove.height >= 44)
  await page.screenshot({ path: join(output, 'image-reference-narrow.png'), animations: 'disabled' })
  assert.equal(submissions.length, 1)
  await pickUpload()
  await panel.getByText('上传图片 5 已上传，尚未应用', { exact: true }).waitFor()
  await panel.getByRole('button', { name: '应用参考图', exact: true }).click()
  await panel.waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: /选择模型/ }).click()
  await page.getByRole('button', { name: /验收图片模型/ }).waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('textbox', { name: '图片提示词', exact: true }).fill('应用已上传的参考图')
  await page.getByRole('button', { name: '用户与语言设置' }).click()
  await page.getByRole('menuitem', { name: 'English', exact: true }).click()
  assert.equal(await page.getByRole('textbox', { name: 'Image prompt', exact: true }).inputValue(), '应用已上传的参考图')
  await page.getByRole('button', { name: 'View all media (6)', exact: true }).waitFor()
  await Promise.all([
    page.waitForResponse(response => response.url().endsWith('/image-a/tasks')),
    page.getByRole('button', { name: 'Send', exact: true }).click(),
  ])
  assert.equal(submissions[1].body.execution_prompt, '应用已上传的参考图')
  await page.getByRole('button', { name: 'User and language settings' }).click()
  await page.getByRole('menuitem', { name: '简体中文', exact: true }).click()
  assert.deepEqual(submissions[1].body.media.references, [
    { file_id: 'file-2', media_kind: 'image', ordinal: 0 },
    { file_id: 'file-1', media_kind: 'image', ordinal: 1 },
    { file_id: 'file-3', media_kind: 'image', ordinal: 2 },
    { file_id: 'file-4', media_kind: 'image', ordinal: 3 },
    { file_id: 'file-5', media_kind: 'image', ordinal: 4 },
    { file_id: 'uploaded-5', media_kind: 'image', ordinal: 5 },
  ])
  await page.setViewportSize({ width: 1440, height: 900 })
  await summary.getByRole('button', { name: '预览参考图：参考图片 2', exact: true }).click()
  await page.getByRole('dialog', { name: '预览参考图：参考图片 2', exact: true }).getByRole('button', { name: '移除参考图', exact: true }).click()
  await page.getByRole('button', { name: '查看全部 5 项素材', exact: true }).waitFor()
  assert.equal(submissions.length, 2)
  // A stale list response must not remove an upload completed while it was in flight.
  libraryGate = new Promise(resolve => { releaseLibrary = resolve })
  await page.reload()
  await openLabAddition(page, '添加参考图')
  await pickUpload()
  await panel.getByText('上传图片 6 已上传，尚未应用', { exact: true }).waitFor()
  const pendingList = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/files'))
  releaseLibrary()
  await pendingList
  await panel.getByRole('tab', { name: '资料库', exact: true }).click()
  await panel.getByText('正在读取图片资料库', { exact: true }).waitFor({ state: 'hidden' })
  const concurrentUpload = panel.getByRole('checkbox', { name: '上传图片 6', exact: true })
  await concurrentUpload.waitFor()
  assert.equal(await concurrentUpload.isChecked(), true)
  await panel.getByRole('button', { name: '取消参考配置', exact: true }).click()
  await panel.waitFor({ state: 'hidden' })
  await openLabAddition(page, '添加参考图')
  await panel.getByRole('tab', { name: '资料库', exact: true }).click()
  assert.equal(await concurrentUpload.isChecked(), false)
  assert.deepEqual(deletions, [])
  console.log(`Image reference browser checks passed. Evidence: ${output}`)
} catch (error) {
  await page?.screenshot({ path: join(output, 'failure.png'), animations: 'disabled' })
  throw error
} finally {
  await cleanup()
}
