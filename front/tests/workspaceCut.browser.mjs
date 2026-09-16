import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createServer } from 'vite'
import { makeWorkspace, revision, clip } from './directing-fixtures.mjs'
const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
process.chdir(root)
const output = await mkdtemp(join(tmpdir(), 'jellyfish-ux4-'))
const mediaPath = join(output, 'sample.mp4')
execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=teal:s=640x360:d=6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mediaPath])
const media = await readFile(mediaPath)
const framePath = join(output, 'frame.png')
execFileSync('ffmpeg', ['-v', 'error', '-i', mediaPath, '-frames:v', '1', framePath])
const frameImage = await readFile(framePath)
const server = await createServer({ root, server: { host: '127.0.0.1', port: 4181, strictPort: true, open: false } })
let browser, page
try {
  await server.listen()
  browser = await chromium.launch({ headless: true })
  page = await browser.newPage({ viewport: { width: 1440, height: 1050 } })
  page.setDefaultTimeout(15000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: location.origin } })
  const workspace = makeWorkspace()
  workspace.plans[0].content.units.push({ ...structuredClone(workspace.plans[0].content.units[0]), id: 'u2' })
  const initial = { items: [clip('a', 't1', 1000, 2000), clip('b', 't1', 4000, 5000, 1000), clip('c', 't2', 1000, 2000, 2000), { kind: 'planned', id: 'pre', design_revision_id: 'd1', shot_id: 'shot1', estimated_duration_ms: 300, timeline_start_ms: 3000, dialogue_cues: [] }] }
  workspace.cuts = [revision('c-active', structuredClone(initial)), revision('c-draft', structuredClone(initial), false)]
  let activeId = 'c-active'
  const feedback = { current_review_id: 'scene-review', reviews: [revision('scene-review', { cut_revision_id: 'c-active', verdict: 'pass', overall: {}, established: {}, missing_coverage: {}, usable_ranges: [], awaiting_evidence: {}, sound_status: 'pending_postproduction', sound_observation: {}, issues: [{ id: 'issue1', severity: 'optional', observation: { state: 'proposal', text: '递信动作可以再收紧' }, acceptance: {}, evidence: [{ take_id: 't1', media_range: { source_in_ms: 1200, source_out_ms: 1800 } }] }] })], repairs: [{ revision: revision('repair1', { cut_revision_id: 'c-active', item_id: 'a', problem_range: { source_in_ms: 1000, source_out_ms: 2000 }, symptom: { state: 'fact', text: '只处理递信片段' }, root_cause_hypothesis: {}, retained_ranges: [], preferred_fix: 'reshoot', alternative_fix: {}, needs_new_media: true, primary_change: {}, acceptance: {}, comparison: {}, attribution: 'unproven' }), current: true, changed_factors: [], prepared_plan_ids: [] }], knowledge: [] }
  const continuity = { frames: [], seams: [{ left_item_id: 'a', right_item_id: 'b', status: 'pass', rationale: '原接缝通过' }, { left_item_id: 'b', right_item_id: 'c', status: 'pass', rationale: '未受影响的接缝' }], units: [{ plan_revision_id: 'p-old', unit_id: 'u1', status: 'ready', errors: [] }, { plan_revision_id: 'p-old', unit_id: 'u2', status: 'ready', errors: [] }] }
  const writes = [], errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    const respond = data => route.fulfill({ json: { success: true, data: structuredClone(data) } })
    if (path.endsWith('/sources/resolve')) return respond(request.postDataJSON().sources.map(source => ({ source, status: source.kind === 'human' ? 'ready' : 'unavailable', label: source.kind === 'human' ? '人工填写' : '历史来源', description: '隔离来源记录' })))
    if (path.endsWith('/files/frame-file/download')) return route.fulfill({ body: frameImage, contentType: 'image/png' })
    if (path.endsWith('/sample.mp4') || path.includes('/files/') && path.endsWith('/download')) {
      const range = request.headers().range?.match(/bytes=(\d+)-(\d*)/)
      const start = range ? Number(range[1]) : 0
      const end = range?.[2] ? Math.min(Number(range[2]), media.length - 1) : media.length - 1
      return route.fulfill({ status: range ? 206 : 200, body: media.subarray(start, end + 1), contentType: 'video/mp4', headers: { 'accept-ranges': 'bytes', 'content-length': String(end - start + 1), ...(range ? { 'content-range': `bytes ${start}-${end}/${media.length}` } : {}) } })
    }
    if (request.method() !== 'GET') writes.push({ path, body: request.postDataJSON() })
    if (path.endsWith('/s1')) return respond(workspace)
    if (path.endsWith('/s1/feedback')) return respond({ ...feedback, active_cut_revision_id: activeId })
    if (path.endsWith('/s1/continuity')) return respond({ ...continuity, active_cut_revision_id: activeId })
    if (path.endsWith('/s1/ledger')) return respond({ workspace, continuity: { ...continuity, active_cut_revision_id: activeId }, feedback: { ...feedback, active_cut_revision_id: activeId }, actions: [], executions: [] })
    if (path.endsWith('/media')) return respond({ take_id: path.split('/').at(-2), file_id: 'media', duration_ms: 6000, url: '/api/sample.mp4' })
    if (path.endsWith('/frame')) return respond({ file_id: 'frame1', source: { kind: 'file', reference: path.split('/').at(-2), version: '1', file_id: 'media', media_range: { source_in_ms: request.postDataJSON().at_ms, source_out_ms: request.postDataJSON().at_ms + 1 } } })
    if (path.endsWith('/cut-frames')) {
      const body = request.postDataJSON(), item = workspace.cuts.find(row => row.id === body.cut_revision_id).content.items.find(row => row.id === body.item_id)
      continuity.frames.push({ id: 'frame' + continuity.frames.length, cut_revision_id: body.cut_revision_id, item_id: item.id, take_id: item.take_id, plan_revision_id: 'p-old', unit_id: 'u1', file_id: 'frame-file', media_range: item.media_range, at_ms: body.edge === 'end' ? item.media_range.source_out_ms - 1 : item.media_range.source_in_ms, edge: body.edge, current: true })
      return respond(continuity.frames.at(-1))
    }
    if (path.endsWith('/revisions')) {
      const body = request.postDataJSON()
      assert.equal(body.document.kind, 'cut')
      let row = workspace.cuts.find(item => item.id === body.revision_id)
      if (row) { assert.equal(row.confirmed_at, null); assert.equal(row.version, body.expected_version); row.content = body.document.content; row.version++ }
      else { row = revision('cut-' + workspace.cuts.length, body.document.content, false); row.parent_id = body.parent_id; workspace.cuts.push(row) }
      return respond(workspace)
    }
    if (/\/revisions\/[^/]+\/confirm$/.test(path)) {
      const row = workspace.cuts.find(item => item.id === path.split('/').at(-2))
      assert.equal(request.postDataJSON().expected_version, row.version)
      row.confirmed_at = '2026-09-15T06:00:00'; row.version++; activeId = row.id
      feedback.current_review_id = null
      feedback.repairs.push({ ...structuredClone(feedback.repairs[0]), revision: revision('repair-current', { ...structuredClone(feedback.repairs[0].revision.content), cut_revision_id: activeId }) })
      continuity.seams[0].status = 'pending'; continuity.units[0].status = 'blocked'; continuity.units[0].errors = ['前段实际区间已变化，请核对落幅参考']
      return respond(workspace)
    }
    if (path.endsWith('/repairs/repair-current/plan')) {
      const body = request.postDataJSON()
      const plan = structuredClone(workspace.plans[0].content)
      plan.units = [plan.units[0]]; plan.units[0].coverage[0].action_scope = body.action_scope; plan.units[0].duration_ms = body.duration_ms
      workspace.plans.push(revision('repair-plan', plan, false)); feedback.repairs[1].prepared_plan_ids.push('repair-plan')
      return respond(workspace)
    }
    if (path.endsWith('/film/tasks')) return respond({ items: [], next_cursor: null })
    if (/\/(styles|assets|batches)$/.test(path)) return respond([])
    return respond({ items: [], total: 0 })
  })
  const base = 'http://127.0.0.1:4181/projects/p1/chapters/ch1/sequences/s1'
  const side = () => page.getByRole('region', { name: '已确认采用侧区' })
  const openAdopted = async () => { await page.getByRole('button', { name: /^当前采用：/ }).click(); await side().waitFor() }
  const closeAdopted = async () => { await page.locator('.ant-drawer-open').getByRole('button', { name: 'Close', exact: true }).click() }
  const selectClip = async id => { await page.locator(`[data-timeline-item="${id}"]`).click(); await page.locator(`[data-workspace-target="cut-item:${id}"]`).waitFor() }
  const candidate = () => page.getByLabel('当前候选播放器', { exact: true })
  const text = value => page.getByText(value, { exact: true }).first().waitFor()
  async function choose(label, option) {
    await page.getByRole('combobox', { name: label, exact: true }).locator('../..').click()
    await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: option }).first().click()
  }
  await page.goto(base + '?view=cut&cut=c-active&take=t1')
  await page.getByRole('button', { name: '检查片段 1 与 2 接缝', exact: true }).click()
  const seamDrawer = page.locator('.ant-drawer-open').filter({ hasText: '实际接缝与连续性' })
  const seamText = () => seamDrawer.getByRole('textbox', { name: '接缝审查说明', exact: true })
  await seamText().fill('关闭抽屉后仍保留此接缝观察')
  assert.equal(await seamDrawer.locator('.cut-boundary-compare video').count(), 2)
  assert.ok((await seamDrawer.locator('.cut-boundary-compare video').first().getAttribute('src')).endsWith('#t=1.5,2'))
  assert.ok((await seamDrawer.locator('.cut-boundary-compare video').last().getAttribute('src')).endsWith('#t=4,5'))
  const closeSeam = async () => { await seamDrawer.getByRole('button', { name: 'Close', exact: true }).click(); await page.waitForFunction(() => [...document.querySelectorAll('.ant-drawer-mask')].every(el => !el.getClientRects().length || getComputedStyle(el).visibility === 'hidden')) }
  await closeSeam()
  await page.getByRole('button', { name: '检查片段 2 与 3 接缝', exact: true }).click()
  assert.equal(await seamText().inputValue(), '')
  await closeSeam()
  await page.getByRole('button', { name: '检查片段 1 与 2 接缝', exact: true }).click()
  assert.equal(await seamText().inputValue(), '关闭抽屉后仍保留此接缝观察')
  await page.screenshot({ path: join(output, 'seam-boundary-and-preserved-input.png') })
  await seamText().fill(''); await closeSeam()
  assert.equal(writes.length, 0)
  await page.goto(base + '?view=cut&cut=c-draft&take=t1')
  await openAdopted()
  await side().getByText('画面：已验收通过', { exact: true }).waitFor()
  await side().getByText('声音：待后期', { exact: true }).waitFor()
  await text('正在观看：递出旧信 · Take 1')
  await candidate().evaluate(element => new Promise(resolve => { if (element.readyState >= 1) resolve(); else element.addEventListener('loadedmetadata', resolve, { once: true }) }))
  assert.equal(await candidate().evaluate(element => element.duration), 6)
  await page.locator('[data-workspace-target="take-review"]').evaluate(element => element.scrollIntoView({ block: 'start' }))
  await page.screenshot({ path: join(output, 'candidate-and-adopted.png'), fullPage: true })
  await side().getByRole('button', { name: '整场验收与局部返工', exact: true }).click()
  await page.getByRole('button', { name: '查看问题证据 1 · 1.2–1.8 秒', exact: true }).click()
  await page.waitForURL(url => url.searchParams.get('item') === 'a' && url.searchParams.get('cut') === 'c-active')
  assert.equal(new URL(page.url()).searchParams.get('take'), 't1')
  await page.getByRole('button', { name: '返回问题与记录', exact: true }).click()
  await page.getByRole('combobox', { name: '场次验收结论' }).waitFor()
  assert.equal(new URL(page.url()).searchParams.get('feedback'), 'scene-review')
  assert.equal(writes.length, 0)
  await page.goto(base + '?view=cut&cut=c-draft&take=t1')
  await candidate().waitFor()
  await page.getByRole('spinbutton', { name: '候选入点秒数' }).fill('0.5')
  await page.getByRole('spinbutton', { name: '候选出点秒数' }).fill('1.5')
  await choose('替换草稿片段', '替换片段 1')
  await page.getByRole('button', { name: '替换剪辑草稿中的此片段', exact: true }).click()
  await page.locator('.cut-version-bar').getByText('草稿 · 未保存', { exact: true }).waitFor()
  assert.equal(writes.length, 0)
  await openAdopted()
  assert.ok((await side().innerText()).includes('源区间 1.000–2.000 秒'))
  await closeAdopted()
  assert.equal(activeId, 'c-active')
  await selectClip('a')
  await page.locator('[data-workspace-target="cut-item:a"]').getByRole('button', { name: /^下\s*移$/ }).click()
  await page.getByRole('button', { name: '保存剪辑草稿', exact: true }).click()
  assert.deepEqual(workspace.cuts[1].content.items.map(item => item.id), ['b', 'a', 'c', 'pre'])
  assert.equal(activeId, 'c-active')
  await page.reload()
  await page.getByRole('navigation', { name: '剪辑时间线' }).waitFor()
  await selectClip('a')
  assert.ok((await page.locator('[data-workspace-target="cut-item:a"]').innerText()).includes('0.50–1.50 秒'))
  assert.equal(workspace.takes.length, 3)
  await page.locator('[data-workspace-target="cut-editor"]').evaluate(element => element.scrollIntoView({ block: 'start' }))
  await page.screenshot({ path: join(output, 'mixed-timeline.png'), fullPage: true })
  await page.getByRole('button', { name: '顺序播放', exact: true }).click()
  await page.locator('video[data-playing-item="b"]').waitFor()
  await page.waitForFunction(() => document.querySelector('video[data-playing-item="b"]')?.currentTime >= 4)
  await page.locator('video[data-playing-item="b"]').evaluate(element => { element.currentTime = 5; element.dispatchEvent(new Event('timeupdate')) })
  await page.locator('video[data-playing-item="a"]').waitFor()
  await page.locator('video[data-playing-item="a"]').evaluate(element => { element.currentTime = 1.5; element.dispatchEvent(new Event('timeupdate')) })
  await page.locator('video[data-playing-item="c"]').waitFor()
  await page.locator('video[data-playing-item="c"]').evaluate(element => { element.currentTime = 2; element.dispatchEvent(new Event('timeupdate')) })
  await page.locator('[data-playing-item="pre"]').waitFor()
  await text('正在预演（预计时长）')
  await page.locator('[data-playing-item="pre"]').waitFor({ state: 'hidden' })
  // Existing media remains intact, comparison and extraction are available without adoption.
  await page.getByText('对比另一条素材', { exact: true }).click()
  await choose('对比候选素材', 'Take 2')
  await text('对比素材（不会改变当前采用区间）')
  await candidate().evaluate(async element => { if (element.readyState < 1) await new Promise(resolve => element.addEventListener('loadedmetadata', resolve, { once: true })); await new Promise(resolve => { element.addEventListener('seeked', resolve, { once: true }); element.currentTime = 1.25 }) })
  assert.equal(await candidate().evaluate(element => element.currentTime), 1.25)
  await page.getByRole('button', { name: '提取当前画面为参考', exact: true }).click()
  await page.getByText('已保存参考图，来自所选素材', { exact: false }).waitFor()
  assert.equal(writes.at(-1).body.at_ms, 1250)
  // Restore the original order before confirming, so only the changed a range affects a/b.
  await selectClip('b')
  await page.locator('[data-workspace-target="cut-item:b"]').getByRole('button', { name: /^下\s*移$/ }).click()
  await page.getByRole('button', { name: '保存剪辑草稿', exact: true }).click()
  assert.deepEqual(workspace.cuts[1].content.items.map(item => item.id), ['a', 'b', 'c', 'pre'])
  // Confirming changes the adopted sidebar, while only relevant dependencies become blocked.
  await page.getByRole('button', { name: '确认并设为当前采用', exact: true }).click()
  await openAdopted()
  await side().getByText('剪辑 2 · 已确认采用', { exact: true }).waitFor()
  await side().getByText('接缝待处理 1 项 · 依赖待复核 1 项', { exact: true }).waitFor()
  assert.equal(activeId, 'c-draft')
  assert.deepEqual(workspace.cuts[0].content, initial)
  await side().getByRole('button', { name: '检查接缝与替换影响', exact: true }).click()
  await text('计划 p-old · 单元 u1 · 待复核，不能提交')
  await text('计划 p-old · 单元 u2 · 实际依据有效')
  await page.getByRole('button', { name: '提取实际落幅', exact: true }).first().click()
  assert.equal(writes.at(-1).body.cut_revision_id, 'c-draft')
  assert.equal(writes.at(-1).body.edge, 'end')
  await page.getByRole('button', { name: '核对计划 1中的此单元', exact: true }).first().click()
  await page.waitForURL(url => url.searchParams.get('view') === 'shoot' && url.searchParams.get('unit') === 'u1')
  assert.equal(new URL(page.url()).searchParams.get('plan'), 'p-old')
  await page.getByRole('button', { name: '返回问题与记录', exact: true }).click()
  await text('依赖与替换影响')
  // A16: a historical repair returns to its exact fragment and then to the same feedback record.
  await page.goto(base + '?view=feedback&feedback=repair1')
  await page.getByRole('textbox', { name: '症状', exact: true }).waitFor()
  await page.getByRole('button', { name: '去调整采用区间 / 替换素材', exact: true }).click()
  await page.waitForURL(url => url.searchParams.get('item') === 'a' && url.searchParams.get('cut') === 'c-active')
  await page.waitForFunction(() => document.activeElement?.getAttribute('data-workspace-target') === 'cut-item:a')
  assert.equal(Number(await page.getByRole('spinbutton', { name: '候选入点秒数' }).inputValue()), 1)
  await page.getByRole('spinbutton', { name: '候选出点秒数' }).fill('1.8')
  await page.getByRole('button', { name: '替换剪辑草稿中的此片段', exact: true }).click()
  await page.getByRole('button', { name: '保存为新剪辑草稿', exact: true }).click()
  await page.locator('.cut-version-bar').getByText('草稿 · 已保存', { exact: true }).waitFor()
  assert.equal(activeId, 'c-draft')
  await page.getByRole('button', { name: '返回问题与记录', exact: true }).click()
  await page.getByRole('textbox', { name: '症状', exact: true }).waitFor()
  assert.equal(await page.getByRole('textbox', { name: '症状', exact: true }).inputValue(), '只处理递信片段')
  assert.equal(new URL(page.url()).searchParams.get('feedback'), 'repair1')
  assert.equal(await page.getByRole('button', { name: '从返工单准备局部计划草稿', exact: true }).isDisabled(), true)
  await choose('选择反馈版本', 'repair-current')
  await choose('局部补拍覆盖', '递出旧信')
  await page.keyboard.press('Escape')
  await page.getByRole('textbox', { name: '局部补拍动作' }).fill('只补递信的手部动作')
  await page.getByRole('button', { name: '从返工单准备局部计划草稿', exact: true }).click()
  await page.getByRole('button', { name: '核对补拍草稿 repair-plan', exact: true }).click()
  await page.waitForURL(url => url.searchParams.get('plan') === 'repair-plan')
  assert.equal(workspace.plans.at(-1).content.units.length, 1)
  assert.equal(activeId, 'c-draft')
  await page.getByRole('button', { name: '返回问题与记录', exact: true }).click()
  await page.getByRole('textbox', { name: '症状', exact: true }).waitFor()
  assert.equal(new URL(page.url()).searchParams.get('feedback'), 'repair-current')
  assert.equal(await page.getByRole('textbox', { name: '局部补拍动作' }).inputValue(), '只补递信的手部动作')
  // All three ledgers and their pinned business links remain read-only.
  const beforeLedger = writes.length
  await page.getByRole('button', { name: '来源与记录', exact: true }).click()
  for (const name of ['连续性账', '提示词版本账', 'Take 实验账']) await page.getByRole('tab', { name, exact: true }).click()
  await page.getByRole('link', { name: '审片此素材', exact: true }).first().click()
  await candidate().waitFor()
  await page.getByRole('button', { name: '返回问题与记录', exact: true }).click()
  await page.getByRole('tab', { name: 'Take 实验账', exact: true, selected: true }).waitFor()
  await page.waitForFunction(() => document.activeElement?.getAttribute('data-workspace-target') === 'ledger-take:t1')
  assert.equal(writes.length, beforeLedger)
  // Browsing memory keeps the exact repeated-Take clip, filters and timeline position.
  await page.goto(base + '?view=cut&cut=c-active&take=t1')
  await selectClip('b')
  await choose('候选审片筛选', '待审片')
  await choose('时间线缩放', '200%')
  const timeline = page.getByRole('navigation', { name: '剪辑时间线', exact: true })
  await page.waitForFunction(() => { const element = document.querySelector('.cut-timeline'); return element.scrollWidth > element.clientWidth })
  await timeline.evaluate(element => { element.scrollLeft = element.scrollWidth })
  const timelineLeft = await timeline.evaluate(element => element.scrollLeft)
  assert.ok(timelineLeft > 0)
  await page.waitForFunction(left => JSON.parse(JSON.parse(sessionStorage.getItem('directing-context:p1:s1') || '{}').cutTimelineScroll || '{}').left === left, timelineLeft)
  await page.reload()
  await page.locator('[data-workspace-target="cut-item:b"]').waitFor()
  await page.waitForFunction(left => Math.abs(document.querySelector('.cut-timeline').scrollLeft - left) < 2, timelineLeft)
  assert.ok((await page.getByRole('combobox', { name: '候选审片筛选', exact: true }).locator('../..').innerText()).includes('待审片'))
  assert.ok((await page.getByRole('combobox', { name: '时间线缩放', exact: true }).locator('../..').innerText()).includes('200%'))
  assert.equal(writes.length, beforeLedger)
  await page.screenshot({ path: join(output, 'restored-cut-context.png') })
  assert.equal(writes.some(row => row.path.endsWith('/shoot')), false)
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ result: 'A13–A16 mixed timeline, playback, adoption and targeted repair checks passed', evidence: output }, null, 2))
} catch (error) {
  if (page) { await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }); console.error((await page.locator('body').innerText()).slice(-6000)) }
  console.error(output); throw error
} finally { await browser?.close(); await server.close() }
