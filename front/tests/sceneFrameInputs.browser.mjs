import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'
import { selectWorkbenchOption } from './workbenchControls.mjs'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-frame-inputs-')
const api = 'http://127.0.0.1:8263'
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.directing.scene_version_browser_server'], {
  cwd: join(root, '../backend'),
  env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', SCENE_BROWSER_TEST_DATABASE: join(output, 'browser.sqlite'), SCENE_BROWSER_TEST_PORT: '8263', SCENE_BROWSER_TEST_SUBJECTS: '1' },
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
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4263, strictPort: true, open: false, proxy: { '/api': api } } })
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
  const content = version.content
  content.design.direction.shots = [{ id: 'shot', beat_ids: [], event_ids: [], blocking_state_ids: [], participant_ids: [], criterion_ids: [], narrative_function: {}, visible_result: {} }]
  content.units = [{ id: 'unit', instruction: '读信者看着来信。', model_id: 'browser-subject-model', duration_ms: 5000, ratio: '16:9', coverage: [{ id: 'coverage', shot_id: 'shot', action_scope: '读信' }] }]
  const detail = `${versionsUrl}/${version.id}`
  const response = await fetch(detail, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: 1, content }) })
  assert.equal(response.status, 200, await response.clone().text())
  const read = async () => (await (await fetch(detail)).json()).data
  const waitSaved = async predicate => {
    for (let i = 0; i < 80; i++) { const value = await read(); if (predicate(value)) return value; await delay(100) }
    throw new Error('frame save did not complete')
  }
  await page.goto(`http://127.0.0.1:4263/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${version.id}&unitView=unit:unit`)
  const open = async title => {
    await page.getByRole('button', { name: '定位画布节点', exact: true }).click()
    await page.getByRole('menuitem', { name: title, exact: true }).click()
    await page.getByRole('button', { name: `查看节点：${title}`, exact: true }).click()
    const dialog = page.getByRole('dialog').last()
    await dialog.waitFor()
    await dialog.getByRole('button', { name: '应用到本单元', exact: true }).hover()
    return dialog
  }
  const apply = async dialog => dialog.getByRole('button', { name: '应用到本单元', exact: true }).click()
  const cancel = async dialog => dialog.getByRole('button', { name: /^取\s*消$/ }).click()
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64')
  const upload = async (dialog, name) => {
    await selectWorkbenchOption(page, '参考素材来源', '上传')
    await dialog.locator('input[type="file"]').setInputFiles({ name, mimeType: 'image/png', buffer: png })
    await dialog.getByRole('button', { name: '更换素材', exact: true }).waitFor()
  }
  let dialog = await open('首帧参考')
  assert.match(await dialog.textContent(), /首帧参考/)
  assert.equal(await dialog.getByRole('combobox', { name: '参考输入位置', exact: true }).count(), 0)
  await upload(dialog, 'start.png')
  assert.equal((await read()).content.units[0].references.length, 0, 'upload only changes the modal draft')
  await cancel(dialog)
  assert.equal((await read()).content.units[0].references.length, 0)
  dialog = await open('首帧参考')
  await selectWorkbenchOption(page, '参考素材来源', '已有素材')
  await dialog.getByRole('button', { name: /^选\s*入$/ }).click()
  await apply(dialog)
  let saved = await waitSaved(value => value.content.units[0].references.length === 1)
  const first = saved.content.units[0].references[0]
  assert.equal(first.input_role, 'first_frame')
  dialog = await open('尾帧参考')
  await selectWorkbenchOption(page, '参考素材来源', '已有素材')
  await dialog.getByRole('button', { name: /^选\s*入$/ }).click()
  await apply(dialog)
  saved = await waitSaved(value => value.content.units[0].references.length === 2)
  const last = saved.content.units[0].references.find(ref => ref.input_role === 'last_frame')
  assert.equal(last.file_id, first.file_id)
  assert.notEqual(last.id, first.id)
  assert.deepEqual(saved.content.units[0].references.find(ref => ref.id === first.id), first)
  for (const role of ['first_frame', 'last_frame']) {
    const node = saved.unit_graph.nodes.find(node => node.kind === 'unit_references' && node.input_role === role)
    assert.equal(node.bindings.length, 1)
    assert.ok(saved.unit_graph.edges.some(edge => edge.source === node.id && edge.target === 'unit:unit'))
  }
  await page.getByText('正在更新单元卡片', { exact: true }).waitFor({ state: 'hidden' })
  await page.getByText('图待同步', { exact: true }).waitFor({ state: 'hidden' })
  await page.screenshot({ path: join(output, 'frames-desktop.png'), animations: 'disabled' })
  dialog = await open('首帧参考')
  await dialog.getByRole('button', { name: '更换素材', exact: true }).click()
  await upload(dialog, 'replacement.png')
  await apply(dialog)
  saved = await waitSaved(value => value.content.units[0].references.find(ref => ref.id === first.id)?.file_id !== first.file_id)
  assert.deepEqual(saved.content.units[0].references.find(ref => ref.id === last.id), last)
  dialog = await open('首帧参考')
  await dialog.getByRole('button', { name: /^移\s*除$/ }).click()
  await apply(dialog)
  saved = await waitSaved(value => value.content.units[0].references.length === 1)
  assert.deepEqual(saved.content.units[0].references, [last])
  dialog = await open('尾帧参考')
  await dialog.getByRole('button', { name: '应用到本单元', exact: true }).focus()
  await page.keyboard.press('Control+z')
  await apply(dialog)
  await dialog.getByText('当前单元输入已变化，请取消并重新打开后编辑', { exact: true }).waitFor()
  await cancel(dialog)
  saved = await waitSaved(value => value.content.units[0].references.length === 2)
  assert.deepEqual(saved.content.units[0].references.find(ref => ref.id === last.id), last)
  await page.setViewportSize({ width: 390, height: 844 })
  dialog = await open('尾帧参考')
  assert.equal(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1), true)
  await page.screenshot({ path: join(output, 'frames-mobile.png'), animations: 'disabled' })
  await cancel(dialog)
  // 改为仅支持首帧的模型，尾帧保留且不能静默改为其他角色。
  saved = await read()
  saved.content.units[0].model_id = 'browser-video-model'
  const unsupported = await fetch(detail, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: saved.revision, content: saved.content }) })
  assert.equal(unsupported.status, 200, await unsupported.clone().text())
  await page.reload()
  dialog = await open('尾帧参考')
  await dialog.getByText('当前模型不支持结束画面，请在生成配置中更换模型；已有绑定保留。', { exact: true }).waitFor()
  await dialog.getByRole('button', { name: '更换素材', exact: true }).click()
  await selectWorkbenchOption(page, '参考素材来源', '上传')
  assert.equal(await dialog.getByRole('button', { name: '上传参考素材', exact: true }).last().isDisabled(), true)
  await cancel(dialog)
  assert.deepEqual((await read()).content.units[0].references.find(ref => ref.id === last.id), last)
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.getByRole('button', { name: '单元准备状态', exact: true }).click()
  await page.getByRole('group', { name: '单元准备状态选项', exact: true }).getByRole('button', { name: '当前模型不支持所选帧位置，请替换参考或模型', exact: true }).click()
  const inputs = page.getByRole('complementary', { name: '参考输入', exact: true })
  await inputs.waitFor()
  await inputs.getByRole('button', { name: '尾帧参考', exact: true }).click()
  await page.getByRole('dialog', { name: '编辑尾帧参考', exact: true }).waitFor()
  await cancel(page.getByRole('dialog').last())
  assert.deepEqual(errors, [])
  console.log(`first/last frames passed: ${output}`)
} catch (error) {
  if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {})
  console.error(backendOutput)
  throw error
} finally { await cleanup() }
