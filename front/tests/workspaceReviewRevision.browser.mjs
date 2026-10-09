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
const output = await mkdtemp(join(tmpdir(), 'jellyfish-review-revision-'))
const server = await createServer({ root, server: { host: '127.0.0.1', port: 4197, strictPort: true, open: false } })
let browser
try {
  await server.listen(); browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.setDefaultTimeout(10000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: location.origin } })
  const workspace = makeWorkspace()
  workspace.plans = [workspace.plans[0]]; workspace.cuts = []; workspace.reviews = []
  workspace.prompts = [revision('prompt1', { plan_revision_id: 'p-old', unit_id: 'u1', text: '固定原指令', decisions: [], sources: [], format_version: 'jellyfish-scene-v4' })]
  workspace.designs[0].content.prompt.binding_requirements = { state: 'proposal', text: '全场人物要求', sources: [] }
  const roles = ['direction', 'performance', 'staging', 'cinematography', 'continuity', 'prompt']
  const packet = { mode: 'formal', roles, occurrences: [{ id: 'o1', prompt_revision_id: 'prompt1', plan_revision_id: 'p-old', unit_id: 'u1', coverage_item_id: 'cover1', shot_id: 'shot1', local_number: 1 }], rows: roles.map(role => ({ role, occurrence_id: 'o1', verdict: role === 'prompt' ? 'revise' : 'pass', rationale: role === 'prompt' ? '空镜不应出现人物' : '一致', findings: role === 'prompt' ? [{ observation: '空镜与人物要求冲突', affected_paths: ['/prompt/binding_requirements'], suggestion: { state: 'proposal', text: '按镜头约束人物', sources: [] }, acceptance: { state: 'proposal', text: '空镜无人物', sources: [] } }] : [] })), context: { state: 'unset' } }
  workspace.reviews = [revision('review1', packet), revision('review2', structuredClone(packet))]
  workspace.task_ids = []
  const writes = [], errors = [], requests = [], applications = [], sizes = []
  const tasks = new Map()
  const originalReview = structuredClone(workspace.reviews[0])
  let applyCount = 0, releaseApply
  const firstApply = new Promise(resolve => { releaseApply = resolve })
  const candidate = (body, id) => ({ input_identity: id, candidate_identity: 'candidate-' + id, preview_text: '新指令：本镜头只拍空镜，声音由后期制作', source_prompt_revision_id: body.prompt_revision_id, changes: [{ target: 'design', path: '/prompt/binding_requirements', before: { state: 'proposal', text: '全场人物要求', sources: [] }, after: { state: 'proposal', text: '本镜头只拍空镜，后续人物镜头保留动作', sources: [] }, reason: '按当前镜头约束可见人物', problem_keys: ['["o1","prompt",0]'] }], outcomes: [{ problem_key: '["o1","prompt",0]', status: id === 'revision2' ? 'needs_choice' : 'planned', reason: id === 'revision2' ? '请选择声音安排' : body.directions[0].text || '按空镜意图修订', choices: id === 'revision2' ? ['声音由后期添加', '使用支持声音的模型同期生成'] : [] }] })
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    const respond = data => route.fulfill({ json: { success: true, data: structuredClone(data) } })
    if (request.method() !== 'GET') writes.push(path)
    if (path.endsWith('/s1')) return respond(workspace)
    if (path.includes('/directing/tasks/')) return respond(tasks.get(path.split('/').at(-1)))
    if (path.endsWith('/review-revisions/fields')) return respond({ prompt_revision_id: 'prompt1', fields: [{ target: 'unit', path: '/duration_ms', value: workspace.plans[0].content.units[0].duration_ms }, { target: 'design', path: '/sound/execution', value: 'unknown' }, { target: 'design', path: '/prompt/binding_requirements', value: workspace.designs[0].content.prompt.binding_requirements }] })
    if (path.endsWith('/review-revisions')) {
      const body = request.postDataJSON(); requests.push(body)
      const id = `revision${requests.length}`
      tasks.set(id, { task_id: id, kind: 'directing_review_revision', status: requests.length === 1 ? 'running' : 'succeeded', error: null, revision_request: body, revision: requests.length === 1 ? null : candidate(body, id) })
      workspace.task_ids.push(id)
      return respond({ task_id: id })
    }
    if (path.endsWith('/review-revisions/apply')) {
      const body = request.postDataJSON(); applications.push(body); applyCount += 1
      const result = { task_id: body.task_id, request_id: body.request_id, stage: applyCount === 1 ? 'blocked' : 'reviewing', design_revision_id: 'd-revised', plan_revision_id: 'plan-revised', prompt_revision_id: applyCount === 1 ? null : 'prompt-revised', review_task_id: applyCount === 1 ? null : 'review-revised', error: applyCount === 1 ? '参考核对暂时失败，已保存修订' : null }
      tasks.get(body.task_id).revision_application = result
      if (!workspace.plans.some(row => row.id === 'plan-revised')) {
        workspace.designs.push(revision('d-revised', structuredClone(workspace.designs[0].content)))
        workspace.plans.push(revision('plan-revised', { ...structuredClone(workspace.plans[0].content), design_revision_id: 'd-revised' }))
      }
      if (applyCount > 1 && !workspace.prompts.some(row => row.id === 'prompt-revised')) {
        workspace.prompts.push(revision('prompt-revised', { ...structuredClone(workspace.prompts[0].content), plan_revision_id: 'plan-revised' }))
        tasks.set('review-revised', { task_id: 'review-revised', kind: 'directing_review', status: 'running', error: null })
        workspace.task_ids.push('review-revised')
      }
      if (applyCount === 1) await firstApply
      if (applyCount === 2) return route.abort('failed')
      return respond(result)
    }
    if (path.endsWith('/sources/resolve')) return respond([])
    if (path.endsWith('/feedback')) return respond({ reviews: [], repairs: [], knowledge: [] })
    if (path.endsWith('/models/model1')) return respond({ id: 'model1', name: '视频模型 A', category: 'video' })
    if (path.endsWith('/models')) return respond({ items: [{ id: 'model1', name: '视频模型 A', category: 'video' }], total: 1 })
    if (path.endsWith('/model-settings')) return respond({ default_video_model_id: 'model1' })
    if (path.endsWith('/film/tasks')) return respond({ items: [], next_cursor: null })
    if (/\/(assets|styles|batches|categories)$/.test(path)) return respond([])
    return respond({ items: [], total: 0 })
  })
  const base = 'http://127.0.0.1:4197/projects/p1/chapters/ch1/sequences/s1?view=shoot&design=d1&plan=p-old&unit=u1&prompt=prompt1&review=review1&focus=review'
  await page.goto(base)
  // 主区保持简洁；调整入口独立于完整指令、检查明细与技术诊断。
  await page.getByRole('region', { name: '修改方案', exact: true }).waitFor()
  const direction = page.getByRole('textbox', { name: '你希望怎么改？' })
  await direction.fill('保留后面人物动作')
  await page.getByRole('button', { name: '加入修改要求', exact: true }).click()
  await page.waitForFunction(() => document.getElementById('revision-instruction')?.value === '保留后面人物动作\n按镜头约束人物')
  assert.equal(await direction.inputValue(), '保留后面人物动作\n按镜头约束人物')
  assert.equal(await direction.evaluate(node => document.activeElement === node), true)
  // 建议只消费一次；切换步骤重新挂载编辑区时不重复加入。
  await page.getByRole('tab', { name: /拍摄准备/ }).click()
  await page.getByRole('tab', { name: /指令与检查/ }).click()
  assert.equal(await direction.inputValue(), '保留后面人物动作\n按镜头约束人物')
  await direction.fill('本镜头只拍空镜，保留后面人物动作')
  await page.reload()
  assert.equal(await direction.inputValue(), '本镜头只拍空镜，保留后面人物动作')
  assert.equal(writes.length, 0)
  // 浏览器存储失败时，切换检查必须先处理未保存方向，不能卸载后丢失输入。
  await page.evaluate(() => { window.__originalSetItem = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (key.startsWith('directing-preparation:')) throw new Error('storage full'); return window.__originalSetItem.call(this, key, value) } })
  await direction.fill('尚未保存的重要方向')
  await page.getByRole('button', { name: '检查记录 · 2', exact: true }).click()
  await page.getByRole('button', { name: '选择此检查', exact: true }).nth(1).click()
  await page.getByRole('dialog').getByText('有未保存的修改', { exact: true }).waitFor()
  await page.getByRole('button', { name: '取消，继续编辑', exact: true }).click()
  assert.equal(await direction.inputValue(), '尚未保存的重要方向')
  await page.evaluate(() => { Storage.prototype.setItem = window.__originalSetItem })
  await direction.fill('')
  await page.getByRole('button', { name: '生成修改方案', exact: true }).click()
  await page.getByText('AI 正在核对问题与处理方向…').waitFor()
  assert.equal(requests[0].directions[0].text, '')
  // 生成中修改方向：返回的旧结果不能采用；清空输入不会自动折叠。
  await direction.fill('不要人物，保留后续动作')
  Object.assign(tasks.get('revision1'), { status: 'succeeded', revision: candidate(requests[0], 'revision1') })
  await page.getByRole('region', { name: '修改方案', exact: true }).waitFor()
  await page.getByRole('button', { name: '更新修改方案', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '采用并重新检查', exact: true }).count(), 0)
  await page.getByRole('button', { name: '更新修改方案', exact: true }).click()
  await page.getByRole('button', { name: '声音由后期添加', exact: true }).click()
  await page.getByRole('button', { name: '更新修改方案', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '采用并重新检查', exact: true }).count(), 0)
  await page.getByRole('button', { name: '更新修改方案', exact: true }).click()
  await page.getByRole('button', { name: '采用并重新检查', exact: true }).click({ trial: true })
  assert.equal(requests[2].directions[0].sound_execution, 'postproduction')
  assert.equal(workspace.plans.length, 1)
  await page.getByRole('heading', { name: '本次将修改 1 处' }).waitFor()
  for (const [width, height] of [[1440, 1000], [1024, 768], [768, 1024], [375, 812]]) {
    await page.setViewportSize({ width, height })
    const adopt = page.getByRole('button', { name: '采用并重新检查', exact: true })
    await adopt.scrollIntoViewIfNeeded()
    await adopt.click({ trial: true })
    const geometry = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth }))
    assert.ok(geometry.scroll <= geometry.width + 1, JSON.stringify(geometry))
    sizes.push({ width, height, ...geometry })
    await page.screenshot({ path: join(output, `proposal-${width}.png`), fullPage: true })
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByRole('button', { name: '采用并重新检查', exact: true }).click()
  await page.locator('fieldset[aria-busy="true"]').first().waitFor()
  releaseApply()
  await page.getByRole('region', { name: '修改方案', exact: true }).getByText('参考核对暂时失败，已保存修订', { exact: true }).waitFor()
  await page.getByRole('region', { name: '修改方案', exact: true }).getByRole('button', { name: /继续生成指令|查看本次检查|查询上次结果/ }).click()
  await page.getByRole('region', { name: '修改方案', exact: true }).getByRole('button', { name: /继续生成指令|查看本次检查|查询上次结果/ }).waitFor()
  await page.waitForTimeout(300)
  await page.reload()
  await page.getByRole('region', { name: '修改方案', exact: true }).getByRole('button', { name: /继续生成指令|查看本次检查|查询上次结果/ }).click()
  await page.getByRole('region', { name: '检查进度', exact: true }).getByText('进行中', { exact: true }).waitFor()
  assert.equal(new Set(applications.map(body => body.request_id)).size, 1)
  assert.equal(workspace.plans.length, 2)
  assert.deepEqual(workspace.reviews[0], originalReview)
  assert.equal(new URL(page.url()).searchParams.get('plan'), 'plan-revised')
  assert.equal(new URL(page.url()).searchParams.get('design'), 'd-revised')
  assert.ok((await page.locator('.production-version-bar').innerText()).includes('计划 2'))
  const beforeVersions = writes.length
  await page.locator('.workspace-versions-entry').click()
  await page.getByRole('dialog', { name: '版本与依据', exact: true }).locator('tr[data-row-key="plan-revised"]').getByText('计划 2', { exact: true }).waitFor()
  await page.getByRole('dialog', { name: '版本与依据', exact: true }).getByRole('button', { name: /^关\s*闭$/ }).click()
  await page.getByRole('dialog', { name: '版本与依据', exact: true }).waitFor({ state: 'hidden' })
  assert.equal(writes.length, beforeVersions)
  await page.getByRole('button', { name: '历史记录', exact: true }).click()
  await page.getByRole('button', { name: '返回原计划查看候选', exact: true }).click()
  await page.waitForURL(url => url.searchParams.get('plan') === 'p-old' && url.searchParams.get('prompt') === 'prompt1' && url.searchParams.get('review') === 'review1' && url.searchParams.get('focus') === 'shoot-confirm')
  assert.equal(writes.some(path => path.endsWith('/shoot')), false)
  assert.deepEqual(errors, [])
  await writeFile(join(output, 'result.json'), JSON.stringify({ writes, errors, sizes, requests, applications }, null, 2))
  console.log(output)
} finally { await browser?.close(); await server.close() }
