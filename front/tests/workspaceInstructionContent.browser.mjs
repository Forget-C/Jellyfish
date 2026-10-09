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
const output = await mkdtemp(join(tmpdir(), 'jellyfish-instruction-content-'))
const server = await createServer({ root, server: { host: '127.0.0.1', port: 4216, strictPort: true, open: false } })
let browser, page
try {
  await server.listen(); browser = await chromium.launch({ headless: true })
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.setDefaultTimeout(10000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: location.origin } })
  const workspace = makeWorkspace()
  workspace.plans = [workspace.plans[0]]; workspace.plans[0].content.units[0].duration_ms = 5000; workspace.cuts = []; workspace.reviews = []; workspace.task_ids = []
  workspace.prompts = [revision('prompt1', { plan_revision_id: 'p-old', unit_id: 'u1', text: '【场次试拍 v4】\n时长 5 秒，画幅 16:9。\n声音安排：待确定\n【场次背景】不追加背景动作\n【本次执行动作】\n镜头 1 [shot1]：递出旧信\nmovement_path：缓慢推进', decisions: [{ section_path: '/cinematography/0/movement_path', disposition: 'text', explanation: '当前单元摄影', text_excerpt: 'movement_path：缓慢推进' }], sources: [], format_version: 'jellyfish-scene-v4' })]
  workspace.prompts[0].content.decisions.push(...['composition', 'height_angle', 'light_sources'].map(field => ({ section_path: `/cinematography/0/${field}`, disposition: 'equivalent', explanation: '共同固定摄影依据', text_excerpt: 'movement_path：缓慢推进' })), { section_path: '/prompt/constraints', disposition: 'unexpressed', explanation: '未写入正文的固定限制' })
  workspace.prompts[0].display_number = 1
  for (const field of ['composition', 'height_angle', 'light_sources']) workspace.designs[0].content.cinematography[0][field] = { state: 'fact', text: '共同固定摄影依据', sources: [] }
  const tasks = new Map(), requests = [], writes = [], errors = [], sizes = []
  workspace.designs[0].content.cinematography[0].movement_path = { state: 'fact', text: '缓慢推进', sources: [] }
  const fields = [{ target: 'unit', path: '/duration_ms', value: 5000 }, { target: 'design', path: '/sound/execution', value: 'unknown' }, { target: 'design', path: '/cinematography/0/movement_path', value: workspace.designs[0].content.cinematography[0].movement_path }]
  const candidate = (body, id) => {
    const target = body.scope?.[0] || { target: 'unit', path: '/duration_ms' }
    const before = fields.find(field => field.target === target.target && field.path === target.path).value
    const after = target.target === 'design' ? { ...before, text: '停步后固定机位' } : 6000
    const preview_text = workspace.prompts[0].content.text.replace('movement_path：缓慢推进', 'movement_path：停步后固定机位')
    return { input_identity: id, candidate_identity: `hash-${id}`, source_prompt_revision_id: 'prompt1', preview_text, preview_decisions: [{ section_path: target.path, disposition: 'text', text_excerpt: 'movement_path：停步后固定机位', explanation: '本次单元摄影' }], changes: [{ ...target, before, after, reason: '按照本次要求', problem_keys: [] }], outcomes: [] }
  }
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
  const base = 'http://127.0.0.1:4216/projects/p1/chapters/ch1/sequences/s1?view=shoot&design=d1&plan=p-old&unit=u1&prompt=prompt1&review=&focus=review'
  await page.goto(base)
  await page.waitForFunction(() => document.activeElement?.getAttribute('data-workspace-target') === 'review')
  const content = page.getByRole('region', { name: '本次指令正文', exact: true })
  await content.getByRole('heading', { name: '摄影与运镜', exact: true }).waitFor()
  const camera = content.locator('.instruction-card').filter({ has: page.getByRole('heading', { name: '摄影与运镜', exact: true }) })
  await camera.getByRole('button', { name: '调整这部分', exact: true }).click()
  await page.getByRole('textbox', { name: '你希望怎么改？' }).fill('停步后固定机位')
  await page.reload()
  await page.waitForFunction(() => document.activeElement?.getAttribute('data-workspace-target') === 'review')
  await content.getByText('正在调整', { exact: true }).waitFor()
  assert.equal(await page.getByRole('textbox', { name: '你希望怎么改？' }).inputValue(), '停步后固定机位')
  await page.getByRole('button', { name: '生成修改方案', exact: true }).click()
  assert.deepEqual(requests[0].body.scope, [{ target: 'design', path: '/cinematography/0/movement_path' }])
  const generated = tasks.get(requests[0].id)
  await page.getByRole('textbox', { name: '你希望怎么改？' }).fill('停步后缓慢摇镜')
  await camera.getByRole('button', { name: '查看关联依据', exact: true }).click()
  const graph = page.getByRole('region', { name: '指令关联图', exact: true })
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '指令关联图')
  assert.equal(await graph.locator('.node-source').count(), 3)
  await graph.getByRole('button', { name: '展开固定依据', exact: true }).click()
  assert.equal(await graph.locator('.node-source').count(), 4)
  await graph.getByRole('button', { name: '收起固定依据', exact: true }).click()
  const sourceNode = graph.locator('.node-source').first()
  await sourceNode.focus(); await page.keyboard.press('Enter')
  assert.equal(await sourceNode.getAttribute('aria-pressed'), 'true')
  await graph.getByRole('region', { name: '关联节点详情', exact: true }).waitFor()
  assert.equal(await sourceNode.evaluate(node => document.activeElement === node), true, 'graph node has focus before candidate completion')
  generated.status = 'succeeded'; generated.revision = candidate(requests[0].body, generated.task_id)
  await graph.getByText('拟修改字段 · 待更新', { exact: true }).waitFor()
  assert.equal(await sourceNode.evaluate(node => document.activeElement === node), true, 'late candidate does not steal graph node focus')
  assert.equal(await sourceNode.getAttribute('aria-pressed'), 'true')
  assert.equal(await page.getByRole('textbox', { name: '你希望怎么改？' }).inputValue(), '停步后缓慢摇镜')
  await graph.getByRole('button', { name: '直接编辑对应字段', exact: true }).click()
  const editor = page.getByRole('region', { name: '直接编辑', exact: true })
  await editor.waitFor()
  assert.equal(await editor.getByRole('textbox').inputValue(), '缓慢推进')
  await editor.getByRole('button', { name: '收起编辑', exact: true }).click()
  assert.equal(requests.length, 1)
  const selector = content.getByRole('combobox', { name: '选择关联图内容', exact: true })
  const selectContent = async label => {
    await selector.scrollIntoViewIfNeeded(); await selector.focus(); await selector.press('ArrowDown')
    for (let index = 0; index < 20; index++) {
      if ((await page.locator('.ant-select-item-option-active').innerText()).includes(label)) { await selector.press('Enter'); return }
      await selector.press('ArrowDown')
    }
    throw new Error(`无法用键盘选择 ${label}`)
  }
  await selectContent('未写入正文')
  await graph.getByText('该依据没有可定位的正文；请查看固定依据或参考详情。', { exact: true }).waitFor()
  assert.equal(await graph.locator('.node-text').count(), 0)
  await graph.locator('.node-source').first().click()
  await graph.getByText('未写入正文的固定限制', { exact: true }).first().waitFor()
  await selectContent('固定输入')
  await graph.getByText('单元预计时长', { exact: true }).waitFor()
  await graph.getByText('单元画幅', { exact: true }).waitFor()
  await selectContent('摄影与运镜')
  await page.getByRole('textbox', { name: '你希望怎么改？' }).fill('停步后缓慢摇镜')
  await graph.getByText('拟修改字段 · 待更新', { exact: true }).waitFor()
  await graph.getByText('本次方案的冻结要求', { exact: true }).waitFor()
  await page.reload()
  await page.waitForFunction(() => document.activeElement?.getAttribute('data-workspace-target') === 'review')
  await graph.locator('.node-text').waitFor()
  assert.equal(await page.getByRole('textbox', { name: '你希望怎么改？' }).inputValue(), '停步后缓慢摇镜')
  for (const [width, height] of [[1920, 1080], [1440, 1000], [1024, 768], [768, 1024], [375, 812]]) {
    await page.setViewportSize({ width, height })
    const geometry = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth }))
    assert.ok(geometry.scroll <= geometry.width + 1)
    await page.evaluate(() => { document.querySelectorAll('.production-content, .workbench-primary-scroll').forEach(node => { node.scrollTop = 0 }) })
    await content.getByRole('heading', { name: '本次指令', exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(output, `graph-${width}.png`), fullPage: true })
  }
  await page.setViewportSize({ width: 375, height: 2200 })
  await graph.scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(output, 'graph-mobile-detail.png'), fullPage: true })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await graph.locator('.node-text').click()
  await graph.getByRole('button', { name: '定位正文卡片', exact: true }).click()
  await camera.waitFor()
  await page.waitForFunction(() => document.activeElement?.textContent === '摄影与运镜')
  await page.getByRole('button', { name: '改为整体调整', exact: true }).click()
  await page.getByRole('button', { name: '更改对象并保留输入', exact: true }).click()
  assert.equal(await page.getByRole('textbox', { name: '你希望怎么改？' }).inputValue(), '停步后缓慢摇镜')
  await content.getByText('模型原文', { exact: true }).click()
  await content.getByText(workspace.prompts[0].content.text, { exact: true }).waitFor()
  await content.getByText('结构化阅读', { exact: true }).click()
  for (const [width, height] of [[1440, 1000], [1024, 768], [768, 1024], [375, 812]]) {
    await page.setViewportSize({ width, height })
    const geometry = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth }))
    assert.ok(geometry.scroll <= geometry.width + 1)
    await page.screenshot({ path: join(output, `content-${width}.png`), fullPage: true })
  }
  assert.deepEqual(errors, [])
  assert.equal(writes.some(path => path.endsWith('/shoot') || path.endsWith('/apply')), false)
  await writeFile(join(output, 'result.json'), JSON.stringify({ requests, writes, errors }, null, 2))
  console.log(output)
} catch (error) {
  if (page) { await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }); await writeFile(join(output, 'failure.txt'), await page.locator('body').innerText()) }
  console.error(output); throw error
} finally { await browser?.close(); await server.close() }
