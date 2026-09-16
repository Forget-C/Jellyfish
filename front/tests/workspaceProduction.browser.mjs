import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { makeWorkspace, revision } from './directing-fixtures.mjs'
const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
process.chdir(root)
const output = await mkdtemp(join(tmpdir(), 'jellyfish-ux3-'))
const server = await createServer({ root, server: { host: '127.0.0.1', port: 4180, strictPort: true, open: false } })
let browser, page
try {
  await server.listen()
  browser = await chromium.launch({ headless: true })
  page = await browser.newPage({ viewport: { width: 1440, height: 1050 } })
  page.setDefaultTimeout(12000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: location.origin } })
  const workspace = makeWorkspace()
  workspace.takes = []; workspace.cuts = []
  const original = workspace.designs[1].content
  original.direction.turning_point = { state: 'unknown' }
  original.direction.relationship_change = { state: 'not_applicable', reason: '本段尚未相认' }
  original.direction.open_questions = [{ state: 'unknown' }]
  original.sound.music_constraints = { state: 'none', reason: '只保留环境声' }
  original.performance.applicability = { state: 'proposal', text: '动作克制', sources: [{ kind: 'human', reference: 'actor-note', version: '3' }] }
  original.prompt.sound_strategy = { state: 'fact', text: '对白后期录制', sources: [{ kind: 'human', reference: 'sound-note', version: '2' }] }
  const before = structuredClone(original)
  const tasks = new Map([
    ['late', { task_id: 'late', kind: 'directing_design', status: 'succeeded', design: structuredClone(workspace.designs[0].content), error: null }],
    ['failed', { task_id: 'failed', kind: 'video_generation', status: 'failed', error: '供应商未生成视频，请核对后重试' }],
    ['cancelled', { task_id: 'cancelled', kind: 'video_generation', status: 'cancelled', error: null }],
    ['running', { task_id: 'running', kind: 'image_generation', status: 'queued', error: null }],
  ])
  // Distinct suggestion; the persisted baseline is not evidence that it has been applied.
  tasks.get('late').design.direction.information_change.text = '模型较早的建议'
  workspace.task_ids = [...tasks.keys()]
  let saveFailure = true, applyFailure = true
  const writes = [], errors = [], batches = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    const respond = data => route.fulfill({ json: { success: true, data: structuredClone(data) } })
    if (path.endsWith('/sources/resolve')) return respond(request.postDataJSON().sources.map(source => ({ source, status: source.kind === 'human' ? 'ready' : 'unavailable', label: source.kind === 'human' ? '人工填写' : '历史来源', description: '隔离来源记录' })))
    const reject = message => route.fulfill({ status: 409, json: { detail: message } })
    if (request.method() !== 'GET') writes.push({ path, body: request.postDataJSON() })
    if (path.endsWith('/s1')) return respond(workspace)
    if (path.endsWith('/s1/feedback')) return respond({ active_cut_revision_id: null, current_review_id: null, reviews: [], repairs: [], knowledge: [] })
    if (path.includes('/directing/tasks/')) return respond(tasks.get(path.split('/').at(-1)))
    if (path.endsWith('/revisions')) {
      if (saveFailure) return reject('模拟保存失败，修改仍保留')
      const body = request.postDataJSON()
      const row = workspace.designs.find(item => item.id === body.revision_id)
      assert.equal(body.document.kind, 'design')
      row.content = body.document.content; row.version++
      return respond(workspace)
    }
    if (path.endsWith('/design/apply')) {
      if (applyFailure) return reject('原文版本已变化，旧建议不可写入')
      workspace.designs.push(revision('late-draft', structuredClone(tasks.get('late').design), false))
      return respond(workspace)
    }
    if (path.endsWith('/images')) return respond({ task_id: 'visual-new' })
    if (path.endsWith('/regroup')) {
      workspace.plans.push(revision('regrouped', structuredClone(workspace.plans[1].content), false))
      return respond(workspace)
    }
    if (path.endsWith('/batches/prepare')) {
      batches.push({ id: 'batch1', version: 1, status: 'prepared', items: [{ ordinal: 0, unit_id: 'u1', model_id: 'model1', duration_ms: 6000, ratio: '16:9', status: 'ready' }] })
      return respond(batches[0])
    }
    if (path.endsWith('/batches/batch1/submit')) { batches[0].status = 'submitted'; batches[0].items[0].status = 'succeeded'; return respond(batches[0]) }
    if (path.endsWith('/batches')) return respond(batches)
    if (path.endsWith('/running/cancel')) { tasks.get('running').status = 'cancelled'; return respond({}) }
    if (path.endsWith('/film/tasks')) return respond({ items: [], next_cursor: null })
    if (/\/(assets|styles|batches)$/.test(path)) return respond([])
    return respond({ items: [], total: 0 })
  })
  const base = 'http://127.0.0.1:4180/projects/p1/chapters/ch1/sequences/s1'
  await page.goto(base + '?view=design&design=d2')
  await page.getByRole('tab', { name: '镜头', exact: true }).click(); await page.getByRole('radio', { name: '清单', exact: true }).locator('..').click()
  const summary = page.locator('.sequence-stages .design-intent')
  await summary.getByText('本场意图：递出旧信，认出对方', { exact: true }).waitFor()
  assert.equal(await page.getByRole('textbox', { name: '本场信息变化', exact: true }).isVisible(), false)
  await page.screenshot({ path: join(output, 'design-overview.png'), fullPage: true })
  async function object(role, label) {
    await page.locator('.design-navigation').getByRole('button', { name: '全场规则', exact: true }).click()
    await choose('岗位', role)
    await page.locator('.design-role-row').filter({ hasText: label }).first().click()
  }
  async function tasksPanel() {
    await page.getByRole('button', { name: '任务中心', exact: true }).click()
    await page.getByRole('button', { name: '查看本场任务与业务结果', exact: true }).click()
  }
  await page.getByRole('tab', { name: '镜头', exact: true }).click(); await page.getByRole('radio', { name: '清单', exact: true }).locator('..').click()
  await summary.getByRole('button', { name: /全场概览/ }).click()
  const information = page.getByRole('textbox', { name: '本场信息变化', exact: true })
  await information.fill('人工修改：递信但尚未相认')
  await summary.getByText('本场意图：人工修改：递信但尚未相认', { exact: true }).waitFor()
  await object('对白与声音', '声音安排')
  const sound = page.getByRole('textbox', { name: '音乐约束', exact: true })
  await sound.fill('不配乐，只保留脚步声')
  const fieldEdits = [
    ['适用说明', '演员以递信动作带出关系', ['performance', 'applicability']],
    ['环境活动', '旁人继续整理桌面', ['staging', 'environment']],
    ['构图重心', '信件位于画面中心', ['cinematography', 0, 'composition']],
    ['前态', '信件仍在右手', ['continuity', 0, 'before']],
    ['编译优先级', '优先保留递信动作', ['prompt', 'priorities']],
  ]
  const objectNames = [['表演指导','表演适用规则'], ['镜内执行','环境活动与留白'], ['摄影指导','摄影 01'], ['场记与连续性','连续性 01'], ['提示词指导','提示词指导']]
  for (const [index, [label, text]] of fieldEdits.entries()) { await object(...objectNames[index]); await page.getByRole('textbox', { name: label, exact: true }).fill(text) }
  await page.getByRole('button', { name: '保存设计草稿', exact: true }).click()
  await page.getByText('模拟保存失败，修改仍保留', { exact: true }).first().waitFor()
  await page.getByRole('tab', { name: '镜头', exact: true }).click(); await page.getByRole('radio', { name: '清单', exact: true }).locator('..').click()
  await summary.getByRole('button', { name: /全场概览/ }).click()
  assert.equal(await information.inputValue(), '人工修改：递信但尚未相认')
  assert.equal(await page.getByRole('button', { name: '确认本轮设计', exact: true }).isDisabled(), true)
  saveFailure = false
  await page.getByRole('button', { name: '保存设计草稿', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('[data-workspace-target="design-confirm"]').disabled)
  const saved = structuredClone(workspace.designs[1].content)
  const expected = structuredClone(before)
  expected.direction.information_change = saved.direction.information_change
  expected.sound.music_constraints = saved.sound.music_constraints
  for (const [, , path] of fieldEdits) {
    let target = expected, source = saved
    for (const key of path.slice(0, -1)) { target = target[key]; source = source[key] }
    target[path.at(-1)] = source[path.at(-1)]
  }
  assert.deepEqual(saved, expected) // Every untouched six-role field, Note state and provenance round-trips.
  assert.equal(saved.sound.music_constraints.state, 'none')
  assert.equal(saved.direction.turning_point.state, 'unknown')
  await page.reload()
  await summary.getByText('本场意图：人工修改：递信但尚未相认', { exact: true }).waitFor()
  await object('对白与声音', '声音安排')
  assert.equal(await sound.inputValue(), '不配乐，只保留脚步声')
  for (const [index, [label, text]] of fieldEdits.entries()) { await object(...objectNames[index]); assert.equal(await page.getByRole('textbox', { name: label, exact: true }).inputValue(), text) }
  // Read-only suggestion view and failed apply do not overwrite the current saved human version.
  await tasksPanel()
  await page.locator('[data-task-id="late"]').getByRole('button', { name: '查看结果' }).click()
  const dialog = page.getByRole('dialog', { name: '导演建议' })
  await dialog.getByRole('button', { name: '写入可编辑草稿' }).click()
  await page.getByText('原文版本已变化，旧建议不可写入', { exact: true }).first().waitFor()
  assert.deepEqual(workspace.designs[1].content, saved)
  assert.equal(await dialog.isVisible(), true)
  applyFailure = false
  await dialog.getByRole('button', { name: '写入可编辑草稿' }).click()
  await dialog.waitFor({ state: 'hidden' })
  assert.deepEqual(workspace.designs[1].content, saved)
  assert.equal(workspace.designs.at(-1).confirmed_at, null)
  await page.getByRole('tab', { name: '镜头', exact: true }).click(); await page.getByRole('radio', { name: '清单', exact: true }).locator('..').click()
  await summary.getByText('本场意图：模型较早的建议', { exact: true }).waitFor()
  await tasksPanel()
  // Stored result and cancelled tasks move to full history; failures/running stay visible.
  await page.locator('[data-task-id="running"]').getByText('等待执行', { exact: true }).waitFor()
  const beforeQueueTransition = writes.length
  tasks.get('running').status = 'running'
  await page.locator('[data-task-id="running"]').getByText('执行中', { exact: true }).waitFor()
  assert.equal(writes.length, beforeQueueTransition) // Polling a queued task must not resubmit it.
  assert.equal(await page.locator('[data-task-id="late"]').isVisible(), false)
  assert.equal(await page.locator('[data-task-id="cancelled"]').isVisible(), false)
  assert.equal(await page.locator('[data-task-id="failed"]').isVisible(), true)
  await page.locator('[data-task-id="running"]').getByRole('button', { name: /^取\s*消$/ }).click()
  await page.waitForFunction(() => document.querySelector('[data-task-id="running"]')?.textContent.includes('已取消'))
  assert.equal(await page.locator('[data-task-id="running"]').isVisible(), false)
  await page.getByText('完整任务记录 · 4 项（含已完成与已取消）', { exact: true }).click()
  assert.equal(await page.locator('[data-task-id="cancelled"]').isVisible(), true)
  assert.equal(await page.locator('[data-task-id="late"]').isVisible(), true)
  assert.equal(writes.filter(row => row.path.endsWith('/confirm') || row.path.endsWith('/shoot')).length, 0)
  // A11: duplicate unit names across plans and multiple valid prompts require explicit selection.
  workspace.plans[1].confirmed_at = '2026-09-15T01:00:00'
  workspace.plans[1].content.units[0].parameters = { seed: 123, guidance_scale: 7 }
  workspace.plans[1].content.units[0].references = ['video', 'audio'].map((kind, index) => ({ id: 'ref-' + kind, file_id: kind + '-file', media_kind: kind, purpose: kind === 'audio' ? 'sound' : 'performance', ordinal: index, participant_ids: [], source: { kind: 'human', reference: 'fixed-media', version: '1' } }))
  workspace.prompts = ['old-input', 'new-input-a', 'new-input-b'].map((id, index) => revision(id, { plan_revision_id: index ? 'p-new' : 'p-old', unit_id: 'u1', text: id + ' 固定正文', decisions: index === 1 ? [{ section_path: '/direction/information_change', disposition: 'reference', text_excerpt: '固定正文', explanation: '使用已冻结设计与声音参考', reference_id: 'ref-audio' }] : [], sources: [], format_version: 'v4' }))
  const roles = ['direction', 'performance', 'staging', 'cinematography', 'continuity', 'prompt']
  workspace.reviews = workspace.prompts.map((prompt, index) => revision('review-' + index, { mode: 'formal', roles, occurrences: [{ id: 'o1', prompt_revision_id: prompt.id, plan_revision_id: prompt.content.plan_revision_id, unit_id: 'u1', coverage_item_id: 'cover1', shot_id: 'shot1', local_number: 1 }], rows: roles.map(role => ({ role, occurrence_id: 'o1', verdict: 'pass', rationale: '检查通过', findings: [] })), context: { state: 'unset' } }))
  workspace.takes = makeWorkspace().takes.slice(0, 2)
  workspace.takes[1].plan_revision_id = 'p-new'
  async function choose(label, option) {
    await page.getByRole('combobox', { name: label, exact: true }).locator('../..').click()
    const popup = page.locator('.ant-select-dropdown:visible').last()
    await popup.locator('.ant-select-item-option').filter({ hasText: option }).first().click()
    if (label !== '重组单元') await popup.waitFor({ state: 'hidden' })
  }
  tasks.set('new-running', { task_id: 'new-running', kind: 'video_generation', status: 'running', error: null })
  workspace.task_ids.push('new-running')
  await page.evaluate(() => sessionStorage.setItem('directing-submitted-tasks:p1:s1', JSON.stringify([{ taskId: 'failed', planId: 'p-old', unitId: 'u1' }, { taskId: 'new-running', planId: 'p-new', unitId: 'u1' }])))
  await page.goto(base + '?view=shoot&plan=p-new&unit=u1&prompt=old-input&review=review-0')
  const unitSummary = page.locator('[data-unit-task-summary]')
  await unitSummary.getByText('本单元 · 执行中 1', { exact: true }).waitFor()
  assert.ok(!(await unitSummary.innerText()).includes('供应商未生成'))
  const beforeTaskBrowse = writes.length
  await choose('查看或编辑生产计划', '计划 1')
  await unitSummary.getByText('本单元 · 失败 1', { exact: true }).waitFor()
  await unitSummary.getByText('供应商未生成视频，请核对后重试', { exact: true }).waitFor()
  await unitSummary.getByRole('button', { name: '查看任务记录', exact: true }).click()
  await page.locator('[data-task-id="failed"]').waitFor()
  await page.locator('.ant-drawer-open').getByRole('button', { name: 'Close', exact: true }).click()
  await choose('查看或编辑生产计划', '计划 2')
  await unitSummary.getByText('本单元 · 执行中 1', { exact: true }).waitFor()
  assert.equal(writes.length, beforeTaskBrowse)

  await page.getByRole('tab', { name: '生成指令', exact: true }).click()
  await page.getByRole('combobox', { name: '选择生成指令版本' }).waitFor()
  assert.equal(await page.getByRole('button', { name: '检查生成指令', exact: true }).isDisabled(), true)
  await page.getByRole('combobox', { name: '选择生成指令版本' }).locator('../..').click()
  const options = page.locator('.ant-select-dropdown:visible .ant-select-item-option')
  assert.equal(await options.count(), 2)
  assert.equal(await options.filter({ hasText: '提示词 1' }).count(), 0)
  await options.filter({ hasText: '提示词 2' }).click()
  assert.equal(await page.locator('.prompt-reader').innerText(), 'new-input-a 固定正文')
  await page.getByText('全部固定参数与版本', { exact: true }).click()
  await page.getByText('提示词引导强度：7', { exact: true }).waitFor()
  assert.equal(await page.locator('video[aria-label="视频参考 1"]').count(), 2)
  assert.equal(await page.locator('audio[aria-label="声音参考 2"]').count(), 2)
  await page.locator('.prompt-reader').getByRole('button', { name: '固定正文', exact: true }).click()
  const mapping = page.locator('.ant-drawer-open').filter({ hasText: '生成指令的冻结依据' })
  await mapping.getByText('固定计划：计划 2 · 单元 u1 · 设计 1', { exact: true }).waitFor()
  await mapping.locator('.frozen-design-value').getByText('递出旧信，认出对方', { exact: true }).waitFor()
  assert.equal(await mapping.locator('audio[aria-label="声音参考 2"]').count(), 1)
  await mapping.getByRole('button', { name: 'Close', exact: true }).click()
  await mapping.waitFor({ state: 'hidden' })
  await choose('选择生成指令版本', '提示词 3')
  assert.equal(await page.locator('.prompt-reader').innerText(), 'new-input-b 固定正文')
  assert.equal(await page.locator('.prompt-decision').count(), 0)
  await choose('选择生成指令版本', '提示词 2')

  await page.getByRole('tab', { name: '检查与试拍', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: '确认并开始生成视频', exact: true }).isDisabled(), true)
  await page.getByRole('tab', { name: '候选素材', exact: true }).click()
  const candidateCard = page.locator('.ant-card').filter({ has: page.getByText('本单元生成的视频 · 待挑选素材', { exact: true }) })
  assert.equal(await candidateCard.getByRole('button').count(), 1)
  await page.keyboard.press('Escape')
  await page.screenshot({ path: join(output, 'production-inputs.png'), fullPage: true })
  await choose('查看或编辑生产计划', '计划 1')
  await page.getByRole('tab', { name: '生成指令', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: '检查生成指令', exact: true }).isDisabled(), true)
  assert.equal(await page.locator('.prompt-reader').count(), 0)
  // A12: existing visual, batch and regroup operations remain reachable and explicit.
  await page.getByRole('button', { name: /阶段工具/ }).click()
  await page.getByRole('menuitem', { name: '验证参考画面', exact: true }).click()
  await choose('验证图设计版本', '设计 1')
  await page.getByRole('textbox', { name: '验证图描述' }).fill('检查递信构图')
  await Promise.all([page.waitForResponse(response => response.url().endsWith('/images')), page.getByRole('button', { name: '生成候选验证图', exact: true }).click()])
  assert.equal(writes.find(row => row.path.endsWith('/images')).body.prompt, '检查递信构图')
  await page.getByRole('button', { name: '批量生成', exact: true }).click()
  await page.getByRole('checkbox', { name: '提示词 2 · 单元 u1', exact: true }).check()
  await choose('提示词 2 的批量审稿', '审稿 2')
  await page.getByRole('button', { name: '预检所选 1 项', exact: true }).click()
  await page.getByRole('button', { name: '确认并提交可执行的 1 项', exact: true }).click()
  await page.getByText('批次 1 · 已受理', { exact: true }).waitFor()
  assert.deepEqual(writes.find(row => row.path.endsWith('/batches/prepare')).body.items, [{ prompt_revision_id: 'new-input-a', review_revision_id: 'review-1' }])
  await page.getByRole('button', { name: '单元与生成指令', exact: true }).click()
  await choose('查看或编辑生产计划', '计划 2')
  await page.getByRole('button', { name: '拆分与重组', exact: true }).click()
  await choose('重组单元', '单元 1')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '按镜头拆为新计划', exact: true }).click()
  await page.getByText('当前查看： · 计划 3 · 草稿 · 固定设计依据：设计 1', { exact: true }).waitFor()
  assert.deepEqual(writes.find(row => row.path.endsWith('/regroup')).body, { plan_revision_id: 'p-new', unit_ids: ['u1'], operation: 'split' })
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ result: 'A09–A12 design roundtrip, scoped production, fixed media, task history and auxiliary operations passed', evidence: output }, null, 2))
} catch (error) {
  if (page) { await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }); console.error((await page.locator('body').innerText()).slice(-4500)) }
  console.error(output); throw error
} finally { await browser?.close(); await server.close() }
