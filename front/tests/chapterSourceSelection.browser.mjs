import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url)); process.chdir(root)
const port = Number(process.env.SOURCE_SELECTION_PORT || 4207)
const server = await createServer({ root, server: { host: '127.0.0.1', port, strictPort: true, open: false } })
const evidence = await mkdtemp(join(tmpdir(), 'jellyfish-source-selection-'))
const raw = '她😀推门。\n她😀推门。\n末场结束。'
const chapters = [{ id: 'ch1', project_id: 'p1', index: 1, title: '重复段落与选区', raw_text: raw, status: 'draft' }, { id: 'ch2', project_id: 'p1', index: 2, title: '空章节', raw_text: '', status: 'draft' }]
const scene = (id, position, start, end) => ({ id, project_id: 'p1', chapter_id: 'ch1', position, title: `场次 ${position + 1}`, version: 1, source: { kind: 'chapter', reference: 'ch1', version: 'v1' }, span: { start, end }, source_text: [...raw].slice(start, end).join(''), source_changed: false })
let sequences = [scene('s1', 0, 0, 5)], version = 'v1', sourceRaw = raw, failSave = false, holdSave = false, releaseSave, failRead = false
let taskIds = [], analyses = 0, queueAnalysis = false, deferredAnalysis
const writes = [], reads = [], errors = []
const tasks = new Map()
const task = (id, sourceVersion = 'v1') => ({ task_id: id, kind: 'directing_divide', status: 'succeeded', source_version: sourceVersion, division_baseline: Object.fromEntries(sequences.map(row => [row.id, row.version])), division: { scenes: [{ title: '重复段落候选', excerpt: '她😀推门。', purpose: '推门' }, { title: '结束候选', excerpt: '末场结束。', purpose: '结束' }, { title: '无法定位候选', excerpt: '模型改写的文字', purpose: '无法定位' }] } })
let browser, page
try {
  await server.listen(); browser = await chromium.launch({ headless: true })
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(10000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: location.origin } })
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/**', async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname
    const respond = data => route.fulfill({ json: { success: true, data } })
    if (req.method() === 'GET') reads.push(path)
    if (path.endsWith('/projects/p1')) return respond({ id: 'p1', name: '原文选区验收', stats: {} })
    if (path.endsWith('/studio/chapters')) return respond({ items: chapters.map(row => ({ ...row, sequence_count: row.id === 'ch1' ? sequences.length : 0 })), pagination: { page: 1, page_size: 10, total: chapters.length, max_page: 1 } })
    const overview = path.match(/\/directing\/chapters\/(ch[12])\/overview$/)
    if (overview) return respond({ chapter_id: overview[1], source_version: version, sequences: overview[1] === 'ch1' ? sequences.map(row => ({ ...row, source_excerpt: row.source_text, design_count: 0, confirmed_design_count: 0, plan_count: 0, take_count: 0, unreviewed_take_count: 0, active_cut_revision_id: null })) : [] })
    const source = path.match(/\/directing\/chapters\/(ch[12])$/)
    if (source) {
      if (failRead) return route.fulfill({ status: 503, json: { detail: '原文暂不可用' } })
      return respond({ chapter_id: source[1], title: chapters.find(row => row.id === source[1]).title, raw_text: source[1] === 'ch1' ? sourceRaw : chapters[1].raw_text, source_version: version, sequences: source[1] === 'ch1' ? sequences : [], task_ids: taskIds })
    }
    if (path.endsWith('/chapters/ch1/analyze')) {
      analyses++; taskIds.push('ai1'); tasks.set('ai1', { ...task('ai1', version), ...(queueAnalysis ? { status: 'queued', division: null } : {}) }); return respond({ task_id: 'ai1' })
    }
    const taskRead = path.match(/\/directing\/tasks\/([^/]+)$/)
    if (taskRead) return respond(tasks.get(taskRead[1]))
    if (path.endsWith('/ch2/division/history')) return respond({ items: [], total: 0, page: 1, page_size: 10, active_task_ids: [] })
    if (path.endsWith('/division/history')) return respond({ items: [...tasks.values()].map(row => ({ id: row.task_id, kind: 'analysis', origin: 'ai', status: row.status, save_relation: 'unsaved', created_at: '2026-09-30T12:00:00Z', number: null, is_current: false })), total: tasks.size, page: 1, page_size: 10, active_task_ids: [...tasks.values()].filter(row => ['queued', 'running'].includes(row.status)).map(row => row.task_id) })
    if (path.includes('/division/analyses/')) {
      if (deferredAnalysis) {
        const pending = deferredAnalysis; deferredAnalysis = undefined
        pending.started(); await pending.release
        const row = tasks.get(path.split('/').at(-1))
        await respond({ analysis: { id: row.task_id, status: row.status }, raw_text: sourceRaw, source_version: row.source_version, result: row.division, issues: [], source_changed: false, baseline_changed: false, baseline: [], saved_versions: [] })
        pending.finished(); return
      }
      const row = tasks.get(path.split('/').at(-1))
      return respond({ analysis: { id: row.task_id, status: row.status }, raw_text: raw, source_version: row.source_version, result: row.division, issues: [], source_changed: row.source_version !== version, baseline_changed: JSON.stringify(row.division_baseline) !== JSON.stringify(Object.fromEntries(sequences.map(row => [row.id, row.version]))), baseline: [], saved_versions: [] })
    }
    if (path.endsWith('/division/preview')) {
      const draft = req.postDataJSON()
      return respond({ preview_token: 'source-preview', impacts: draft.members.map(member => ({ key: member.key, before: sequences.find(row => row.id === member.sequence_id) || null, after: member, changes: ['range'], design_count: 0, plan_count: 0, take_count: 0, cut_count: 0 })), blockers: [], unassigned_character_count: 0, identity_confirmation_required: false })
    }
    if (path.endsWith('/division') && req.method() === 'PUT') {
      const body = req.postDataJSON(); writes.push(body)
      if (holdSave) await new Promise(resolve => { releaseSave = resolve })
      if (failSave || body.draft.source_version !== version) return route.fulfill({ status: 409, json: { detail: '原文或场次版本冲突，输入已保留' } })
      const created = {}
      sequences = body.draft.members.map((member, position) => {
        const existing = sequences.find(row => row.id === member.sequence_id)
        const id = existing?.id || `s${sequences.length + position + 1}`
        if (!existing) created[member.key] = id
        return { ...scene(id, position, member.span.start, member.span.end), title: member.title, version: existing ? existing.version + 1 : 1, source_text: [...sourceRaw].slice(member.span.start, member.span.end).join(''), source: { kind: 'chapter', reference: 'ch1', version }, is_current: true }
      })
      return respond({ request_id: body.request_id, chapter: { chapter_id: 'ch1', title: chapters[0].title, raw_text: sourceRaw, source_version: version, sequences, task_ids: taskIds }, created_sequence_ids: created, impacts: [] })
    }
    if (/\/chapters\/ch1\/sequences(?:\/s\d+)?$/.test(path) && ['POST', 'PUT'].includes(req.method())) {
      const body = req.postDataJSON(); writes.push(body)
      if (holdSave) await new Promise(resolve => { releaseSave = resolve })
      if (failSave || body.source_version !== version) return route.fulfill({ status: 409, json: { detail: '原文或场次版本冲突，输入已保留' } })
      const existing = req.method() === 'PUT' ? sequences.find(row => row.id === path.split('/').at(-1)) : undefined
      if (existing) assert.equal(body.expected_version, existing.version)
      if (body.span && sequences.some(row => row.id !== existing?.id && !row.source_changed && body.span.start < row.span.end && row.span.start < body.span.end)) return route.fulfill({ status: 409, json: { detail: '场次范围重叠' } })
      const saved = existing || scene(`s${sequences.length + 1}`, body.position, body.span.start, body.span.end)
      Object.assign(saved, { title: body.title, position: body.position, version: existing ? existing.version + 1 : 1 })
      if (body.span) Object.assign(saved, { span: body.span, source_text: [...sourceRaw].slice(body.span.start, body.span.end).join(''), source: { ...saved.source, version }, source_changed: false })
      if (!existing) sequences.push(saved)
      return respond(saved)
    }
    const chapterRead = path.match(/\/studio\/chapters\/(ch[12])$/)
    if (chapterRead) return respond({ ...chapters.find(row => row.id === chapterRead[1]), sequence_count: chapterRead[1] === 'ch1' ? sequences.length : 0 })
    return respond({ items: [], total: 0 })
  })
  const base = `http://127.0.0.1:${port}/projects/p1?tab=chapters`
  const drawer = page.locator('.ant-drawer-open')
  const nativeSelect = async (start, end) => {
    if (!await page.getByRole('textbox', { name: '键盘或触屏选择原文', exact: true }).count()) await page.getByRole('button', { name: '键盘/触屏选区', exact: true }).click()
    const input = page.getByRole('textbox', { name: '键盘或触屏选择原文', exact: true })
    await input.evaluate((element, offsets) => { element.focus(); element.setSelectionRange(...offsets); document.dispatchEvent(new Event('selectionchange')) }, [start, end])
    await page.locator(`[aria-label="选中原文"][data-start="${[...sourceRaw.slice(0, start)].length}"][data-end="${[...sourceRaw.slice(0, end)].length}"]`).waitFor({ state: 'attached' })
  }
  const discard = async () => {
    await page.getByRole('button', { name: '放弃修改', exact: true }).click()
    await page.getByRole('button', { name: '放弃草稿并载入最新划分', exact: true }).click()
    await page.getByText('已载入最新划分。', { exact: true }).waitFor()
  }
  const preview = async () => page.getByRole('button', { name: '保存新版本', exact: true }).click()
  const save = async () => { await preview(); await page.getByRole('button', { name: '保存本章划分', exact: true }).click() }
  const saved = async () => { await page.getByText('已保存本章划分。', { exact: true }).waitFor() }
  await page.goto(base)
  assert.deepEqual(await page.getByRole('columnheader').allTextContents(), ['章节名称', '原文预览', '原文字数', '场次数量', '操作'])
  assert.equal(reads.some(path => path.includes('/directing/')), false)
  await page.getByRole('button', { name: '重复段落与选区 · 1 场', exact: true }).click()
  await page.getByRole('textbox', { name: '场次标题', exact: true }).waitFor()
  assert.equal(new URL(page.url()).searchParams.get('sequence'), 's1')
  assert.equal(writes.length, 0)
  assert.equal(await drawer.getByRole('button', { name: '编辑章节', exact: true }).count(), 0)
  assert.equal(await drawer.getByRole('textbox', { name: '场次原文摘录', exact: true }).count(), 0)
  await page.getByRole('textbox', { name: '场次标题', exact: true }).fill('改名保留来源')
  await page.getByRole('button', { name: /^保\s*存$/ }).click()
  await page.getByRole('heading', { name: '改名保留来源', exact: true }).waitFor()
  assert.equal(writes.at(-1).span, null)
  await page.getByRole('button', { name: '在原文中调整范围', exact: true }).click()
  await page.getByRole('region', { name: '完整章节原文', exact: true }).waitFor()
  assert.equal(await page.locator('.chapter-source-text').textContent(), raw, 'decoration is not source text')
  await drawer.evaluate(element => Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))))
  await page.getByRole('button', { name: '键盘/触屏选区', exact: true }).click({ trial: true })
  // Real pointer drag must not be interpreted as clicking the marked scene.
  const points = await page.locator('.chapter-source-text').evaluate(element => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    const node = walker.nextNode(), box = (start, end) => { const range = document.createRange(); range.setStart(node, start); range.setEnd(node, end); const rect = range.getBoundingClientRect(); return { x: rect.x, right: rect.right, y: rect.y + rect.height / 2 } }
    return [box(0, 1), box(1, 3)]
  })
  await page.mouse.move(points[0].x + 1, points[0].y); await page.mouse.down()
  await page.mouse.move(points[1].right - 1, points[1].y, { steps: 10 }); await page.mouse.up()
  await page.locator('[aria-label="选中原文"][data-start="0"][data-end="2"]').waitFor()
  // The second identical occurrence, with an emoji, must preserve its exact source position.
  await nativeSelect(7, 13)
  await save(); await saved()
  assert.deepEqual(writes.at(-1).draft.members[0].span, { start: 6, end: 11 })
  assert.equal(sequences[0].source_text, '她😀推门。')
  // Cross-node native DOM selection includes the paragraph break, never the boundary badges.
  await page.getByRole('button', { name: '返回范围高亮', exact: true }).click()
  await page.locator('.chapter-source-text').evaluate(element => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT), nodes = []; let node
    while ((node = walker.nextNode())) nodes.push(node)
    const at = offset => { for (const node of nodes) { if (offset <= node.length) return [node, offset]; offset -= node.length } throw Error('offset missing') }
    const selection = document.getSelection(); selection.removeAllRanges(); selection.setBaseAndExtent(...at(1), ...at(8))
  })
  await page.getByLabel('选中原文', { exact: true }).filter({ hasText: '😀推门。\n她' }).waitFor()
  await discard()
  // New range starts empty; overlap cannot reach the API.
  await page.getByRole('button', { name: '新增场次', exact: true }).click()
  assert.equal(await page.getByRole('textbox', { name: '场次标题', exact: true }).inputValue(), '')
  await page.getByRole('textbox', { name: '场次标题', exact: true }).fill('重叠测试')
  assert.equal(await page.getByRole('button', { name: '放弃修改并继续', exact: true }).count(), 0)
  await page.getByRole('region', { name: '完整章节原文', exact: true }).waitFor()
  assert.equal(await page.getByRole('textbox', { name: '场次标题', exact: true }).inputValue(), '重叠测试')
  await nativeSelect(7, 13)
  const beforeOverlap = writes.length
  await preview()
  await page.getByText('场次「改名保留来源」与「重叠测试」范围重叠', { exact: true }).waitFor()
  assert.equal(writes.length, beforeOverlap)
  await nativeSelect(0, 6)
  failSave = true
  await save()
  await page.getByText('原文或场次版本冲突，输入已保留', { exact: true }).waitFor()
  assert.equal(await page.getByRole('textbox', { name: '场次标题', exact: true }).inputValue(), '重叠测试')
  failSave = false
  await save()
  await saved()
  assert.equal(sequences.length, 2)
  // AI fills the existing editor; ambiguous and missing excerpts stay unresolved.
  assert.equal(analyses, 0)
  await page.getByRole('button', { name: 'AI智能划分', exact: true }).click()
  await page.getByText('AI 生成 · 未保存。请核对场次范围与身份，保存后形成新版本。', { exact: true }).waitFor()
  assert.equal(analyses, 1)
  const beforeCandidates = writes.length
  await preview()
  await page.getByText('场次「重复段落候选」需要有效的连续原文范围', { exact: true }).waitFor()
  await page.getByRole('combobox', { name: '原文出现位置', exact: true }).locator('../..').click()
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: '第 2 次出现' }).click()
  assert.equal(await page.getByLabel('选中原文', { exact: true }).textContent(), '她😀推门。')
  await page.getByRole('button', { name: '3. 无法定位候选 · 待定位', exact: true }).click()
  await preview()
  await page.getByText('场次「无法定位候选」需要有效的连续原文范围', { exact: true }).waitFor()
  assert.equal(writes.length, beforeCandidates)
  await discard()
  // Pending atomic save locks all fields; unchanged ranges are submitted together.
  await page.getByRole('button', { name: '新增场次', exact: true }).click()
  await page.getByRole('textbox', { name: '场次标题', exact: true }).fill('结束场次')
  await nativeSelect(14, 19)
  holdSave = true; await save()
  await page.getByText('操作处理中，完成后可继续编辑。', { exact: true }).waitFor()
  assert.equal(await page.getByRole('textbox', { name: '场次标题', exact: true }).isDisabled(), true)
  holdSave = false; releaseSave(); await saved()
  assert.equal(sequences.length, 3)
  assert.deepEqual(writes.at(-1).draft.members.at(-1).span, { start: 12, end: 17 })
  await drawer.getByRole('button', { name: 'Close', exact: true }).click()
  await drawer.waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: '重复段落与选区 · 3 场', exact: true }).click()
  await page.getByRole('textbox', { name: '场次标题', exact: true }).waitFor()
  assert.equal(new URL(page.url()).searchParams.get('sequence'), sequences.at(-1).id)
  // Long source scroll is browsing state, and switching the selection surface preserves it.
  sourceRaw = raw + '\n' + '尚未分配的长段落。\n'.repeat(180)
  await page.goto(`${base}&chapter=ch1&panel=source`)
  await page.getByRole('region', { name: '完整章节原文', exact: true }).waitFor()
  await page.locator('.chapter-source-text').waitFor()
  await page.locator('.chapter-source-text').evaluate(element => { element.scrollTop = 1200; element.dispatchEvent(new Event('scroll')) })
  await page.waitForFunction(() => JSON.parse(sessionStorage.getItem('chapter-browse:["p1","ch1"]')).sourceTop === 1200)
  await page.reload(); await page.getByRole('region', { name: '完整章节原文', exact: true }).waitFor(); await page.locator('.chapter-source-text').waitFor()
  assert.equal(await page.locator('.chapter-source-text').evaluate(element => element.scrollTop), 1200)
  // Outdated ranges never paint at old offsets or become confirmed by a title change.
  version = 'v2'; sourceRaw = `序言。${raw}`; sequences.forEach(row => { row.source_changed = true })
  await page.goto(`${base}&chapter=ch1&sequence=s1`)
  await page.getByRole('textbox', { name: '场次标题', exact: true }).fill('过期后改名')
  await page.getByRole('button', { name: /^保\s*存$/ }).click()
  await page.getByRole('heading', { name: '过期后改名', exact: true }).waitFor()
  assert.equal(sequences[0].source_changed, true)
  await page.getByRole('button', { name: '在原文中调整范围', exact: true }).click()
  await page.getByText('需要重新定位：旧范围未绘制到当前原文，确认范围后才能更新来源。', { exact: true }).waitFor()
  assert.equal(await page.locator('.source-assigned').count(), 0)
  assert.equal(await page.getByRole('button', { name: '保存新版本', exact: true }).isDisabled(), true)
  await page.getByRole('button', { name: '历史版本', exact: true }).click()
  const historyModal = page.getByRole('dialog', { name: '历史版本', exact: true })
  await historyModal.getByRole('button', { name: '展开', exact: true }).first().click()
  await historyModal.getByText('基于旧原文，载入后需要重新定位全部范围。', { exact: true }).waitFor()
  await historyModal.getByRole('button', { name: '关闭', exact: true }).click()
  // Dirty range survives cancellation, and discard permits navigation.
  await page.getByRole('button', { name: '新增场次', exact: true }).click()
  await nativeSelect(0, 3)
  await page.getByRole('textbox', { name: '场次标题', exact: true }).fill('尚未保存')
  await drawer.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: '取消，继续编辑', exact: true }).click()
  assert.equal(await page.getByRole('textbox', { name: '场次标题', exact: true }).inputValue(), '尚未保存')
  await drawer.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: '放弃修改并继续', exact: true }).click()
  await drawer.waitFor({ state: 'hidden' })
  version = 'v1'; sourceRaw = raw; sequences.forEach(row => { row.source_changed = false })
  // Four real viewport layouts; native keyboard and touch-style selection remain available.
  for (const width of [1440, 1024, 768, 375]) {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 1000 })
    await page.goto(base)
    await page.getByRole('button', { name: '重复段落与选区 · 3 场', exact: true }).waitFor()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `table ${width}`)
    await page.screenshot({ path: join(evidence, `table-${width}.png`), animations: 'disabled' })
    await page.getByRole('button', { name: '重复段落与选区 · 3 场', exact: true }).click()
    await page.getByRole('textbox', { name: '场次标题', exact: true }).waitFor()
    await page.screenshot({ path: join(evidence, `scene-${width}.png`), animations: 'disabled' })
    if (width === 375) {
      await page.getByRole('button', { name: '返回场次列表', exact: true }).click()
      await page.getByRole('textbox', { name: '搜索本章场次', exact: true }).waitFor()
      assert.equal(await page.getByRole('textbox', { name: '场次标题', exact: true }).count(), 0)
    }
    await drawer.getByRole('button', { name: '调整划分', exact: true }).click()
    await page.getByRole('button', { name: 'AI智能划分', exact: true }).waitFor()
    await page.screenshot({ path: join(evidence, `ai-${width}.png`), animations: 'disabled' })
    assert.equal(await page.getByRole('region', { name: '完整章节原文', exact: true }).isVisible(), true)
    await page.getByRole('region', { name: '完整章节原文', exact: true }).waitFor()
    await page.getByRole('region', { name: '完整章节原文', exact: true }).waitFor()
    await drawer.evaluate(element => Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))))
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `source ${width}`)
    assert.equal(await drawer.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true, `drawer ${width}`)
    await page.screenshot({ path: join(evidence, `source-${width}.png`), animations: 'disabled' })
    await page.getByRole('button', { name: '键盘/触屏选区', exact: true }).click()
    const input = page.getByRole('textbox', { name: '键盘或触屏选择原文', exact: true })
    await input.focus(); await page.keyboard.press('ControlOrMeta+Home'); await page.keyboard.down('Shift'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await page.keyboard.up('Shift')
    if (width === 375) await page.getByRole('button', { name: '查看当前选区', exact: true }).click()
    await page.getByLabel('选中原文', { exact: true }).filter({ hasText: '她😀' }).waitFor()
    await drawer.getByRole('button', { name: 'Close', exact: true }).click()
    await page.getByRole('button', { name: '放弃修改并继续', exact: true }).click()
  }
  // textarea normalizes Windows newlines; persisted offsets must still refer to the original CRLF source.
  await page.setViewportSize({ width: 1440, height: 1000 })
  version = 'v3'; sourceRaw = '前言\r\n' + raw; sequences = []
  await page.goto(`${base}&chapter=ch1&panel=source`)
  await page.getByRole('region', { name: '完整章节原文', exact: true }).waitFor()
  await page.getByRole('button', { name: '新增场次', exact: true }).click()
  await page.getByRole('textbox', { name: '场次标题', exact: true }).fill('Windows 换行范围')
  await page.getByRole('button', { name: '键盘/触屏选区', exact: true }).click()
  await page.getByRole('textbox', { name: '键盘或触屏选择原文', exact: true }).evaluate(element => { element.focus(); element.setSelectionRange(3, 6); document.dispatchEvent(new Event('selectionchange')) })
  await page.locator('[aria-label="选中原文"][data-start="4"][data-end="6"]').waitFor()
  await save(); await saved()
  assert.deepEqual(writes.at(-1).draft.members[0].span, { start: 4, end: 6 })
  assert.equal(sequences.at(-1).source_text, '她😀')
  // Leave through the UI while a result request is in flight; it must not populate another chapter.
  queueAnalysis = true
  let releaseAnalysis, analysisStarted, analysisFinished
  const started = new Promise(resolve => { analysisStarted = resolve })
  const finished = new Promise(resolve => { analysisFinished = resolve })
  deferredAnalysis = { started: analysisStarted, finished: analysisFinished, release: new Promise(resolve => { releaseAnalysis = resolve }) }
  await page.getByRole('button', { name: 'AI智能划分', exact: true }).click()
  await started
  await drawer.getByRole('button', { name: 'Close', exact: true }).click()
  chapters[1].raw_text = '第二章独立原文'
  await page.evaluate(url => { history.pushState({}, '', url); dispatchEvent(new PopStateEvent('popstate')) }, `${base}&chapter=ch2&panel=source`)
  await page.getByRole('button', { name: '新增场次', exact: true }).click()
  await page.getByRole('textbox', { name: '场次标题', exact: true }).fill('第二章草稿')
  tasks.set('ai1', task('ai1', version)); releaseAnalysis(); await finished
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  assert.equal(await page.getByRole('textbox', { name: '场次标题', exact: true }).inputValue(), '第二章草稿')
  chapters[1].raw_text = ''
  assert.equal(await page.getByText('重复段落候选', { exact: true }).count(), 0)
  // Reloading resumes activity display only; a past run must never automatically become a new draft.
  await page.goto(`${base}&chapter=ch1&panel=source`)
  await page.getByRole('button', { name: 'AI智能划分', exact: true }).click()
  await page.getByRole('button', { name: '划分中…', exact: true }).waitFor()
  const acceptedBeforeReload = analyses
  await page.reload()
  await page.getByRole('button', { name: '划分中…', exact: true }).waitFor()
  tasks.set('ai1', task('ai1', version))
  await page.getByRole('button', { name: 'AI智能划分', exact: true }).waitFor()
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'AI智能划分' && !button.disabled))
  assert.equal(await page.getByRole('textbox', { name: '场次标题', exact: true }).inputValue(), 'Windows 换行范围')
  assert.equal(analyses, acceptedBeforeReload)
  await page.goto(`${base}&chapter=ch2`)
  await page.getByText('本章尚无场次，请先从原文划分场次', { exact: true }).waitFor()
  await page.getByRole('button', { name: '从原文划分场次', exact: true }).click()
  await page.getByRole('button', { name: '填写章节原文', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'AI智能划分' }).isDisabled(), true)
  assert.deepEqual(errors, [])
  console.log(`Source selection browser checks passed: table, default detail, native/DOM Unicode ranges, conflict, AI, outdated sources, draft guards, four sizes. Evidence: ${evidence}`)
} catch (error) { console.error(await page?.locator('body').innerText()); console.error(errors); throw error } finally { await browser?.close(); await server.close() }
