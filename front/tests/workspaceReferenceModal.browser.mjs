import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { makeWorkspace, revision } from './directing-fixtures.mjs'
const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url)); process.chdir(root)
const output = await mkdtemp(join(tmpdir(), 'jellyfish-reference-modal-'))
const server = await createServer({ root, server: { host: '127.0.0.1', port: 4204, strictPort: true, open: false } })
const workspace = makeWorkspace(), writes = [], errors = [], results = []
workspace.designs[0].content.participants[0].name = '张三'
workspace.designs[0].content.participants[0].character_id = 'actor1'
workspace.plans[0].content.units[0].dependencies = [{ plan_revision_id: 'p-new', unit_id: 'u1', frame_id: 'historical-frame', reference_id: 'historical-reference' }]
workspace.plans[0].content.units.push({ ...structuredClone(workspace.plans[0].content.units[0]), id: 'u2', dependencies: [] })
workspace.prompts = [revision('prompt1', { plan_revision_id: 'p-old', unit_id: 'u1', text: '固定输入', sources: [], decisions: [], format_version: 'v4' })]
workspace.designs[0].content.participants.push({ id: 'person2', name: '李四', character_id: 'actor2', prop_id: null }, { id: 'prop-person', name: '旧信', character_id: null, prop_id: 'prop1' }, { id: 'missing-person', name: '未关联人物', character_id: null, prop_id: null })
workspace.designs[0].content.direction.location_asset_id = 'scene1'
const assets = [{ id: 'actor1', kind: 'character', name: '张三', description: '', image_file_ids: ['image1', 'image2', 'image3'] }, { id: 'actor2', kind: 'character', name: '李四', image_file_ids: ['li-image'] }, { id: 'prop1', kind: 'prop', name: '旧信', image_file_ids: ['prop-image'] }, { id: 'scene1', kind: 'scene', name: '书房', image_file_ids: ['scene-image'] }]
const capability = { model_id: 'model1', frame_roles: ['first_frame', 'last_frame'], max_frames: 2, subject_images: true, subject_videos: false, combine_subjects_and_frames: false, max_subjects: 7, max_images_per_subject: 3, max_media_per_subject: 3, limits_status: 'known' }
let browser, page
try {
  await server.listen(); browser = await chromium.launch({ headless: true })
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, hasTouch: true }); page.setDefaultTimeout(12000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: location.origin } })
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname
    const respond = data => route.fulfill({ json: { success: true, data: structuredClone(data) } })
    if (path.endsWith('/sources/resolve')) return respond(req.postDataJSON().sources.map(source => ({ source, status: 'ready', label: '人工', description: '隔离来源' })))
    if (req.method() !== 'GET') writes.push({ path, body: req.postDataJSON() })
    if (path.endsWith('/s1')) return respond(workspace)
    if (path.endsWith('/feedback')) return respond({ active_cut_revision_id: 'c-active', reviews: [], repairs: [], knowledge: [] })
    if (path.endsWith('/continuity')) return respond({ active_cut_revision_id: 'c-active', frames: [], seams: [], units: [] })
    if (path.endsWith('/overview')) return respond({ sequences: [{ ...workspace.sequence, source_excerpt: '', confirmed_design_count: 1, plan_count: 2 }] })
    if (path.endsWith('/reference-capabilities')) return respond(capability)
    if (path.endsWith('/files')) return respond({ items: [{ id: 'manual1', name: '临时参考', type: 'image' }, { id: 'manual2', name: '另一张参考', type: 'image' }], pagination: { total: 2 } })
    if (path.endsWith('/assets')) return respond(assets)
    if (path.endsWith('/models')) return respond({ items: [{ id: 'model1', name: '测试视频模型' }] })
    if (path.endsWith('/settings')) return respond({ default_video_model_id: 'model1' })
    if (/\/(download|content)$/.test(path)) return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="steelblue"/></svg>' })
    if (/\/(styles|batches)$/.test(path)) return respond([])
    return respond({ items: [], total: 0 })
  })
  const base = 'http://127.0.0.1:4204/projects/p1/chapters/ch1/sequences/s1?view=shoot&design=d1&plan=p-old&unit=u1&prompt=&review='
  workspace.designs[0].content.participants[0].character_id = null
  workspace.designs[0].content.direction.location_asset_id = null
  workspace.designs[0].content.direction.blocking_states.push({ ...workspace.designs[0].content.direction.blocking_states[0], id: 'prop-state', participant_id: 'prop-person' })
  workspace.designs[0].content.direction.shots[0].blocking_state_ids.push('prop-state')
  await page.goto(base)
  const graph = page.getByRole('region', { name: '试拍关系图', exact: true })
  const modal = page.getByRole('dialog').filter({ has: page.locator('.ant-modal-title') })
  const node = (kind, id) => graph.locator(`[data-node-kind="${kind}"]${id ? `[data-node-id="${id}"]` : ':not([data-node-action])'} .design-node-select`).first()
  const selectOption = async (name, label) => {
    await modal.getByRole('combobox', { name, exact: true }).locator('xpath=ancestor::div[contains(concat(" ",normalize-space(@class)," ")," ant-select ")][1]').click()
    await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: label }).click()
    if (await modal.getByRole('combobox', { name, exact: true }).getAttribute('aria-expanded') === 'true') await page.keyboard.press('Escape')
    await page.locator('.ant-select-dropdown:visible').waitFor({ state: 'hidden' })
  }
  const cancel = async () => { await modal.getByRole('button', { name: /^取\s*消$/ }).click(); await modal.waitFor({ state: 'hidden' }) }
  const apply = async () => { await modal.getByRole('button', { name: '应用到本单元', exact: true }).click(); await modal.waitFor({ state: 'hidden' }) }
  const files = () => selectOption('参考素材来源', '已有素材')
  const count = () => graph.locator('[data-node-kind="reference"]:not([data-node-action])').count()
  await node('participant', 'person1').click()
  await modal.getByText('角色：张三', { exact: true }).waitFor()
  assert.ok(await graph.locator('[data-node-kind="participant"][data-node-id="person1"]').innerText().then(text => text.includes('未关联资产')))
  assert.equal(await graph.locator('[data-node-kind="location"]').count(), 1)
  await files()
  await modal.getByRole('button', { name: /^选\s*入$/ }).first().click()
  assert.equal(await count(), 0, 'modal edits do not change the plan before apply')
  await cancel(); assert.equal(await count(), 0)
  await node('participant', 'person1').click(); await files()
  await modal.getByRole('button', { name: /^选\s*入$/ }).first().click(); await apply()
  assert.equal(await count(), 1)
  const referenceId = await graph.locator('[data-node-kind="reference"]:not([data-node-action])').getAttribute('data-node-id')
  await node('reference').click()
  await selectOption('参考对应人物或物件', '李四')
  assert.equal(await modal.getByRole('button', { name: '更换素材', exact: true }).count(), 1, 'changing bindings does not hide the edited group')
  await cancel()
  assert.equal(await graph.getByRole('button', { name: /主体／场所绑定：角色：李四/ }).count(), 0)
  await node('reference').click(); await selectOption('参考对应人物或物件', '李四'); await apply()
  assert.equal(await graph.getByRole('button', { name: /主体／场所绑定：角色：李四/ }).count(), 1)
  assert.equal(await graph.locator('[data-node-kind="reference"]:not([data-node-action])').getAttribute('data-node-id'), referenceId)
  await node('reference').click()
  await modal.getByRole('button', { name: '更换素材', exact: true }).click(); await files()
  await modal.getByText('另一张参考', { exact: true }).locator('../..').getByRole('button', { name: /^选\s*入$/ }).click(); await cancel()
  assert.ok(await graph.locator('.production-node-media img').getAttribute('src').then(src => src.includes('manual1')))
  await node('reference').click()
  await modal.getByRole('button', { name: '更换素材', exact: true }).click(); await files()
  await modal.getByText('另一张参考', { exact: true }).locator('../..').getByRole('button', { name: /^选\s*入$/ }).click(); await apply()
  assert.ok(await graph.locator('.production-node-media img').getAttribute('src').then(src => src.includes('manual2')))
  assert.equal(await graph.locator('[data-node-kind="reference"]:not([data-node-action])').getAttribute('data-node-id'), referenceId)
  await node('reference').click(); await modal.getByRole('button', { name: /^移\s*除$/ }).click(); await cancel()
  assert.equal(await count(), 1)
  await node('reference').click(); await modal.getByRole('button', { name: /^移\s*除$/ }).click(); await apply()
  assert.equal(await count(), 0)
  results.push('unlinked role and location remain visible; modal add/rebind/replace/remove cancel leaves plan untouched; apply updates exact reference identity')
  await node('location').click(); await files()
  await modal.getByRole('button', { name: /^选\s*入$/ }).first().click(); await apply()
  assert.ok(await graph.locator('[data-node-kind="location"]').innerText().then(text => text.includes('本次已选 1 份空间参考')))
  await node('location').click()
  await modal.getByRole('button', { name: '更换素材', exact: true }).waitFor()
  assert.equal(await modal.getByRole('button', { name: '更换素材', exact: true }).count(), 1)
  await cancel()
  await node('participant', 'prop-person').click()
  await modal.getByRole('button', { name: '选入 旧信 图片 1', exact: true }).click(); await apply()
  assert.equal(await count(), 2)
  const firstFile = () => graph.locator('.production-node-media img').first().getAttribute('src')
  const originalFirst = await firstFile()
  await node('participant', 'prop-person').click()
  await modal.getByRole('button', { name: /^上\s*移$/ }).click()
  assert.equal(await firstFile(), originalFirst)
  await cancel(); assert.equal(await firstFile(), originalFirst)
  await node('participant', 'prop-person').click()
  await modal.getByRole('button', { name: /^上\s*移$/ }).click(); await apply()
  assert.ok((await firstFile()).includes('prop-image'))
  await graph.locator('[data-node-kind="reference"][data-node-action="add"] .design-node-select').click()
  await modal.getByRole('button', { name: '查看本单元全部参考', exact: true }).click()
  await modal.getByText('本单元参考', { exact: true }).waitFor()
  assert.equal(await modal.getByRole('button', { name: '更换素材', exact: true }).count(), 2)
  await cancel(); assert.equal(await count(), 2)
  results.push('reordering is staged until apply; all references can be inspected in the same modal without changing plan data')
  results.push('unlinked location can use explicit temporary space reference; prop node uses the same modal; fixed design association stays unchanged')
  const snapshots = []
  for (const width of [1440, 1024, 768, 375]) {
    await page.setViewportSize({ width, height: 900 })
    await node('participant', 'prop-person').tap(); await modal.waitFor()
    await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth + 1)
    const box = await modal.getByRole('button', { name: '应用到本单元', exact: true }).boundingBox()
    assert.ok(box && box.y + box.height <= 900, 'modal footer is reachable')
    await modal.locator('.ant-modal-content').screenshot({ path: join(output, `modal-content-${width}.png`), animations: 'disabled' })
    await page.screenshot({ path: join(output, `modal-${width}.png`), animations: 'disabled' })
    snapshots.push(width); await cancel()
  }
  await node('coverage').click(); await page.getByRole('textbox', { name: '动作范围 cover1', exact: true }).waitFor()
  assert.equal(await modal.count(), 0)
  const coverageDrawer = page.locator('.ant-drawer-open')
  if (await coverageDrawer.count()) { await coverageDrawer.getByRole('button', { name: 'Close', exact: true }).click(); await coverageDrawer.waitFor({ state: 'hidden' }) }
  await node('unit').click(); await page.getByRole('combobox', { name: '视频模型', exact: true }).waitFor()
  assert.equal(await modal.count(), 0)
  const inspector = page.locator('.ant-drawer-open')
  if (await inspector.count()) { await inspector.getByRole('button', { name: 'Close', exact: true }).click(); await inspector.waitFor({ state: 'hidden' }) }
  await node('dependency').click(); await page.getByText('计划 2 · 固定历史依据', { exact: true }).waitFor()
  assert.equal(await modal.count(), 0)
  assert.equal(workspace.designs[0].content.participants[0].character_id, null)
  assert.equal(workspace.designs[0].content.direction.location_asset_id, null)
  assert.deepEqual(writes, []); assert.deepEqual(errors, [])
  results.push('four widths and touch support one modal; coverage/model/dependency retain original editors; browsing and local apply make zero business writes')
  await writeFile(join(output, 'results.json'), JSON.stringify({ results, snapshots, writes, errors }, null, 2))
  console.log(JSON.stringify({ output, results }, null, 2))
} catch (error) { console.error(await page?.locator('body').innerText()); throw error }
finally { await browser?.close(); await server.close() }
