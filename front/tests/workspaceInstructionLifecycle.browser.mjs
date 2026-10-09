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
const output = await mkdtemp(join(tmpdir(), 'jellyfish-instruction-lifecycle-'))
const server = await createServer({ root, server: { host: '127.0.0.1', port: 4196, strictPort: true, open: false } })
let browser, page
try {
  await server.listen(); browser = await chromium.launch({ headless: true })
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.setDefaultTimeout(10000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: location.origin } })
  const workspace = makeWorkspace()
  workspace.plans = [workspace.plans[0]]; workspace.plans[0].content.units[0].duration_ms = 5000; workspace.cuts = []; workspace.reviews = []; workspace.task_ids = []
  workspace.prompts = [revision('prompt1', { plan_revision_id: 'p-old', unit_id: 'u1', text: '原指令全文', decisions: [], sources: [], format_version: 'jellyfish-scene-v4' })]
  const tasks = new Map(), requests = [], writes = [], errors = [], sizes = []
  const fields = [{ target: 'unit', path: '/duration_ms', value: 5000 }, { target: 'design', path: '/sound/execution', value: 'unknown' }]
  const candidate = (body, id) => body.instruction === '需要同期声音' ? { input_identity: id, candidate_identity: `hash-${id}`, changes: [], outcomes: [], summary: { status: 'needs_choice', reason: '请选择声音制作方式。', choices: ['声音由后期添加', '使用支持声音的模型同期生成'] } } : body.instruction === '保持不变' ? { input_identity: id, candidate_identity: `hash-${id}`, changes: [], outcomes: [], summary: { status: 'unchanged', reason: '当前指令已满足保持不变的要求。', choices: [] } } : ({ input_identity: id, candidate_identity: `hash-${id}`, source_prompt_revision_id: 'prompt1', preview_text: '预览新指令：时长6秒，镜头保持固定。', changes: body.edits?.length ? body.edits.map(edit => ({ ...edit, reason: '人工指定修改', problem_keys: [] })) : [{ target: 'unit', path: '/duration_ms', before: 5000, after: 6000, reason: '依照本次要求', problem_keys: [] }], outcomes: [] })
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    const respond = data => route.fulfill({ json: { success: true, data: structuredClone(data) } })
    if (request.method() !== 'GET') writes.push(path)
    if (path.endsWith('/s1')) return respond(workspace)
    if (path.includes('/directing/tasks/')) return respond(tasks.get(path.split('/').at(-1)))
    if (path.endsWith('/review-revisions/fields')) return respond({ prompt_revision_id: 'prompt1', fields })
    if (path.endsWith('/review-revisions') || path.endsWith('/review-revisions/preview')) {
      const body = request.postDataJSON(), id = `revision-${requests.length + 1}`
      requests.push({ path, body, id })
      tasks.set(id, { task_id: id, kind: 'directing_review_revision', status: requests.length === 1 ? 'running' : 'succeeded', revision_request: body, revision: requests.length === 1 ? null : candidate(body, id) })
      workspace.task_ids.push(id)
      return respond({ task_id: id })
    }
    if (path.endsWith('/review-revisions/apply')) {
      const body = request.postDataJSON()
      assert.equal(body.candidate_identity, `hash-${body.task_id}`)
      assert.equal(body.edits[0].after, 6000)
      const plan = revision('plan-next', structuredClone(workspace.plans[0].content))
      plan.content.units[0].duration_ms = 6000
      workspace.plans.push(plan)
      workspace.prompts.push(revision('prompt-next', { ...workspace.prompts[0].content, plan_revision_id: plan.id, text: tasks.get(body.task_id).revision.preview_text }))
      const result = { task_id: body.task_id, request_id: body.request_id, stage: 'reviewing', plan_revision_id: plan.id, prompt_revision_id: 'prompt-next', review_task_id: 'review-next' }
      tasks.get(body.task_id).revision_application = result
      tasks.set('review-next', { task_id: 'review-next', kind: 'directing_review', status: 'running', workspace_context: { plan_revision_id: plan.id, unit_id: 'u1', prompt_revision_id: 'prompt-next' } })
      workspace.task_ids.push('review-next')
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
  const base = 'http://127.0.0.1:4196/projects/p1/chapters/ch1/sequences/s1?view=shoot&design=d1&plan=p-old&unit=u1&prompt=prompt1&review=&focus=review'
  await page.goto(base)
  // 主编辑器无需打开抽屉即可输入，检查结论在固定侧栏。
  await page.getByRole('textbox', { name: '你希望怎么改？' }).waitFor()
  await page.getByRole('complementary', { name: '指令检查' }).waitFor()
  assert.equal(await page.getByText('原指令全文', { exact: true }).isVisible(), true)
  assert.equal(await page.getByText('技术详情', { exact: true }).isVisible(), false)
  for (const [width, height] of [[1440, 1000], [1024, 768], [768, 1024], [375, 812]]) {
    await page.setViewportSize({ width, height })
    const geometry = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth }))
    assert.ok(geometry.scroll <= geometry.width + 1)
    sizes.push(geometry); await page.screenshot({ path: join(output, `default-${width}.png`), fullPage: true })
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByRole('textbox', { name: '你希望怎么改？' }).fill('镜头保持固定，延长到6秒。')
  await page.getByRole('button', { name: '生成修改方案', exact: true }).click()
  assert.equal(requests[0].body.review_source ?? null, null)
  assert.deepEqual(requests[0].body.directions, [])
  await page.getByRole('button', { name: '查看完整指令', exact: true }).click()
  Object.assign(tasks.get(requests[0].id), { status: 'succeeded', revision: candidate(requests[0].body, requests[0].id) })
  await page.waitForTimeout(2800)
  // 异步结果只更新内联预览，不抢占正在阅读的正文。
  assert.equal(await page.getByRole('button', { name: '关闭指令详情' }).isVisible(), true)
  await page.getByRole('button', { name: '关闭指令详情' }).click()
  assert.equal(await page.getByRole('region', { name: '修改方案', exact: true }).count(), 1)
  await page.getByRole('button', { name: '采用并重新检查', exact: true }).waitFor()
  assert.equal(await page.getByText('预览新指令：时长6秒，镜头保持固定。', { exact: true }).isVisible(), false)
  await page.getByText('查看新指令全文', { exact: true }).click()
  await page.getByText('预览新指令：时长6秒，镜头保持固定。', { exact: true }).waitFor()
  // 同一草稿改为人工字段预览；无需 AI 调用或展开技术详情。
  await page.getByRole('textbox', { name: '你希望怎么改？' }).fill('')
  await page.getByRole('button', { name: '直接编辑', exact: true }).click()
  await page.getByRole('textbox', { name: '时长（秒）', exact: true }).fill('6')
  await page.getByRole('button', { name: '收起编辑', exact: true }).click()
  await page.getByRole('button', { name: '直接编辑', exact: true }).click()
  assert.equal(await page.getByRole('textbox', { name: '时长（秒）', exact: true }).inputValue(), '6')
  await page.getByRole('button', { name: '更新修改方案', exact: true }).click()
  assert.ok(requests[1].path.endsWith('/preview'))
  assert.equal(requests[1].body.edits[0].before, 5000)
  assert.equal(requests[1].body.edits[0].after, 6000)
  await page.getByRole('button', { name: '采用并重新检查', exact: true }).click()
  await page.getByRole('region', { name: '检查进度', exact: true }).waitFor()
  assert.equal(workspace.prompts.length, 2)
  await page.getByRole('button', { name: '历史记录', exact: true }).click()
  await page.getByText('从上一版修改而来', { exact: true }).waitFor()
  await page.getByRole('button', { name: '查看修订前指令', exact: true }).click()
  await page.getByText('历史预览', { exact: true }).first().waitFor()
  assert.ok(page.url().includes('prompt=prompt-next'))
  const historyRequests = requests.length
  await page.getByRole('tab', { name: '历史关联图', exact: true }).click()
  const historyGraph = page.getByRole('region', { name: '完整指令要求关系', exact: true })
  await historyGraph.waitFor()
  await historyGraph.locator('[data-canvas-type="camera"]').first().click()
  assert.equal(await historyGraph.getByRole('button', { name: '调整此要求', exact: true }).count(), 0)
  assert.equal(await historyGraph.getByRole('button', { name: '前往导演设计核对', exact: true }).count(), 0)
  await historyGraph.locator('summary').filter({ hasText: '全部固定输入' }).click()
  await historyGraph.getByText('5 秒', { exact: true }).waitFor()
  assert.ok(page.url().includes('prompt=prompt-next'), 'historical graph does not switch the working prompt')
  assert.equal(requests.length, historyRequests, 'historical graph does not request revisions')
  await page.getByRole('button', { name: '切换到此版本', exact: true }).click()
  await page.waitForURL(url => url.searchParams.get('plan') === 'p-old')
  // 全通过检查也允许主动修改，仍精确绑定原检查来源。
  const roles = ['direction', 'performance', 'staging', 'cinematography', 'continuity', 'prompt']
  workspace.reviews.push(revision('review-pass', { mode: 'formal', roles, occurrences: [{ id: 'o1', prompt_revision_id: 'prompt1', plan_revision_id: 'p-old', unit_id: 'u1', coverage_item_id: 'cover1', shot_id: 'shot1', local_number: 1 }], rows: roles.map(role => ({ role, occurrence_id: 'o1', verdict: 'pass', rationale: '一致', findings: [] })), context: { state: 'unset' } }))
  await page.goto(base.replace('review=&', 'review=review-pass&'))
  await page.getByRole('textbox', { name: '你希望怎么改？' }).fill('再延长一秒')
  await page.getByRole('button', { name: '生成修改方案', exact: true }).click()
  assert.equal(requests.at(-1).body.review_source.id, 'review-pass')
  await page.getByRole('button', { name: '采用并重新检查', exact: true }).waitFor()
  await page.getByRole('textbox', { name: '你希望怎么改？' }).fill('保持不变')
  await page.getByRole('button', { name: '更新修改方案', exact: true }).click()
  await page.getByRole('region', { name: '整体修改结果' }).getByText('当前指令已满足保持不变的要求。', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '采用并重新检查', exact: true }).count(), 0)
  assert.equal(workspace.prompts.length, 2)
  await page.getByRole('button', { name: '更新修改方案', exact: true }).waitFor()
  await page.getByRole('textbox', { name: '你希望怎么改？' }).fill('需要同期声音')
  await page.getByRole('button', { name: '更新修改方案', exact: true }).click()
  await page.getByRole('button', { name: '使用支持声音的模型同期生成', exact: true }).click()
  await page.waitForURL(url => url.searchParams.get('focus') === 'unit-model:u1')
  assert.ok(await page.evaluate(() => Object.values(sessionStorage).some(value => value.includes('使用支持声音的模型同期生成') && value.includes('generated'))))
  assert.equal(writes.some(path => path.endsWith('/shoot')), false)
  assert.deepEqual(errors, [])
  await writeFile(join(output, 'result.json'), JSON.stringify({ sizes, requests, writes, errors }, null, 2))
  console.log(output)
} catch (error) {
  if (page) { await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }); await writeFile(join(output, 'failure.txt'), await page.locator('body').innerText()) }
  console.error(output); throw error
} finally { await browser?.close(); await server.close() }
