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
let taskIds = [], analyses = 0
const writes = [], reads = [], errors = []
const tasks = new Map()
const task = (id, sourceVersion = 'v1') => ({ task_id: id, kind: 'directing_divide', status: 'succeeded', source_version: sourceVersion, division: { scenes: [{ title: '重复段落候选', excerpt: '她😀推门。', purpose: '推门' }, { title: '结束候选', excerpt: '末场结束。', purpose: '结束' }, { title: '无法定位候选', excerpt: '模型改写的文字', purpose: '无法定位' }] } })
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
      return respond({ chapter_id: source[1], title: chapters.find(row => row.id === source[1]).title, raw_text: source[1] === 'ch1' ? sourceRaw : '', source_version: version, sequences: source[1] === 'ch1' ? sequences : [], task_ids: taskIds })
    }
    if (path.endsWith('/chapters/ch1/analyze')) {
      analyses++; taskIds.push('ai1'); tasks.set('ai1', task('ai1', version)); return respond({ task_id: 'ai1' })
    }
    const taskRead = path.match(/\/directing\/tasks\/([^/]+)$/)
    if (taskRead) return respond(tasks.get(taskRead[1]))
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
  const discard = async () => { await page.getByRole('button', { name: '取消选区', exact: true }).click(); await page.getByRole('button', { name: '放弃修改并继续', exact: true }).click(); await page.getByRole('textbox', { name: '场次标题', exact: true }).waitFor({ state: 'hidden' }) }
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
  await page.getByRole('button', { name: '确认保存范围', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('[aria-busy=true]'))
  assert.deepEqual(writes.at(-1).span, { start: 6, end: 11 })
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
  await page.getByRole('button', { name: '手动新建场次', exact: true }).click()
  assert.equal(await page.getByRole('textbox', { name: '场次标题', exact: true }).inputValue(), '')
  await page.getByRole('textbox', { name: '场次标题', exact: true }).fill('重叠测试')
  await nativeSelect(7, 13)
  const beforeOverlap = writes.length
  await page.getByRole('button', { name: '确认创建场次', exact: true }).click()
  await page.getByText('原文范围与场次「改名保留来源」重叠，请调整范围', { exact: true }).waitFor()
  assert.equal(writes.length, beforeOverlap)
  await nativeSelect(0, 6)
  failSave = true
  await page.getByRole('button', { name: '确认创建场次', exact: true }).click()
  await page.getByText('原文或场次版本冲突，输入已保留', { exact: true }).waitFor()
  assert.equal(await page.getByRole('textbox', { name: '场次标题', exact: true }).inputValue(), '重叠测试')
  failSave = false
  await page.getByRole('button', { name: '确认创建场次', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('[aria-busy=true]'))
  assert.equal(sequences.length, 2)
  // AI analysis requires a click. Preview and mode changes cannot create scenes.
  await page.getByRole('radio', { name: 'AI 划分', exact: true }).locator('../..').click()
  assert.equal(analyses, 0)
  await page.getByRole('button', { name: '开始 AI 分析', exact: true }).click()
  await page.getByRole('button', { name: '查看划场建议', exact: true }).click()
  await page.getByRole('region', { name: 'AI 场次建议', exact: true }).waitFor()
  assert.equal(analyses, 1)
  const beforeCandidates = writes.length
  await page.getByRole('button', { name: '核对并创建场次', exact: true }).first().click()
  assert.equal(await page.getByRole('button', { name: '确认创建场次', exact: true }).isDisabled(), true)
  await page.getByRole('combobox', { name: '原文出现位置', exact: true }).locator('../..').click()
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: '第 2 次出现' }).click()
  assert.equal(await page.getByLabel('选中原文', { exact: true }).textContent(), '她😀推门。')
  await discard()
  await page.getByRole('button', { name: '核对并创建场次', exact: true }).nth(2).click()
  assert.equal(await page.getByRole('button', { name: '确认创建场次', exact: true }).isDisabled(), true)
  await discard()
  assert.equal(writes.length, beforeCandidates)
  await page.getByRole('button', { name: '核对并创建场次', exact: true }).nth(1).click()
  holdSave = true
  await page.getByRole('button', { name: '确认创建场次', exact: true }).click()
  await page.getByText('操作处理中，完成后可继续编辑。', { exact: true }).waitFor()
  assert.equal(await page.getByRole('textbox', { name: '场次标题', exact: true }).isDisabled(), true)
  holdSave = false; releaseSave()
  await page.waitForFunction(() => !document.querySelector('[aria-busy=true]'))
  assert.equal(sequences.length, 3)
  assert.deepEqual(writes.at(-1).span, { start: 12, end: 17 })
  assert.equal(await page.getByRole('button', { name: '核对并创建场次', exact: true }).nth(1).isDisabled(), true)
  await page.getByRole('button', { name: '返回场次列表', exact: true }).click()
  await page.getByRole('textbox', { name: '场次标题', exact: true }).waitFor()
  assert.equal(new URL(page.url()).searchParams.get('sequence'), 's3')
  assert.equal(await page.getByRole('button', { name: '在原文中调整范围', exact: true }).evaluate(element => document.activeElement === element), true)
  // Long source scroll is browsing state, and switching the selection surface preserves it.
  sourceRaw = raw + '\n' + '尚未分配的长段落。\n'.repeat(180)
  await page.goto(`${base}&chapter=ch1&panel=source`)
  await page.locator('.chapter-source-text').waitFor()
  await page.locator('.chapter-source-text').evaluate(element => { element.scrollTop = 1200; element.dispatchEvent(new Event('scroll')) })
  await page.waitForFunction(() => JSON.parse(sessionStorage.getItem('chapter-browse:["p1","ch1"]')).sourceTop === 1200)
  await page.reload(); await page.locator('.chapter-source-text').waitFor()
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
  assert.equal(await page.getByRole('button', { name: '确认保存范围', exact: true }).isDisabled(), true)
  await page.getByRole('button', { name: '查看划场建议', exact: true }).click()
  await page.getByText('原文已变化，请重新分析；旧建议保留供参考。', { exact: true }).waitFor()
  for (const button of await page.getByRole('button', { name: '核对并创建场次', exact: true }).all()) assert.equal(await button.isDisabled(), true)
  // Dirty range survives cancellation, and discard permits navigation.
  await page.getByRole('radio', { name: '手动划分', exact: true }).locator('../..').click()
  await page.getByRole('button', { name: '手动新建场次', exact: true }).click()
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
    await drawer.getByRole('button', { name: '划分场次', exact: true }).click()
    await page.getByRole('region', { name: '完整章节原文', exact: true }).waitFor()
    await drawer.evaluate(element => Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))))
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `source ${width}`)
    assert.equal(await drawer.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true, `drawer ${width}`)
    await page.screenshot({ path: join(evidence, `source-${width}.png`), animations: 'disabled' })
    await page.getByRole('button', { name: '键盘/触屏选区', exact: true }).click()
    const input = page.getByRole('textbox', { name: '键盘或触屏选择原文', exact: true })
    await input.focus(); await page.keyboard.press('ControlOrMeta+Home'); await page.keyboard.down('Shift'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await page.keyboard.up('Shift')
    if (width === 375) await page.getByRole('button', { name: '查看并确认当前选区', exact: true }).click()
    await page.getByLabel('选中原文', { exact: true }).filter({ hasText: '她😀' }).waitFor()
    await drawer.getByRole('button', { name: 'Close', exact: true }).click()
    await page.getByRole('button', { name: '放弃修改并继续', exact: true }).click()
  }
  // textarea normalizes Windows newlines; persisted offsets must still refer to the original CRLF source.
  await page.setViewportSize({ width: 1440, height: 1000 })
  version = 'v3'; sourceRaw = '前言\r\n' + raw; sequences.forEach(row => { row.source_changed = true })
  await page.goto(`${base}&chapter=ch1&panel=source`)
  await page.getByRole('button', { name: '手动新建场次', exact: true }).click()
  await page.getByRole('textbox', { name: '场次标题', exact: true }).fill('Windows 换行范围')
  await page.getByRole('button', { name: '键盘/触屏选区', exact: true }).click()
  await page.getByRole('textbox', { name: '键盘或触屏选择原文', exact: true }).evaluate(element => { element.focus(); element.setSelectionRange(3, 6); document.dispatchEvent(new Event('selectionchange')) })
  await page.locator('[aria-label="选中原文"][data-start="4"][data-end="6"]').waitFor()
  await page.getByRole('button', { name: '确认创建场次', exact: true }).click()
  await page.getByRole('button', { name: '确认保存范围', exact: true }).waitFor()
  assert.deepEqual(writes.at(-1).span, { start: 4, end: 6 })
  assert.equal(sequences.at(-1).source_text, '她😀')
  await page.goto(`${base}&chapter=ch2`)
  await page.getByText('本章尚无场次，请先从原文划分场次', { exact: true }).waitFor()
  await page.getByRole('button', { name: '从原文划分场次', exact: true }).click()
  await page.getByRole('button', { name: '填写章节原文', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '手动新建场次', exact: true }).isDisabled(), true)
  assert.deepEqual(errors, [])
  console.log(`Source selection browser checks passed: table, default detail, native/DOM Unicode ranges, conflict, AI, outdated sources, draft guards, four sizes. Evidence: ${evidence}`)
} catch (error) { console.error(await page?.locator('body').innerText()); console.error(errors); throw error } finally { await browser?.close(); await server.close() }
