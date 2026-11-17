import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'
import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-workbench-retry-')
const origin = 'http://127.0.0.1:4388', api = 'http://127.0.0.1:8388', studio = api + '/api/v1/studio'
const project = 'canvas-project', chapter = 'workbench-retry'
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_runtime_browser_server'], {
  cwd: join(root, '../backend'),
  env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache',
    CANVAS_BROWSER_SCENE_OBJECTS: '1', CANVAS_BROWSER_STORYBOARD_RECOVERY: '1',
    CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'),
    CANVAS_BROWSER_PORT: '8388' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
captureBackend(backend, output)
let server, browser
const cleanup = browserCleanup(() => ({ browser, server, backend }))
const data = async (url, method = 'GET', body) => {
  const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) })
  assert.ok(response.ok, await response.clone().text())
  return (await response.json()).data
}
const control = body => data(api + '/test/runtime-controls', 'POST', body)
const readControls = async () => (await fetch(api + '/test/runtime-controls')).json()
const poll = async (read, predicate) => {
  for (let attempt = 0; attempt < 120; attempt++) {
    const value = await read()
    if (predicate(value)) return value
    await delay(100)
  }
  throw new Error('Expected persisted task state was not observed')
}

try {
  let ready = false
  for (let attempt = 0; attempt < 80; attempt++) {
    if (backend.exitCode !== null) throw new Error('isolated backend exited')
    try { if ((await fetch(studio + '/generation-canvases/' + project)).ok) { ready = true; break } } catch {}
    await delay(250)
  }
  assert.ok(ready)
  const raw = '前门的阿同拿着信封。后门的阿同等待。'
  await data(studio + '/chapters', 'POST', { id: chapter, project_id: project, index: 0, title: '重试分镜', raw_text: raw })
  const chapterApi = studio + '/projects/' + project + '/directing/chapters/' + chapter
  const source = await data(chapterApi)
  const scene = await data(chapterApi + '/sequences', 'POST', {
    title: '候车', position: 0, source_version: source.source_version, span: { start: 0, end: raw.length },
  })
  const sceneApi = chapterApi + '/sequences/' + scene.id
  await data(sceneApi + '/objects/extractions', 'POST', { request_id: 'retry-objects' })
  const prepared = await poll(() => data(sceneApi + '/objects'), value => value.task?.status === 'succeeded')
  const firstObject = prepared.objects.find(item => item.excerpt === '前门的阿同')
  await data(sceneApi + '/objects/' + firstObject.id, 'PUT', {
    expected_revision: prepared.revision, asset_id: 'object-browser-character',
  })
  await control({ storyboard_release: 1, storyboard_fail_on: 1 })
  const original = await data(sceneApi + '/storyboards', 'POST', {
    name: '原有画布', request_id: 'retry-original', mode: 'faithful', pending_modality: 'image',
  })
  const taskPath = sceneApi + '/storyboards/' + original.task_id
  await poll(() => data(taskPath), value => value.status === 'failed')

  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: {
    host: '127.0.0.1', port: 4388, strictPort: true, hmr: false, proxy: { '/api': api },
  } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } })
  await context.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const page = await context.newPage()
  page.setDefaultTimeout(14000)
  const management = origin + '/projects/' + project + '/chapters/' + chapter + '/workbench-management?sequence=' + scene.id + '&step=storyboard'
  const canvas = studio + '/generation-canvases/' + project + '/' + original.canvas_id
  await page.goto(management)
  assert.equal(await page.getByRole('button', { name: '打开画布', exact: true }).count(), 0)
  await page.getByRole('button', { name: '处理提取问题', exact: true }).click()
  const dialog = page.getByRole('region', { name: '核对分镜处理' })
  await dialog.getByText('本次使用的原文、对象与模型', { exact: true }).click()
  await dialog.getByText('忠实提取', { exact: true }).waitFor()
  await dialog.getByText('controlled-text', { exact: true }).waitFor()
  await dialog.getByText('稍后配置图片模型卡', { exact: true }).waitFor()
  await dialog.getByText(raw, { exact: true }).waitFor()
  await dialog.getByText('本次采用的对象（3）', { exact: true }).click()
  await dialog.getByText(/阿同（前门的阿同）.*已有角色/).waitFor()
  await dialog.getByText(/阿同（后门的阿同）/).waitFor()
  await page.screenshot({ path: join(output, 'retry-confirmation.png') })

  const current = await data(canvas)
  await data(canvas, 'PUT', { request_id: 'manual-before-retry', expected_revision: current.revision,
    document: { ...current.document, name: '保留人工编辑' } })
  const confirm = page.getByRole('button', { name: '确认重试' })
  await confirm.click()
  await dialog.getByText(/请重新核对生成依据/).waitFor()
  await dialog.getByRole('button', { name: '重新读取依据' }).click()
  await dialog.getByText('本次使用的原文、对象与模型', { exact: true }).click()
  await dialog.getByText(raw, { exact: true }).waitFor()
  let originalRequest
  await page.route('**/retry', async route => {
    originalRequest = route.request().postDataJSON()
    const response = await route.fetch()
    assert.ok(response.ok(), await response.text())
    await route.abort('failed')
  }, { times: 1 })
  await confirm.click()
  await dialog.getByText(/重试结果待核实/).waitFor()
  await page.reload()
  const replay = page.waitForRequest(req => req.method() === 'POST' && req.url().endsWith('/retry'))
  await page.getByRole('button', { name: '查看提取进度', exact: true }).click()
  await page.getByRole('button', { name: '核实提交结果', exact: true }).click()
  assert.deepEqual((await replay).postDataJSON(), originalRequest)
  await page.getByRole('button', { name: '核实提交结果', exact: true }).waitFor({ state: 'hidden' })
  const tasks = await data(sceneApi + '/storyboards')
  assert.equal(tasks.length, 2)
  const retried = tasks.find(task => task.retry_of_task_id === original.task_id)
  assert.equal(retried.canvas_id, original.canvas_id)
  assert.equal((await data(sceneApi + '/canvases')).canvases.length, 1)
  await control({ storyboard_release: 2 })
  await page.getByText('需要核对', { exact: true }).waitFor()
  const retryResult = await data(sceneApi + '/storyboards/' + retried.task_id)
  const retryCards = retryResult.candidate.document.cards.filter(card => card.type.startsWith('model.'))
  assert.ok(retryCards.length > 0)
  assert.ok(retryCards.every(card => card.type === 'model.image'))
  assert.equal(page.url(), management)

  const ordinary = await context.newPage()
  await ordinary.goto(origin + '/projects/' + project + '/generation-canvas?canvas=' + original.canvas_id)
  await ordinary.getByRole('dialog', { name: '处理分镜提取结果', exact: true }).waitFor()
  assert.equal(await ordinary.locator('[data-card-type="direction.shot"]').count(), 0)
  await ordinary.close()
  await page.getByRole('dialog', { name: '处理分镜提取结果', exact: true }).waitFor()
  assert.equal((await data(canvas)).document.name, '保留人工编辑')

  const reviewControls = await readControls()
  const firstReview = reviewControls.storyboard_review_calls + 1
  await control({ storyboard_release: 100, storyboard_review_release: firstReview - 1,
    storyboard_review_fail_on: firstReview, storyboard_review_conflict_on: firstReview + 1 })
  const reviewTask = await data(sceneApi + '/storyboards', 'POST', {
    name: '审查恢复画布', request_id: 'review-original', mode: 'faithful',
  })
  const reviewCanvas = studio + '/generation-canvases/' + project + '/' + reviewTask.canvas_id
  const untouched = await data(reviewCanvas)
  await page.goto(management)
  const reviewCard = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: '审查恢复画布', exact: true }) })
  await reviewCard.getByText('正在审查分镜连续性', { exact: true }).waitFor()
  assert.equal((await data(reviewCanvas)).revision, untouched.revision)
  await control({ storyboard_review_release: firstReview })
  await reviewCard.getByText('分镜审查未完成，草案已保留', { exact: true }).waitFor()
  await page.reload()
  await reviewCard.getByRole('button', { name: '处理提取问题', exact: true }).click()
  const reviewDialog = page.getByRole('region', { name: '核对重试审查' })
  await reviewDialog.getByText('已保留分镜草案。本次从审查阶段继续，结果仍需核对后应用。', { exact: true }).waitFor()
  await reviewDialog.getByText('本次使用的原文、对象与模型', { exact: true }).click()
  await reviewDialog.getByText(raw, { exact: true }).waitFor()
  await page.getByRole('button', { name: '重新审查', exact: true }).click()
  await control({ storyboard_review_release: firstReview + 1 })
  await reviewCard.getByText('分镜存在设计冲突', { exact: true }).waitFor()
  const reviewedControls = await readControls()
  assert.equal(reviewedControls.storyboard_calls, reviewControls.storyboard_calls + 1)
  assert.equal(reviewedControls.storyboard_review_calls, firstReview + 1)

  const findings = page.getByRole('dialog', { name: '处理分镜提取结果', exact: true })
  await findings.getByText('静止与入场要求冲突', { exact: true }).waitFor()
  assert.equal(await findings.getByRole('button', { name: '应用并进入画布', exact: true }).isEnabled(), false)
  assert.deepEqual(await data(reviewCanvas), untouched)
  await findings.getByRole('button', { name: '暂不处理', exact: true }).click()
  assert.deepEqual(await data(reviewCanvas), untouched)
  await reviewCard.getByRole('button', { name: '核对分镜', exact: true }).click()
  await findings.getByRole('checkbox', { name: '接受风险：静止与入场要求冲突', exact: true }).check()
  await findings.getByRole('button', { name: '应用并进入画布', exact: true }).click()
  await page.getByText('已接受分镜设计风险', { exact: true }).first().waitFor()
  const accepted = await data(reviewCanvas)
  assert.ok(accepted.document.storyboard)
  await page.getByRole('button', { name: '撤销操作', exact: true }).click()
  await poll(() => data(reviewCanvas), value => !value.document.storyboard)
  await page.getByRole('button', { name: '重做操作', exact: true }).click()
  await poll(() => data(reviewCanvas), value => value.document.storyboard?.task_id === accepted.document.storyboard.task_id)
  await page.reload()
  await page.getByText('已接受分镜设计风险', { exact: true }).first().waitFor()

  await control({ storyboard_review_release: 100, storyboard_repair_on: reviewedControls.storyboard_review_calls + 1 })
  const repairTask = await data(sceneApi + '/storyboards', 'POST', {
    name: '定向修正画布', request_id: 'targeted-repair', mode: 'complete',
  })
  const repairCanvas = studio + '/generation-canvases/' + project + '/' + repairTask.canvas_id
  await page.goto(management)
  const repairCard = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: '定向修正画布', exact: true }) })
  await repairCard.getByText('正在定向修正分镜', { exact: true }).waitFor()
  assert.equal((await data(repairCanvas)).revision, 0)
  await control({ storyboard_repair_release: true })
  await repairCard.getByText('正在复核分镜连续性', { exact: true }).waitFor()
  assert.equal((await data(repairCanvas)).revision, 0)
  await control({ storyboard_recheck_release: true })
  await repairCard.getByRole('button', { name: '查看并采用分镜', exact: true }).click()
  await page.getByRole('button', { name: '应用并进入画布', exact: true }).click()
  const correctedCanvas = await poll(() => data(repairCanvas), value => value.document.storyboard?.task_id === repairTask.task_id)
  const camera = correctedCanvas.document.cards.find(card => card.type === 'direction.camera')
  assert.equal(camera.fields.viewpoint.text, '保持原地，固定机位切近')
  assert.equal((await readControls()).storyboard_repair_calls, 1)
  assert.ok((await data(sceneApi + '/storyboards/' + repairTask.task_id)).structure_issues.length)

  await page.reload()
  const checkButton = page.getByRole('button', { name: '检查分镜连续性', exact: true })
  await checkButton.waitFor()
  assert.equal((await readControls()).saved_storyboard_check_calls, 0)
  await checkButton.click()
  await page.getByText('检查发现设计冲突', { exact: true }).waitFor()
  assert.equal((await data(repairCanvas)).revision, correctedCanvas.revision)
  const reviewSaved = page.getByRole('button', { name: '核对检查差异', exact: true })
  await reviewSaved.click()
  await page.getByRole('dialog', { name: '核对分镜差异', exact: true }).getByRole('button', { name: '定向修正', exact: true }).click()
  await page.getByText('检查修正待确认', { exact: true }).waitFor()
  assert.equal((await data(repairCanvas)).revision, correctedCanvas.revision)
  await reviewSaved.click()
  await page.getByRole('dialog', { name: '核对分镜差异', exact: true }).getByRole('button', { name: '应用分镜', exact: true }).click()
  const checked = await poll(() => data(repairCanvas), value =>
    value.document.cards.find(card => card.type === 'direction.camera')?.fields.viewpoint.text === '沿原轴线保持机位')
  assert.equal(checked.document.storyboard.task_id, repairTask.task_id)
  await page.getByRole('button', { name: '撤销操作', exact: true }).click()
  await poll(() => data(repairCanvas), value => !value.document.storyboard.continuity_check_task_id)
  await page.reload()
  await page.getByText('检查依据已变', { exact: true }).waitFor()
  await page.getByRole('button', { name: '查看检查报告', exact: true }).click()
  await page.getByRole('dialog', { name: '分镜连续性检查报告', exact: true }).waitFor()
  const ordinaryChecked = await context.newPage()
  await ordinaryChecked.goto(origin + '/projects/' + project + '/generation-canvas?canvas=' + repairTask.canvas_id)
  await ordinaryChecked.locator('[data-card-type="direction.shot"]').first().waitFor()
  assert.equal(await ordinaryChecked.getByRole('button', { name: '检查分镜连续性', exact: true }).count(), 0)
  await ordinaryChecked.close()

  await control({ storyboard_structure_choices: true, storyboard_repair_on: 0 })
  const structureTask = await data(sceneApi + '/storyboards', 'POST', {
    name: '结构纠错方案', request_id: 'structure-options', mode: 'complete',
  })
  const structurePath = sceneApi + '/storyboards/' + structureTask.task_id
  await poll(() => data(structurePath), value => value.status === 'failed')
  await page.goto(management)
  const structureCard = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: '结构纠错方案', exact: true }) })
  await structureCard.getByRole('button', { name: '处理提取问题', exact: true }).click()
  const structureDialog = page.getByRole('region', { name: '核对分镜处理', exact: true })
  const correct = page.getByRole('button', { name: '提交纠错', exact: true })
  await structureDialog.getByRole('radio', { name: '补充镜头参与对象', exact: true }).waitFor()
  await structureDialog.getByText('镜头 01 增加已准备人物，保留等待设计和镜头结构。', { exact: true }).waitFor()
  assert.equal(await correct.isDisabled(), true)
  await structureDialog.getByRole('radio', { name: '自行说明处理方式', exact: true }).check()
  assert.equal(await correct.isDisabled(), true)
  await structureDialog.getByLabel('纠错意见', { exact: true }).fill('保留等待设计，仅补齐参与对象关联')
  await page.getByRole('button', { name: '暂不处理', exact: true }).click()
  await structureCard.getByRole('button', { name: '处理提取问题', exact: true }).click()
  await structureDialog.getByRole('radio', { name: '自行说明处理方式', exact: true }).check()
  assert.equal(await structureDialog.getByLabel('纠错意见', { exact: true }).inputValue(), '保留等待设计，仅补齐参与对象关联')
  await structureDialog.getByRole('radio', { name: '重新生成整份分镜', exact: true }).check()
  await structureDialog.getByText('纠错意见不用于本次重新生成', { exact: true }).waitFor()
  await structureDialog.getByRole('radio', { name: '修正当前草案', exact: true }).check()
  assert.equal(await structureDialog.getByLabel('纠错意见', { exact: true }).inputValue(), '保留等待设计，仅补齐参与对象关联')
  assert.equal(await correct.isEnabled(), true)
  await page.waitForTimeout(350) // Wait for the modal entrance animation before visual evidence.
  await page.screenshot({ path: join(output, 'structure-options-desktop.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await structureDialog.evaluate(element => element.scrollWidth <= element.clientWidth), true)
  await page.waitForTimeout(350)
  await page.screenshot({ path: join(output, 'structure-options-narrow.png') })
  await structureDialog.getByLabel('纠错意见', { exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(output, 'structure-notes-narrow.png') })
  const submission = page.waitForRequest(request => request.url().endsWith('/retry') && request.method() === 'POST')
  await correct.click()
  assert.equal((await submission).postDataJSON().correction_notes, '保留等待设计，仅补齐参与对象关联')
  await structureCard.getByRole('button', { name: '核对分镜', exact: true }).waitFor()
  assert.equal((await data(studio + '/generation-canvases/' + project + '/' + structureTask.canvas_id)).revision, 0)

  const historyTask = await data(sceneApi + '/storyboards', 'POST', {
    name: '历史记录区分', request_id: 'history-separation', mode: 'complete',
  })
  let attempt = await poll(() => data(sceneApi + '/storyboards/' + historyTask.task_id), value => value.status === 'failed')
  for (const request_id of ['history-first', 'history-second']) {
    const basis = await data(sceneApi + '/storyboards/' + attempt.task_id + '/retry/basis')
    const accepted = await data(sceneApi + '/storyboards/' + attempt.task_id + '/retry', 'POST', {
      request_id, basis_token: basis.basis.token, correction_notes: '测试依据不足',
    })
    attempt = await poll(() => data(sceneApi + '/storyboards/' + accepted.task_id), value => value.status === 'failed')
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(management)
  const historyCard = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: '历史记录区分', exact: true }) })
  await historyCard.getByRole('button', { name: '处理提取问题', exact: true }).click()
  const currentResult = page.getByRole('region', { name: '本轮结果', exact: true })
  const reason = '模型认为：镜头缺少人物出镜依据，请调整适用范围。'
  await currentResult.getByText(reason, { exact: true }).waitFor()
  await page.getByText('保留草案的问题（1）', { exact: true }).waitFor()
  assert.equal(await page.getByRole('region', { name: '保留草案的问题', exact: true }).getByText(reason, { exact: true }).count(), 0)
  await structureDialog.getByLabel('纠错意见', { exact: true }).fill('稍后处理的草稿')
  const historySummary = page.getByText('历史处理记录（2次）', { exact: true })
  assert.equal(await historySummary.locator('..').getByText(reason, { exact: true }).isVisible(), false)
  await historySummary.click()
  await historySummary.locator('..').getByText(reason, { exact: true }).waitFor()
  assert.equal(await structureDialog.getByLabel('纠错意见', { exact: true }).inputValue(), '稍后处理的草稿')
  await page.screenshot({ path: join(output, 'history-separation-desktop.png'), animations: 'disabled' })
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await structureDialog.evaluate(element => element.scrollWidth <= element.clientWidth), true)
  await page.screenshot({ path: join(output, 'history-separation-narrow.png'), animations: 'disabled' })

} finally {
  if (backend.exitCode === null) await control({ disconnect: true, storyboard_release: 100, storyboard_review_release: 100,
    storyboard_repair_release: true, storyboard_recheck_release: true }).catch(() => {})
  await cleanup()
}
