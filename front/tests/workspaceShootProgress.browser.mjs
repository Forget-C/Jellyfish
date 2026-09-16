import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { makeWorkspace, revision } from './directing-fixtures.mjs'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
process.chdir(root)
const output = await mkdtemp(join(tmpdir(), 'jellyfish-shoot-progress-'))
const server = await createServer({ root, server: { host: '127.0.0.1', port: 4199, strictPort: true, open: false } })
let browser, page
try {
  await server.listen(); browser = await chromium.launch({ headless: true })
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.setDefaultTimeout(15000)
  await page.addInitScript(() => {
    window.__ENV = { BACKEND_URL: location.origin }
    if (!sessionStorage.getItem('directing-submitted-tasks:p1:s1')) sessionStorage.setItem('directing-submitted-tasks:p1:s1', JSON.stringify([{ taskId: 'check1', planId: 'p-old', unitId: 'u1', promptId: 'prompt1' }]))
  })
  const workspace = makeWorkspace()
  workspace.plans = [workspace.plans[0]]; workspace.cuts = []
  workspace.takes = [{ ...workspace.takes[2], prompt_revision_id: 'older-prompt' }]
  const unit = workspace.plans[0].content.units[0]
  unit.references = [0, 1].map(ordinal => ({ id: `ref${ordinal}`, ordinal, file_id: `image${ordinal}`, media_kind: 'image', purpose: 'composition', input_role: ordinal ? 'subject' : 'first_frame', participant_ids: [], source: { kind: 'human', reference: 'author', version: '1' } }))
  workspace.prompts = [revision('prompt1', { plan_revision_id: 'p-old', unit_id: 'u1', text: '他缓缓递出旧信，对方低头辨认。保持手部和旧信清晰可见，镜头固定，动作克制。', decisions: [], sources: [], format_version: 'v4' })]
  workspace.reviews = []; workspace.task_ids = ['check1']
  const roles = ['direction', 'performance', 'staging', 'cinematography', 'continuity', 'prompt']
  const packet = { mode: 'formal', roles, occurrences: [{ id: 'o1', prompt_revision_id: 'prompt1', plan_revision_id: 'p-old', unit_id: 'u1', coverage_item_id: 'cover1', shot_id: 'shot1', local_number: 1 }], rows: roles.map(role => ({ role, occurrence_id: 'o1', verdict: 'pass', rationale: '动作与镜头要求一致', findings: [] })), context: { state: 'unset' } }
  const tasks = new Map([['check1', { task_id: 'check1', kind: 'directing_review', status: 'running', error: null }]])
  const writes = [], errors = [], sizes = []
  let taskUnavailable = false
  const shootRequests = []
  let loseShootResponse = true
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    const respond = data => route.fulfill({ json: { success: true, data: structuredClone(data) } })
    if (request.method() !== 'GET') writes.push(path)
    if (path.endsWith('/s1')) return respond(workspace)
    if (path.includes('/directing/tasks/')) {
      if (taskUnavailable) return route.fulfill({ status: 503, json: { detail: '任务状态读取失败' } })
      return respond(tasks.get(path.split('/').at(-1)))
    }
    if (path.endsWith('/shoot')) {
      const body = request.postDataJSON()
      shootRequests.push(body)
      const id = shootRequests[0].request_id === body.request_id ? 'video2' : 'video3'
      tasks.set(id, { task_id: id, kind: 'video_generation', status: 'running', error: null })
      if (loseShootResponse) { loseShootResponse = false; return route.abort('failed') }
      return respond({ task_id: id })
    }
    if (path.endsWith('/check1/cancel')) { tasks.get('check1').status = 'cancelled'; return respond({}) }
    if (path.endsWith('/prompts/prompt1/review')) {
      tasks.set('check2', { task_id: 'check2', kind: 'directing_review', status: 'running', error: null })
      // 接受响应先到、工作区任务索引滞后时，仍应直接核实这个确切任务。
      return respond({ task_id: 'check2' })
    }
    if (path.endsWith('/sources/resolve')) return respond([])
    if (path.endsWith('/feedback')) return respond({ reviews: [], repairs: [], knowledge: [] })
    if (path.endsWith('/models/model1')) return respond({ id: 'model1', name: '视频模型 A', category: 'video' })
    if (path.endsWith('/models')) return respond({ items: [{ id: 'model1', name: '视频模型 A', category: 'video' }], total: 1 })
    if (path.endsWith('/model-settings')) return respond({ default_video_model_id: 'model1' })
    if (path.endsWith('/download')) return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150"><rect width="200" height="150" fill="#dce8f0"/><path d="M20 125 80 55 110 90 150 35 185 125Z" fill="#7395ac"/></svg>' })
    if (path.endsWith('/film/tasks')) return respond({ items: [], next_cursor: null })
    if (/\/(assets|styles|batches|categories)$/.test(path)) return respond([])
    return respond({ items: [], total: 0 })
  })
  const base = 'http://127.0.0.1:4199/projects/p1/chapters/ch1/sequences/s1?view=shoot&design=d1&plan=p-old&unit=u1&prompt=prompt1&review=&focus=review'
  await page.goto(base)
  await page.getByRole('region', { name: '检查进度', exact: true }).getByText('进行中', { exact: true }).waitFor()
  await page.locator('.production-unit-list').getByText('检查中 · 1 个候选', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '检查这份指令', exact: true }).count(), 0)
  await page.getByRole('button', { name: '取消检查', exact: true }).click()
  await page.getByRole('region', { name: '检查进度', exact: true }).getByText('已取消', { exact: true }).waitFor()
  await page.getByRole('button', { name: '检查这份指令', exact: true }).click()
  await page.locator('[data-inline-task-id="check2"]').getByText('进行中', { exact: true }).waitFor()
  await page.getByRole('button', { name: '本场任务记录 · 2', exact: true }).waitFor()
  taskUnavailable = true
  await page.getByRole('region', { name: '检查进度', exact: true }).getByText('状态读取失败，正在重试；核实前请勿重复提交。', { exact: true }).waitFor()
  assert.equal(writes.filter(path => path.endsWith('/prompts/prompt1/review')).length, 1)
  assert.equal(await page.getByRole('button', { name: '检查这份指令', exact: true }).count(), 0)
  taskUnavailable = false
  Object.assign(tasks.get('check2'), { status: 'succeeded', review: packet })
  await page.getByRole('button', { name: '确认结论，进入试拍', exact: true }).waitFor()
  await page.locator('.production-unit-list').getByText('待确认结论 · 1 个候选', { exact: true }).waitFor()
  await page.getByRole('button', { name: '固定输入', exact: true }).click()
  await page.getByRole('region', { name: '本次固定输入详情' }).getByText('视频模型 A', { exact: true }).waitFor()
  await page.getByRole('button', { name: '关闭指令详情' }).click()
  const detail = page.locator('.shoot-passed-summary')
  await detail.locator(':scope > summary').focus(); await page.keyboard.press('Enter')
  assert.equal(await detail.getAttribute('open'), '')
  await page.keyboard.press('Enter')
  assert.equal(await detail.getAttribute('open'), null)
  for (const width of [1440, 1024, 768, 375]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.locator('.production-content').evaluate(element => { element.scrollTop = 0 })
    await page.locator('.shoot-passed-summary > summary').evaluate(element => element.blur())
    const primary = page.getByRole('button', { name: '确认结论，进入试拍', exact: true })
    await primary.scrollIntoViewIfNeeded()
    assert.equal(await page.locator('.production-next-step .ant-btn-primary').count(), 1)
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    const box = await primary.boundingBox()
    assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1 && box.y >= 0 && box.y + box.height <= 1000)
    assert.ok(await primary.evaluate(element => { const rect = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)) }))
    await page.screenshot({ path: join(output, `check-ready-${width}.png`), animations: 'disabled' })
    sizes.push({ width, primary: box })
  }
  workspace.reviews.push({ ...revision('review1', packet), source_task_id: 'check2' })
  workspace.task_ids.push('video1')
  tasks.set('video1', { task_id: 'video1', kind: 'video_generation', status: 'running', error: null })
  await page.evaluate(() => {
    const key = 'directing-submitted-tasks:p1:s1'
    sessionStorage.setItem(key, JSON.stringify([...JSON.parse(sessionStorage.getItem(key)), { taskId: 'video1', planId: 'p-old', unitId: 'u1', promptId: 'prompt1' }]))
  })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(base.replace('review=&focus=review', 'review=review1&focus=shoot-confirm'))
  await page.getByRole('region', { name: '视频生成进度', exact: true }).getByText('进行中', { exact: true }).waitFor()
  await page.locator('.production-unit-list').getByText('视频生成中 · 1 个候选', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '开始试拍', exact: true }).count(), 0)
  await page.getByRole('tab', { name: '候选素材', exact: true }).click()
  await page.getByRole('button', { name: '查看视频 1 · 待审片', exact: true }).waitFor()
  await page.getByRole('button', { name: '查看本次任务', exact: true }).click()
  await page.getByRole('tab', { name: '执行试拍', exact: true, selected: true }).waitFor()
  Object.assign(tasks.get('video1'), { status: 'failed', error: '隔离视频失败，请核对模型配置' })
  await page.getByRole('region', { name: '视频生成进度', exact: true }).getByText('隔离视频失败，请核对模型配置', { exact: true }).waitFor()
  await page.getByRole('button', { name: '开始试拍', exact: true }).waitFor()
  assert.equal(workspace.takes.length, 1)
  await page.getByRole('button', { name: '开始试拍', exact: true }).click()
  await page.getByRole('button', { name: '核实本次提交', exact: true }).waitFor()
  await page.reload()
  await page.getByRole('button', { name: '核实本次提交', exact: true }).click()
  await page.locator('[data-inline-task-id="video2"]').getByText('进行中', { exact: true }).waitFor()
  assert.equal(shootRequests.length, 2)
  assert.equal(shootRequests[0].request_id, shootRequests[1].request_id, 'refresh retries the original authorized submission')
  assert.deepEqual(await page.evaluate(() => JSON.parse(sessionStorage.getItem('directing-shoot-requests:p1:s1'))), [])
  workspace.takes.push({ ...workspace.takes[0], id: 'new-take', task_id: 'video2', prompt_revision_id: 'prompt1' })
  Object.assign(tasks.get('video2'), { status: 'succeeded' })
  await page.getByRole('button', { name: '再拍一次', exact: true }).click()
  await page.locator('[data-inline-task-id="video3"]').getByText('进行中', { exact: true }).waitFor()
  assert.equal(shootRequests.length, 3)
  assert.notEqual(shootRequests[2].request_id, shootRequests[0].request_id, 'explicit reshoot creates a distinct request')
  assert.equal(workspace.takes.length, 2)
  assert.deepEqual(errors, [])
  await writeFile(join(output, 'results.json'), JSON.stringify({ sizes, writes, errors }, null, 2))
  console.log(JSON.stringify({ output, result: 'PASS inline check/cancel/retry/unknown state, consistent unit status, preserved candidates, readable fixed inputs, keyboard disclosure and four widths' }))
} catch (error) {
  if (page) { await page.screenshot({ path: join(output, 'failure.png') }); console.log(await page.locator('body').innerText()) }
  console.log(output); throw error
} finally { await browser?.close(); await server.close() }
