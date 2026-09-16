import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { makeWorkspace, revision } from './directing-fixtures.mjs'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url)); process.chdir(root)
const output = await mkdtemp(join(tmpdir(), 'jellyfish-journey-'))
execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=teal:s=640x360:d=6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(output, 'sample.mp4')])
const media = await readFile(join(output, 'sample.mp4'))
const server = await createServer({ root, server: { host: '127.0.0.1', port: 4188, strictPort: true, open: false } })
const workspace = makeWorkspace()
for (const key of ['designs','plans','prompts','reviews','takes','cuts']) workspace[key] = []
let project, chapter, sceneCreated = false, packet, activeId = null
const feedback = { active_cut_revision_id: null, current_review_id: null, reviews: [], repairs: [], knowledge: [] }
const compileRequests = [], reviewRequests = []
const loseReviewResponse = process.env.JELLYFISH_TEST_REVIEW_LOST_RESPONSE === '1'
const loseCompileResponse = process.env.JELLYFISH_TEST_COMPILE_LOST_RESPONSE === '1'
const tasks = new Map(), writes = [], errors = [], steps = []
const list = items => ({ items, total: items.length, pagination: { total: items.length, page: 1, page_size: 100, total_pages: 1 } })
let browser, page
try {
  await server.listen(); browser = await chromium.launch({ headless: true })
  page = await browser.newPage({ viewport: { width: 1586, height: 992 } }); page.setDefaultTimeout(15000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: location.origin } })
  page.on('pageerror', error => { errors.push(error.message); console.error(error.stack) })
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method()
    const body = method === 'GET' ? undefined : request.postDataJSON()
    const respond = data => route.fulfill({ json: { success: true, data: structuredClone(data) } })
    if (path.endsWith('/sources/resolve')) return respond(request.postDataJSON().sources.map(source => ({ source, status: source.kind === 'human' ? 'ready' : 'unavailable', label: source.kind === 'human' ? '人工填写' : '历史来源', description: '隔离来源记录' })))
    if (body) writes.push({ path, body })
    if (path.endsWith('/projects')) { if (body) project = { ...body, stats: { chapters: 0, roles: 0 }, created_at: '2026-09-15T00:00:00Z' }; return respond(body ? project : list(project ? [project] : [])) }
    if (project && path.endsWith(`/projects/${project.id}`)) return respond(project)
    if (path.endsWith('/chapters')) { if (body) { chapter = body; workspace.sequence.project_id = project.id; workspace.sequence.chapter_id = chapter.id }; return respond(body ? chapter : list(chapter ? [chapter] : [])) }
    if (chapter && path.endsWith(`/chapters/${chapter.id}/assembly`)) return respond({ chapter_id: chapter.id, title: chapter.title, sequences: [], transitions: [], gaps: [] })
    if (chapter && path.endsWith(`/chapters/${chapter.id}`)) return respond(path.includes('/directing/') ? { chapter_id: chapter.id, title: chapter.title, raw_text: chapter.raw_text, source_version: 1, sequences: sceneCreated ? [workspace.sequence] : [], task_ids: [] } : chapter)
    if (path.endsWith('/sequences') && body) { sceneCreated = true; workspace.sequence.title = body.title; workspace.sequence.source_text = chapter.raw_text.slice(body.span.start, body.span.end); return respond(workspace.sequence) }
    if (path.endsWith('/s1')) return respond(workspace)
    if (path.endsWith('/s1/feedback') && !body) return respond({ ...feedback, active_cut_revision_id: activeId })
    if (path.endsWith('/s1/continuity')) return respond({ active_cut_revision_id: activeId, frames: [], seams: [], units: [] })
    if (path.endsWith('/revisions') && body) {
      const group = { design: 'designs', plan: 'plans', cut: 'cuts' }[body.document.kind]
      let row = workspace[group].find(row => row.id === body.revision_id)
      if (row) { assert.equal(body.expected_version, row.version); row.content = body.document.content; row.version++ }
      else { row = revision(`${body.document.kind}-${workspace[group].length+1}`, body.document.content, false); row.project_id = project.id; row.chapter_id = chapter.id; workspace[group].push(row) }
      return respond(workspace)
    }
    if (/\/revisions\/[^/]+\/confirm$/.test(path)) {
      const id = path.split('/').at(-2), row = [...workspace.designs,...workspace.plans,...workspace.cuts].find(row => row.id === id)
      assert.equal(body.expected_version, row.version); row.confirmed_at = '2026-09-15T00:00:00Z'; row.version++
      if (workspace.cuts.includes(row)) activeId = row.id
      return respond(workspace)
    }
    if (path.endsWith('/compile')) {
      const plan = workspace.plans.find(row => row.id === body.plan_revision_id); assert.ok(plan.confirmed_at)
      compileRequests.push(body.request_id)
      assert.ok(body.request_id)
      if (!workspace.prompts.length) workspace.prompts.push(revision('prompt1', { plan_revision_id: plan.id, unit_id: body.unit_id, text: '固定拍摄范围：递出旧信，保持手部与旧信可见。', decisions: [], sources: [], format_version: 'v4' }))
      if (loseCompileResponse && compileRequests.length === 1) {
        workspace.prompts.push(revision('unrelated-prompt', { ...workspace.prompts[0].content, text: '另一次操作的指令，不能默认选择' }))
        return route.abort('failed')
      }
      return respond({ ...workspace, compiled_prompt_revision_id: 'prompt1' })
    }
    if (path.endsWith('/prompts/prompt1/review')) {
      const plan = workspace.plans[0], unit = plan.content.units[0], roles = ['direction','performance','staging','cinematography','continuity','prompt']
      packet = { mode: 'formal', roles, occurrences: [{ id: 'o1', prompt_revision_id: 'prompt1', plan_revision_id: plan.id, unit_id: unit.id, coverage_item_id: unit.coverage[0].id, shot_id: unit.coverage[0].shot_id, local_number: 1 }], rows: roles.map(role => ({ role, occurrence_id: 'o1', verdict: 'pass', rationale: '隔离回归审稿通过', findings: [] })), context: { state: 'unset' } }
      reviewRequests.push(body.request_id); assert.ok(body.request_id)
      tasks.set('review-task', { task_id: 'review-task', kind: 'directing_review', status: 'succeeded', error: null, review: packet })
      if (!workspace.task_ids.includes('review-task')) workspace.task_ids.push('review-task')
      if (loseReviewResponse && reviewRequests.length === 1) return route.abort('failed')
      return respond({ task_id: 'review-task' })
    }
    if (path.includes('/directing/tasks/')) return respond(tasks.get(path.split('/').at(-1)))
    if (path.endsWith('/review/apply')) { assert.equal(body.task_id, 'review-task'); if (!workspace.reviews.some(row => row.source_task_id === body.task_id)) workspace.reviews.push({ ...revision('review1', packet), source_task_id: body.task_id }); return respond(workspace) }
    if (path.endsWith('/shoot')) {
      assert.equal(body.prompt_revision_id, 'prompt1'); assert.equal(body.review_revision_id, 'review1'); assert.equal(activeId, null)
      const take = structuredClone(makeWorkspace().takes[2]); Object.assign(take, { id: 'take1', task_id: 'shoot-task', project_id: project.id, chapter_id: chapter.id, plan_revision_id: workspace.plans[0].id, unit_id: workspace.plans[0].content.units[0].id })
      workspace.takes.push(take); tasks.set('shoot-task', { task_id: 'shoot-task', kind: 'video_generation', status: 'succeeded', error: null }); workspace.task_ids.push('shoot-task'); return respond({ task_id: 'shoot-task' })
    }
    if (path.endsWith('/takes/take1') && body) { const take = workspace.takes[0]; assert.equal(body.expected_version, take.version); take.annotation = body.annotation; take.version++; return respond(workspace) }
    if (path.endsWith('/media')) return respond({ take_id: 'take1', file_id: 'media', duration_ms: 6000, url: '/api/sample.mp4' })
    if (path.endsWith('/sample.mp4')) {
      const range = request.headers().range?.match(/bytes=(\d+)-(\d*)/), start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(Number(range[2]), media.length-1) : media.length-1
      return route.fulfill({ status: range ? 206 : 200, body: media.subarray(start,end+1), contentType: 'video/mp4', headers: { 'accept-ranges': 'bytes', 'content-length': String(end-start+1), ...(range ? { 'content-range': `bytes ${start}-${end}/${media.length}` } : {}) } })
    }
    if (path.endsWith('/s1/feedback') && body) { assert.equal(body.document.kind, 'repair'); assert.equal(body.document.content.cut_revision_id, activeId); feedback.repairs.push({ revision: revision('repair1', body.document.content, false), current: true, changed_factors: [], prepared_plan_ids: [] }); return respond({ ...feedback, active_cut_revision_id: activeId }) }
    if (path.endsWith('/style-options')) return respond({ visual_styles: ['现实'], styles: ['真人都市'] })
    if (path.endsWith('/model-settings')) return respond({ default_video_model_id: 'model1' })
    if (path.endsWith('/models')) return respond(list([{ id: 'model1', name: '隔离视频模型', category: 'video', enabled: true }]))
    if (path.endsWith('/film/tasks')) return respond({ items: [], next_cursor: null })
    if (/\/(styles|assets|batches|categories)$/.test(path)) return respond([])
    return respond(list([]))
  })
  const record = async name => { assert.equal(await page.locator('.ant-alert-error').count(), 0, name); steps.push(name); await page.screenshot({ path: join(output, `${steps.length}.png`) }) }
  const context = async label => { await page.getByRole('button', { name: /阶段工具/ }).click(); await page.getByRole('menuitem', { name: label, exact: true }).click() }
  await page.goto('http://127.0.0.1:4188/projects')
  await page.getByRole('button', { name: /新建项目/ }).click()
  await page.getByPlaceholder('例如：现实都市爱情短剧').fill('主流程验收项目')
  await page.getByRole('button', { name: '创建并进入', exact: true }).click()
  await page.waitForURL(url => project && url.pathname === `/projects/${project.id}`)
  await record('新建项目')
  await page.getByRole('tab', { name: /章节/ }).click()
  await page.getByRole('button', { name: /新建章节/ }).click()
  await page.getByRole('textbox', { name: '章节标题', exact: true }).fill('旧信重逢')
  await page.getByRole('textbox', { name: '章节原文', exact: true }).fill('他递出旧信，她认出了他。')
  await page.getByRole('button', { name: '创建并划分场次', exact: true }).click()
  await page.getByRole('button', { name: '手动新建场次', exact: true }).click()
  await page.getByRole('button', { name: '创建并进入场次', exact: true }).click()
  await page.getByRole('button', { name: '手动起稿', exact: true }).click()
  await page.getByRole('button', { name: '分镜 1', exact: true }).click()
  await page.getByRole('textbox', { name: '可见结果', exact: true }).fill('他把旧信递到她手边')
  await page.getByRole('textbox', { name: '叙事作用', exact: true }).fill('让她认出笔迹')
  await page.getByRole('button', { name: '保存设计草稿', exact: true }).click()
  await page.getByRole('button', { name: '确认本轮设计', exact: true }).click()
  await page.getByRole('button', { name: '准备试拍 →', exact: true }).waitFor()
  assert.ok(workspace.designs[0].confirmed_at); await record('章节原文、场次与设计确认')
  await page.getByRole('button', { name: '准备试拍 →', exact: true }).click()
  await page.getByRole('region', { name: '试拍准备起点' }).getByRole('checkbox').first().check()
  await page.getByRole('button', { name: /建立试拍草稿/ }).click()
  await page.getByRole('combobox', { name: '视频模型', exact: true }).locator('../..').click()
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: '隔离视频模型' }).click()
  await page.getByRole('button', { name: '保存并确认拍摄准备', exact: true }).click()
  await page.getByRole('button', { name: '生成试拍指令', exact: true }).click()
  if (loseCompileResponse) {
    await page.getByRole('button', { name: '核实本次指令生成', exact: true }).waitFor()
    await page.reload()
    await page.getByRole('button', { name: '核实本次指令生成', exact: true }).click()
    await page.waitForURL(url => url.searchParams.get('prompt') === 'prompt1')
    assert.equal(compileRequests.length, 2)
    assert.equal(compileRequests[0], compileRequests[1])
    assert.equal(workspace.prompts.length, 2, '恢复原结果，不重复编译，也不选择并发生成的其他版本')
  }
  await page.locator('.shoot-prompt-excerpt').waitFor()
  assert.equal(await page.getByRole('tab', { name: '指令与检查', exact: true }).getAttribute('aria-selected'), 'true')
  const compiledPrompt = new URL(page.url()).searchParams.get('prompt')
  assert.ok(compiledPrompt)
  await page.locator('.production-unit-list button[aria-pressed="true"]').click()
  assert.equal(new URL(page.url()).searchParams.get('prompt'), compiledPrompt, '再次点击当前单元保留已选指令')
  await page.getByRole('button', { name: '检查这份指令', exact: true }).click()
  if (loseReviewResponse) {
    await page.getByRole('button', { name: '核实本次检查', exact: true }).waitFor()
    await page.reload()
    await page.getByRole('button', { name: '核实本次检查', exact: true }).click()
    await page.getByRole('button', { name: '确认结论，进入试拍', exact: true }).waitFor()
    assert.equal(reviewRequests.length, 2)
    assert.equal(reviewRequests[0], reviewRequests[1])
    assert.equal(workspace.task_ids.filter(id => id === 'review-task').length, 1)
    assert.equal(workspace.reviews.length, 0, '恢复检查不自动保存结论或开始试拍')
    assert.equal(workspace.takes.length, 0)
  }
  await page.getByRole('region', { name: '本次检查结论', exact: true }).waitFor()
  await page.getByRole('button', { name: '确认结论，进入试拍', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('[role=tab][aria-selected=true]') !== null && new URL(location.href).searchParams.get('focus') === 'shoot-confirm')
  assert.equal(await page.getByRole('button', { name: '生成试拍指令', exact: true }).count(), 0)
  assert.equal(await page.getByRole('tab', { name: '执行试拍', exact: true }).getAttribute('aria-selected'), 'true')
  assert.equal(workspace.takes.length, 0, '确认检查结论不能自动生成视频')
  const confirmedReview = new URL(page.url()).searchParams.get('review')
  await page.locator('.production-unit-list button[aria-pressed="true"]').click()
  assert.equal(new URL(page.url()).searchParams.get('review'), confirmedReview, '再次点击当前单元保留已选审稿')
  await page.getByRole('button', { name: '开始试拍', exact: true }).click()
  await page.getByRole('tab', { name: '候选素材', exact: true }).click()
  await page.getByRole('button', { name: '查看视频 1 · 待审片', exact: true }).waitFor()
  await page.getByRole('button', { name: '任务中心', exact: true }).click()
  await page.getByRole('button', { name: '查看本场任务与业务结果', exact: true }).click()
  await page.locator('[data-task-id="shoot-task"]').getByRole('button', { name: '查看视频 1 · 待审片', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('.ant-drawer-open'))
  await page.getByLabel('当前候选播放器', { exact: true }).evaluate(video => new Promise(resolve => { if (video.readyState >= 2) resolve(); else video.addEventListener('loadeddata', resolve, { once: true }) }))
  assert.equal(activeId, null); await record('单元确认、编译审稿与生成候选')
  await page.getByRole('textbox', { name: '实际观察', exact: true }).fill('递信动作清楚，保留中间区间')
  await page.getByRole('button', { name: '保存审片', exact: true }).click()
  await page.getByRole('spinbutton', { name: '候选入点秒数', exact: true }).fill('1')
  await page.getByRole('spinbutton', { name: '候选出点秒数', exact: true }).fill('4')
  await page.getByRole('button', { name: '把这一段加入剪辑草稿', exact: true }).click()
  await page.getByRole('button', { name: '保存剪辑草稿', exact: true }).click()
  assert.equal(activeId, null)
  await page.getByRole('button', { name: '确认并设为当前采用', exact: true }).click()
  await page.getByRole('button', { name: '当前采用：剪辑 1', exact: true }).waitFor()
  assert.deepEqual(workspace.cuts[0].content.items[0].media_range, { source_in_ms: 1000, source_out_ms: 4000 })
  await record('审片、精确区间与确认粗剪')
  await context('验收与局部返工')
  await page.getByRole('button', { name: '新建最小返工单', exact: true }).click()
  await page.getByRole('textbox', { name: '症状', exact: true }).fill('入点稍早，只调整此片段')
  await page.getByRole('button', { name: '保存反馈草稿', exact: true }).click()
  await page.waitForURL(url => url.searchParams.get('feedback') === 'repair1')
  await page.getByText('实际输入变化：尚无可比较新输入', { exact: true }).waitFor()
  assert.equal(feedback.repairs[0].revision.content.item_id, workspace.cuts[0].content.items[0].id)
  assert.equal(feedback.repairs[0].revision.content.cut_revision_id, activeId)
  await record('局部返工保留片段与采用身份')
  assert.deepEqual(errors, [])
  await writeFile(join(output, 'results.json'), JSON.stringify({ steps, writes, errors }, null, 2)); console.log(JSON.stringify({ output, steps }, null, 2))
} catch (error) { if (page) { console.log(await page.locator('body').innerText()); await page.screenshot({ path: join(output, 'failure.png') }) }; console.log('Browser evidence:', output); throw error }
finally { await browser?.close(); await server.close() }
