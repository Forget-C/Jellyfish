import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeWorkspace } from './directing-fixtures.mjs'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url)); process.chdir(root)
const port = Number(process.env.CHAPTER_NAV_PORT || 4201)
const server = await createServer({ root, server: { host: '127.0.0.1', port, strictPort: true, open: false } })
const evidence = await mkdtemp(join(tmpdir(), 'jellyfish-chapter-scenes-'))
const chapter = { id: 'ch1', project_id: 'p1', index: 1, title: '第一章', raw_text: '她推开门。她推开门。后场结束。', status: 'draft' }
const chapters = [chapter]
const chapterTaskIds = []
const sequence = { id: 's1', project_id: 'p1', chapter_id: 'ch1', position: 0, title: '推门', version: 1, source: { kind: 'chapter', reference: 'ch1', version: 'v1' }, span: { start: 0, end: 5 }, source_text: '她推开门。', source_changed: false }
const sequences = [sequence]
let fullReads = 0, failSave = false, designWrites = 0, failOverview = true, overviewReads = 0
let releaseDesignSave, holdOverview = false, releaseOverview, overviewStarted
let failSource = false
const writes = [], errors = []
let browser, page
try {
  await server.listen(); browser = await chromium.launch({ headless: true })
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } }); page.setDefaultTimeout(10000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: location.origin } })
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname
    const respond = data => route.fulfill({ json: { success: true, data } })
    if (/\/chapters\/[^/]+\/history$/.test(path)) return respond([])
    if (path.endsWith('/projects/p1')) return respond({ id: 'p1', name: '测试项目', stats: {} })
    if (path.endsWith('/division/history')) return respond({ items: chapterTaskIds.map(id => ({ id, kind: 'analysis', origin: 'ai', status: 'succeeded', save_relation: 'unknown', created_at: '2026-09-30T12:00:00Z', number: null, is_current: false })), total: chapterTaskIds.length, page: 1, page_size: 10, active_task_ids: [] })
    if (path.includes('/division/analyses/')) return respond({ analysis: { id: 'old-analysis', status: 'succeeded' }, raw_text: '她推开门。', source_version: 'old-source', result: { scenes: [{ title: '旧原文建议', purpose: '仅供参考', excerpt: '她推开门。' }] }, issues: ['分析时的场次基线资料不完整'], source_changed: true, baseline_changed: true, baseline: null, saved_versions: [] })
    if (path.endsWith('/directing/tasks/old-analysis')) return respond({ task_id: 'old-analysis', kind: 'directing_divide', status: 'succeeded', source_version: 'old-source', division: { scenes: [{ title: '旧原文建议', purpose: '仅供参考', excerpt: '她推开门。' }] } })
    if (path.endsWith('/chapters')) return respond({ items: chapters.map(row => ({ ...row, sequence_count: row.id === 'ch1' ? sequences.length : 0 })), pagination: { total: chapters.length } })
    if (path.endsWith('/directing/chapters/ch2')) return respond({ chapter_id: 'ch2', title: '第二章', raw_text: chapter.raw_text, source_version: 'v1', sequences: [], task_ids: [] })
    if (path.endsWith('/ch2/overview')) return respond({ chapter_id: 'ch2', title: '第二章', source_version: 'v1', sequences: [] })
    if (path.endsWith('/ch1/overview')) {
      overviewReads++
      if (failOverview) return route.fulfill({ status: 503, json: { detail: '章节概览暂不可用' } })
      if (holdOverview) { await new Promise(resolve => { releaseOverview = resolve; overviewStarted() }) }
      return respond({ chapter_id: 'ch1', title: chapter.title, source_version: 'v1', sequences: sequences.map(sequence => ({ ...sequence, source_excerpt: sequence.source_text, design_count: 0, confirmed_design_count: 0, plan_count: 0, confirmed_plan_count: 0, take_count: 0, unreviewed_take_count: 0, active_cut_revision_id: null })) })
    }
    if (path.endsWith('/directing/chapters/ch1')) {
      fullReads++
      if (failSource) return route.fulfill({ status: 503, json: { detail: '章节原文暂不可用' } })
      return respond({ chapter_id: 'ch1', title: chapter.title, raw_text: chapter.raw_text, source_version: 'v1', sequences, task_ids: chapterTaskIds })
    }
    if (path.endsWith('/chapters/ch1')) return respond({ ...chapter, sequence_count: sequences.length })
    if (path.endsWith('/chapters/missing')) return route.fulfill({ status: 404, json: { detail: '章节不存在或不属于当前项目' } })
    if (path.endsWith('/chapters/ch1/assembly')) return respond({ chapter_id: 'ch1', title: chapter.title, transitions: [], gaps: ['本场尚无已确认粗剪'], sequences: [{ sequence_id: 's1', title: sequence.title, position: 0, cut_revision_id: null, review_id: null, verdict: 'unreviewed', sound_status: 'pending_postproduction', source_changed: false, items: [], timeline_starts_ms: [], duration_ms: 0, gaps: ['本场尚无已确认粗剪'] }] })
    if (path.endsWith('/s1/revisions') && req.method() === 'POST') {
      designWrites++
      await new Promise(resolve => { releaseDesignSave = resolve })
      return route.fulfill({ status: 409, json: { detail: '切场保存冲突，设计已保留' } })
    }
    if (path.endsWith('/division/preview')) {
      const draft = req.postDataJSON()
      return respond({ preview_token: 'nav-preview', impacts: draft.members.map(member => ({ key: member.key, before: sequences.find(row => row.id === member.sequence_id) || null, after: member, changes: member.sequence_id ? [] : ['added'], design_count: 0, plan_count: 0, take_count: 0, cut_count: 0 })), blockers: [], unassigned_character_count: 0, identity_confirmation_required: false })
    }
    if (path.endsWith('/division') && req.method() === 'PUT') {
      const body = req.postDataJSON(); writes.push(body)
      const created = {}
      for (const [position, member] of body.draft.members.entries()) {
        if (member.sequence_id) continue
        const id = `s${sequences.length + 1}`; created[member.key] = id
        sequences.push({ ...sequence, id, title: member.title, span: member.span, position, version: 1, source_text: chapter.raw_text.slice(member.span.start, member.span.end) })
      }
      return respond({ request_id: body.request_id, chapter: { chapter_id: 'ch1', title: chapter.title, raw_text: chapter.raw_text, source_version: 'v1', sequences, task_ids: chapterTaskIds }, created_sequence_ids: created, impacts: [] })
    }
    if (/\/sequences\/s[0-9]+$/.test(path) && req.method() === 'GET') {
      const workspace = makeWorkspace()
      workspace.sequence = sequences.find(row => row.id === path.split('/').at(-1))
      for (const key of ['designs', 'plans', 'prompts', 'reviews', 'takes', 'cuts', 'task_ids']) workspace[key] = []
      return respond(workspace)
    }
    if (path.endsWith('/sequences/s1') && req.method() !== 'GET') {
      const body = req.postDataJSON(); writes.push(body)
      if (failSave) return route.fulfill({ status: 409, json: { detail: '版本冲突，请核对' } })
      assert.equal(body.expected_version, sequence.version); assert.equal(body.source_version, 'v1')
      Object.assign(sequence, { title: body.title, position: body.position, ...(body.span ? { span: body.span } : {}), version: sequence.version + 1 })
      return respond(sequence)
    }
    return respond({ items: [], total: 0 })
  })
  await page.goto(`http://127.0.0.1:${port}/projects/p1?tab=chapters&chapter=ch1`)
  await page.getByText('章节概览暂不可用', { exact: false }).waitFor()
  assert.equal(fullReads, 0)
  assert.equal(writes.length, 0)
  const failedReads = overviewReads
  failOverview = false
  await page.getByRole('button', { name: /^重\s*试$/ }).click()
  await page.getByRole('button', { name: '1. 推门', exact: true }).waitFor()
  assert.equal(overviewReads, failedReads + 1)
  await page.getByRole('textbox', { name: '场次标题', exact: true }).waitFor()
  assert.ok(fullReads > 0)
  assert.equal(writes.length, 0)
  const drawer = page.locator('.ant-drawer-open')
  await drawer.getByRole('textbox', { name: '场次标题', exact: true }).fill('新的场次名')
  const detailReads = fullReads
  assert.ok(detailReads > 0)
  await drawer.getByRole('button', { name: /^保\s*存$/ }).click()
  await drawer.getByRole('heading', { name: '新的场次名', exact: true }).waitFor()
  assert.ok(page.url().includes('tab=chapters'))
  assert.equal(writes.length, 1)
  assert.equal(writes[0].span, null)
  await drawer.getByRole('textbox', { name: '场次标题', exact: true }).fill('未保存标题')
  await drawer.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: '取消，继续编辑', exact: true }).click()
  assert.equal(await drawer.getByRole('textbox', { name: '场次标题', exact: true }).inputValue(), '未保存标题')
  failSave = true
  await drawer.getByRole('button', { name: /^保\s*存$/ }).click()
  await drawer.getByText('版本冲突，请核对', { exact: false }).waitFor()
  assert.equal(await drawer.getByRole('textbox', { name: '场次标题', exact: true }).inputValue(), '未保存标题')
  await drawer.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: '放弃修改并继续', exact: true }).click()
  await drawer.waitFor({ state: 'hidden' })
  assert.equal(fullReads, detailReads)
  assert.equal(writes.length, 2)
  await page.goto(`http://127.0.0.1:${port}/projects/p1/chapters/ch1/sequences`)
  await page.waitForURL(url => url.pathname === '/projects/p1' && url.searchParams.get('tab') === 'chapters' && url.searchParams.get('chapter') === 'ch1')
  await page.locator('.ant-drawer-open').getByRole('button', { name: '调整划分', exact: true }).click()
  await page.getByRole('region', { name: '完整章节原文', exact: true }).waitFor()
  for (const title of ['连续第一场', '连续第二场']) {
    await page.getByRole('button', { name: '新增场次', exact: true }).click()
    const modal = page.getByRole('complementary', { name: '当前选区', exact: true })
    await modal.getByRole('textbox', { name: '场次标题', exact: true }).fill(title)
    if (!await page.getByRole('textbox', { name: '键盘或触屏选择原文', exact: true }).count()) await page.getByRole('button', { name: '键盘/触屏选区', exact: true }).click()
    const start = title === '连续第一场' ? 5 : 10
    await page.getByRole('textbox', { name: '键盘或触屏选择原文', exact: true }).evaluate((element, start) => { element.focus(); element.setSelectionRange(start, start + 5); document.dispatchEvent(new Event('selectionchange')) }, start)
    await page.locator(`[aria-label="选中原文"][data-start="${start}"]`).waitFor()
    assert.equal(writes.length, 2, '连续添加先留在同一整章草稿')
    assert.ok(page.url().includes('panel=source'))
  }
  await page.getByRole('button', { name: '保存新版本', exact: true }).click()
  await page.getByRole('button', { name: '保存本章划分', exact: true }).click()
  await page.getByText('已保存本章划分。', { exact: true }).waitFor()
  assert.equal(writes.length, 3)
  assert.deepEqual(writes[2].draft.members.slice(1).map(row => row.title), ['连续第一场', '连续第二场'])
  await page.goto(`http://127.0.0.1:${port}/projects/p1/chapters/ch1/sequences/s1?view=design&plan=old-plan&unit=old-unit`)
  await page.getByRole('button', { name: '手动起稿', exact: true }).click()
  await page.getByRole('button', { name: '分镜 1', exact: true }).click()
  await page.getByRole('textbox', { name: '可见结果', exact: true }).fill('跨场前仍未保存的动作')
  await page.getByRole('button', { name: '下一场', exact: true }).click()
  await page.getByRole('button', { name: '保存后继续', exact: true }).click()
  await page.getByRole('dialog', { name: '当前操作尚未完成', exact: true }).waitFor()
  assert.ok(new URL(page.url()).pathname.endsWith('/sequences/s1'))
  assert.equal(designWrites, 1)
  assert.equal(await page.getByRole('button', { name: /保存后继续/ }).isDisabled(), true)
  assert.equal(await page.getByRole('button', { name: '放弃修改并继续', exact: true }).isDisabled(), true)
  assert.equal(await page.getByRole('button', { name: '留在当前页', exact: true }).isDisabled(), true)
  await page.keyboard.press('Escape')
  await page.getByRole('dialog', { name: '当前操作尚未完成', exact: true }).waitFor()
  releaseDesignSave()
  await page.getByText('拍摄方案未保存成功，请处理页面中的提示后重试。', { exact: true }).waitFor()
  assert.equal(designWrites, 1)
  assert.ok(new URL(page.url()).pathname.endsWith('/sequences/s1'))
  await page.getByRole('button', { name: '取消，继续编辑', exact: true }).click()
  assert.ok(new URL(page.url()).pathname.endsWith('/sequences/s1'))
  assert.equal(await page.getByRole('textbox', { name: '可见结果', exact: true }).inputValue(), '跨场前仍未保存的动作')
  assert.equal(writes.length, 3)
  await page.getByRole('button', { name: '下一场', exact: true }).click()
  await page.getByRole('button', { name: '放弃修改并继续', exact: true }).click()
  await page.waitForURL(url => url.pathname.endsWith('/sequences/s2') && url.searchParams.get('view') === 'design')
  assert.equal(new URL(page.url()).searchParams.get('plan') || '', '')
  assert.equal(new URL(page.url()).searchParams.get('unit') || '', '')
  await page.getByRole('button', { name: '返回章节', exact: true }).click()
  await page.waitForURL('**chapter=ch1&sequence=s2')
  await page.locator('.ant-drawer-open').getByRole('textbox', { name: '场次标题', exact: true }).waitFor()
  assert.equal(await page.locator('.ant-drawer-open').getByRole('textbox', { name: '场次标题', exact: true }).inputValue(), '连续第一场')
  await page.locator('.ant-drawer-open').getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: /继续工作/ }).click()
  await page.waitForURL(url => url.pathname.endsWith('/sequences/s2') && url.searchParams.get('view') === 'design')
  assert.equal(writes.length, 3)
  const readsBeforeOverview = fullReads
  await page.goto(`http://127.0.0.1:${port}/projects/p1?tab=dashboard`)
  await page.getByRole('button', { name: '连续第一场 · 继续设计', exact: true }).click()
  await page.waitForURL(url => url.pathname.endsWith('/sequences/s2') && url.searchParams.get('view') === 'design')
  assert.equal(fullReads, readsBeforeOverview)
  sequence.source_changed = true
  await page.goto(`http://127.0.0.1:${port}/projects/p1?tab=dashboard`)
  await page.getByRole('button', { name: '新的场次名 · 核对原文', exact: true }).click()
  await page.waitForURL('**tab=chapters&chapter=ch1&sequence=s1')
  await page.locator('.ant-drawer-open').getByRole('textbox', { name: '场次标题', exact: true }).waitFor()
  await page.locator('.ant-drawer-open').getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: '第一章 · 3 场', exact: true }).click()
  await page.getByRole('textbox', { name: '搜索本章场次', exact: true }).fill('连续第二场')
  await page.getByRole('button', { name: '继续设计', exact: true }).click()
  await page.waitForURL(url => url.pathname.endsWith('/sequences/s3') && url.searchParams.get('view') === 'design')
  await page.getByRole('button', { name: '返回章节', exact: true }).click()
  await page.locator('.ant-drawer-open').getByRole('textbox', { name: '场次标题', exact: true }).waitFor()
  assert.equal(await page.getByRole('textbox', { name: '搜索本章场次', exact: true }).inputValue(), '连续第二场')
  assert.equal(await page.getByRole('button', { name: '继续设计', exact: true }).count(), 1)
  await page.locator('.ant-drawer-open').getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: '第一章 · 3 场', exact: true }).click()
  await page.getByRole('textbox', { name: '搜索本章场次', exact: true }).fill('')
  for (let index = 4; index <= 60; index++) sequences.push({ ...sequence, id: `s${index}`, position: index - 1, title: `长列表场次 ${index}`, source_changed: false })
  await page.reload()
  const targetRow = page.locator('.ant-list-item').filter({ hasText: '长列表场次 40' })
  await targetRow.getByRole('button', { name: '继续设计', exact: true }).scrollIntoViewIfNeeded()
  const scroll = page.locator('.chapter-scenes-list')
  const previousTop = await scroll.evaluate(element => element.scrollTop)
  assert.ok(previousTop > 1000)
  await targetRow.getByRole('button', { name: '继续设计', exact: true }).click()
  await page.waitForURL(url => url.pathname.endsWith('/sequences/s40') && url.searchParams.get('view') === 'design')
  await page.getByRole('button', { name: '返回章节', exact: true }).click()
  await page.locator('.ant-drawer-open').getByRole('textbox', { name: '场次标题', exact: true }).waitFor()
  await page.waitForFunction(top => Math.abs(document.querySelector('.chapter-scenes-list').scrollTop - top) < 2, previousTop)
  chapters.push({ ...chapter, id: 'ch2', index: 2, title: '第二章' })
  holdOverview = true
  const waitingOverview = new Promise(resolve => { overviewStarted = resolve })
  await page.goto(`http://127.0.0.1:${port}/projects/p1?tab=chapters&chapter=ch1`)
  await waitingOverview
  await drawer.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: '第二章 · 0 场', exact: true }).click()
  await page.getByRole('button', { name: 'AI智能划分', exact: true }).waitFor()
  const oldResponse = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/ch1/overview'))
  holdOverview = false
  releaseOverview()
  await (await oldResponse).finished()
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  assert.equal(await page.locator('.ant-list-item').count(), 0)
  await page.getByRole('button', { name: 'AI智能划分', exact: true }).waitFor()
  await page.goto(`http://127.0.0.1:${port}/projects/p1?tab=chapters`)
  await page.getByRole('button', { name: '第二章 · 0 场', exact: true }).waitFor()
  assert.equal(await drawer.count(), 0)
  chapters.pop()
  await page.reload()
  await page.getByRole('button', { name: '第一章 · 60 场', exact: true }).waitFor()
  assert.equal(await drawer.count(), 0)
  await page.goto(`http://127.0.0.1:${port}/projects/p1?tab=chapters&chapter=missing`)
  await page.getByText('章节不存在或不属于当前项目', { exact: false }).waitFor()
  assert.equal(await page.locator('.ant-list-item').count(), 0)
  await page.goto(`http://127.0.0.1:${port}/projects/p1?tab=chapters&chapter=ch1&sequence=missing`)
  await drawer.getByText('场次不存在或不属于当前章节', { exact: false }).waitFor()
  assert.equal(new URL(page.url()).searchParams.get('sequence'), 'missing')
  chapterTaskIds.push('old-analysis')
  failSource = true
  await page.goto(`http://127.0.0.1:${port}/projects/p1?tab=chapters&chapter=ch1&panel=source`)
  await page.getByText('章节原文暂不可用', { exact: false }).waitFor()
  failSource = false
  await page.getByRole('button', { name: /^重\s*试$/ }).click()
  await page.getByRole('button', { name: 'AI智能划分', exact: true }).waitFor()
  assert.equal(await page.getByText('章节原文暂不可用', { exact: false }).count(), 0)
  assert.equal(await page.getByRole('button', { name: '查看过期分析结果', exact: true }).count(), 0)
  await page.getByRole('button', { name: '历史版本', exact: true }).click()
  const historyModal = page.getByRole('dialog', { name: '历史版本', exact: true })
  await historyModal.getByRole('button', { name: '展开', exact: true }).click()
  await historyModal.getByText('基于旧原文，载入后需要重新定位全部范围。', { exact: true }).waitFor()
  assert.equal(await historyModal.getByRole('button', { name: '载入编辑', exact: true }).isDisabled(), true)
  await historyModal.getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByRole('button', { name: '新增场次', exact: true }).click()
  const pendingScene = page.getByRole('complementary', { name: '当前选区', exact: true })
  await pendingScene.getByRole('textbox', { name: '场次标题', exact: true }).fill('尚未确认的新场次')
  await drawer.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: '取消，继续编辑', exact: true }).click()
  assert.equal(await pendingScene.getByRole('textbox', { name: '场次标题', exact: true }).inputValue(), '尚未确认的新场次')
  await drawer.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: '放弃修改并继续', exact: true }).click()
  await drawer.waitFor({ state: 'hidden' })
  assert.equal(writes.length, 3)
  await page.goto(`http://127.0.0.1:${port}/projects/p1?tab=chapters&chapter=ch1`)
  assert.equal(await drawer.getByRole('button', { name: '章节组合', exact: true }).count(), 0)
  await drawer.getByRole('button', { name: 'Close', exact: true }).click()
  await drawer.waitFor({ state: 'hidden' })
  assert.equal(await page.getByRole('button', { name: '章节组合', exact: true }).count(), 0)
  for (const width of [1440, 1024, 768, 375]) {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 })
    await page.evaluate(() => sessionStorage.removeItem('chapter-browse:["p1","ch1"]'))
    await page.goto(`http://127.0.0.1:${port}/projects/p1?tab=chapters&chapter=ch1`)
    if (width === 375) await drawer.getByRole('button', { name: '返回场次列表', exact: true }).click()
    const details = page.getByRole('button', { name: /^详\s*情$/ }).first()
    await details.scrollIntoViewIfNeeded()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `${width}: chapter overflow`)
    const title = page.locator('.ant-list-item').first().getByRole('button', { name: /^1\./ })
    await title.focus()
    await page.keyboard.press('Enter')
    await drawer.getByRole('textbox', { name: '场次标题', exact: true }).waitFor()
    assert.equal(await drawer.getByRole('textbox', { name: '场次标题', exact: true }).inputValue(), sequences[0].title)
    await drawer.evaluate(element => Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))))
    assert.equal(await drawer.evaluate(element => { const box = element.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth + 1 && element.scrollWidth <= element.clientWidth + 1 }), true, `${width}: detail overflow`)
    const save = drawer.getByRole('button', { name: /^保\s*存$/ })
    await save.scrollIntoViewIfNeeded()
    assert.equal(await save.evaluate(element => { const box = element.getBoundingClientRect(); return box.top >= 0 && box.bottom <= innerHeight && element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)) }), true, `${width}: detail save obscured`)
    await page.screenshot({ path: join(evidence, `scene-${width}.png`), animations: 'disabled' })
    if (width === 375) {
      await drawer.getByRole('button', { name: '返回场次列表', exact: true }).click()
      await drawer.getByRole('textbox', { name: '搜索本章场次', exact: true }).waitFor()
      assert.equal(await drawer.getByRole('textbox', { name: '场次标题', exact: true }).count(), 0)
    }
    await drawer.getByRole('button', { name: 'Close', exact: true }).click()
    await drawer.waitFor({ state: 'hidden' })
  }
  assert.equal(writes.length, 3)
  assert.deepEqual(errors, [])
  await page.goto(`http://127.0.0.1:${port}/projects/p1/chapters/ch1/sequences?panel=assembly`)
  await page.waitForURL(url => url.pathname === '/projects/p1/chapters/ch1/workbench-management')
  await page.getByText('章节组合已停用，可在工作台管理中继续准备场次。', { exact: true }).waitFor()
  await page.goto(`http://127.0.0.1:${port}/projects/p1/chapters/ch1/sequences?sequence=s1`)
  await drawer.getByRole('textbox', { name: '场次标题', exact: true }).waitFor()
  assert.equal(await drawer.getByRole('textbox', { name: '场次标题', exact: true }).inputValue(), sequences[0].title)
  failSave = false
  await drawer.getByRole('spinbutton', { name: '场次顺序', exact: true }).fill('3')
  await drawer.getByRole('button', { name: /^保\s*存$/ }).click()
  await page.waitForFunction(() => document.querySelector('.ant-drawer-open input[aria-label="场次顺序"]')?.value === '3' && !document.querySelector('.ant-drawer-open .ant-btn-loading'), undefined, { timeout: 10000 })
  assert.equal(writes.length, 4)
  assert.equal(writes.at(-1).position, 2)
  assert.equal(new URL(page.url()).pathname, '/projects/p1')
  assert.equal(new URL(page.url()).searchParams.get('sequence'), 's1')
  chapters.push({ ...chapter, id: 'ch2', index: 2, title: '第二章' })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`http://127.0.0.1:${port}/projects/p1?tab=chapters&chapter=ch2`)
  await drawer.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: '第一章 · 60 场', exact: true }).click()
  await page.locator('.ant-drawer-open').getByRole('button', { name: '调整划分', exact: true }).click()
  await page.getByRole('region', { name: '完整章节原文', exact: true }).waitFor()
  await page.getByRole('button', { name: '新增场次', exact: true }).click()
  await pendingScene.getByRole('textbox', { name: '场次标题', exact: true }).fill('切章前的未确认场次')
  await page.evaluate(() => history.back())
  await page.getByRole('button', { name: '取消，继续编辑', exact: true }).click()
  assert.equal(new URL(page.url()).searchParams.get('chapter'), 'ch1')
  assert.equal(await pendingScene.getByRole('textbox', { name: '场次标题', exact: true }).inputValue(), '切章前的未确认场次')
  await page.evaluate(() => history.back())
  await page.getByRole('button', { name: '放弃修改并继续', exact: true }).click()
  await page.waitForURL(url => !url.searchParams.has('chapter'))
  await page.getByRole('button', { name: '第二章 · 0 场', exact: true }).waitFor()
  assert.equal(writes.length, 4)
  chapters.length = 0
  await page.goto(`http://127.0.0.1:${port}/projects/p1?tab=chapters`)
  await page.getByText('添加第一章，开始划分场次', { exact: true }).waitFor()
  await page.getByRole('button', { name: /新建章节/ }).click()
  await page.getByRole('textbox', { name: '章节标题', exact: true }).waitFor()
  assert.equal(writes.length, 4)
  assert.deepEqual(errors, [])
  console.log(`Chapter navigation: detail saves stay in chapter, close guard, conflict preserves input, lazy detail loading passed. Evidence: ${evidence}`)
} catch (error) { console.error(await page?.locator("body").innerText()); console.error(errors); throw error } finally { await browser?.close(); await server.close() }
