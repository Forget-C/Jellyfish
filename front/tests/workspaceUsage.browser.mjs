import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createServer } from 'vite'
import { makeWorkspace, revision } from './directing-fixtures.mjs'

// Playwright may be supplied by the desktop runtime through NODE_PATH; no live backend is used.
const { chromium } = createRequire(import.meta.url)('playwright')
process.chdir(fileURLToPath(new URL('..', import.meta.url)))
const output = await mkdtemp(join(tmpdir(), 'jellyfish-ux1-'))
const mediaPath = join(output, 'sample.mp4')
execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=steelblue:s=640x360:d=6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mediaPath])
const media = await readFile(mediaPath)
const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { host: '127.0.0.1', port: 4178, strictPort: true, open: false } })
let browser
let page
try {
  await server.listen()
  browser = await chromium.launch({ headless: true })
  page = await browser.newPage({ viewport: { width: 1440, height: 1050 } })
  page.setDefaultTimeout(15000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const workspace = makeWorkspace()
  let activeId = 'c-active'
  let continuityExtra = { frames: [], seams: [], units: [] }
  let feedbackMode = 'ok'
  let failRevisionSave = false
  const pendingFeedback = []
  const writes = []
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const payload = data => ({ success: true, data })
  await page.route('**/api/**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const respond = data => route.fulfill({ json: payload(structuredClone(data)) })
    if (path.endsWith('/sources/resolve')) return respond(request.postDataJSON().sources.map(source => ({ source, status: source.kind === 'human' ? 'ready' : 'unavailable', label: source.kind === 'human' ? '人工填写' : '历史来源', description: '隔离来源记录' })))
    if (path.endsWith('/ux1-sample.mp4')) return route.fulfill({ body: media, contentType: 'video/mp4' })
    if (request.method() !== 'GET') writes.push({ path, body: request.postDataJSON() })
    if (path.endsWith('/s1/feedback')) {
      if (feedbackMode === 'hold') return new Promise(resolve => pendingFeedback.push(async id => { await respond({ active_cut_revision_id: id, current_review_id: null, reviews: [], repairs: [], knowledge: [] }); resolve() }))
      if (feedbackMode === 'fail') return route.fulfill({ status: 503, json: { detail: 'UX1 unavailable' } })
      return respond({ active_cut_revision_id: activeId, current_review_id: null, reviews: [], repairs: [], knowledge: [] })
    }
    if (path.endsWith('/s1/continuity')) return respond({ active_cut_revision_id: activeId, ...continuityExtra })
    if (path.endsWith('/s1/batches')) return respond([])
    if (path.endsWith('/s1/ledger')) return respond({ workspace, continuity: { active_cut_revision_id: activeId, frames: [], seams: [], units: [] }, feedback: { active_cut_revision_id: activeId, current_review_id: null, reviews: [], repairs: [], knowledge: [] }, actions: [], executions: [] })
    if (path.endsWith('/s1')) return respond(workspace)
    if (/\/takes\/[^/]+\/media$/.test(path)) {
      const takeId = path.split('/').at(-2)
      return respond({ take_id: takeId, file_id: `file-${takeId}`, url: '/api/ux1-sample.mp4', duration_ms: 6000 })
    }
    if (/\/takes\/[^/]+$/.test(path) && request.method() === 'PUT') {
      const take = workspace.takes.find(t => t.id === path.split('/').at(-1))
      take.annotation = request.postDataJSON().annotation
      take.version += 1
      return respond(workspace)
    }
    if (path.endsWith('/s1/revisions')) {
      const body = request.postDataJSON()
      if (failRevisionSave) return route.fulfill({ status: 409, json: { detail: '验收模拟保存冲突' } })
      const group = body.document.kind === 'cut' ? workspace.cuts : body.document.kind === 'design' ? workspace.designs : workspace.plans
      let saved = group.find(row => row.id === body.revision_id)
      if (saved) { assert.equal(saved.confirmed_at, null); saved.content = body.document.content; saved.version += 1 }
      else { saved = revision(`${body.document.kind}-${group.length + 1}`, body.document.content, false); saved.parent_id = body.parent_id || null; group.push(saved) }
      return respond(workspace)
    }
    if (/\/s1\/revisions\/[^/]+\/confirm$/.test(path)) {
      const cut = workspace.cuts.find(row => row.id === path.split('/').at(-2))
      assert.equal(cut.version, request.postDataJSON().expected_version)
      cut.confirmed_at = '2026-09-15T03:00:00'; cut.version += 1; activeId = cut.id
      return respond(workspace)
    }
    if (/\/(styles|assets|models)$/.test(path)) return respond([])
    return respond({ items: [], total: 0 })
  })
  const url = 'http://127.0.0.1:4178/projects/p1/chapters/ch1/sequences/s1?view=cut'
  async function contextAction(label) {
    if (label === '版本与历史') { await page.locator('.workspace-versions-entry').click(); return }
    await page.locator('.workspace-stage-tabs').waitFor()
    if (await page.getByRole('button', { name: '更多场次操作', exact: true }).isVisible()) await page.getByRole('button', { name: '更多场次操作', exact: true }).click()
    else await page.getByRole('button', { name: /阶段工具/ }).click()
    await page.getByRole('menuitem', { name: label, exact: true }).click()
  }
  async function closeDrawer() { if (await page.getByRole('dialog', { name: '版本与依据', exact: true }).isVisible()) { await page.getByRole('dialog', { name: '版本与依据', exact: true }).getByRole('button', { name: /^关\s*闭$/ }).click(); await page.getByRole('dialog', { name: '版本与依据', exact: true }).waitFor({ state: 'hidden' }); return } await page.locator('.ant-drawer-open').last().getByRole('button', { name: 'Close', exact: true }).click(); await page.waitForTimeout(350) }
  async function text(value) {
    if (/^当前查看： · 计划/.test(value)) {
      const summary = page.locator('summary').filter({ hasText: /^版本与引用$/ })
      if (!await summary.locator('..').evaluate(element => element.open)) await summary.click()
    }
    if (/^当前查看： · (设计|剪辑)/.test(value)) {
      const [, kind, number] = value.match(/(设计|剪辑) (\d+)/)
      const selector = page.getByRole('button', { name: /^版本与依据/ })
      await selector.waitFor()
      await selector.click()
      assert.match(await page.locator('.workspace-version-context').innerText(), new RegExp(kind + ' 0?' + number))
      await closeDrawer()
      return
    }
    if (/^当前采用：剪辑|^正在核对当前采用|^采用状态暂不可用|^尚未确认采用剪辑/.test(value)) {
      await contextAction('当前进展'); await page.getByText(value, { exact: true }).filter({ visible: true }).first().waitFor(); await closeDrawer(); return
    }
    if (/^当前采用：片段|^编辑草稿已选入|^采用状态加载中$/.test(value)) {
      await page.locator('.cut-inspector').getByRole('tab', { name: '来源', exact: true }).click()
      await page.getByText(value, { exact: true }).filter({ visible: true }).first().waitFor()
      await page.locator('.cut-inspector').getByRole('tab', { name: '审片', exact: true }).click(); return
    }
    await page.getByText(value, { exact: true }).first().waitFor({ state: 'visible' })
  }
  async function choose(label, title) {
    const versionKind = { '查看或编辑设计版本': ['设计版本', '设计'], '查看或编辑生产计划': ['生产计划版本', '计划'], '查看或编辑剪辑版本': ['剪辑版本', '剪辑'] }[label]
    if (versionKind) {
      if (!await page.getByRole('dialog', { name: '版本与依据', exact: true }).isVisible()) await page.getByRole('button', { name: /^版本与依据/ }).click()
      const versionDialog = page.getByRole('dialog', { name: '版本与依据', exact: true })
      await versionDialog.getByRole('tab', { name: versionKind[0], exact: true }).click()
      const number = title.match(/\d+/)[0]
      await versionDialog.locator('tr[data-row-key]').filter({ has: page.getByText(`${versionKind[1]} ${number}`, { exact: true }) }).getByRole('button', { name: /^(基于此版本编辑|继续编辑草稿)$/ }).click()
      return
    }
    if (label === '选择候选 Take') { await page.locator('.cut-take-library button').filter({ hasText: `候选 ${title.match(/Take (\d+)/)[1].padStart(2, '0')}` }).click(); return }
    await page.getByRole('combobox', { name: label, exact: true }).locator('../..').click()
    await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: label === '查看或编辑设计版本' ? new RegExp('设计 0?' + title.match(/设计 (\d+)/)[1]) : title }).first().click()
  }
  async function settled() { await text(`当前采用：剪辑 ${workspace.cuts.findIndex(row => row.id === activeId) + 1} · 已确认`) }
  await page.goto(url)
  await settled()
  await text('当前查看： · 剪辑 3 · 草稿')
  assert.equal(writes.length, 0)
  await contextAction('当前进展')
  await page.locator('.ant-drawer-open').getByText('查看采用区间与预演', { exact: true }).click()
  assert.ok((await page.locator('body').innerText()).includes('片段 2 · 计划 1 · 单元 01 · 候选 01 · 源区间 4.000–5.000 秒'))
  await closeDrawer()

  // A04: opening and expanding every history group performs no business writes.
  await contextAction('版本与历史')
  const drawer = page.getByRole('dialog', { name: '版本与依据', exact: true })
  await drawer.getByRole('tab', { name: '设计版本', exact: true }).click()
  await drawer.locator('tr[data-row-key="d1"] .ant-table-row-expand-icon').click()
  assert.ok((await drawer.innerText()).includes('当前采用仍在引用'))
  await drawer.getByRole('tab', { name: '剪辑版本', exact: true }).click()
  await drawer.locator('tr[data-row-key="c-old"] .ant-table-row-expand-icon').click()
  assert.ok((await drawer.innerText()).includes('已确认 · 历史版本'))
  assert.equal(writes.length, 0)
  await closeDrawer()

  // A01: latest draft remains explicitly a viewing choice, while older dependencies stay in use.
  await page.getByRole('tab', { name: '导演设计' , exact: true }).click()
  await text('当前查看： · 设计 2 · 草稿')
  await choose('查看或编辑设计版本', '设计 1 · 已确认')
  await contextAction('版本与历史')
  await page.getByRole('dialog', { name: '版本与依据', exact: true }).getByRole('tab', { name: '设计版本', exact: true }).click()
  await page.getByRole('dialog', { name: '版本与依据', exact: true }).locator('tr[data-row-key="d1"] .ant-table-row-expand-icon').click()
  await page.getByRole('dialog', { name: '版本与依据', exact: true }).getByText('计划 1 · 已确认（当前采用仍在引用）', { exact: false }).waitFor()
  await closeDrawer()
  await page.getByRole('tab', { name: '单元试拍' , exact: true }).click()
  await text('当前查看： · 计划 2 · 草稿 · 固定设计依据：设计 1')
  await choose('查看或编辑生产计划', '计划 1 · 已确认')
  await page.getByText('此计划的引用：计划 1 · 单元 01 · 候选 01（当前采用仍在引用）', { exact: false }).waitFor()
  assert.equal(writes.length, 0)
  await settled()
  await page.getByRole('tab', { name: '剪辑验收' , exact: true }).click()

  // A03: review-passed but currently unused take remains a candidate; adopted take shows both ranges.
  await choose('选择候选 Take', 'Take 2 · u1')
  assert.ok((await page.getByLabel('当前候选素材', { exact: true }).innerText()).includes('整体可用'))
  await choose('选择候选 Take', 'Take 1 · u1')
  await text('当前采用：片段 1 · 1.000–2.000 秒')
  await text('当前采用：片段 2 · 4.000–5.000 秒')
  await choose('选择候选 Take', 'Take 3 · u1')
  await page.locator('video').first().evaluate(video => new Promise(resolve => { if (video.readyState >= 1) resolve(); else video.addEventListener('loadedmetadata', resolve, { once: true }) }))
  assert.equal(await page.locator('video').first().evaluate(video => video.duration), 6)
  await page.locator('.cut-inspector').getByRole('tab', { name: '审片', exact: true }).click()
  await page.getByRole('textbox', { name: '实际观察', exact: true }).waitFor()
  await page.getByRole('button', { name: '保存审片', exact: true }).click()
  await settled()
  assert.equal(workspace.takes[2].annotation.review_status, 'reviewed')
  assert.equal(activeId, 'c-active')
  const writesAfterReview = writes.length
  await page.getByRole('spinbutton').nth(0).fill('0.8')
  await page.getByRole('spinbutton').nth(1).fill('4.6')
  await page.getByRole('button', { name: '把这一段加入剪辑草稿', exact: true }).click()
  await text('编辑草稿已选入：片段 1 · 0.800–4.600 秒（未保存）')
  assert.equal(writes.length, writesAfterReview)
  await settled()
  await page.getByRole('button', { name: '保存剪辑草稿', exact: true }).click()
  await text('编辑草稿已选入：片段 1 · 0.800–4.600 秒（已保存，未确认采用）')
  assert.equal(activeId, 'c-active')
  await page.reload()
  await settled()
  await text('编辑草稿已选入：片段 1 · 0.800–4.600 秒（已保存，未确认采用）')
  await page.getByRole('button', { name: '确认并设为当前采用', exact: true }).click()
  await text('当前采用：剪辑 3 · 已确认')
  assert.equal(activeId, 'c-draft')
  await page.reload()
  await settled()
  await text('当前采用：片段 1 · 0.800–4.600 秒')

  // A02: late successful output is a new candidate, not automatic adoption.
  workspace.takes.push({ ...structuredClone(workspace.takes[2]), id: 't4', display_number: 4, file_id: 'file4', task_id: 'new-success', annotation: { review_status: 'unreviewed', rationale: { state: 'unset' }, coverage: [], retained_ranges: [] } })
  await contextAction('刷新状态')
  await settled()
  await choose('选择候选 Take', 'Take 4 · u1')
  assert.ok((await page.getByLabel('当前候选素材', { exact: true }).innerText()).includes('当前未采用'))
  assert.equal(activeId, 'c-draft')

  // A04: loading/error states cannot temporarily label everything as unadopted.
  feedbackMode = 'hold'
  await contextAction('刷新状态')
  await text('正在核对当前采用…')
  await text('采用状态加载中')
  assert.equal(pendingFeedback.length, 1)
  const writesBeforeHistory = writes.length
  await contextAction('版本与历史')
  assert.ok(!(await page.getByRole('dialog', { name: '版本与依据', exact: true }).innerText()).includes('当前未采用'))
  await closeDrawer()
  feedbackMode = 'fail'
  await contextAction('刷新状态')
  await text('采用状态暂不可用，请刷新状态重试。')
  // Complete the previous stale request with null: it must not overwrite the newer error.
  const oldResponse = page.waitForResponse(response => response.url().endsWith('/s1/feedback') && response.status() === 200)
  for (const complete of pendingFeedback.splice(0)) await complete(null)
  await (await oldResponse).finished()
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await text('采用状态暂不可用，请刷新状态重试。')
  assert.equal(writes.length, writesBeforeHistory)
  feedbackMode = 'ok'
  await contextAction('刷新状态')
  await settled()
  assert.equal(activeId, 'c-draft')
  // Only an explicit null pointer means no adopted cut. A missing referenced cut stays unknown.
  activeId = null
  await contextAction('刷新状态')
  await text('尚未确认采用剪辑；候选素材和草稿不代表当前采用。')
  activeId = 'not-in-workspace'
  await contextAction('刷新状态')
  await text('采用状态暂不可用，请刷新状态重试。')
  activeId = 'c-draft'
  await contextAction('刷新状态')
  await settled()

  // A01/A02: a remotely updated draft does not silently replace the local editing baseline.
  const concurrent = revision('concurrent', { items: [] }, false)
  workspace.cuts.push(concurrent)
  await contextAction('刷新状态')
  await settled()
  await choose('查看或编辑剪辑版本', '剪辑 4 · 草稿')
  concurrent.content.items.push(structuredClone(workspace.cuts[2].content.items[0]))
  concurrent.version += 1
  await contextAction('刷新状态')
  await text('剪辑编辑基线已过期，请核对服务端版本后继续。')
  assert.equal(await page.getByRole('button', { name: '保存剪辑草稿', exact: true }).isDisabled(), true)
  assert.equal(await page.getByRole('button', { name: '确认并设为当前采用', exact: true }).isDisabled(), true)
  await page.getByRole('button', { name: '载入服务端剪辑版本', exact: true }).click()
  await settled()
  assert.equal(activeId, 'c-draft')
  assert.deepEqual(errors, [])
  assert.deepEqual(writes.map(row => row.path), [
    '/api/v1/studio/projects/p1/directing/sequences/s1/takes/t3',
    '/api/v1/studio/projects/p1/directing/sequences/s1/revisions',
    '/api/v1/studio/projects/p1/directing/sequences/s1/revisions/c-draft/confirm',
  ])
  // UX2 navigation: all old entry points still open their panel and stage.
  const entries = { design: '导演设计', shoot: '单元试拍', visual: '单元试拍', batch: '单元试拍', cut: '剪辑验收', continuity: '剪辑验收', feedback: '剪辑验收', ledger: '剪辑验收' }
  for (const [view, stage] of Object.entries(entries)) {
    await page.goto(url.replace('view=cut', `view=${view}`))
    await settled()
    const flow = page.getByRole('region', { name: '场次制作流程' })
    const primary = flow.locator('.ant-tabs').first().getByRole('tab')
    assert.equal(await primary.count(), 3)
    assert.ok((await flow.locator('.ant-tabs').first().locator('[role="tab"][aria-selected="true"]').innerText()).startsWith(stage))
    if (['visual', 'batch', 'continuity', 'feedback', 'ledger'].includes(view)) {
      await contextAction('当前进展')
      await page.getByRole('region', { name: '下一步引导' }).getByRole('button').click()
      await page.waitForFunction(target => document.activeElement?.getAttribute('data-workspace-target') === target, view, { timeout: 10000 })
    }
    await contextAction('刷新状态')
    await settled()
  }
  // Explicit old versions win on entry; user choices then survive refresh.
  await page.goto(url.replace('view=cut', 'view=design&design=d1&plan=p-old&unit=u1&cut=c-old&take=t1&returnTo=%2Fprojects%2Fp1'))
  await text('当前查看： · 设计 1 · 基线已确认，修改将派生新版本')
  await choose('查看或编辑设计版本', '设计 2 · 草稿')
  await page.reload()
  await text('当前查看： · 设计 2 · 草稿')
  assert.equal(new URL(page.url()).searchParams.get('returnTo'), '/projects/p1')
  await page.getByRole('tab', { name: '单元试拍' }).click()
  await text('先选择已确认的导演设计')
  assert.ok(!new URL(page.url()).searchParams.get('plan'))
  await choose('查看或编辑生产计划', '计划 1 · 已确认')
  await text('当前查看： · 计划 1 · 基线已确认，修改将派生新版本 · 固定设计依据：设计 1')
  await page.getByRole('tab', { name: '剪辑验收' }).click()
  await text('当前查看： · 剪辑 1 · 已确认 · 历史版本')
  await choose('查看或编辑剪辑版本', '剪辑 3 · 已确认')
  await choose('选择候选 Take', 'Take 3 · u1')
  await page.waitForURL(value => value.searchParams.get('take') === 't3' && value.searchParams.get('cut') === 'c-draft')
  await page.reload()
  await text('当前采用：片段 1 · 0.800–4.600 秒')
  assert.equal(new URL(page.url()).searchParams.get('cut'), 'c-draft')
  assert.equal(new URL(page.url()).searchParams.get('take'), 't3')
  assert.deepEqual(errors, [])
  // UX2 edit protection: cancel, failure, retry, discard and browser back.
  const modal = page.getByRole('dialog', { name: '有未保存的修改' })
  await page.getByRole('button', { name: '把这一段加入剪辑草稿', exact: true }).click()
  const dirtyCut = '草稿 · 未保存'
  await page.locator('.cut-version-bar').getByText(dirtyCut, { exact: true }).waitFor()
  await page.getByRole('tab', { name: '导演设计' }).click()
  await modal.waitFor()
  await modal.getByRole('button', { name: '取消，继续编辑' }).click()
  assert.equal(new URL(page.url()).searchParams.get('view'), 'cut')
  await text(dirtyCut)
  failRevisionSave = true
  await page.getByRole('tab', { name: '导演设计' }).click()
  await modal.getByRole('button', { name: '保存后继续' }).click()
  await modal.getByText('剪辑草稿未保存成功，请处理页面中的提示后重试。').waitFor()
  assert.equal(new URL(page.url()).searchParams.get('view'), 'cut')
  await text(dirtyCut)
  assert.equal(activeId, 'c-draft')
  failRevisionSave = false
  await modal.getByRole('button', { name: '保存后继续' }).click()
  await modal.waitFor({ state: 'hidden' })
  await text('当前查看： · 设计 1 · 基线已确认，修改将派生新版本')
  assert.equal(activeId, 'c-draft')
  assert.equal(workspace.cuts.at(-1).confirmed_at, null)
  await page.getByRole('tab', { name: '剪辑验收' }).click()
  await page.getByRole('button', { name: '把这一段加入剪辑草稿', exact: true }).click()
  const writesBeforeDiscard = writes.length
  await page.evaluate(() => history.back())
  await modal.waitFor()
  await modal.getByRole('button', { name: '取消，继续编辑' }).click()
  assert.equal(new URL(page.url()).searchParams.get('view'), 'cut')
  await page.getByRole('tab', { name: '导演设计' }).click()
  await modal.getByRole('button', { name: '放弃修改并继续' }).click()
  await modal.waitFor({ state: 'hidden' })
  await text('当前查看： · 设计 1 · 基线已确认，修改将派生新版本')
  assert.equal(writes.length, writesBeforeDiscard)
  // A page-wide navigation must also protect an edited design, without saving on cancel.
  await page.getByRole('button', { name: '＋ 新建设计⌄', exact: true }).click()
  await page.getByRole('menuitem', { name: '手动起稿', exact: true }).click()
  await contextAction('本场原文')
  await page.getByRole('button', { name: '返回场次列表核对原文', exact: true }).click()
  await modal.waitFor()
  await modal.getByText('拍摄方案', { exact: true }).waitFor()
  await modal.getByRole('button', { name: '取消，继续编辑' }).click()
  await closeDrawer()
  await choose('查看或编辑设计版本', '设计 1 · 已确认')
  await modal.waitFor()
  await modal.getByRole('button', { name: '放弃修改并继续' }).click()
  await text('当前查看： · 设计 1 · 基线已确认，修改将派生新版本')
  assert.equal(writes.length, writesBeforeDiscard)
  await page.getByRole('tab', { name: '剪辑验收' }).click()
  assert.deepEqual(errors, [])
  // Other document editors register their drafts with the same leave guard.
  const beforeOtherDrafts = writes.length
  await page.getByRole('tab', { name: '导演设计' }).click()
  await page.getByRole('button', { name: /^本场资产/ }).click()
  await page.getByRole('button', { name: '新建风格候选', exact: true }).click()
  await page.getByRole('textbox', { name: '风格标题' }).fill('保留克制表演')
  await closeDrawer()
  await page.getByRole('tab', { name: '剪辑验收' }).click()
  await modal.getByText('项目风格', { exact: true }).waitFor()
  await modal.getByRole('button', { name: '取消，继续编辑' }).click()
  await page.getByRole('button', { name: /^本场资产/ }).click()
  assert.equal(await page.getByRole('textbox', { name: '风格标题' }).inputValue(), '保留克制表演')
  await closeDrawer()
  await page.getByRole('tab', { name: '剪辑验收' }).click()
  await modal.getByRole('button', { name: '放弃修改并继续' }).click()
  await page.getByRole('tab', { name: '单元试拍' }).click()
  const actionScope = page.locator('[data-workspace-target="unit:u1"] textarea').first()
  await page.locator('.production-graph-node[data-node-kind="coverage"]:not([data-node-action]) .design-node-select').first().click()
  await actionScope.fill('保留递信的局部动作')
  await page.getByRole('tab', { name: '剪辑验收' }).click()
  assert.equal(await modal.count(), 0)
  await page.getByRole('tab', { name: '单元试拍' }).click()
  assert.equal(await actionScope.inputValue(), '保留递信的局部动作')
  await choose('查看或编辑生产计划', '计划 2 · 草稿')
  await modal.getByText('生产计划与参考', { exact: true }).waitFor()
  await modal.getByRole('button', { name: '取消，继续编辑' }).click()
  assert.equal(await actionScope.inputValue(), '保留递信的局部动作')
  await choose('查看或编辑生产计划', '计划 2 · 草稿')
  await modal.getByRole('button', { name: '放弃修改并继续' }).click()
  await page.getByRole('tab', { name: '剪辑验收' }).click()
  await contextAction('验收与局部返工')
  await page.getByRole('button', { name: '新建经验候选', exact: true }).click()
  await page.getByRole('textbox', { name: '适用条件' }).fill('只适用于本场固定机位')
  await page.getByRole('tab', { name: '导演设计' }).click()
  await modal.getByText('验收与返工反馈', { exact: true }).waitFor()
  await modal.getByRole('button', { name: '取消，继续编辑' }).click()
  assert.equal(await page.getByRole('textbox', { name: '适用条件' }).inputValue(), '只适用于本场固定机位')
  await page.getByRole('tab', { name: '剪辑验收' }).click()
  await modal.getByRole('button', { name: '放弃修改并继续' }).click()
  assert.equal(writes.length, beforeOtherDrafts)

  // Concurrent annotation refresh keeps local prose and the original save baseline.
  await page.locator('.cut-inspector').getByRole('tab', { name: '审片', exact: true }).click()
  await page.getByRole('textbox', { name: '实际观察', exact: true }).waitFor()
  await page.getByRole('textbox', { name: '实际观察' }).fill('尚未保存的本地审片')
  const reviewedTake = workspace.takes.find(row => row.id === 't3')
  reviewedTake.version += 1
  reviewedTake.annotation.rationale = { state: 'fact', text: '另一位成员的新观察', sources: [] }
  await contextAction('刷新状态')
  await text('素材审片版本已有更新，本地输入仍保留。')
  assert.equal(await page.getByRole('textbox', { name: '实际观察' }).inputValue(), '尚未保存的本地审片')
  assert.equal(await page.getByRole('button', { name: '保存审片', exact: true }).isDisabled(), true)
  await page.getByRole('button', { name: '核对并载入最新审片', exact: true }).click()
  await modal.getByRole('button', { name: '放弃修改并继续' }).click()
  assert.equal(await page.getByRole('textbox', { name: '实际观察' }).inputValue(), '另一位成员的新观察')

  // A remote adopted-cut replacement cannot unmount and erase a dirty seam form.
  const seamItems = [{ kind: 'media', id: 'left', take_id: 't3', media_range: { source_in_ms: 0, source_out_ms: 1000 }, timeline_start_ms: 0 }, { kind: 'media', id: 'right', take_id: 't3', media_range: { source_in_ms: 1000, source_out_ms: 2000 }, timeline_start_ms: 1000 }]
  workspace.cuts.push(revision('seam-old', { items: seamItems }))
  workspace.cuts.push(revision('seam-new', { items: seamItems.map(item => ({ ...item, id: item.id + '-new' })) }))
  continuityExtra.seams = [{ left_item_id: 'left', right_item_id: 'right', status: 'pending' }]
  activeId = 'seam-old'
  await contextAction('刷新状态')
  await contextAction('检查实际连续性')
  await page.getByRole('textbox', { name: '接缝审查说明' }).fill('保留旧版接缝观察')
  activeId = 'seam-new'
  continuityExtra.seams = [{ left_item_id: 'left-new', right_item_id: 'right-new', status: 'pending' }]
  await contextAction('刷新状态')
  await text('连续性依据已有更新；正在编辑的旧版输入已保留。')
  assert.equal(await page.getByRole('textbox', { name: '接缝审查说明' }).inputValue(), '保留旧版接缝观察')
  await page.getByRole('button', { name: '处理修改并载入最新连续性', exact: true }).click()
  await modal.getByRole('button', { name: '取消，继续编辑' }).click()
  assert.equal(await page.getByRole('textbox', { name: '接缝审查说明' }).inputValue(), '保留旧版接缝观察')
  await page.getByRole('button', { name: '处理修改并载入最新连续性', exact: true }).click()
  await modal.getByRole('button', { name: '放弃修改并继续' }).click()
  await text('当前采用版本：seam-new · 草稿编辑不改变此依据')
  assert.equal(await page.getByRole('textbox', { name: '接缝审查说明' }).inputValue(), '')
  assert.equal(writes.length, beforeOtherDrafts)
  assert.deepEqual(errors, [])
  await page.screenshot({ path: join(output, 'ux1-cut.png'), fullPage: true })
  console.log(JSON.stringify({ result: 'A01–A04 and UX2 navigation/context/edit guard checks passed', writes: writes.map(row => row.path), screenshot: join(output, 'ux1-cut.png') }, null, 2))
} catch (error) {
  console.error(error)
  if (page) { await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }); console.error((await page.locator('body').innerText()).slice(-7000)) }
  console.error('Browser evidence:', output)
  throw error
} finally {
  await browser?.close()
  await server.close()
}
