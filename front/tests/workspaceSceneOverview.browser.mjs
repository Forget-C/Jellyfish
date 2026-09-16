import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { makeWorkspace } from './directing-fixtures.mjs'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
process.chdir(root)
const output = await mkdtemp(join(tmpdir(), 'jellyfish-scene-overview-'))
const server = await createServer({ root, server: { host: '127.0.0.1', port: 4194, strictPort: true, open: false } })
const workspace = makeWorkspace()
const note = text => ({ state: 'proposal', text, sources: [{ kind: 'human', reference: 'design-views-fixture', version: '2' }] })
const design = workspace.designs[1].content
const shot = structuredClone(design.direction.shots[0])
design.direction.shots = Array.from({ length: 12 }, (_, i) => ({ ...structuredClone(shot), id: `shot${i+1}`, beat_ids: [i % 2 === 0 ? 'beat1' : 'beat2'], visible_result: note(`明确动作 ${i+1}`), narrative_function: note(`叙事作用 ${i+1}`) }))
design.direction.beats.push({ ...structuredClone(design.direction.beats[0]), id: 'beat2', objective: note('确认身份') })
design.direction.shots[0].beat_ids.push('beat2')
design.direction.shots[0].criterion_ids.push('missing-criterion')
design.direction.information_change = note('观众认出两人的关系')
const preview = (id, revisionId, shotId, image) => ({ kind: 'planned', id, design_revision_id: revisionId, shot_id: shotId, preview_file_id: image, estimated_duration_ms: 3000, timeline_start_ms: 0, dialogue_cues: [] })
workspace.cuts[0].content.items = [preview('old-image', 'd1', 'shot1', 'old-image')]
workspace.cuts[1].content.items = [preview('one-a', 'd2', 'shot1', 'one-a'), preview('one-b', 'd2', 'shot1', 'one-b'), preview('two', 'd2', 'shot2', 'two'), preview('wrong-version', 'd1', 'shot3', 'wrong-version')]
workspace.cuts[2].content.items = [preview('latest', 'd2', 'shot1', 'latest')]
const writes = [], images = [], errors = [], results = []
let browser, page
try {
  await server.listen()
  browser = await chromium.launch({ headless: true })
  page = await browser.newPage({ viewport: { width: 1586, height: 992 } })
  page.setDefaultTimeout(15000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: location.origin } })
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    const respond = data => route.fulfill({ json: { success: true, data: structuredClone(data) } })
    if (path.endsWith('/sources/resolve')) return respond(request.postDataJSON().sources.map(source => ({ source, status: 'ready', label: '人工填写', description: '测试来源' })))
    if (request.method() !== 'GET') writes.push(path)
    if (path.endsWith('/s1')) return respond(workspace)
    if (path.endsWith('/s1/feedback')) return respond({ active_cut_revision_id: 'c-active', current_review_id: null, reviews: [], repairs: [], knowledge: [] })
    if (path.endsWith('/download')) { images.push(path); return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#bcd6fa"/><text x="30" y="90" font-size="24">明确绑定的测试预演</text></svg>' }) }
    if (path.endsWith('/film/tasks')) return respond({ items: [], next_cursor: null })
    if (/\/(assets|styles|batches)$/.test(path)) return respond([])
    return respond({ items: [], total: 0 })
  })
  const base = 'http://127.0.0.1:4194/projects/p1/chapters/ch1/sequences/s1?view=design&design=d2'
  const choose = async (label, option) => {
    await page.getByRole('combobox', { name: label, exact: true }).locator('../..').click()
    const popup = page.locator('.ant-select-dropdown:visible').last()
    await popup.locator('.ant-select-item-option').filter({ hasText: option }).first().click()
    await popup.waitFor({ state: 'hidden' })
  }
  const closeDrawer = async () => {
    await page.locator('.ant-drawer-open').last().getByRole('button', { name: 'Close', exact: true }).click()
    await page.waitForFunction(() => [...document.querySelectorAll('.ant-drawer-mask')].every(el => !el.getClientRects().length || getComputedStyle(el).visibility === 'hidden'))
  }
  const selectView = async label => {
    await page.getByRole('tab', { name: '镜头', exact: true }).click()
    await page.getByRole('radio', { name: label, exact: true }).locator('..').click()
  }
  const closeDetails = async () => { if (await page.locator('.ant-drawer-open').count()) await closeDrawer() }
  await page.goto(base)
  const board = page.getByRole('grid', { name: '分镜编排', exact: true })
  await board.waitFor()
  for (const remembered of ['list', 'relations', 'storyboard']) {
    await page.evaluate(view => sessionStorage.setItem('directing-context:p1:s1', JSON.stringify({ designView: view })), remembered)
    await page.reload()
    if (remembered === 'relations') await page.getByLabel('全场关系总览', { exact: true }).waitFor()
    else await page.getByRole('grid', { name: remembered === 'list' ? '镜头清单' : '分镜编排', exact: true }).waitFor()
  }
  results.push('既有list、relations、storyboard浏览记录映射到新层级')
  assert.equal(await page.getByRole('button', { name: '表格', exact: true }).count(), 0)
  assert.equal(await page.locator('.design-storyboard-image').count(), 0)
  assert.deepEqual(await page.locator('.design-storyboard-card > button').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label'))), Array.from({ length: 12 }, (_, i) => `分镜 ${i+1}`))
  await page.getByRole('button', { name: '分镜 3', exact: true }).click()
  await page.getByRole('textbox', { name: '可见结果', exact: true }).fill('尚未保存的动作修改')
  await selectView('清单')
  await page.waitForFunction(() => document.querySelectorAll('[data-shot-id]').length === 12)
  assert.deepEqual(await page.locator('[data-shot-id]').evaluateAll(nodes => nodes.map(node => node.dataset.shotId)), Array.from({ length: 12 }, (_, i) => `shot${i+1}`))
  assert.equal(await page.locator('[data-shot-id="shot3"]').getAttribute('aria-selected'), 'true')
  await page.getByRole('tab', { name: '关系', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: '放大关系图', exact: true }).count(), 0)
  assert.equal(await page.getByText('完整关联', { exact: true }).count(), 0)
  const overview = page.getByLabel('全场关系总览', { exact: true })
  const first = overview.locator('[data-beat-group="beat1"]')
  await first.getByRole('button', { name: '节拍 1 · 未命名节拍', exact: true }).click()
  assert.equal(await page.locator('.design-navigation').getByRole('button', { name: /全场 ·/ }).getAttribute('aria-pressed'), 'true')
  await first.getByRole('button', { name: /待命名人物/ }).first().click()
  assert.equal(await overview.locator('.design-overview-row.is-highlighted').count(), 2)
  await page.locator('.design-impact summary').first().click()
  assert.match(await page.locator('.design-impact').innerText(), /调度依据/)
  await page.getByRole('button', { name: '清除高亮', exact: true }).click()
  assert.equal(await overview.locator('.design-overview-row.is-highlighted').count(), 0)
  await first.getByRole('button', { name: /待命名人物/ }).first().click()
  assert.equal(await overview.locator('.design-overview-row.is-highlighted').count(), 2)
  await first.getByRole('button', { name: '进入节拍 1 关系', exact: true }).click()
  await page.getByRole('button', { name: '放大关系图', exact: true }).waitFor()
  await page.getByRole('button', { name: '返回上一范围', exact: true }).click()
  await overview.waitFor()
  await first.getByRole('button', { name: '选择镜头 3', exact: true }).click()
  await selectView('分镜')
  assert.equal(await page.getByRole('textbox', { name: '可见结果', exact: true }).inputValue(), '尚未保存的动作修改')
  results.push('交错节拍保持真实顺序；镜头选择与未保存正文跨分镜、清单、关系往返保留；总览选择不改变范围；共享对象路径可解释')

  // 五种尺寸逐一查看四种实际展示，不以旧截图代替新版验收。
  for (const [width, height] of [[1586,992],[1440,900],[1024,768],[768,1024],[375,812]]) {
    await page.setViewportSize({ width, height })
    for (const mode of ['分镜','清单','总览','节拍图']) {
      await closeDetails()
      if (mode === '分镜' || mode === '清单') await selectView(mode)
      else {
        await page.getByRole('tab', { name: '关系', exact: true }).click()
        if (mode === '节拍图') await page.locator('[data-beat-group="beat1"]').getByRole('button', { name: '进入节拍 1 关系', exact: true }).click()
      }
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      const metrics = await page.evaluate(() => {
        const center = document.querySelector('.design-center').getBoundingClientRect()
        const buttons = [...document.querySelectorAll('.design-view-toolbar button, .design-list-footer button, .design-graph-footer button')].filter(node => node.getClientRects().length)
        return { width: innerWidth, scroll: document.documentElement.scrollWidth, center: { left: center.left, right: center.right }, controls: buttons.map(node => { const r = node.getBoundingClientRect(); const hit = document.elementFromPoint(r.x+r.width/2,r.y+r.height/2); return { label: node.textContent, visible: r.width > 0 && r.height > 0 && r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight && (node.contains(hit) || hit === node) } }) }
      })
      if (mode === '清单' && width >= 768) assert.ok(await page.locator('.design-list-head > span').evaluateAll(nodes => nodes.every(node => node.scrollWidth <= node.clientWidth + 1)), '清单标题应完整可读')
      assert.ok(metrics.scroll <= width + 1, JSON.stringify({ mode, metrics }))
      assert.ok(metrics.controls.every(row => row.visible), JSON.stringify({ mode, metrics }))
      await page.screenshot({ path: join(output, `${width}-${mode}.png`) })
      results.push({ width, height, mode, metrics })
      if (mode === '节拍图') await page.getByRole('button', { name: '返回上一范围', exact: true }).click()
    }
  }
  await page.setViewportSize({ width: 1586, height: 992 })
  await closeDetails()
  // 重新进入会触发既有未保存保护；此处显式载入新的隔离样本。
  await page.evaluate(() => sessionStorage.clear())
  design.direction.shots = Array.from({ length: 200 }, (_, i) => ({ ...structuredClone(shot), id: `shot${i+1}`, beat_ids: ['beat1'], visible_result: note(`集中镜头 ${i+1}`) }))
  await page.goto(base)
  await page.getByRole('tab', { name: '关系', exact: true }).click()
  await page.getByRole('button', { name: '展开剩余188镜', exact: true }).click()
  const enter = page.locator('[data-beat-group="beat1"]').getByRole('button', { name: '进入节拍 1 关系', exact: true })
  await enter.focus()
  const overviewTop = await overview.evaluate(element => { element.scrollTop = 200; return element.scrollTop })
  assert.ok(overviewTop > 0)
  await page.waitForFunction(top => JSON.parse(JSON.parse(sessionStorage.getItem('directing-context:p1:s1')).designOverview).top === top, overviewTop)
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: '返回上一范围', exact: true }).click()
  await page.waitForFunction(top => Math.abs(document.querySelector('.design-scene-overview').scrollTop - top) < 2, overviewTop)
  await page.getByRole('button', { name: '选择镜头 200', exact: true }).press('Enter')
  assert.match(await page.locator('.design-inspector h2').innerText(), /镜头 200/)
  await page.getByRole('textbox', { name: '搜索镜头、动作、人物', exact: true }).fill('集中镜头 200')
  assert.equal(await page.locator('.design-overview-shots button').count(), 1)
  await page.getByRole('button', { name: '选择镜头 200', exact: true }).click()
  await selectView('清单')
  assert.equal(await page.locator('[data-shot-id="shot200"]').getAttribute('aria-selected'), 'true')
  results.push('单节拍200镜头可展开、键盘选择、全量搜索并在清单定位同一镜头')
  design.direction.beats = []
  await page.goto(base)
  await page.getByRole('tab', { name: '关系', exact: true }).click()
  await page.locator('[data-beat-group="unassigned"]').waitFor()
  await page.getByRole('button', { name: '进入未分组关系', exact: true }).click()
  await page.getByLabel('镜头关系画布', { exact: true }).waitFor()
  results.push('无节拍仍保留未分组总览与详细关系入口')
  design.direction.shots = []
  await page.evaluate(() => sessionStorage.clear())
  await page.goto(base)
  await page.getByRole('button', { name: /新增镜头/ }).waitFor()
  await page.getByRole('tab', { name: '关系', exact: true }).click()
  await page.getByText('暂无镜头，可在镜头视图新增', { exact: true }).waitFor()
  await selectView('分镜')
  await page.getByRole('button', { name: /新增镜头/ }).click()
  await page.waitForFunction(() => document.querySelector('[aria-label="分镜编排"]').getAttribute('aria-rowcount') === '1')
  results.push('空场次保留镜头创建入口，关系总览给出明确空态；无节拍也能创建镜头草稿')
  assert.deepEqual(errors, [])
  assert.deepEqual(writes, [])
  await writeFile(join(output, 'results.json'), JSON.stringify({ results, writes, errors }, null, 2))
  console.log(JSON.stringify({ output, checks: results.length }, null, 2))
} catch (error) {
  if (page) { await page.screenshot({ path: join(output, 'failure.png') }); console.log(await page.locator('body').innerText()) }
  console.log('Browser evidence:', output)
  throw error
} finally { await browser?.close(); await server.close() }
