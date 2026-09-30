import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'vite'
import { makeWorkspace } from './directing-fixtures.mjs'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url)); process.chdir(root)
const port = 4211
const server = await createServer({ root, server: { host: '127.0.0.1', port, strictPort: true, open: false } })
const evidence = await mkdtemp(join(tmpdir(), 'jellyfish-whole-division-'))
const raw = '前😀段。后段。尾段。'
const chapter = { chapter_id: 'ch1', title: '整章验收', raw_text: raw, source_version: 'v1', task_ids: [], sequences: [[0, 4], [4, 7], [7, 10]].map(([start, end], i) => ({ id: `s${i + 1}`, chapter_id: 'ch1', project_id: 'p1', title: ['前场', '后场', '尾场'][i], position: i, span: { start, end }, source_text: [...raw].slice(start, end).join(''), source: { kind: 'chapter', reference: 'ch1', version: 'v1' }, source_changed: false, is_current: true, version: 1 })) }
chapter.current_version = { id: 'v1', number: 1 }
const versions = new Map([['v1', structuredClone(chapter)]])
const history = [], receipts = new Map(), puts = [], previews = [], errors = [], tasks = new Map()
let loseResponse = false, failSave = false, failPreview = false, seq = 4, legacyWrites = 0, analyses = 0
const snapshot = () => structuredClone(chapter)
const impact = draft => [...draft.members.map((after, position) => {
  const before = chapter.sequences.find(row => row.id === after.sequence_id) || null
  const changes = !before ? ['added'] : [before.title !== after.title && 'title', before.position !== position && 'position', JSON.stringify(before.span) !== JSON.stringify(after.span) && 'range', after.reconfirm_source && 'source'].filter(Boolean)
  return { key: after.key, before, after, changes, design_count: before ? 2 : 0, plan_count: 0, take_count: before ? 1 : 0, cut_count: 0, active_cut_revision_id: null }
}), ...draft.exited_sequence_ids.map(id => ({ key: id, before: chapter.sequences.find(row => row.id === id), after: null, changes: ['exited'], design_count: 2, plan_count: 0, take_count: 1, cut_count: 0, active_cut_revision_id: null }))]
let failedHistoryReads = 0, failedVersionReads = 0, versionReads = 0, emptyHistory = false
const historyPages = []
let failedAnalysisReads = 0
let deferredAnalysis, deferredVersion
let browser, page
try {
  await server.listen(); browser = await chromium.launch({ headless: true })
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(10000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: location.origin } })
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname
    const respond = data => route.fulfill({ json: { success: true, data: structuredClone(data) } })
    if (path.endsWith('/projects/p1')) return respond({ id: 'p1', name: '整章项目', stats: {} })
    if (path.endsWith('/chapters')) return respond({ items: [{ id: 'ch1', project_id: 'p1', index: 1, title: chapter.title, raw_text: chapter.raw_text, sequence_count: chapter.sequences.length }], pagination: { total: 1 } })
    if (path.endsWith('/ch1/history')) return respond(history)
    if (path.endsWith('/ch1/overview')) return respond({ chapter_id: 'ch1', title: chapter.title, source_version: chapter.source_version, sequences: chapter.sequences.map(row => ({ ...row, source_excerpt: row.source_text, design_count: 2, confirmed_design_count: 0, plan_count: 0, confirmed_plan_count: 0, take_count: 1, unreviewed_take_count: 1, active_cut_revision_id: null })) })
    if (path.endsWith('/directing/chapters/ch1')) return respond(chapter)
    if (path.endsWith('/chapters/ch1')) return respond({ id: 'ch1', project_id: 'p1', index: 1, title: chapter.title, raw_text: chapter.raw_text, sequence_count: chapter.sequences.length })
    if (path.includes('/division/receipts/')) return respond(receipts.get(path.split('/').at(-1)) || null)
    if (path.includes('/division/history/receipts/')) return respond({ request_id: 'broken', chapter: null, issues: ['历史回执资料不完整或格式不正确'] })
    if (path.endsWith('/division/history')) {
      const requestedPage = Number(new URL(req.url()).searchParams.get('page') || 1)
      historyPages.push(requestedPage)
      if (failedHistoryReads > 0) { failedHistoryReads--; return route.fulfill({ status: 503, json: { detail: '历史列表暂时不可用' } }) }
      if (emptyHistory) return respond({ items: [], total: 0, page: requestedPage, page_size: 10, active_task_ids: [] })
      const items = [...versions.values()].reverse().map(value => ({ id: value.current_version.id, number: value.current_version.number, kind: 'version', origin: 'manual', created_at: '2026-09-30T12:00:00Z', sequence_count: value.sequences.length, status: 'saved', is_current: value.current_version.id === chapter.current_version.id, source_task_id: null }))
      items.push(...[...tasks.values()].map(task => ({ id: task.task_id, number: null, kind: 'analysis', origin: 'ai', created_at: '2026-09-30T12:01:00Z', sequence_count: null, status: task.status, is_current: false, source_task_id: task.task_id, save_relation: 'unsaved' })))
      items.push({ id: 'broken', number: null, kind: 'receipt', origin: 'imported', created_at: '2026-09-29T12:00:00Z', sequence_count: null, status: 'unimported', is_current: false, save_relation: 'unknown' })
      return respond({ items: items.slice((requestedPage - 1) * 10, requestedPage * 10), page: requestedPage, page_size: 10, total: items.length, current_version: chapter.current_version, active_task_ids: [...tasks.values()].filter(task => ['queued', 'running'].includes(task.status)).map(task => task.task_id) })
    }
    if (path.includes('/division/versions/')) {
      versionReads++
      if (failedVersionReads > 0) { failedVersionReads--; return route.fulfill({ status: 503, json: { detail: '版本正文暂时不可用' } }) }
      const value = structuredClone(versions.get(path.split('/').at(-1)))
      if (deferredVersion) {
        const pending = deferredVersion; deferredVersion = undefined
        value.sequences[0].title = '过时请求的内容'
        pending.started()
        await pending.release
        const result = await respond({ version: { id: value.current_version.id, number: value.current_version.number, origin: 'manual', source_task_id: null }, chapter: value, restored_baseline: [], mapping: {} })
        pending.finished()
        return result
      }
      return respond({ version: { id: value.current_version.id, number: value.current_version.number, origin: 'manual', source_task_id: null }, chapter: value, restored_baseline: [], mapping: value.current_version.id === 'v1' ? { source_task_unknown: true, lineage_unknown: true } : {}, source_revision_id: null, base_revision_id: null })
    }
    if (path.includes('/division/analyses/')) {
      if (failedAnalysisReads > 0) { failedAnalysisReads--; return route.fulfill({ status: 503, json: { detail: '状态读取暂时不可用' } }) }
      const task = tasks.get(path.split('/').at(-1))
      const detail = { analysis: { id: task.task_id, status: task.status, save_relation: 'unsaved' }, raw_text: task.raw_text || chapter.raw_text, source_version: task.source_version,
        baseline: Object.entries(task.division_baseline || {}).map(([sequence_id, version]) => ({ sequence_id, version })), result: task.division || null,
        source_changed: task.source_version !== chapter.source_version, baseline_changed: JSON.stringify(task.division_baseline) !== JSON.stringify(Object.fromEntries(chapter.sequences.map(row => [row.id, row.version]))), issues: [], saved_versions: [] }
      if (deferredAnalysis) { const pending = deferredAnalysis; deferredAnalysis = undefined; pending.started(); await pending.release }
      return respond(detail)
    }
    if (path.endsWith('/division/preview')) {
      const draft = req.postDataJSON(); previews.push(draft)
      if (failPreview) return route.fulfill({ status: 409, json: { detail: '预览基线冲突，请对照最新划分' } })
      const spans = [...draft.members].sort((a, b) => a.span.start - b.span.start)
      assert.equal(spans.some((row, i) => i > 0 && row.span.start < spans[i - 1].span.end), false)
      return respond({ preview_token: JSON.stringify(draft), impacts: impact(draft), blockers: [], unassigned_character_count: [...chapter.raw_text].length - spans.reduce((n, row) => n + row.span.end - row.span.start, 0), identity_confirmation_required: !!draft.exited_sequence_ids.length || draft.lineage.some(row => row.target_keys.length !== 1) })
    }
    if (path.endsWith('/division') && req.method() === 'PUT') {
      const body = req.postDataJSON(); puts.push(body)
      if (failSave) return route.fulfill({ status: 409, json: { detail: '场次集合冲突，草稿保留' } })
      if (receipts.has(body.request_id)) return respond(receipts.get(body.request_id))
      assert.equal(body.preview_token, JSON.stringify(body.draft))
      const impacts = impact(body.draft), created = {}
      for (const id of body.draft.exited_sequence_ids) history.push({ ...chapter.sequences.find(row => row.id === id), is_current: false })
      chapter.sequences = body.draft.members.map((member, position) => {
        const before = chapter.sequences.find(row => row.id === member.sequence_id)
        const id = before?.id || `s${seq++}`
        if (!before) created[member.key] = id
        return { id, chapter_id: 'ch1', project_id: 'p1', title: member.title, span: member.span, source_text: [...chapter.raw_text].slice(member.span.start, member.span.end).join(''), position,
          source: { kind: 'chapter', reference: 'ch1', version: chapter.source_version }, version: before ? before.version + Number(!!impacts[position].changes.length) : 1, source_changed: false, is_current: true }
      })
      chapter.current_version = { id: `v${versions.size + 1}`, number: versions.size + 1 }; versions.set(chapter.current_version.id, snapshot())
      const saved = { request_id: body.request_id, chapter: snapshot(), created_sequence_ids: created, impacts }
      receipts.set(body.request_id, saved)
      if (loseResponse) { loseResponse = false; return route.abort('failed') }
      return respond(saved)
    }
    if (path.endsWith('/ch1/analyze')) { analyses++; tasks.set('late', { task_id: 'late', kind: 'directing_divide', status: 'queued', source_version: chapter.source_version, division_baseline: Object.fromEntries(chapter.sequences.map(row => [row.id, row.version])), raw_text: chapter.raw_text }); chapter.task_ids.push('late'); return respond({ task_id: 'late' }) }
    if (path.endsWith('/tasks/late/cancel')) { tasks.set('late', { ...tasks.get('late'), status: 'cancelled' }); return respond({}) }
    if (path.includes('/directing/tasks/')) return respond(tasks.get(path.split('/').at(-1)))
    if (/\/sequences\/s\d+$/.test(path) && req.method() === 'GET') {
      const workspace = makeWorkspace(); workspace.sequence = [...chapter.sequences, ...history].find(row => row.id === path.split('/').at(-1))
      if (workspace.sequence.is_current) for (const key of ['designs', 'plans', 'takes', 'cuts', 'prompts', 'reviews', 'task_ids']) workspace[key] = []
      return respond(workspace)
    }
    if (path.includes('/sequences') && req.method() !== 'GET') { legacyWrites++; return route.fulfill({ status: 500, json: { detail: 'unexpected single-scene write' } }) }
    return respond({ items: [], total: 0 })
  })
  const base = `http://127.0.0.1:${port}/projects/p1?tab=chapters`
  const drawer = page.locator('.ant-drawer-open')
  const title = page.getByRole('textbox', { name: '场次标题', exact: true })
  const preview = page.getByRole('dialog').filter({ has: page.getByText('划分变更预览', { exact: true }) })
  const select = async (start, end) => {
    if (!await page.getByRole('textbox', { name: '键盘或触屏选择原文', exact: true }).count()) await page.getByRole('button', { name: '键盘/触屏选区', exact: true }).click()
    const offsets = [start, end].map(n => [...chapter.raw_text].slice(0, n).join('').length)
    await page.getByRole('textbox', { name: '键盘或触屏选择原文', exact: true }).evaluate((el, offsets) => { el.focus(); el.setSelectionRange(...offsets); document.dispatchEvent(new Event('selectionchange')) }, offsets)
    await page.locator(`[aria-label="选中原文"][data-start="${start}"][data-end="${end}"]`).waitFor({ state: 'attached' })
  }
  const openPreview = async () => { await page.getByRole('button', { name: '保存新版本', exact: true }).click(); await preview.waitFor() }
  await page.goto(base)
  await page.getByRole('button', { name: '场次管理', exact: true }).click()
  await title.waitFor()
  await page.getByRole('button', { name: '在原文中调整范围', exact: true }).click()
  await page.getByRole('button', { name: 'AI智能划分', exact: true }).waitFor()
  assert.equal(await page.locator('.chapter-division-toolbar button').count(), 2)
  await select(0, 5)
  await page.getByRole('button', { name: '2. 后场', exact: true }).click()
  await page.locator('[aria-label="选中原文"][data-start="5"][data-end="7"]').waitFor()
  await title.fill('后场改名')
  assert.equal(await title.inputValue(), '后场改名')
  assert.equal(puts.length, 0); assert.equal(analyses, 0)
  await openPreview()
  await preview.getByText('尾场 · 保留（无变化）', { exact: true }).waitFor()
  assert.deepEqual(previews.at(-1).members.slice(0, 2).map(row => row.span), [{ start: 0, end: 5 }, { start: 5, end: 7 }])
  loseResponse = true
  await preview.getByRole('button', { name: '保存本章划分', exact: true }).click()
  await page.getByRole('button', { name: '核对上次保存', exact: true }).waitFor()
  await drawer.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: '留在当前页', exact: true }).click()
  await page.getByRole('button', { name: '核对上次保存', exact: true }).click()
  await page.getByText('已保存为 v2。', { exact: true }).waitFor()
  assert.equal(puts.length, 1); assert.equal(chapter.sequences[2].version, 1)
  assert.equal(new URL(page.url()).searchParams.get('panel'), 'source')
  // Known conflict preserves all edits and invalidates the preview.
  await title.fill('冲突后保留')
  await openPreview(); failSave = true
  await preview.getByRole('button', { name: '保存本章划分', exact: true }).click()
  await page.getByText('场次集合冲突，草稿保留', { exact: false }).waitFor()
  assert.equal(await title.inputValue(), '冲突后保留')
  failSave = false
  await openPreview(); await preview.getByRole('button', { name: '保存本章划分', exact: true }).click()
  await preview.waitFor({ state: 'hidden' })
  // Exit/create requires explicit identity acknowledgement; existing third identity becomes history.
  await page.getByRole('button', { name: '3. 尾场', exact: true }).click()
  await page.getByRole('button', { name: '移出本章草稿', exact: true }).click()
  await page.getByRole('button', { name: '新增场次', exact: true }).click()
  await title.fill('新尾场'); await select(7, 10)
  await openPreview()
  assert.equal(await preview.getByRole('button', { name: '保存本章划分', exact: true }).isDisabled(), true)
  await preview.getByRole('checkbox').check()
  await preview.getByRole('button', { name: '保存本章划分', exact: true }).click()
  await preview.waitFor({ state: 'hidden' })
  assert.equal(history[0].id, 's3'); assert.equal(chapter.sequences[2].id, 's4')
  await drawer.getByRole('button', { name: 'Close', exact: true }).click(); await drawer.waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: '场次管理', exact: true }).click()
  await page.getByRole('button', { name: '查看历史场次', exact: true }).click()
  await page.getByRole('button', { name: '尾场 · 历史', exact: true }).click()
  await page.getByRole('button', { name: '查看历史成果', exact: true }).click()
  await page.getByText('尾场 · 已退出当前划分', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '生成导演建议', exact: true }).count(), 0)
  await page.goto(`http://127.0.0.1:${port}/projects/p1/chapters/ch1/sequences/s3?view=cut&cut=c-old`)
  await page.getByText('版本身份：c-old · 修订 2', { exact: true }).waitFor()
  await page.getByText(/源区间 0.000–1.000 秒/).waitFor()
  assert.equal(await page.getByRole('button', { name: '保存剪辑草稿', exact: true }).count(), 0)
  await page.goto(`http://127.0.0.1:${port}/projects/p1/chapters/ch1/sequences/s3?view=cut&cut=missing`)
  await page.getByText('指定的历史版本不存在或不属于本场次，请选择可用版本。', { exact: true }).waitFor()
  // All four layouts preserve the whole draft and guard Escape without writes.
  for (const width of [1440, 1024, 768, 375]) {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 1000 })
    await page.goto(`${base}&chapter=ch1&panel=source`)
      if (width === 375) await page.getByRole('button', { name: '查看当前选区', exact: true }).click()
    await title.fill(`未保存 ${width}`)
    await page.screenshot({ path: join(evidence, `manual-${width}.png`), animations: 'disabled' })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `${width}: page overflow`)
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: '取消，继续编辑', exact: true }).click()
    assert.equal(await title.inputValue(), `未保存 ${width}`)
    await drawer.getByRole('button', { name: 'Close', exact: true }).click()
    await page.getByRole('button', { name: '放弃修改并继续', exact: true }).click(); await drawer.waitFor({ state: 'hidden' })
  }
  // History viewing preserves drafts and never writes or changes current version.
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`${base}&chapter=ch1&panel=source`)
  await title.fill('历史浏览保留草稿')
  let beforeHistory = puts.length
  await page.getByRole('button', { name: '历史版本', exact: true }).click()
  const modal = page.getByRole('dialog', { name: '历史版本', exact: true })
  await modal.getByRole('button', { name: '展开', exact: true }).first().click()
  await modal.getByRole('button', { name: '查看版本', exact: true }).click()
  assert.equal(await title.getAttribute('readonly'), '')
  await page.getByRole('button', { name: '返回当前编辑', exact: true }).click()
  assert.equal(await title.inputValue(), '历史浏览保留草稿')
  assert.equal(puts.length, beforeHistory)
  await page.getByRole('button', { name: '历史版本', exact: true }).click()
  await modal.getByRole('button', { name: '展开', exact: true }).first().click()
  await modal.getByRole('button', { name: '基于此版本编辑', exact: true }).click()
  await page.getByRole('button', { name: '替换草稿', exact: true }).click()
  await modal.waitFor({ state: 'hidden' })
  await page.getByText('历史方案已载入草稿。请核对范围与身份，保存将形成新版本。', { exact: true }).waitFor()
  assert.equal(await title.inputValue(), chapter.sequences[0].title)
  const originalTitle = versions.get('v4').sequences[0].title
  await title.fill('基于历史修改')
  await openPreview()
  await preview.getByRole('button', { name: '保存本章划分', exact: true }).click()
  await preview.waitFor({ state: 'hidden' })
  assert.equal(puts.at(-1).draft.source_revision_id, 'v4')
  assert.equal(versions.get('v4').sequences[0].title, originalTitle)
  assert.equal(chapter.current_version.number, 5)
  beforeHistory++
  // AI completes into the same editor, with no adoption step or write.
  await page.getByRole('button', { name: 'AI智能划分', exact: true }).click()
  await page.getByRole('button', { name: '划分中…', exact: true }).waitFor()
  tasks.set('late', { ...tasks.get('late'), status: 'succeeded', division: { scenes: chapter.sequences.map(row => ({ title: `AI ${row.title}`, excerpt: row.source_text, purpose: '叙事' })) } })
  await page.getByText('AI 生成 · 未保存。请核对场次范围与身份，保存后形成新版本。', { exact: true }).waitFor()
  assert.equal(await title.inputValue(), `AI ${chapter.sequences[0].title}`)
  assert.equal(puts.length, beforeHistory)
  assert.equal(await page.getByRole('button', { name: '采用到本章草稿', exact: true }).count(), 0)
  // A later manual change prevents a late analysis from replacing the draft.
  await page.getByRole('button', { name: 'AI智能划分', exact: true }).click()
  await page.getByRole('button', { name: '开始分析', exact: true }).click()
  await page.getByRole('button', { name: '划分中…', exact: true }).waitFor()
  await title.fill('迟到结果不能覆盖')
  tasks.set('late', { ...tasks.get('late'), status: 'succeeded', division: { scenes: [{ title: '迟到方案', excerpt: raw, purpose: '叙事' }] } })
  await page.getByText('新 AI 方案已保留到历史版本；当前草稿未被覆盖，可展开核对后载入编辑。', { exact: true }).waitFor()
  assert.equal(await title.inputValue(), '迟到结果不能覆盖')
  // Browsing history prevents automatic replacement; an expanded running row refreshes on completion.
  await page.getByRole('button', { name: 'AI智能划分', exact: true }).click()
  await page.getByRole('button', { name: '开始分析', exact: true }).click()
  await page.getByRole('button', { name: '划分中…', exact: true }).waitFor()
  await page.getByRole('button', { name: '历史版本', exact: true }).click()
  const activeAnalysis = modal.getByRole('row').filter({ has: page.getByText('AI 分析', { exact: true }) })
  let releaseDetail, detailStarted
  const detailInFlight = new Promise(resolve => { detailStarted = resolve })
  deferredAnalysis = { started: detailStarted, release: new Promise(resolve => { releaseDetail = resolve }) }
  await activeAnalysis.locator('.ant-table-row-expand-icon').click()
  await detailInFlight
  tasks.set('late', { ...tasks.get('late'), status: 'succeeded', division: { scenes: [{ title: '展开中完成的方案', excerpt: raw, purpose: '叙事' }] } })
  await activeAnalysis.getByText('待保存方案', { exact: true }).waitFor()
  releaseDetail()
  await modal.getByText('1. 展开中完成的方案', { exact: true }).waitFor()
  await modal.getByRole('button', { name: '关闭', exact: true }).click()
  assert.equal(await title.inputValue(), '迟到结果不能覆盖')
  // A detail response from a closed modal must not replace a fresh response after reopening.
  let releaseOld, oldStarted, oldFinished
  const started = new Promise(resolve => { oldStarted = resolve })
  const finished = new Promise(resolve => { oldFinished = resolve })
  deferredVersion = { started: oldStarted, finished: oldFinished, release: new Promise(resolve => { releaseOld = resolve }) }
  await page.getByRole('button', { name: '历史版本', exact: true }).click()
  await modal.getByRole('button', { name: '展开', exact: true }).first().click()
  await started
  await modal.getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByRole('button', { name: '历史版本', exact: true }).click()
  await modal.getByRole('button', { name: '展开', exact: true }).first().click()
  await modal.getByRole('button', { name: '查看版本', exact: true }).waitFor()
  releaseOld()
  await finished
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  assert.equal(await modal.getByText('1. 过时请求的内容', { exact: true }).count(), 0)
  await modal.getByText(`1. ${chapter.sequences[0].title}`, { exact: true }).waitFor()
  await modal.getByRole('button', { name: '关闭', exact: true }).click()
  // Read retries do not resubmit AI; failed and cancelled runs preserve the draft.
  const beforeRetry = analyses
  failedAnalysisReads = 1
  await page.getByRole('button', { name: 'AI智能划分', exact: true }).click()
  await page.getByRole('button', { name: '开始分析', exact: true }).click()
  await page.getByText('分析状态读取失败，正在重试读取：状态读取暂时不可用', { exact: true }).waitFor()
  tasks.set('late', { ...tasks.get('late'), status: 'failed' })
  await page.getByText('分析失败，原草稿保持不变；可在历史版本查看记录。', { exact: true }).waitFor()
  assert.equal(analyses, beforeRetry + 1)
  assert.equal(await title.inputValue(), '迟到结果不能覆盖')
  await page.getByRole('button', { name: 'AI智能划分', exact: true }).click()
  await page.getByRole('button', { name: '开始分析', exact: true }).click()
  await page.getByRole('button', { name: '划分中…', exact: true }).waitFor()
  await page.getByRole('button', { name: '历史版本', exact: true }).click()
  await modal.getByRole('button', { name: '取消分析', exact: true }).click()
  await modal.getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByText('分析已取消，原草稿保持不变。', { exact: true }).waitFor()
  assert.equal(analyses, beforeRetry + 2)
  assert.equal(await title.inputValue(), '迟到结果不能覆盖')
  // Concurrent source edits keep the frozen editor and require revalidation instead of AI autofill.
  await page.getByRole('button', { name: 'AI智能划分', exact: true }).click()
  await page.getByRole('button', { name: '开始分析', exact: true }).click()
  await page.getByRole('button', { name: '划分中…', exact: true }).waitFor()
  chapter.raw_text = `新增正文。${raw}`; chapter.source_version = 'changed-during-analysis'
  tasks.set('late', { ...tasks.get('late'), status: 'succeeded', division: { scenes: [{ title: '基于旧原文的迟到方案', excerpt: raw, purpose: '叙事' }] } })
  await page.getByText('新 AI 方案已保留到历史版本；当前草稿未被覆盖，可展开核对后载入编辑。', { exact: true }).waitFor()
  await page.getByRole('button', { name: '查看最新划分', exact: true }).waitFor()
  assert.equal(await title.inputValue(), '迟到结果不能覆盖')
  assert.equal(await page.locator('.chapter-source-text').textContent(), raw)
  assert.equal(await page.getByRole('button', { name: '保存新版本', exact: true }).isDisabled(), true)
  chapter.raw_text = raw; chapter.source_version = 'v1'
  // History modal remains usable at all four widths without page overflow.
  for (const width of [1440, 1024, 768, 375]) {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 1000 })
    await page.getByRole('button', { name: '历史版本', exact: true }).click()
    await modal.getByRole('button', { name: '展开', exact: true }).first().click()
    await modal.getByRole('button', { name: '查看版本', exact: true }).waitFor()
    await modal.evaluate(element => Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))))
    await page.screenshot({ path: join(evidence, `history-${width}.png`) })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
    await modal.getByRole('button', { name: '关闭', exact: true }).click()
  }
  await page.getByRole('button', { name: '历史版本', exact: true }).click()
  const imported = modal.getByRole('row').filter({ has: page.getByText('v1', { exact: true }) })
  await imported.getByRole('button', { name: '展开', exact: true }).click()
  await modal.getByText('旧记录未保留完整的分析来源或身份变更映射；仅展示已验证的保存快照，不推断缺失关系。', { exact: true }).waitFor()
  const legacy = modal.getByRole('row').filter({ has: page.getByText('旧保存记录', { exact: true }) })
  await legacy.getByRole('button', { name: '展开', exact: true }).click()
  await modal.getByText('历史回执资料不完整或格式不正确', { exact: true }).waitFor()
  assert.equal(await modal.getByRole('button', { name: '载入编辑', exact: true }).count(), 0)
  await modal.getByRole('button', { name: '关闭', exact: true }).click()
  // An old successful receipt cannot present itself as the latest concurrently saved version.
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.reload()
  await title.waitFor()
  await title.fill('丢失响应的本次保存')
  await openPreview(); loseResponse = true
  await preview.getByRole('button', { name: '保存本章划分', exact: true }).click()
  await page.getByRole('button', { name: '核对上次保存', exact: true }).waitFor()
  const savedVersion = chapter.current_version.number
  chapter.sequences[0].title = '其他用户后续保存'
  chapter.sequences[0].version++
  chapter.current_version = { id: `v${savedVersion + 1}`, number: savedVersion + 1 }
  versions.set(chapter.current_version.id, snapshot())
  const beforeReceipt = puts.length
  await page.getByRole('button', { name: '核对上次保存', exact: true }).click()
  await page.getByText('本次保存已成功；当前划分随后已有新版本。已保留本次结果，请核对最新划分。', { exact: true }).waitFor()
  assert.equal(await title.inputValue(), '丢失响应的本次保存')
  await page.getByRole('button', { name: '查看最新划分', exact: true }).waitFor()
  assert.equal(chapter.current_version.number, savedVersion + 1)
  assert.equal(puts.length, beforeReceipt)
  // List pagination reads summaries only; both list/detail failures have explicit retry, and empty state is usable.
  for (let number = 8; number <= 18; number++) {
    const item = snapshot(); item.current_version = { id: `v${number}`, number }; versions.set(item.current_version.id, item)
  }
  const readsBeforePage = versionReads, writesBeforePage = puts.length, analysesBeforePage = analyses
  failedHistoryReads = 1
  await page.getByRole('button', { name: '历史版本', exact: true }).click()
  await modal.getByText('历史列表暂时不可用', { exact: true }).waitFor()
  await modal.getByRole('button', { name: '重试列表', exact: true }).click()
  await modal.getByText('v18', { exact: true }).waitFor()
  await modal.locator('.ant-pagination-item-2').click()
  await modal.getByText('v1', { exact: true }).waitFor()
  assert.equal(historyPages.at(-1), 2)
  assert.equal(versionReads, readsBeforePage)
  failedVersionReads = 1
  await modal.getByRole('button', { name: '展开', exact: true }).first().click()
  await modal.getByText('版本正文暂时不可用', { exact: true }).waitFor()
  await modal.getByRole('button', { name: '重试详情', exact: true }).click()
  await modal.getByRole('button', { name: '查看版本', exact: true }).waitFor()
  assert.equal(versionReads, readsBeforePage + 2)
  await modal.getByRole('button', { name: '关闭', exact: true }).click()
  emptyHistory = true
  await page.getByRole('button', { name: '历史版本', exact: true }).click()
  await modal.getByText('暂无历史版本或分析记录', { exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await modal.waitFor({ state: 'hidden' })
  assert.equal(await drawer.isVisible(), true)
  assert.equal(await title.inputValue(), '丢失响应的本次保存')
  assert.equal(puts.length, writesBeforePage)
  assert.equal(analyses, analysesBeforePage)
  assert.equal(legacyWrites, 0)
  assert.deepEqual(errors, [])
  console.log(`Whole chapter: shared boundaries, lost response, conflicts, identity history, one editor, safe AI fill, history modal, draft retention and four sizes passed. Evidence: ${evidence}`)
} catch (cause) { console.error(await page?.locator('body').innerText()); console.error(errors); throw cause } finally { await browser?.close(); await server.close() }
