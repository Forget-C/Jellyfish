import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { browserCleanup, browserOutput } from './browser-runtime.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
process.chdir(root)
const output = await browserOutput('jellyfish-lab-video-references-')
const origin = 'http://127.0.0.1:4804'
const timestamp = '2026-11-10T08:00:00Z'
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aR2kAAAAASUVORK5CYII=', 'base64')
const referenceVideo = await readFile(join(root, 'public/canvas-presets/pan.mp4'))
const sessions = ['video-a', 'video-b'].map((id, index) => ({ id, lab_type: 'video', title: `视频会话 ${index + 1}`, created_at: timestamp, updated_at: timestamp }))
const files = [
  { id: 'image-a', name: '验收图片 A', type: 'image' },
  { id: 'image-b', name: '验收图片 B', type: 'image' },
  { id: 'video-file', name: '验收视频', type: 'video' },
]
const capabilities = {
  a: { allowed_ratios: ['16:9', '9:16'], supports_subject_image_reference: true, supports_subject_video_reference: true, supports_subject_reference_with_frame_reference: true, max_subjects: 2, max_images_per_subject: 1, max_videos_per_subject: 1, max_media_per_subject: 2, max_total_subject_videos: 1 },
  b: { allowed_ratios: ['9:16'], supports_subject_image_reference: true, supports_subject_video_reference: false, supports_subject_reference_with_frame_reference: false, max_subjects: 1 },
  c: {},
}
const models = ['a', 'b', 'c'].map(id => ({ id, name: `验收模型 ${id.toUpperCase()}`, category: 'video' }))
const submissions = []
const deletions = []
let failCapability
let capabilityGate
let uploadGate
let uploadCount = 0
let failUpload = false
let failLibrary = true
let failVideoPreview = true

const server = await createServer({ root, cacheDir: join(output, 'vite'), server: { host: '127.0.0.1', port: 4804, strictPort: true, open: false } })
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
    if (url.pathname.endsWith('/experiment-sessions')) return respond(url.searchParams.get('lab_type') === 'video' ? sessions : [])
    if (url.pathname.endsWith('/models')) return respond({ items: models })
    if (url.pathname.endsWith('/video-generation-options')) {
      const modelId = url.searchParams.get('model_id')
      if (capabilityGate?.modelId === modelId) await capabilityGate.promise
      if (failCapability === modelId) return route.fulfill({ status: 503, json: { detail: '暂不可读取' } })
      return respond({ model_id: modelId, model_name: models.find(model => model.id === modelId)?.name, provider: 'fixture', default_ratio: '9:16', ...capabilities[modelId] })
    }
    if (url.pathname.endsWith('/files/upload')) {
      const attempt = ++uploadCount
      await uploadGate
      if (failUpload) return route.fulfill({ status: 503, json: { detail: '上传失败' } })
      const file = { id: `uploaded-${attempt}`, name: `上传图片 ${attempt}`, type: 'image' }
      files.push(file)
      return respond(file)
    }
    if (url.pathname.endsWith('/files')) {
      if (failLibrary) return route.fulfill({ status: 503, json: { detail: '暂不可读取' } })
      return respond({ items: files, total: files.length })
    }
    if (url.pathname.endsWith('/video-file/download')) return failVideoPreview
      ? route.fulfill({ status: 503 })
      : route.fulfill({ body: referenceVideo, contentType: 'video/mp4' })
    if (url.pathname.endsWith('/download')) return route.fulfill({ body: png, contentType: 'image/png' })
    const run = url.pathname.match(/\/labs\/video\/sessions\/([^/]+)\/tasks$/)
    if (run) {
      submissions.push({ session: run[1], body: request.postDataJSON() })
      const taskId = `task-${submissions.length}`
      return respond({ task_id: taskId, messages: [{ id: taskId, session_id: run[1], role: 'task', content: '已完成', sequence: submissions.length, task_id: taskId, status: 'succeeded', created_at: timestamp, updated_at: timestamp }] })
    }
    if (url.pathname.endsWith('/film/tasks')) return respond({ items: [], next_cursor: null })
    return respond([])
  })
  await page.goto(origin + '/lab?session=video-a')
  const trigger = page.getByRole('button', { name: '参考素材', exact: true })
  const panel = page.getByRole('dialog', { name: '配置视频参考素材', exact: true })
  await trigger.click()
  await panel.getByRole('heading', { name: '帧参考', exact: true }).waitFor()
  await panel.getByRole('heading', { name: '主体参考', exact: true }).waitFor()
  await panel.getByRole('button', { name: '取消参考配置', exact: true }).click()
  await panel.waitFor({ state: 'hidden' })
  const prompt = page.getByRole('textbox', { name: '视频提示词', exact: true })
  const generate = page.getByRole('button', { name: '生成视频', exact: true })
  const apply = panel.getByRole('button', { name: '应用参考素材', exact: true })
  const back = panel.getByRole('button', { name: '返回已选素材', exact: true })
  const chooseFile = name => panel.getByRole('button', { name, exact: true })
  const selectModel = async (from, to) => {
    await page.getByRole('button', { name: from ? '验收模型 ' + from : '选择模型', exact: true }).click()
    await page.getByRole('combobox', { name: '视频模型', exact: true }).press('ArrowDown')
    await page.getByText('验收模型 ' + to, { exact: true }).last().click()
    await page.getByRole('heading', { name: /视频实验室/ }).click()
  }
  const getCapability = (model, from) => Promise.all([
    page.waitForResponse(response => response.url().endsWith('/video-generation-options?model_id=' + model.toLowerCase()), { timeout: 15000 }),
    selectModel(from, model),
  ])

  await getCapability('A')
  await prompt.fill('验证混合主体素材与帧引用')
  await trigger.click()
  await panel.getByRole('button', { name: '选择首帧', exact: true }).click()
  await panel.getByText('视频参考资料库读取失败', { exact: true }).waitFor()
  assert.equal(await panel.getByText('资料库中暂无图片', { exact: true }).count(), 0)
  failLibrary = false
  await panel.getByRole('button', { name: '重试读取', exact: true }).click()
  await chooseFile('验收图片 A').click()
  await back.click()
  await panel.getByRole('button', { name: '选择尾帧', exact: true }).click()
  await chooseFile('验收图片 A').click()
  await back.click()
  await panel.getByRole('button', { name: '选择关键帧', exact: true }).click()
  await chooseFile('验收图片 B').click()
  await back.click()
  await panel.getByRole('button', { name: '添加主体', exact: true }).click()
  await panel.getByText('请填写主体名称并添加至少一份参考素材', { exact: true }).waitFor()
  assert.ok(await apply.isDisabled())
  const subjectName = '带有长名称的主体参考'.repeat(12)
  await panel.getByRole('textbox', { name: '主体 1 名称', exact: true }).fill(subjectName)
  await panel.getByRole('button', { name: '选择主体1视频', exact: true }).click()
  await chooseFile('验收视频').click()
  await back.click()
  await panel.getByRole('button', { name: '选择主体1图片', exact: true }).click()
  await chooseFile('验收图片 A').click()
  await chooseFile('验收图片 B').click()
  await panel.getByText('单个主体最多 1 张图片；单个主体最多 2 份素材', { exact: true }).waitFor()
  assert.ok(await apply.isDisabled())
  await chooseFile('验收图片 B').click()
  await back.click()
  await panel.getByRole('button', { name: '添加主体', exact: true }).click()
  await panel.getByRole('textbox', { name: '主体 2 名称', exact: true }).fill('主体乙')
  await panel.getByRole('button', { name: '选择主体2图片', exact: true }).click()
  await chooseFile('验收图片 B').click()
  await back.click()
  assert.ok(await panel.getByRole('button', { name: '添加主体', exact: true }).isDisabled())
  assert.equal(submissions.length, 0)
  await apply.click()
  await panel.waitFor({ state: 'hidden' })
  await page.getByText('首帧已选 · 尾帧已选 · 关键帧已选 · 主体 2 个', { exact: true }).waitFor()

  // 有效引用在取消后保持原值，上传结果可以留在资料库。
  await trigger.click()
  const first = panel.getByRole('button', { name: '选择首帧', exact: true })
  await first.click()
  let releaseUpload
  uploadGate = new Promise(resolve => { releaseUpload = resolve })
  const pickFirst = () => panel.getByLabel('上传首帧文件').setInputFiles({ name: 'reference.png', mimeType: 'image/png', buffer: png })
  await pickFirst()
  await panel.getByText('正在上传参考素材', { exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await panel.waitFor({ state: 'hidden' })
  await trigger.and(page.locator(':focus')).waitFor()
  await trigger.click()
  await first.click()
  releaseUpload()
  await chooseFile('上传图片 1').waitFor()
  assert.equal(await chooseFile('上传图片 1').getAttribute('aria-pressed'), 'false')
  assert.equal(await chooseFile('验收图片 A').getAttribute('aria-pressed'), 'true')
  uploadGate = undefined
  failUpload = true
  await pickFirst()
  await panel.getByText('参考素材上传失败', { exact: true }).waitFor()
  failUpload = false
  await panel.getByRole('button', { name: '重试上传', exact: true }).click()
  await panel.getByText('上传图片 3 已上传，尚未应用', { exact: true }).waitFor()
  await panel.getByRole('button', { name: '取消参考配置', exact: true }).click()
  await panel.waitFor({ state: 'hidden' })

  // 当前模型 B 明确拒绝组合和横屏比例，但不覆写提示词、引用和比例。
  await getCapability('B', 'A')
  await page.getByText('当前模型不支持比例 16:9，请重新选择', { exact: true }).waitFor()
  await page.getByText(/当前模型不支持帧参考与主体参考同时使用.*最多支持 1 个主体.*不支持主体视频/).waitFor()
  assert.ok(await generate.isDisabled())
  assert.equal(await prompt.inputValue(), '验证混合主体素材与帧引用')
  assert.equal(submissions.length, 0)

  // 能力错误可重试。字段缺失与请求失败不同，服务端仍可接受原配置。
  failCapability = 'c'
  await getCapability('C', 'B')
  await page.getByText('视频模型能力读取失败', { exact: false }).waitFor()
  assert.ok(await generate.isDisabled())
  failCapability = undefined
  await page.getByRole('button', { name: '重试读取能力', exact: true }).click()
  await page.getByText('模型未提供完整参考限制，提交时由服务端校验', { exact: true }).waitFor()

  // A 的迟到响应不得覆盖后来选中的 B。
  let releaseCapability
  capabilityGate = { modelId: 'a', promise: new Promise(resolve => { releaseCapability = resolve }) }
  await selectModel('C', 'A')
  await page.getByText('正在读取视频模型能力', { exact: true }).waitFor()
  assert.ok(await generate.isDisabled())
  await getCapability('B', 'A')
  await page.getByText('当前模型不支持比例 16:9，请重新选择', { exact: true }).waitFor()
  await Promise.all([
    page.waitForResponse(response => response.url().endsWith('/video-generation-options?model_id=a')),
    Promise.resolve().then(releaseCapability),
  ])
  await page.getByRole('button', { name: '验收模型 B', exact: true }).waitFor()
  assert.ok(await generate.isDisabled())
  assert.equal(submissions.length, 0)
  capabilityGate = undefined

  // 缺失能力字段时可以提交，混合素材顺序必须在组内连续。
  await getCapability('C', 'B')
  await page.getByText('模型未提供完整参考限制，提交时由服务端校验', { exact: true }).waitFor()
  await page.setViewportSize({ width: 375, height: 812 })
  await trigger.click()
  await panel.getByRole('textbox', { name: '主体 1 名称', exact: true }).waitFor()
  assert.equal(Math.round((await panel.boundingBox()).width), 375)
  assert.equal(await panel.getByRole('textbox', { name: '主体 1 名称', exact: true }).inputValue(), subjectName)
  const picture = panel.getByRole('button', { name: '预览首帧：验收图片 A', exact: true })
  await picture.click()
  const preview = page.getByRole('dialog', { name: '预览参考素材：验收图片 A', exact: true })
  await preview.getByRole('img', { name: '验收图片 A', exact: true }).waitFor()
  await preview.getByRole('button', { name: 'Close', exact: true }).press('Escape')
  await preview.waitFor({ state: 'hidden' })
  await picture.and(page.locator(':focus')).waitFor()
  assert.ok(await panel.isVisible())
  const video = panel.getByRole('button', { name: '预览主体1视频：验收视频', exact: true })
  await video.press('Enter')
  const videoPreview = page.getByRole('dialog', { name: '预览参考素材：验收视频', exact: true })
  await videoPreview.getByText('视频不可用', { exact: true }).waitFor()
  failVideoPreview = false
  await videoPreview.getByRole('button', { name: '重试加载', exact: true }).click()
  const player = await videoPreview.locator('video[controls]').elementHandle()
  await page.waitForFunction(element => element.readyState >= 1 && element.videoWidth > 0, player)
  assert.equal(await player.evaluate(element => element.paused), true)
  await player.evaluate(element => element.play())
  await page.screenshot({ path: join(output, 'video-reference-playback-narrow.png'), animations: 'disabled' })
  await videoPreview.getByRole('button', { name: 'Close', exact: true }).press('Escape')
  await videoPreview.waitFor({ state: 'hidden' })
  await video.and(page.locator(':focus')).waitFor()
  assert.equal(await player.evaluate(element => element.paused), true)
  assert.equal(submissions.length, 0)
  await page.screenshot({ path: join(output, 'video-reference-narrow.png'), animations: 'disabled' })
  await panel.getByRole('button', { name: '取消参考配置', exact: true }).click()
  await panel.waitFor({ state: 'hidden' })
  await Promise.all([
    page.waitForResponse(response => response.url().endsWith('/video-a/tasks')),
    generate.click(),
  ])
  assert.deepEqual(submissions, [{ session: 'video-a', body: {
    model_id: 'c',
    execution_prompt: '验证混合主体素材与帧引用',
    media: {
      frames: {
        first: { file_id: 'image-a', media_kind: 'image', ordinal: 0 },
        last: { file_id: 'image-a', media_kind: 'image', ordinal: 0 },
        keys: [{ file_id: 'image-b', media_kind: 'image', ordinal: 0 }],
      },
      subjects: [
        { name: subjectName, media: [{ file_id: 'video-file', media_kind: 'video', ordinal: 0 }, { file_id: 'image-a', media_kind: 'image', ordinal: 1 }] },
        { name: '主体乙', media: [{ file_id: 'image-b', media_kind: 'image', ordinal: 0 }] },
      ],
    },
    operation_input: { kind: 'video_generation', ratio: '16:9' },
  } }])
  await getCapability('A', 'C')
  await prompt.fill('明确支持的模型提交组合')
  await Promise.all([
    page.waitForResponse(response => response.url().endsWith('/video-a/tasks')),
    generate.click(),
  ])
  assert.equal(submissions[1].body.model_id, 'a')
  assert.deepEqual(submissions[1].body.media, submissions[0].body.media)

  // 同一份配置切换到更严格的模型后，修正冲突才能提交。
  await getCapability('B', 'A')
  await page.getByText('当前模型不支持比例 16:9，请重新选择', { exact: true }).waitFor()
  await prompt.fill('修正模型冲突后提交')
  await page.getByText('16:9（当前模型不支持）', { exact: true }).click()
  await page.getByText('9:16', { exact: true }).last().click()
  await page.getByText('当前模型不支持比例 16:9，请重新选择', { exact: true }).waitFor({ state: 'hidden' })
  assert.ok(await generate.isDisabled())
  await trigger.click()
  for (const label of ['首帧', '尾帧', '关键帧']) {
    await panel.getByRole('button', { name: new RegExp(`^移除${label}：`) }).click()
  }
  await panel.getByRole('button', { name: '移除主体 2', exact: true }).click()
  await panel.getByRole('button', { name: '移除主体1视频：验收视频', exact: true }).click()
  await apply.click()
  await panel.waitFor({ state: 'hidden' })
  await Promise.all([
    page.waitForResponse(response => response.url().endsWith('/video-a/tasks')),
    generate.click(),
  ])
  assert.deepEqual(submissions[2], { session: 'video-a', body: {
    model_id: 'b',
    execution_prompt: '修正模型冲突后提交',
    media: { frames: { first: null, last: null, keys: [] }, subjects: [{ name: subjectName, media: [{ file_id: 'image-a', media_kind: 'image', ordinal: 0 }] }] },
    operation_input: { kind: 'video_generation', ratio: '9:16' },
  } })

  // 从另一会话返回后，旧抽屉的上传响应只能更新资料库。
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByRole('button', { name: '视频会话 2', exact: true }).click()
  await page.waitForURL(url => url.searchParams.get('session') === 'video-b')
  await trigger.click()
  await first.click()
  uploadGate = new Promise(resolve => { releaseUpload = resolve })
  await pickFirst()
  await panel.getByText('正在上传参考素材', { exact: true }).waitFor()
  await page.goBack()
  await page.waitForURL(url => url.searchParams.get('session') === 'video-a')
  await panel.waitFor({ state: 'hidden' })
  await trigger.click()
  await Promise.all([
    page.waitForResponse(response => response.url().endsWith('/files/upload')),
    releaseUpload(),
  ])
  assert.equal(await panel.getByRole('button', { name: '移除首帧', exact: true }).count(), 0)
  await panel.getByRole('button', { name: '取消参考配置', exact: true }).click()
  await page.reload()
  await trigger.click()
  await first.click()
  await chooseFile('上传图片 4').waitFor()
  assert.equal(await chooseFile('上传图片 4').getAttribute('aria-pressed'), 'false')
  assert.equal(submissions.length, 3)
  assert.deepEqual(deletions, [])
  console.log(`Video reference browser checks passed. Evidence: ${output}`)
} catch (error) {
  await page?.screenshot({ path: join(output, 'failure.png'), animations: 'disabled' })
  throw error
} finally {
  await cleanup()
}
