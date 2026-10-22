import { workbenchShot, selectWorkbenchOption, locateCanvasNode } from './workbenchControls.mjs'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await mkdtemp(join(tmpdir(), 'jellyfish-scene-version-'))
const api = 'http://127.0.0.1:8257'
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.directing.scene_version_browser_server'], {
  cwd: join(root, '../backend'),
  env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', SCENE_BROWSER_TEST_DATABASE: join(output, 'browser.sqlite'), SCENE_BROWSER_TEST_PORT: '8257' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let backendOutput = ''
backend.stdout.on('data', data => { backendOutput += data })
backend.stderr.on('data', data => { backendOutput += data })
let server, browser, page
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
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4257, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  page = await context.newPage()
  page.on('pageerror', error => console.error(error.message))
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
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
  const content = version.content
  content.design.participants = [{ id: 'reader', name: '读信者', character_id: assets[0].id }, { id: 'outside', name: '其他人物', character_id: assets[2].id }]
  content.design.direction.shots = [{ id: 'shot', beat_ids: [], event_ids: [], blocking_state_ids: [], participant_ids: ['reader'], criterion_ids: [], narrative_function: {}, visible_result: { state: 'proposal', text: '读信反应', sources: [{ kind: 'human', reference: 'browser', version: '1' }] } }]
  content.units = [{ id: 'unit', model_id: 'browser-video-model', duration_ms: 5000, ratio: '16:9', coverage: [{ id: 'coverage', shot_id: 'shot', action_scope: '读信' }] }]
  const detail = `${versionsUrl}/${version.id}`
  const save = async (revision, body) => {
    const response = await fetch(detail, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: revision, content: body }) })
    assert.equal(response.status, 200, await response.clone().text())
    return (await response.json()).data
  }
  await save(1, content)
  const open = async () => {
    await page.goto(`http://127.0.0.1:4257/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${version.id}`)
    await page.getByRole('button', { name: '定位画布节点', exact: true }).waitFor()
    await (await workbenchShot(page, '镜头 1：读信反应')).click()
    await page.getByRole('button', { name: '单元画布', exact: true }).click()
    await page.getByRole('combobox', { name: '当前单元', exact: true }).press('ArrowDown')
    await page.getByRole('combobox', { name: '当前单元', exact: true }).press('Enter')
    await locateCanvasNode(page, '参考素材')
    await page.locator('[data-canvas-node="unit:unit:references"]').getByRole('button', { name: /^查看节点：/ }).click()
    return page.getByRole('dialog').last()
  }
  let dialog = await open()
  await dialog.getByText('默认甲', { exact: true }).waitFor()
  assert.equal(await dialog.getByText('场外丙', { exact: true }).count(), 0, '其他人物默认不自动铺入当前单元')
  assert.equal(await dialog.getByRole('img', { name: '参考图 1', exact: true }).count(), 0, '单图默认不自动选图')
  await selectWorkbenchOption(page, '本次参考绑定人物或物件', '读信者')
  await page.getByRole('combobox', { name: '本次参考绑定人物或物件' }).press('Escape')
  await selectWorkbenchOption(page, '本次素材资产', '手动乙')
  assert.equal(await dialog.locator('.ant-select-selection-item[title="读信者"]').count(), 1)
  await dialog.getByRole('button', { name: '应用到本单元', exact: true }).click()
  assert.deepEqual((await (await fetch(detail)).json()).data.content.units[0].references, [], '切换资产没有选择图片不持久化来源')
  dialog = await open()
  await dialog.getByText('默认甲', { exact: true }).waitFor()
  await selectWorkbenchOption(page, '本次参考绑定人物或物件', '读信者')
  await page.getByRole('combobox', { name: '本次参考绑定人物或物件' }).press('Escape')
  await selectWorkbenchOption(page, '本次素材资产', '手动乙')
  await dialog.getByRole('button', { name: '选入 手动乙 图片 1', exact: true }).click()
  await dialog.getByRole('button', { name: '应用到本单元', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
  let saved
  for (let i = 0; i < 40; i++) {
    saved = (await (await fetch(detail)).json()).data
    if (saved.content.units[0].references.length) break
    await delay(200)
  }
  assert.equal(saved.content.units[0].references[0].asset_origin.id, assets[1].id)
  assert.deepEqual(saved.content.units[0].references[0].participant_ids, ['reader'])
  assert.equal(saved.content.design.participants[0].character_id, assets[0].id)
  await page.screenshot({ path: join(output, 'independent-reference.png'), animations: 'disabled' })
  // 来源目录删除后固定文件仍可用；不能从已失效来源新增。
  const fixedReferences = structuredClone(saved.content.units[0].references)
  const deleteSource = await fetch(`${api}/api/v1/studio/entities/character/${assets[1].id}`, { method: 'DELETE' })
  assert.ok(deleteSource.ok, await deleteSource.text())
  dialog = await open()
  await dialog.getByText('素材来源：手动乙 · 选择时的资产记录', { exact: true }).waitFor()
  await dialog.getByText('来源资产不可用；已选固定文件保留，可用性在执行前单独核实。', { exact: true }).waitFor()
  await dialog.getByRole('button', { name: '添加参考', exact: true }).click()
  await dialog.getByRole('combobox', { name: '本次素材资产', exact: true }).click()
  assert.equal(await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').getByText('手动乙', { exact: true }).count(), 0)
  await page.keyboard.press('Escape')
  await dialog.getByRole('button', { name: '应用到本单元', exact: true }).click()
  saved = (await (await fetch(detail)).json()).data
  assert.deepEqual(saved.content.units[0].references, fixedReferences)
  const fixedCollection = saved.unit_graph.nodes.find(node => node.kind === 'unit_references')
  assert.equal(fixedCollection.previews[0].source_status, 'unavailable')
  assert.equal(fixedCollection.previews[0].status, 'available')
  await page.screenshot({ path: join(output, 'fixed-reference-source-unavailable.png'), animations: 'disabled' })
  // 外部对象存储夹具中移除真实字节；来源失效提示与文件读取失败分别显示。
  const stored = (await readdir(join(output, 'objects'), { recursive: true })).find(name => name.endsWith('.png'))
  assert.ok(stored)
  const storedPath = join(output, 'objects', stored)
  const storedBytes = await readFile(storedPath)
  await unlink(storedPath)
  await page.route('**/files/*/download', route => route.continue())
  dialog = await open()
  await dialog.getByText('来源资产不可用；已选固定文件保留，可用性在执行前单独核实。', { exact: true }).waitFor()
  await dialog.getByRole('status').filter({ hasText: `读取失败；固定文件 ${fileId} 保留` }).waitFor()
  await page.screenshot({ path: join(output, 'fixed-reference-file-unavailable.png'), animations: 'disabled' })
  await dialog.getByRole('button', { name: /取\s*消/ }).click()
  await writeFile(storedPath, storedBytes)
  await page.unroute('**/files/*/download')
  // 明确空范围与未知范围不借用全场人物默认；无图候选仍可独立选材。
  for (const participantIds of [[], null, ['reader']]) {
    const next = structuredClone(saved.content)
    next.units[0].references = []
    next.design.direction.shots[0].participant_ids = participantIds
    if (participantIds?.length) next.design.participants[0].character_id = assets[2].id
    saved = await save(saved.revision, next)
    dialog = await open()
    if (participantIds === null) await dialog.getByText('覆盖镜头的参与对象范围待核对；候选分组不代表完整出镜名单。', { exact: true }).waitFor()
    assert.equal(await dialog.locator('.scene-asset-row').count(), participantIds?.length ? 1 : 0)
    if (participantIds?.length) await dialog.getByText('尚无可用图片，请在本场资产中准备。', { exact: true }).waitFor()
    assert.equal(await dialog.getByRole('img', { name: '参考图 1', exact: true }).count(), 0)
    await dialog.getByRole('button', { name: /取\s*消/ }).click()
  }
  const removed = await fetch(`${api}/api/v1/studio/entities/character/${assets[2].id}`, { method: 'DELETE' })
  assert.ok(removed.ok, await removed.text())
  dialog = await open()
  await dialog.getByText('默认资产不可用：读信者角色。可独立选择其他素材。', { exact: true }).waitFor()
  await selectWorkbenchOption(page, '本次素材资产', '默认甲')
  await dialog.getByRole('button', { name: '选入 默认甲 图片 1', exact: true }).waitFor()
  await dialog.getByRole('button', { name: /取\s*消/ }).click()
  await page.getByRole('button', { name: '导演画布', exact: true }).click()
  const overview = page.getByRole('button', { name: '总览', exact: true })
  if (await overview.isEnabled()) await overview.click()
  await locateCanvasNode(page, '本场场所')
  await page.locator('[data-canvas-node="location"]').getByRole('button', { name: '设置默认资产', exact: true }).click()
  await page.getByRole('complementary', { name: /设置默认资产/ }).waitFor()
  await page.getByText('默认资产随设计保存，仅用于单元选材候选。解除或修改默认不会更改已选参考；单元也可独立选择其他项目资产。', { exact: true }).waitFor()
  console.log(`PASS independent default candidates and chosen reference: ${output}`)
} catch (error) {
  if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true, animations: 'disabled' }).catch(() => {})
  throw error
} finally {
  await browser?.close()
  await server?.close()
  backend.kill('SIGTERM')
}
