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
const output = await mkdtemp(join(tmpdir(), 'jellyfish-design-views-'))
const server = await createServer({ root, server: { host: '127.0.0.1', port: 4187, strictPort: true, open: false } })
const workspace = makeWorkspace()
const note = text => ({ state: 'proposal', text, sources: [{ kind: 'human', reference: 'design-views-fixture', version: '2' }] })
const design = workspace.designs[1].content
const shot = structuredClone(design.direction.shots[0])
design.direction.shots = Array.from({ length: 200 }, (_, i) => ({ ...structuredClone(shot), id: `shot${i+1}`, beat_ids: [i < 100 ? 'beat1' : 'beat2'], visible_result: note(`明确动作 ${i+1}`), narrative_function: note(`叙事作用 ${i+1}`) }))
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
    if (path.endsWith('/overview')) return respond({ sequences: [{ ...workspace.sequence, source_excerpt: '', confirmed_design_count: 1, plan_count: 2 }] })
    if (path.endsWith('/s1/feedback')) return respond({ active_cut_revision_id: 'c-active', current_review_id: null, reviews: [], repairs: [], knowledge: [] })
    if (path.endsWith('/download')) { images.push(path); return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#bcd6fa"/><text x="30" y="90" font-size="24">明确绑定的测试预演</text></svg>' }) }
    if (path.endsWith('/film/tasks')) return respond({ items: [], next_cursor: null })
    if (/\/(assets|styles|batches)$/.test(path)) return respond([])
    return respond({ items: [], total: 0 })
  })
  const base = 'http://127.0.0.1:4187/projects/p1/chapters/ch1/sequences/s1?view=design&design=d2'
  const choose = async (label, option) => {
    const version = label === '查看或编辑设计版本'
    if (version) {
      await page.locator('.workspace-versions-entry').click()
      await page.getByRole('dialog', { name: '版本与依据', exact: true }).locator('tr[data-row-key]').filter({ has: page.getByText(option.replace(' 0', ' '), { exact: true }) }).getByRole('button', { name: /^(基于此版本编辑|继续编辑草稿)$/ }).click()
      return
    }

    await page.getByRole('combobox', { name: label, exact: true }).locator('../..').click()
    const popup = page.locator('.ant-select-dropdown:visible').last()
    await popup.locator('.ant-select-item-option').filter({ hasText: option }).first().click()
    await popup.waitFor({ state: 'hidden' })
  }
  const closeDrawer = async () => {
    await page.locator('.ant-drawer-open').last().getByRole('button', { name: 'Close', exact: true }).click()
    await page.waitForFunction(() => [...document.querySelectorAll('.ant-drawer-mask')].every(el => !el.getClientRects().length || getComputedStyle(el).visibility === 'hidden'))
  }
  const settingsClick = async target => {
    if (!await target.isVisible()) await page.getByRole('button', { name: '视图设置', exact: true }).click()
    await target.click()
    await page.getByRole('button', { name: '视图设置', exact: true }).click()
    await page.locator('.ant-popover:visible').waitFor({ state: 'hidden' })
  }
  const allShots = design.direction.shots
  for (const count of [1, 12, 60, 200]) {
    design.direction.shots = allShots.slice(0, count)
    await page.goto(base)
    const storyboard = page.getByRole('grid', { name: '分镜编排' })
    await storyboard.waitFor()
    assert.equal(await storyboard.getAttribute('aria-rowcount'), String(count))
    assert.ok(await page.locator('.design-storyboard-card').count() <= Math.min(count, 45))
    await storyboard.focus(); await page.keyboard.press('End')
    await page.getByRole('button', { name: `分镜 ${count}`, exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: `分镜 ${count}`, exact: true }).getAttribute('aria-pressed'), 'true')
    const top = await storyboard.evaluate(element => element.scrollTop)
    await page.reload()
    await page.getByRole('button', { name: `分镜 ${count}`, exact: true }).waitFor()
    await page.waitForFunction(top => Math.abs(document.querySelector('.design-storyboard-viewport').scrollTop - top) < 2, top)
    await storyboard.focus(); await page.keyboard.press('Home')
    await page.getByRole('button', { name: '分镜 1', exact: true }).waitFor()
    if (count !== 200) await page.evaluate(() => sessionStorage.clear())
  }
  results.push('1/12/60/200镜头支持键盘定位、虚拟渲染，重新进入恢复分镜滚动与选择')
  assert.equal(await page.locator('.design-storyboard img').count(), 0)
  await page.getByRole('button', { name: '视图设置', exact: true }).click()
  await page.getByRole('switch', { name: '显示画面', exact: true }).click()
  await page.getByRole('combobox', { name: '复用已绑定预演图片', exact: true }).locator('../..').click()
  assert.equal(await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: '剪辑 1' }).count(), 0)
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: '剪辑 2' }).click()
  assert.equal(await page.getByRole('button', { name: '分镜 1', exact: true }).locator('img').count(), 0)
  assert.equal(await page.getByRole('button', { name: '分镜 3', exact: true }).locator('img').count(), 0)
  const secondImage = page.getByRole('button', { name: '分镜 2', exact: true }).locator('img')
  await secondImage.waitFor()
  assert.ok((await secondImage.getAttribute('src')).endsWith('/two/download'))
  await choose('镜头 1 预演来源片段', '预演片段 2')
  const firstImage = page.getByRole('button', { name: '分镜 1', exact: true }).locator('img')
  assert.ok((await firstImage.getAttribute('src')).endsWith('/one-b/download'))
  await firstImage.evaluate(image => image.decode())
  await page.screenshot({ path: join(output, 'explicit-preview-source.png') })
  assert.ok(!images.some(path => /latest|wrong-version|old-image/.test(path)))
  assert.ok(await page.locator('.design-storyboard-card').count() < 45)
  await choose('查看或编辑设计版本', '设计 01')
  await page.getByRole('button', { name: '分镜 1', exact: true }).waitFor()
  assert.equal(await page.locator('.design-storyboard img').count(), 0)
  results.push('分镜只显示显式所选来源；多候选不默认选取，版本与镜头不匹配不加载；200镜头仅渲染可见卡片')

  await choose('查看或编辑设计版本', '设计 02')
  await page.getByRole('tab', { name: '关系图', exact: true }).click()
  await page.locator('[data-beat-group="beat1"]').getByRole('button', { name: '进入节拍 1 关系', exact: true }).click()
  await settingsClick(page.getByRole('button', { name: '聚焦所选镜头', exact: true }))
  await page.locator('[data-graph-node="criterion:missing-criterion"].is-missing').waitFor()
  const canvas = page.locator('.design-graph-canvas')
  const initial = await canvas.getAttribute('style')
  await page.getByRole('button', { name: '放大关系图', exact: true }).click()
  assert.notEqual(await canvas.getAttribute('style'), initial)
  await page.getByLabel('镜头关系画布', { exact: true }).focus(); await page.keyboard.press('ArrowRight')
  assert.notEqual(await canvas.getAttribute('style'), initial)
  await page.getByRole('button', { name: '适应画布', exact: true }).click()
  await settingsClick(page.getByText('完整关联', { exact: true }))
  await page.locator('[data-relation="节拍表演"]').waitFor()
  assert.equal(await page.locator('[data-relation="节拍表演"] path').first().getAttribute('stroke-dasharray'), '5 4')
  const sharedNode = page.locator('[data-graph-node^="participant:"]').first()
  const sharedKey = await sharedNode.getAttribute('data-graph-node')
  await sharedNode.locator('.design-node-select').click()
  const sharedHeading = await page.locator('.design-inspector h2').innerText()
  await page.getByRole('tab', { name: '分镜', exact: true }).click()
  await page.locator('.design-storyboard-card.is-related').first().waitFor()
  assert.equal(await page.locator('.design-inspector h2').innerText(), sharedHeading)
  assert.equal(await page.locator('.design-storyboard-card.is-selected').count(), 0)
  await page.getByRole('tab', { name: '清单', exact: true }).click()
  await page.locator('.design-shot-row.is-related').first().waitFor()
  assert.equal(await page.locator('.design-inspector h2').innerText(), sharedHeading)
  assert.equal(await page.locator('.design-shot-row[aria-selected="true"]').count(), 0)
  await page.getByRole('tab', { name: '关系图', exact: true }).click()
  await page.locator(`[data-graph-node="${sharedKey}"].is-selected`).waitFor()
  results.push('共享对象跨三视图保留详情与身份，分镜和清单高亮关联镜头而不伪造镜头选择')
  await settingsClick(page.getByRole('button', { name: /退出聚焦/ }))
  await settingsClick(page.getByRole('button', { name: '返回上一范围', exact: true }))
  assert.equal(await page.locator('[data-beat-group]').count(), 2)
  assert.equal(await page.getByRole('button', { name: '放大关系图', exact: true }).count(), 0)
  assert.ok(await page.locator('.design-overview-shots button').count() <= 26)
  await page.locator('[data-beat-group="beat2"]').getByText('101 个关联镜头', { exact: false }).waitFor()
  await page.screenshot({ path: join(output, 'beat-aggregation-200.png') })
  await page.getByRole('button', { name: '进入节拍 2 关系', exact: true }).click()
  await page.getByRole('tab', { name: '清单', exact: true }).click()
  assert.equal(await page.getByRole('grid', { name: '镜头清单' }).getAttribute('aria-rowcount'), '101')
  await page.getByRole('textbox', { name: '搜索镜头、动作、人物', exact: true }).fill('明确动作 200')
  await page.locator('[data-shot-id="shot200"]').click()
  await page.getByRole('textbox', { name: '搜索镜头、动作、人物', exact: true }).fill('明确动作 1')
  await page.locator('[data-shot-id="shot1"]').click()
  await page.getByRole('tab', { name: '关系图', exact: true }).click()
  await settingsClick(page.getByRole('button', { name: '聚焦所选镜头', exact: true }))
  await page.locator('[data-graph-node="shot:shot1"]').getByRole('button', { name: '定位镜头', exact: true }).click()
  assert.equal(await page.getByRole('textbox', { name: '搜索镜头、动作、人物', exact: true }).inputValue(), '')
  await page.getByRole('tab', { name: '清单', exact: true }).click()
  results.push('关系过滤、间接与缺失引用、缩放和平移有效；全场200镜头按节拍聚合并可进入过滤清单；关系节点定位分镜清除阻挡条件')

  await page.getByRole('button', { name: '仅看问题', exact: true }).click()
  assert.equal(await page.getByRole('grid', { name: '镜头清单' }).getAttribute('aria-rowcount'), '1')
  await page.getByRole('button', { name: '仅看问题', exact: true }).click()
  const grid = page.getByRole('grid', { name: '镜头清单' }); await grid.focus(); await page.keyboard.press('End')
  await page.locator('[data-shot-id="shot200"][aria-selected="true"]').waitFor()
  const tableTop = await grid.evaluate(element => element.scrollTop)
  assert.ok(tableTop > 0)
  await page.reload()
  await page.locator('[data-shot-id="shot200"][aria-selected="true"]').waitFor()
  await page.waitForFunction(top => Math.abs(document.querySelector('[aria-label="镜头清单"]').scrollTop - top) < 2, tableTop)
  results.push('表格重新进入恢复当前节拍、所选镜头与真实滚动位置')
  await choose('查看或编辑设计版本', '设计 01')
  await page.getByRole('tab', { name: '关系图', exact: true }).click()
  await page.locator('.design-graph-workspace').waitFor()
  assert.equal(await page.locator('[data-graph-node="shot:shot200"]').count(), 0)
  await choose('查看或编辑设计版本', '设计 02')
  await page.getByRole('tab', { name: '清单', exact: true }).click()
  const baseline = new URL(page.url()).searchParams.get('design')
  await page.locator('.workspace-versions-entry').click()
  const versionDialog = page.getByRole('dialog', { name: '版本与依据', exact: true })
  for (const id of ['d1', 'd2']) await versionDialog.locator(`tr[data-row-key="${id}"]`).getByRole('button', { name: '加入比较', exact: true }).click()
  await versionDialog.getByRole('button', { name: '比较所选版本', exact: true }).click()
  const changes = page.locator('.revision-differences')
  await changes.getByText('新增', { exact: true }).first().waitFor()
  assert.ok((await changes.innerText()).includes('设计建议'))
  assert.ok((await changes.innerText()).includes('design-views-fixture'))
  await page.screenshot({ path: join(output, 'revision-differences.png') })
  await versionDialog.getByRole('button', { name: '返回版本列表', exact: true }).click()
  await versionDialog.locator('tr[data-row-key="d2"]').getByRole('button', { name: '查看版本', exact: true }).click()
  await page.locator('.ant-modal:visible').getByRole('button', { name: '岗位审阅', exact: true }).click()
  await page.locator('.ant-modal:visible').getByRole('combobox', { name: '岗位', exact: true }).waitFor()
  await page.locator('.ant-modal:visible').getByRole('button', { name: /^关\s*闭$/ }).click()
  await page.locator('.ant-modal:visible').waitFor({ state: 'hidden' })
  assert.equal(new URL(page.url()).searchParams.get('design'), baseline)
  for (const width of [1440, 1024, 768, 375]) {
    await page.setViewportSize({ width, height: 900 })
    const boxes = []
    for (const name of ['分镜', '清单', '关系图']) {
      await page.getByRole('tab', { name, exact: true }).click()
      const box = await page.locator('.design-view-toolbar:visible').boundingBox()
      boxes.push(box)
    }
    for (const box of boxes) for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(box[key] - boxes[0][key]) < 2, `${width}: toolbar ${key}`)
    if (width < 1280) {
      const version = await page.locator('.workspace-versions-entry').boundingBox()
      const navigation = await page.getByRole('button', { name: '场次导航', exact: true }).boundingBox()
      assert.ok(version.x + version.width <= navigation.x || navigation.y + navigation.height <= version.y, `${width}: version and navigation overlap`)
    }
    await page.screenshot({ path: join(output, `stable-toolbar-${width}.png`) })
  }
  assert.deepEqual(writes, [])
  assert.deepEqual(errors, [])
  results.push('历史比较包含对象增删、Note状态和来源；完整历史可审阅岗位；浏览不写入且不改变编辑基线或采用')
  await writeFile(join(output, 'results.json'), JSON.stringify({ results, images, writes, errors }, null, 2))
  console.log(JSON.stringify({ output, results }, null, 2))
} catch (error) {
  if (page) { await page.screenshot({ path: join(output, 'failure.png') }); console.log(await page.locator('body').innerText()) }
  console.log('Browser evidence:', output)
  throw error
} finally { await browser?.close(); await server.close() }
