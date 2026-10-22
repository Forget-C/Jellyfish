import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'
import { workbenchShot, selectWorkbenchOption } from './workbenchControls.mjs'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-reference-source-')
const api = 'http://127.0.0.1:8258'
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.directing.scene_version_browser_server'], {
  cwd: join(root, '../backend'),
  env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', SCENE_BROWSER_TEST_DATABASE: join(output, 'browser.sqlite'), SCENE_BROWSER_TEST_PORT: '8258', SCENE_BROWSER_TEST_SUBJECTS: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let backendOutput = ''
backend.stdout.on('data', data => { backendOutput += data })
backend.stderr.on('data', data => { backendOutput += data })
let server, browser, page
const cleanup = browserCleanup(() => ({ browser, server, backend }))
captureBackend(backend, output)
try {
  let chapter
  for (let attempt = 0; attempt < 80; attempt++) {
    if (backend.exitCode !== null) throw new Error(backendOutput)
    try {
      const response = await fetch(`${api}/api/v1/studio/projects/canvas-project/directing/chapters/canvas-chapter`)
      if (response.ok) { chapter = (await response.json()).data; break }
    } catch { /* The dedicated test server is still starting. */ }
    await delay(250)
  }
  assert.ok(chapter, `test backend did not become ready: ${backendOutput}`)
  const sequenceId = chapter.sequences[0].id
  const versionsUrl = `${api}/api/v1/studio/projects/canvas-project/directing/sequences/${sequenceId}/versions`
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4258, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.setDefaultTimeout(12000)
  await context.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const create = await fetch(versionsUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), title: '覆盖编辑验收' }) })
  assert.equal(create.status, 200)
  const version = (await create.json()).data
  const assetsUrl = versionsUrl.replace('/versions', '/assets')
  const assets = []
  for (const name of ['默认甲', '手动乙', '场外丙']) {
    const response = await fetch(assetsUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), kind: 'character', name }) })
    assert.equal(response.status, 200)
    assets.push((await response.json()).data)
  }
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64')
  const form = new FormData()
  form.set('file', new Blob([png], { type: 'image/png' }), 'reference.png')
  form.set('project_id', 'canvas-project')
  form.set('usage_kind', 'upload')
  const uploaded = await fetch(`${api}/api/v1/studio/files/upload`, { method: 'POST', body: form })
  assert.equal(uploaded.status, 201, await uploaded.clone().text())
  const fileId = (await uploaded.json()).data.id
  for (const asset of assets.slice(0, 2)) {
    const response = await fetch(`${api}/api/v1/studio/entities/character/${asset.id}/images`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file_id: fileId }) })
    assert.ok(response.ok, await response.text())
  }
  const extraFiles = []
  for (const name of ['second.png', 'third.png', 'other.png']) {
    const extraForm = new FormData()
    extraForm.set('file', new Blob([png], { type: 'image/png' }), name)
    extraForm.set('project_id', 'canvas-project'); extraForm.set('usage_kind', 'upload')
    const response = await fetch(`${api}/api/v1/studio/files/upload`, { method: 'POST', body: extraForm })
    assert.equal(response.status, 201)
    extraFiles.push((await response.json()).data.id)
  }
  for (const [index, extraId] of extraFiles.slice(0, 2).entries()) {
    const response = await fetch(`${api}/api/v1/studio/entities/character/${assets[index === 0 ? 1 : 0].id}/images`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file_id: extraId, view_angle: 'LEFT' }) })
    assert.ok(response.ok, await response.text())
  }
  const content = version.content
  content.design.participants = [{ id: 'reader', name: '读信者', character_id: assets[0].id }, { id: 'outside', name: '其他人物', character_id: assets[2].id }]
  content.design.direction.shots = [{ id: 'shot', beat_ids: [], event_ids: [], blocking_state_ids: [], participant_ids: ['reader'], criterion_ids: [], narrative_function: {}, visible_result: { state: 'proposal', text: '读信反应', sources: [{ kind: 'human', reference: 'browser', version: '1' }] } }]
  content.units = [{ id: 'unit', instruction: '读信者看着来信。', model_id: 'browser-subject-model', duration_ms: 5000, ratio: '16:9', coverage: [{ id: 'coverage', shot_id: 'shot', action_scope: '读信' }] }]
  const detail = `${versionsUrl}/${version.id}`
  const save = async (revision, body) => {
    const response = await fetch(detail, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: revision, content: body }) })
    assert.equal(response.status, 200, await response.clone().text())
    return (await response.json()).data
  }
  await save(1, content)
  const open = async () => {
    await page.goto(`http://127.0.0.1:4258/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${version.id}`)
    await page.getByRole('button', { name: '定位画布节点', exact: true }).waitFor()
    await (await workbenchShot(page, '镜头 1：读信反应')).click()
    await page.getByRole('button', { name: '单元画布', exact: true }).click()
    await selectWorkbenchOption(page, '当前单元', '单元 1')
    await page.getByRole('button', { name: '定位画布节点', exact: true }).click()
    await page.getByRole('menuitem', { name: '参考素材', exact: true }).first().click()
    await page.locator('[data-canvas-node="unit:unit:references"]').getByRole('button', { name: /^查看节点：/ }).click()
    return page.getByRole('dialog').last()
  }
  let dialog = await open()
  await selectWorkbenchOption(page, '本次参考绑定人物或物件', '读信者')
  await page.keyboard.press('Escape')
  await selectWorkbenchOption(page, '本次素材资产', '默认甲')
  await dialog.getByRole('button', { name: '选入 默认甲 图片 1', exact: true }).click()
  await dialog.getByRole('button', { name: '选入 默认甲 图片 2', exact: true }).click()
  await dialog.getByRole('button', { name: '应用到本单元', exact: true }).click()
  const read = async () => (await (await fetch(detail)).json()).data
  const waitSaved = async predicate => {
    for (let i = 0; i < 60; i++) { const value = await read(); if (predicate(value)) return value; await delay(100) }
    throw new Error('reference save did not complete')
  }
  let saved = await waitSaved(value => value.content.units[0].references.length === 2)
  const old = structuredClone(saved.content.units[0].references)
  dialog = await open()
  await dialog.getByRole('button', { name: '更换来源', exact: true }).click()
  await selectWorkbenchOption(page, '本次素材资产', '手动乙')
  await dialog.getByRole('button', { name: '选入 手动乙 图片 2', exact: true }).click()
  assert.deepEqual((await read()).content.units[0].references, old, 'staged source does not mutate saved group')
  await dialog.getByRole('button', { name: '应用到本单元', exact: true }).click()
  saved = await waitSaved(value => value.content.units[0].references.length === 1)
  assert.equal(saved.content.units[0].references[0].asset_origin.id, assets[1].id)
  assert.deepEqual(saved.content.units[0].references[0].participant_ids, ['reader'])
  dialog = await open()
  await dialog.getByRole('button', { name: '更换素材', exact: true }).click()
  await selectWorkbenchOption(page, '本次素材资产', '默认甲')
  await dialog.getByRole('button', { name: '选入 默认甲 图片 1', exact: true }).click()
  await dialog.getByText('更换身份素材来源请使用“更换来源”，以整组替换', { exact: true }).waitFor()
  await dialog.getByRole('button', { name: /^取\s*消$/ }).click()
  assert.equal((await read()).content.units[0].references[0].asset_origin.id, assets[1].id)
  // 其它对象、用途、连续性输入及另一单元均不能进入身份组替换范围。
  saved = await read()
  const isolation = structuredClone(saved.content)
  const template = isolation.units[0].references[0]
  const unrelated = [
    { id: 'first-frame', purpose: 'identity', input_role: 'first_frame', participant_ids: ['reader'] },
    { id: 'composition', purpose: 'composition', input_role: 'subject', participant_ids: ['reader'] },
    { id: 'landing', purpose: 'continuity', input_role: 'subject', participant_ids: ['reader'] },
    { id: 'other-person', purpose: 'identity', input_role: 'subject', participant_ids: ['outside'] },
  ].map((fields, index) => ({ ...template, ...fields, file_id: extraFiles[2], subject_group_id: fields.input_role === 'subject' ? fields.id : null, asset_origin: null, ordinal: index + 1 }))
  isolation.units[0].references.push(...unrelated)
  isolation.units.push({ ...structuredClone(isolation.units[0]), id: 'other-unit', references: [structuredClone(template)] })
  saved = await save(saved.revision, isolation)
  const basisUrl = detail + '/units/unit/instruction-basis'
  const confirmed = await fetch(basisUrl + '/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: saved.revision, content: saved.content }) })
  assert.equal(confirmed.status, 200, await confirmed.clone().text())
  const bound = structuredClone(saved.content)
  bound.units[0].instruction_basis_id = (await confirmed.json()).data.basis_id
  saved = await save(saved.revision, bound)
  const basis = async value => {
    const response = await fetch(basisUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: value.content }) })
    assert.equal(response.status, 200, await response.clone().text())
    return (await response.json()).data
  }
  const fixedOtherUnit = structuredClone(saved.content.units[1])
  const targetRefs = value => value.content.units[0].references.filter(ref => ref.purpose === 'identity' && (ref.input_role || 'subject') === 'subject' && ref.participant_ids[0] === 'reader')
  const targetCard = () => dialog.locator('.ant-card').filter({ has: page.locator('.ant-select-selection-item').filter({ hasText: '读信者' }) }).filter({ has: page.getByRole('button', { name: '更换来源', exact: true }) })
  const start = async () => { dialog = await open(); await targetCard().getByRole('button', { name: '更换来源', exact: true }).click() }
  const cancel = async () => { await dialog.getByRole('button', { name: /^取\s*消$/ }).click(); await dialog.waitFor({ state: 'hidden' }) }
  const apply = async () => { await dialog.getByRole('button', { name: '应用到本单元', exact: true }).click(); await dialog.waitFor({ state: 'hidden' }) }
  const assertIsolation = value => {
    assert.deepEqual(value.content.units[0].references.filter(ref => unrelated.some(row => row.id === ref.id)), unrelated)
    assert.deepEqual(value.content.units[1], fixedOtherUnit)
    assert.equal(value.content.design.participants[0].character_id, assets[0].id)
  }
  const chooseFile = async name => {
    await selectWorkbenchOption(page, '参考素材来源', '已有素材')
    await dialog.getByText(name, { exact: true }).locator('../..').getByRole('button', { name: /^选\s*入$/ }).click()
  }
  // 没有具体素材的来源浏览不能清空原组；身份语义与对象不可切换。
  const original = structuredClone(saved.content)
  await start()
  assert.equal(await dialog.getByRole('combobox', { name: '本次参考绑定人物或物件', exact: true }).isDisabled(), true)
  assert.equal(await dialog.getByRole('combobox', { name: '参考输入位置', exact: true }).isDisabled(), true)
  assert.equal(await targetCard().getByRole('combobox', { name: '参考用途', exact: true }).isDisabled(), true)
  await selectWorkbenchOption(page, '本次素材资产', '默认甲')
  await dialog.getByRole('button', { name: '应用到本单元', exact: true }).click()
  await dialog.getByText('请明确选入新来源的素材，或取消更换来源', { exact: true }).waitFor()
  assert.deepEqual((await read()).content, original)
  await cancel()
  await start()
  await selectWorkbenchOption(page, '本次素材资产', '默认甲')
  await dialog.getByRole('button', { name: '选入 默认甲 图片 1', exact: true }).click()
  await cancel()
  assert.deepEqual((await read()).content, original)
  assert.equal((await basis(await read())).status, 'current', 'browsing and cancellation do not change instruction basis')
  // 资产→人工、人工→资产、人工→人工；原来源不残留，隔离输入逐字保留。
  await start(); await chooseFile('third'); await apply()
  saved = await waitSaved(value => !targetRefs(value)[0].asset_origin)
  assert.equal(targetRefs(saved)[0].file_id, extraFiles[1]); assertIsolation(saved)
  const changedBasis = await basis(saved)
  assert.equal(changedBasis.status, 'changed')
  assert.deepEqual(changedBasis.current.unit.references, saved.content.units[0].references, 'instruction input consumes the same applied references')
  await start(); await selectWorkbenchOption(page, '本次素材资产', '默认甲')
  await dialog.getByRole('button', { name: '选入 默认甲 图片 1', exact: true }).click(); await apply()
  saved = await waitSaved(value => targetRefs(value)[0].asset_origin?.id === assets[0].id)
  assert.equal(targetRefs(saved).length, 1); assertIsolation(saved)
  await start(); await chooseFile('third'); await apply()
  saved = await waitSaved(value => !targetRefs(value)[0].asset_origin)
  await start(); await chooseFile('second'); await apply()
  saved = await waitSaved(value => targetRefs(value)[0].file_id === extraFiles[0])
  assert.equal(targetRefs(saved).length, 1); assertIsolation(saved)
  await page.screenshot({ path: join(output, 'replacement-isolation.png'), animations: 'disabled' })
  await start(); await chooseFile('third'); await chooseFile('reference'); await apply()
  saved = await waitSaved(value => targetRefs(value).length === 2)
  assert.deepEqual(saved.content.units[0].references.map(ref => ref.ordinal), [0, 1, 2, 3, 4, 5])
  assertIsolation(saved)
  console.log('PASS four source directions, explicit action, cancellation, and non-target isolation')
  // 上传故障不删除原组；关闭或切换来源后的迟到结果不得进入新上下文。
  const beforeUpload = structuredClone(saved.content)
  await page.route('**/files/upload', route => route.fulfill({ status: 500, json: { detail: '上传边界故障' } }))
  await start(); await selectWorkbenchOption(page, '参考素材来源', '上传')
  const failedUpload = page.waitForResponse(response => response.url().endsWith('/files/upload') && response.status() === 500)
  await dialog.locator('input[type=file]').setInputFiles({ name: 'failed.png', mimeType: 'image/png', buffer: png })
  await failedUpload
  await dialog.getByRole('alert').filter({ hasText: '上传边界故障' }).waitFor()
  await cancel(); assert.deepEqual((await read()).content, beforeUpload)
  await page.unroute('**/files/upload')
  for (const closeFirst of [true, false]) {
    let release, entered
    const held = new Promise(resolve => { release = resolve })
    const started = new Promise(resolve => { entered = resolve })
    await page.route('**/files/upload', async route => { entered(); await held; await route.continue() })
    await start(); await selectWorkbenchOption(page, '参考素材来源', '上传')
    await dialog.locator('input[type=file]').setInputFiles({ name: 'late.png', mimeType: 'image/png', buffer: png })
    await started
    if (closeFirst) {
      await dialog.getByRole('button', { name: 'Close', exact: true }).click()
      await page.getByRole('button', { name: '编辑参考素材', exact: true }).click(); dialog = page.getByRole('dialog').last()
    } else await selectWorkbenchOption(page, '参考素材来源', '已有素材')
    const completed = page.waitForResponse(response => response.url().endsWith('/files/upload'))
    release(); await completed
    // 等待上传 promise 完成，不以保存后端的无写入冒充弹窗草稿安全。
    await page.waitForTimeout(150)
    const prepared = dialog.locator('.ant-card').filter({ hasText: '准备替换：读信者' })
    if (!closeFirst) assert.equal(await prepared.getByRole('img').count(), 0)
    assert.equal(await dialog.getByRole('button', { name: '撤回选入', exact: true }).count(), 0)
    await cancel(); assert.deepEqual((await read()).content, beforeUpload)
    await page.unroute('**/files/upload')
  }
  console.log('PASS failed and late upload preserve the prior group and modal context')
  // 保存失败保留已应用的当前编辑内容；数据库仍为旧组，恢复后由原保存流程完成。
  let rejectSave = true
  await page.route('**/versions/*', route => route.request().method() === 'PUT' && rejectSave
    ? route.fulfill({ status: 422, json: { detail: '保存边界故障' } }) : route.continue())
  await start(); await selectWorkbenchOption(page, '本次素材资产', '手动乙')
  await dialog.getByRole('button', { name: '选入 手动乙 图片 2', exact: true }).click(); await apply()
  await page.getByRole('status').filter({ hasText: '保存失败' }).first().waitFor()
  assert.deepEqual((await read()).content, beforeUpload)
  await page.getByRole('button', { name: '编辑参考素材', exact: true }).click(); dialog = page.getByRole('dialog').last()
  await dialog.getByText('素材来源：手动乙 · 选择时的资产记录', { exact: true }).waitFor()
  assert.equal(await targetCard().getByRole('button', { name: '更换素材', exact: true }).count(), 1)
  await cancel(); rejectSave = false
  await page.unroute('**/versions/*')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  saved = await waitSaved(value => targetRefs(value).length === 1 && targetRefs(value)[0].asset_origin?.id === assets[1].id)
  assertIsolation(saved)
  // 同一界面中撤销了底层参考后，旧弹窗基线不能覆写较新编辑。
  await page.getByRole('button', { name: '编辑参考素材', exact: true }).click(); dialog = page.getByRole('dialog').last()
  await targetCard().getByRole('button', { name: '更换来源', exact: true }).click()
  await chooseFile('third')
  await dialog.getByRole('button', { name: '应用到本单元', exact: true }).focus()
  await page.keyboard.press('Control+z')
  await dialog.getByRole('button', { name: '应用到本单元', exact: true }).click()
  await dialog.getByText('当前单元输入已变化，请取消并重新打开后编辑', { exact: true }).waitFor()
  await cancel()
  saved = await waitSaved(value => targetRefs(value).length === 2)
  // 服务器实际 CAS 与非法混源整次拒绝，不能覆盖已保存的新修订。
  saved = await read()
  const stale = await fetch(detail, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: saved.revision - 1, content: beforeUpload }) })
  assert.equal(stale.status, 409)
  assert.deepEqual((await read()).content, saved.content)
  const mixed = structuredClone(saved.content)
  const target = targetRefs(saved)[0]
  mixed.units[0].references.push({ ...target, id: 'illegal-mixed', ordinal: 99, file_id: fileId, asset_origin: { kind: 'character', id: assets[0].id, name: '默认甲' }, subject_group_id: 'illegal-new-source' })
  const invalid = await fetch(detail, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: saved.revision, content: mixed }) })
  assert.equal(invalid.status, 422)
  assert.deepEqual((await read()).content, saved.content)
  console.log('PASS save failure recovery, stale modal baseline, HTTP CAS and atomic mixed-source rejection')
  await page.route('**/reference-capabilities**', route => route.fulfill({ status: 500, json: { detail: '能力读取边界故障' } }))
  await start(); await chooseFile('third')
  await dialog.getByText('能力读取边界故障', { exact: true }).waitFor()
  assert.equal(await dialog.getByRole('button', { name: '撤回选入', exact: true }).count(), 1)
  await cancel(); await page.unroute('**/reference-capabilities**')
  await page.route('**/reference-capabilities**', async route => {
    const response = await route.fetch(), body = await response.json()
    body.data.max_images_per_subject = 1
    await route.fulfill({ response, json: body })
  })
  await start(); await chooseFile('third'); await chooseFile('reference')
  await dialog.getByText('每个主体的图片最多 1 份，当前 2 份', { exact: true }).waitFor()
  assert.equal(await dialog.getByRole('button', { name: '撤回选入', exact: true }).count(), 2)
  await cancel(); await page.unroute('**/reference-capabilities**')
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width: 1440, height: 960 })
    await start(); await chooseFile('third')
    await page.setViewportSize({ width, height: 960 })
    await dialog.getByText('当前模型不能组合主体参考与帧参考，请明确选择', { exact: true }).waitFor()
    assert.equal(await dialog.getByRole('button', { name: '撤回选入', exact: true }).count(), 1, 'capability issue preserves prepared material')
    assert.equal(await dialog.getByRole('button', { name: '应用到本单元', exact: true }).isVisible(), true)
    await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth + 1)
    await dialog.locator('.ant-modal-body').evaluate(element => { element.scrollTop = element.scrollHeight })
    await page.screenshot({ path: join(output, `replacement-${width}.png`), animations: 'disabled' })
    await cancel()
  }
  await page.setViewportSize({ width: 1440, height: 960 })
  console.log('PASS unknown/limited capability preparation and desktop/mobile footer')
  const reader = await context.newPage()
  await reader.goto(page.url())
  reader.setDefaultTimeout(12000)
  await reader.getByRole('button', { name: '转到此页编辑', exact: true }).waitFor()
  await (await workbenchShot(reader, '镜头 1：读信反应')).click()
  await reader.getByRole('button', { name: '单元画布', exact: true }).click()
  await selectWorkbenchOption(reader, '当前单元', '单元 1')
  await reader.getByRole('button', { name: '编辑参考素材', exact: true }).click()
  const readonly = reader.getByRole('dialog', { name: '编辑参考素材', exact: true })
  await readonly.getByRole('status').filter({ hasText: '只读' }).waitFor()
  assert.ok(await readonly.getByRole('button', { name: '更换来源', exact: true }).count())
  for (const button of await readonly.getByRole('button', { name: '更换来源', exact: true }).all()) assert.equal(await button.isDisabled(), true)
  assert.equal(await readonly.getByRole('button', { name: '应用到本单元', exact: true }).count(), 0)
  await reader.close()
  assert.deepEqual(errors, [])
  console.log(`PASS atomic identity source replacement: ${output}`)
} catch (error) {
  console.error(backendOutput)
  if (page) console.error(await page.evaluate(() => [...document.querySelectorAll('body *')].filter(el => { const box = el.getBoundingClientRect(); return box.width && box.right > innerWidth + 1 }).slice(0, 20).map(el => ({ tag: el.tagName, classes: el.className, right: el.getBoundingClientRect().right, width: el.getBoundingClientRect().width }))))
  if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true, animations: 'disabled' }).catch(() => {})
  throw error
} finally {
  await cleanup()
}
