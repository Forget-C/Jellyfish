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
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => { window.__copied = text } } })
    if (!sessionStorage.getItem('directing-submitted-tasks:p1:s1')) sessionStorage.setItem('directing-submitted-tasks:p1:s1', JSON.stringify([{ taskId: 'check1', planId: 'p-old', unitId: 'u1', promptId: 'prompt1' }]))
  })
  const workspace = makeWorkspace()
  workspace.plans = [workspace.plans[0]]; workspace.cuts = []
  workspace.takes = [{ ...workspace.takes[2], prompt_revision_id: 'older-prompt' }]
  const unit = workspace.plans[0].content.units[0]
  unit.references = [0, 1].map(ordinal => ({ id: `ref${ordinal}`, ordinal, file_id: `image${ordinal}`, media_kind: 'image', purpose: 'composition', input_role: ordinal ? 'subject' : 'first_frame', participant_ids: [], source: { kind: 'human', reference: 'author', version: '1' } }))
  unit.references[1].asset_origin = { kind: 'character', id: 'historical-role', name: '选择时的张三' }
  workspace.designs[0].content.participants[0].name = '林岚'
  workspace.designs[1].content.participants[0].name = '最新设计姓名'
  const promptText = '【场次试拍 v4】\n参考 @ref1：用途 composition，主体 空间/构图，输入位置 subject。\n【participants[1]: id=person1】\nparticipant_id：person1\n镜头 1 [shot1]：person1递出旧信。\nphysical_action：person1递出旧信。\nphysical_action：person1递出旧信。\n参考 @missing-ref：尚未找到。'
  workspace.prompts = [revision('prompt1', { plan_revision_id: 'p-old', unit_id: 'u1', text: promptText, decisions: [{ section_path: '/performance/beats/0/physical_action', disposition: 'text', explanation: '固定动作', text_excerpt: 'physical_action：person1递出旧信。' }], sources: [], format_version: 'jellyfish-scene-v4' })]
  workspace.prompts.push(revision('prompt0', { ...workspace.prompts[0].content, text: '历史模型原文：person1站在门边。', decisions: [], format_version: 'unknown-format' }))
  workspace.reviews = []; workspace.task_ids = ['check1']
  workspace.prompts.forEach((row, index) => { row.display_number = index + 1 })
  const roles = ['direction', 'performance', 'staging', 'cinematography', 'continuity', 'prompt']
  const packet = { mode: 'formal', roles, occurrences: [{ id: 'o1', prompt_revision_id: 'prompt1', plan_revision_id: 'p-old', unit_id: 'u1', coverage_item_id: 'cover1', shot_id: 'shot1', local_number: 1 }], rows: roles.map(role => ({ role, occurrence_id: 'o1', verdict: 'pass', rationale: '动作与镜头要求一致', findings: [] })), context: { state: 'unset' } }
  packet.rows[0].rationale = 'person1的动作与shot1一致'
  packet.rows[0].findings = [{ observation: 'person1递出旧信', affected_paths: ['/performance/beats/0/physical_action'], suggestion: { state: 'proposal', text: '保持person1的动作', sources: [] }, acceptance: { state: 'fact', text: 'shot1中手部清晰', sources: [] } }]
  packet.rows[0].findings.push({ observation: '无法定位的检查', affected_paths: ['/direction/nonexistent'], suggestion: { state: 'unknown', reason: '请核对原文', sources: [] }, acceptance: { state: 'unset', sources: [] } })
  const originalPacket = structuredClone(packet)
  const originalReferences = structuredClone(unit.references)
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
  await page.getByRole('region', { name: '本次固定输入详情' }).getByText('提示词 + 2 张图片 · 1 组主体参考', { exact: true }).waitFor()
  await page.getByRole('region', { name: '本次固定输入详情' }).getByText('来源：选择时的张三 · 选择时的资产记录 · 1 份', { exact: true }).waitFor()
  await page.getByRole('button', { name: '关闭指令详情' }).click()
  await page.waitForFunction(() => document.activeElement?.textContent === '固定输入')
  const readsBefore = writes.filter(path => !path.endsWith('/sources/resolve')).length
  await page.getByRole('button', { name: '查看指令', exact: true }).click()
  const reader = page.locator('.prompt-reader')
  await page.getByRole('radio', { name: '易读视图', exact: true }).locator('../..').waitFor()
  assert.ok((await reader.innerText()).includes('人物/物件：林岚'))
  assert.ok(!(await reader.innerText()).includes('最新设计姓名'))
  await page.getByRole('button', { name: '复制易读内容', exact: true }).click()
  assert.equal(await page.evaluate(() => window.__copied), await reader.innerText())
  await page.getByRole('radio', { name: '模型原文', exact: true }).locator('../..').click()
  assert.equal(await reader.innerText(), promptText)
  await page.getByRole('button', { name: '复制模型原文', exact: true }).click()
  assert.equal(await page.evaluate(() => window.__copied), promptText)
  await page.getByRole('radio', { name: '易读视图', exact: true }).locator('../..').click()
  const person = reader.getByRole('button', { name: '查看人物：林岚', exact: true }).first()
  await person.focus(); await page.keyboard.press('Enter')
  await page.getByRole('region', { name: '指令固定依据' }).getByText('原始标识：person1', { exact: true }).waitFor()
  await page.getByRole('button', { name: '收起固定依据', exact: true }).click()
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '查看人物：林岚')
  assert.ok(await person.evaluate(element => element === document.activeElement))
  await reader.getByRole('button', { name: /查看参考：选择时的张三/ }).click()
  await page.getByRole('region', { name: '指令固定依据' }).getByAltText('参考图 2').waitFor()
  await page.getByRole('button', { name: '收起固定依据', exact: true }).click()
  await reader.getByRole('button', { name: '查看未识别内容：@missing-ref', exact: true }).click()
  await page.getByRole('region', { name: '指令固定依据' }).getByText(/暂未识别/).waitFor()
  await page.getByRole('button', { name: '收起固定依据', exact: true }).click()
  await page.setViewportSize({ width: 375, height: 812 })
  await reader.getByRole('button', { name: '查看人物：林岚', exact: true }).first().click()
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
  await page.mouse.move(0, 0)
  await page.locator('.ant-tooltip:visible').first().waitFor({ state: 'hidden' })
  await page.screenshot({ path: join(output, '375-readable-detail.png'), animations: 'disabled' })
  await page.getByRole('button', { name: '收起固定依据', exact: true }).click()
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.screenshot({ path: join(output, '1440-readable-prompt.png'), animations: 'disabled' })
  await page.getByRole('button', { name: '关闭指令详情' }).click()
  assert.equal(writes.filter(path => !path.endsWith('/sources/resolve')).length, readsBefore)
  assert.equal(workspace.prompts[0].content.text, promptText)
  await page.getByRole('button', { name: '查看指令', exact: true }).click()
  await page.getByRole('tab', { name: '版本记录', exact: true }).click()
  await page.getByRole('button', { name: '查看此版本', exact: true }).last().click()
  await page.getByText(/仅查看历史，当前工作对象仍为/).waitFor()
  assert.equal(await reader.innerText(), '历史模型原文：林岚站在门边。')
  assert.ok(page.url().includes('prompt=prompt1'))
  await page.getByRole('button', { name: '关闭指令详情' }).click()
  const detail = page.locator('.shoot-passed-summary')
  await detail.locator(':scope > summary').focus(); await page.keyboard.press('Enter')
  assert.equal(await detail.getAttribute('open'), '')
  const row = detail.locator('.shoot-review-row').first()
  await row.locator(':scope > summary').click()
  assert.ok((await row.innerText()).includes('林岚的动作与镜头 01一致'))
  await row.getByRole('button', { name: '查看人物：林岚', exact: true }).first().click()
  await row.getByRole('region', { name: '检查对象详情' }).getByText('原始标识：person1', { exact: true }).waitFor()
  await row.getByRole('button', { name: '收起对象详情', exact: true }).click()
  await row.locator('.review-raw > summary').click()
  assert.deepEqual(JSON.parse(await row.locator('.review-raw pre').innerText()), packet.rows[0])
  await row.getByRole('button', { name: '查看相关指令与固定依据', exact: true }).first().click()
  assert.ok(await page.getByRole('radio', { name: '易读视图', exact: true }).isChecked())
  await page.waitForFunction(() => document.querySelectorAll('.prompt-reader .is-highlighted').length > 0)
  assert.equal((await reader.locator('.is-highlighted').allTextContents()).join(''), '可见身体动作：林岚递出旧信。可见身体动作：林岚递出旧信。')
  await page.getByRole('radio', { name: '模型原文', exact: true }).locator('../..').click()
  assert.equal((await reader.locator('.is-highlighted').allTextContents()).join(''), 'physical_action：person1递出旧信。physical_action：person1递出旧信。')
  await page.getByRole('button', { name: '关闭指令详情' }).click()
  await row.getByRole('button', { name: '查看相关指令与固定依据', exact: true }).last().click()
  await page.getByText('这些问题字段没有可准确对应的编译映射；请核对原固定依据。', { exact: true }).waitFor()
  assert.equal(await reader.locator('.is-highlighted').count(), 0)
  await page.getByRole('button', { name: '关闭指令详情' }).click()
  assert.deepEqual(packet, originalPacket)
  assert.deepEqual(unit.references, originalReferences)
  assert.equal(writes.filter(path => !path.endsWith('/sources/resolve')).length, readsBefore)
  await page.screenshot({ path: join(output, '1440-readable-review.png'), animations: 'disabled' })
  await detail.locator(':scope > summary').focus()
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
  await page.getByRole('tab', { name: '试拍与候选', exact: true }).click()
  await page.getByRole('button', { name: '预览候选 03', exact: true }).waitFor()
  await page.getByRole('region', { name: '视频生成进度', exact: true }).waitFor()
  await page.getByRole('tab', { name: '试拍与候选', exact: true, selected: true }).waitFor()
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
  workspace.takes.push({ ...workspace.takes[0], id: 'new-take', display_number: 4, task_id: 'video2', prompt_revision_id: 'prompt1' })
  Object.assign(tasks.get('video2'), { status: 'succeeded' })
  await page.getByRole('button', { name: '同指令再拍一次', exact: true }).click()
  await page.locator('[data-inline-task-id="video3"]').getByText('进行中', { exact: true }).waitFor()
  assert.equal(shootRequests.length, 3)
  assert.notEqual(shootRequests[2].request_id, shootRequests[0].request_id, 'explicit reshoot creates a distinct request')
  assert.equal(workspace.takes.length, 2)
  assert.deepEqual(errors, [])
  await writeFile(join(output, 'results.json'), JSON.stringify({ sizes, writes, errors }, null, 2))
  console.log(JSON.stringify({ output, result: 'PASS readable/raw copies, historical names, entity details, review originals and source positioning, no presentation writes, check/shoot flow and four widths' }))
} catch (error) {
  if (page) { await page.screenshot({ path: join(output, 'failure.png') }); console.log(await page.locator('body').innerText()) }
  console.log(output); throw error
} finally { await browser?.close(); await server.close() }
