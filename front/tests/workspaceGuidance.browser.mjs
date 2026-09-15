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
const output = await mkdtemp(join(tmpdir(), 'jellyfish-ux2-'))
const server = await createServer({ root, server: { host: '127.0.0.1', port: 4179, strictPort: true, open: false } })
let browser
let page
try {
  await server.listen()
  browser = await chromium.launch({ headless: true })
  page = await browser.newPage({ viewport: { width: 1440, height: 1050 } })
  page.setDefaultTimeout(15000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  let workspace = makeWorkspace()
  for (const key of ['designs', 'plans', 'prompts', 'reviews', 'takes', 'cuts']) workspace[key] = []
  const tasks = new Map()
  const writes = []
  const errors = []
  let compileError = '当前模型要求首帧参考'
  page.on('pageerror', error => errors.push(error.message))
  const roles = ['direction', 'performance', 'staging', 'cinematography', 'continuity', 'prompt']
  const packet = { mode: 'formal', roles, occurrences: [{ id: 'o1', prompt_revision_id: 'prompt1', plan_revision_id: 'p-old', unit_id: 'u1', coverage_item_id: 'cover1', shot_id: 'shot1', local_number: 1 }], rows: roles.map(role => ({ role, occurrence_id: 'o1', verdict: 'pass', rationale: '测试检查通过', findings: [] })), context: { state: 'fact', text: '固定本次输入', sources: [] } }
  await page.route('**/api/**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const respond = data => route.fulfill({ json: { success: true, data: structuredClone(data) } })
    if (request.method() !== 'GET') writes.push({ path, body: request.postDataJSON() })
    if (path === '/api/v1/film/tasks') return respond({ items: tasks.has('review-task') ? [{ task_id: 'review-task', task_kind: 'directing_review', title: '指令回跳任务', status: tasks.get('review-task').status, stage: '', progress: null, cancel_requested: false, target_type: 'directing_sequence', target_id: 's1', project_id: 'p1', created_at_ts: Date.now(), updated_at_ts: Date.now(), source: { kind: 'sequence', id: 's1', project_id: 'p1', chapter_id: 'ch1', title: workspace.sequence.title } }] : [], next_cursor: null })
    if (path.endsWith('/chapters/ch1/assembly')) return respond({ chapter_id: 'ch1', title: '测试章节', sequences: [], transitions: [], gaps: [] })
    if (path.endsWith('/chapters/ch1')) return respond({ chapter_id: 'ch1', title: '测试章节', raw_text: workspace.sequence.source_text, source_version: '1', sequences: [workspace.sequence], task_ids: [] })
    if (path.endsWith('/s1')) return respond(workspace)
    if (path.endsWith('/s1/feedback')) return respond({ active_cut_revision_id: null, current_review_id: null, reviews: [], repairs: [], knowledge: [] })
    if (path.includes('/directing/tasks/')) return respond(tasks.get(path.split('/').at(-1)))
    if (path.endsWith('/s1/design')) {
      tasks.set('design-task', { task_id: 'design-task', kind: 'directing_design', status: 'running', error: null, source_version: '1' })
      workspace.task_ids.push('design-task')
      return respond({ task_id: 'design-task' })
    }
    if (path.endsWith('/s1/compile')) {
      if (compileError) return route.fulfill({ status: 400, json: { detail: compileError } })
      workspace.prompts.push(revision('prompt1', { plan_revision_id: 'p-old', unit_id: 'u1', text: '固定动作与参考', format_version: 'v4', decisions: [], sources: [] }))
      return respond(workspace)
    }
    if (path.endsWith('/prompts/prompt1/review')) {
      tasks.set('review-task', { task_id: 'review-task', kind: 'directing_review', status: 'running', error: null, source_version: '1' })
      workspace.task_ids.push('review-task')
      return respond({ task_id: 'review-task' })
    }
    if (path.endsWith('/s1/review/apply')) {
      workspace.reviews.push(revision('review1', packet))
      return respond(workspace)
    }
    if (path.endsWith('/media')) return respond({ take_id: path.split('/').at(-2), file_id: 'file3', duration_ms: 6000, url: '/api/test-video.mp4' })
    if (path.endsWith('/test-video.mp4')) return route.fulfill({ status: 204 })
    if (/\/(styles|assets|batches)$/.test(path)) return respond([])
    return respond({ items: [], total: 0 })
  })
  const base = 'http://127.0.0.1:4179/projects/p1/chapters/ch1/sequences/s1'
  const guide = () => page.getByRole('region', { name: '下一步引导' })
  const text = value => page.getByText(value, { exact: true }).first().waitFor()
  async function choose(label, value) {
    await page.getByRole('combobox', { name: label, exact: true }).locator('../..').click()
    await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: value }).first().click()
  }
  async function focused(target) {
    await page.waitForFunction(value => document.activeElement?.getAttribute('data-workspace-target') === value, target)
  }

  // A05: purpose, output, one prominent first action; no empty six-role editor.
  await page.goto(base)
  await guide().getByRole('button', { name: '生成拍摄方案草稿' }).waitFor()
  assert.equal(await page.getByRole('region', { name: '场次工作区', exact: true }).locator('button.ant-btn-primary:visible').count(), 1)
  assert.equal(await page.getByRole('button', { name: '保存设计草稿', exact: true }).count(), 0)
  await text('把这场戏做成可预览的粗剪')
  await page.screenshot({ path: join(output, 'first-entry.png'), fullPage: true })
  await guide().getByRole('button').click()
  await guide().getByText('拍摄方案正在生成', { exact: true }).waitFor()
  assert.equal(writes.length, 1)
  assert.equal(await page.getByRole('button', { name: '生成导演建议', exact: true }).isDisabled(), true)
  const instruction = page.getByPlaceholder('本场希望观众看到什么？也可填写对现有设计的修改意见。')
  await instruction.fill('保持演员动作克制')
  tasks.get('design-task').status = 'succeeded'
  tasks.get('design-task').design = makeWorkspace().designs[0].content
  await guide().getByText('已有可查看的拍摄建议', { exact: true }).waitFor()
  assert.equal(await instruction.inputValue(), '保持演员动作克制')
  assert.equal(await instruction.evaluate(element => document.activeElement === element), true)
  await guide().getByRole('button', { name: '查看拍摄建议' }).click()
  await page.getByRole('dialog', { name: '导演建议' }).waitFor()
  assert.equal(writes.length, 1) // Viewing a result must not apply or confirm it.
  await page.getByRole('dialog', { name: '导演建议' }).getByRole('button', { name: 'Close' }).click()

  // A06: known source changes direct the user to the scene source boundary.
  workspace.sequence.source_changed = true
  await page.getByRole('button', { name: '刷新状态', exact: true }).click()
  await guide().getByRole('button', { name: '回场次列表核对原文' }).waitFor()
  workspace = makeWorkspace()
  workspace.takes = []; workspace.cuts = []; workspace.task_ids = []
  workspace.plans[0].content.units.push({ ...structuredClone(workspace.plans[0].content.units[0]), id: 'u2' })
  await page.goto(base + '?view=shoot&design=d1&plan=p-old&unit=u1')
  await guide().getByRole('button', { name: '去准备生成指令' }).click()
  await focused('compile')
  await page.getByRole('button', { name: '准备生成指令', exact: true }).click()
  await guide().getByText('当前模型要求首帧参考', { exact: true }).waitFor()
  await guide().getByRole('button', { name: '定位本次输入与问题' }).click()
  await focused('unit:u1')
  await choose('选择编译单元', '单元 2')
  await guide().getByRole('button', { name: '去准备生成指令' }).waitFor()
  assert.equal(await page.getByRole('button', { name: '准备生成指令', exact: true }).isDisabled(), false)
  await choose('选择编译单元', '单元 1')
  compileError = '当前执行器不支持声音参考，请保留声音设计并安排后期'
  await page.getByRole('button', { name: '准备生成指令', exact: true }).click()
  await guide().getByText(compileError, { exact: true }).waitFor()
  await guide().getByRole('button').click()
  await focused('unit:u1')

  // A06/A08: a submitted review belongs to one unit and survives refresh.
  compileError = ''
  await page.getByRole('button', { name: '准备生成指令', exact: true }).click()
  await guide().getByRole('button', { name: '去检查生成指令' }).click()
  await focused('prompt-review')
  await page.getByRole('button', { name: '检查生成指令', exact: true }).click()
  await guide().getByText('本次任务正在执行', { exact: true }).waitFor()
  await page.reload()
  await guide().getByText('本次任务正在执行', { exact: true }).waitFor()
  await choose('选择编译单元', '单元 2')
  await guide().getByRole('button', { name: '去准备生成指令' }).waitFor()
  await choose('选择编译单元', '单元 1')
  await choose('选择生成指令版本', '提示词 1')
  tasks.get('review-task').status = 'succeeded'
  tasks.get('review-task').review = packet
  await guide().getByRole('button', { name: '查看指令检查结果' }).click()
  await page.getByRole('dialog', { name: '审稿结果' }).waitFor()
  const beforeApply = writes.length
  await page.getByRole('button', { name: '保存审稿结论', exact: true }).click()
  await guide().getByRole('button', { name: '核对并开始生成' }).waitFor()
  assert.equal(writes.length, beforeApply + 1)
  assert.equal(writes.some(row => row.path.endsWith('/shoot')), false)

  // New media offers a concrete review target; following it never adopts the take.
  workspace.takes = [makeWorkspace().takes[2]]
  await page.getByRole('button', { name: '刷新状态', exact: true }).click()
  await guide().getByRole('button', { name: '查看待审视频' }).click()
  await focused('take-review')
  assert.equal(new URL(page.url()).searchParams.get('take'), 't3')
  await text('尚未确认采用剪辑；候选素材和草稿不代表当前采用。')
  assert.equal(workspace.cuts.length, 0)
  // A07: asset-manager back, chapter re-entry and task-center return use actual UI routes.
  await page.getByRole('tab', { name: /2\. 生成视频素材/ }).click()
  await choose('选择编译单元', '单元 2')
  await page.waitForURL(url => url.searchParams.get('unit') === 'u2')
  await page.getByRole('link', { name: '资产管理', exact: true }).click()
  await page.waitForURL(url => url.pathname === '/assets')
  await page.goBack()
  await page.getByRole('combobox', { name: '选择编译单元' }).waitFor()
  assert.ok((await page.getByRole('combobox', { name: '选择编译单元' }).locator('../..').innerText()).includes('单元 2'))
  await page.getByRole('button', { name: '返回场次列表', exact: true }).click()
  await page.getByRole('button', { name: '进入场次', exact: true }).click()
  await page.getByRole('combobox', { name: '选择编译单元' }).waitFor()
  assert.ok((await page.getByRole('combobox', { name: '选择编译单元' }).locator('../..').innerText()).includes('单元 2'))
  await page.getByRole('button', { name: /任务中心/ }).click()
  const taskRow = page.getByText('指令回跳任务', { exact: true }).locator('../..')
  await taskRow.getByRole('button', { name: /查看/ }).click()
  await page.waitForURL(url => url.searchParams.get('task') === 'review-task')
  await text('当前定位任务')
  assert.equal(new URL(page.url()).searchParams.get('view'), 'shoot')
  assert.ok((await page.getByRole('combobox', { name: '选择编译单元' }).locator('../..').innerText()).includes('单元 1'))
  assert.equal(await page.locator('textarea[readonly]').inputValue(), '固定动作与参考')
  // Preparation inputs survive leaving; storage denial falls back to the same explicit guard.
  const beforePreparation = writes.length
  await page.getByRole('button', { name: '验证参考画面', exact: true }).click()
  const visualPrompt = page.getByRole('textbox', { name: '验证图描述' })
  await visualPrompt.fill('检查两人的站位关系')
  await page.reload()
  assert.equal(await visualPrompt.inputValue(), '检查两人的站位关系')
  await page.evaluate(() => {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) { if (key.startsWith('directing-preparation:')) throw new Error('test storage denied'); return original.call(this, key, value) }
    window.restorePreparationStorage = () => { Storage.prototype.setItem = original }
  })
  await visualPrompt.fill('尚未暂存的新想法')
  await page.getByRole('tab', { name: /1\. 设计这场戏/ }).click()
  const unsaved = page.getByRole('dialog', { name: '有未保存的修改' })
  await unsaved.getByRole('button', { name: '保存后继续' }).click()
  await unsaved.getByText('验证图准备（暂存到本浏览器）未保存成功，请处理页面中的提示后重试。').waitFor()
  assert.equal(await visualPrompt.inputValue(), '尚未暂存的新想法')
  await unsaved.getByRole('button', { name: '取消，继续编辑' }).click()
  await page.evaluate(() => window.restorePreparationStorage())
  await page.getByRole('tab', { name: /1\. 设计这场戏/ }).click()
  await unsaved.getByRole('button', { name: '保存后继续' }).click()
  await unsaved.waitFor({ state: 'hidden' })
  assert.equal(await instruction.inputValue(), '保持演员动作克制')
  await page.getByText('人物、场所与风格', { exact: true }).click()
  await page.getByRole('button', { name: '按需创建资产', exact: true }).click()
  await page.getByRole('textbox', { name: '新资产名称' }).fill('暂存的旧信')
  await page.getByRole('dialog', { name: '创建跨场复用资产' }).getByRole('button', { name: 'Close' }).click()
  await page.reload()
  await page.getByText('人物、场所与风格', { exact: true }).click()
  await page.getByRole('button', { name: '按需创建资产', exact: true }).click()
  assert.equal(await page.getByRole('textbox', { name: '新资产名称' }).inputValue(), '暂存的旧信')
  await page.getByRole('dialog', { name: '创建跨场复用资产' }).getByRole('button', { name: 'Close' }).click()
  assert.equal(writes.length, beforePreparation)
  // A return from a different browser session can recover a review's fixed identities.
  await page.evaluate(() => sessionStorage.removeItem('directing-submitted-tasks:p1:s1'))
  await page.goto(base + '?view=shoot&task=review-task&focus=tasks')
  await guide().getByRole('button', { name: '载入本任务的固定输入' }).waitFor()
  assert.equal(await page.locator('textarea[readonly]').count(), 0)
  await guide().getByRole('button', { name: '载入本任务的固定输入' }).click()
  await page.waitForURL(url => url.searchParams.get('plan') === 'p-old')
  await text('当前查看： · 计划 1 · 基线已确认，修改将派生新版本 · 固定设计依据：设计 1')
  assert.equal(await page.locator('textarea[readonly]').inputValue(), '固定动作与参考')
  await choose('选择编译单元', '单元 2')
  await page.waitForURL(url => url.searchParams.get('unit') === 'u2')
  await page.reload()
  assert.ok((await page.getByRole('combobox', { name: '选择编译单元' }).locator('../..').innerText()).includes('单元 2'))
  // A remote running task with no recoverable snapshot must never select a newer plan.
  tasks.set('remote-running', { task_id: 'remote-running', kind: 'video_generation', status: 'running', error: null, source_version: null })
  workspace.task_ids.push('remote-running')
  await page.goto(base + '?view=shoot&task=remote-running&focus=tasks')
  await guide().getByRole('button', { name: '查看定位任务' }).waitFor()
  assert.equal(await page.locator('textarea[readonly]').count(), 0)
  assert.ok(!(await page.getByRole('combobox', { name: '查看或编辑生产计划' }).locator('../..').innerText()).includes('计划 1'))


  assert.deepEqual(errors, [])
  await page.screenshot({ path: join(output, 'next-step.png'), fullPage: true })
  console.log(JSON.stringify({ result: 'UX2 first-entry, guidance, scoped blockers, task refresh, focus and business return checks passed', writes: writes.map(row => row.path), evidence: output }, null, 2))
} catch (error) {
  if (page) { await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }); console.error((await page.locator('body').innerText()).slice(-9000)) }
  console.error('Browser evidence:', output)
  throw error
} finally {
  await browser?.close()
  await server.close()
}
