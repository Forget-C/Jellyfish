import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'
import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-object-assets-')
const api = 'http://127.0.0.1:8268', studio = `${api}/api/v1/studio`
const project = 'canvas-project', chapter = 'object-test-chapter', excerpt = '前门的阿同拿着信封。后门的阿同等待。'
const raw = excerpt + '空镜。'
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_runtime_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache',
    CANVAS_BROWSER_SCENE_OBJECTS: '1', CANVAS_BROWSER_OBJECT_CANDIDATE: '1', CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'),
    CANVAS_BROWSER_PORT: '8268' }, stdio: ['ignore', 'pipe', 'pipe'],
})
captureBackend(backend, output)
let server, browser, page
const cleanup = browserCleanup(() => ({ browser, server, backend }))
const request = async (url, method = 'GET', body) => {
  const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) })
  assert.ok(response.ok, await response.clone().text())
  return (await response.json()).data
}
try {
  let ready = false
  for (let attempt = 0; attempt < 80; attempt++) {
    if (backend.exitCode !== null) throw new Error('isolated backend exited')
    try { if ((await fetch(`${studio}/generation-canvases/${project}`)).ok) { ready = true; break } } catch {}
    await delay(250)
  }
  assert.ok(ready)
  await request(`${studio}/chapters`, 'POST', { id: chapter, project_id: project, index: 0, title: '候车', raw_text: raw })
  const scenes = `${studio}/projects/${project}/directing/chapters/${chapter}/sequences`
  const sourceVersion = createHash('sha256').update(raw).digest('hex')
  const sequence = await request(scenes, 'POST', { title: '两人等候', position: 0,
    source_version: sourceVersion, span: { start: 0, end: excerpt.length } })
  const emptyScene = await request(scenes, 'POST', { title: '空镜', position: 1,
    source_version: sourceVersion, span: { start: excerpt.length, end: raw.length } })
  const objectsUrl = `${scenes}/${sequence.id}/objects`
  const read = () => request(objectsUrl)
  const canvas = await request(`${scenes}/${sequence.id}/canvases`, 'POST', { name: '已有方案' })
  const canvasUrl = `${studio}/generation-canvases/${project}/${canvas.id}`
  const canvasBefore = await request(canvasUrl)
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4268, strictPort: true, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  page.setDefaultTimeout(12000)
  const management = `http://127.0.0.1:4268/projects/${project}/chapters/${chapter}/workbench-management?sequence=${sequence.id}&step=objects`
  await page.goto(management)
  await page.getByRole('navigation', { name: '制作步骤' }).waitFor()
  const extract = page.getByRole('button', { name: '提取对象', exact: true })
  await page.getByText(/^尚未提取对象/).waitFor()
  await extract.focus()
  await page.keyboard.press('Enter')
  const front = page.getByRole('region', { name: '阿同 · 前门的阿同', exact: true })
  const back = page.getByRole('region', { name: '阿同 · 后门的阿同', exact: true })
  await front.waitFor()
  await request(`${studio}/entities/actor`, 'POST', { id: 'library-actor', name: '资产库演员', style: '真人都市' })
  const uploadImage = async name => {
    const body = new FormData()
    body.append('file', new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7WQAAAAASUVORK5CYII=', 'base64')], { type: 'image/png' }), name)
    const uploaded = await fetch(`${studio}/files/upload`, { method: 'POST', body })
    assert.ok(uploaded.ok, await uploaded.clone().text())
    return (await uploaded.json()).data.id
  }
  const image = await uploadImage('actor.png')
  const slots = await request(`${studio}/entities/actor/library-actor/images`)
  await request(`${studio}/entities/actor/library-actor/images/${slots.items[0].id}`, 'PATCH', { file_id: image })
  assert.equal((await request(`${studio}/entities/character?project_id=${project}`)).items.length, 1, '提取对象不创建项目资源')
  await front.getByRole('button', { name: '对象更多操作' }).click()
  await page.getByRole('menuitem', { name: '新建并关联', exact: true }).click()
  const draft = page.getByRole('dialog', { name: '新建角色', exact: true })
  await draft.getByRole('textbox', { name: '名称', exact: true }).waitFor()
  assert.equal(await draft.getByRole('textbox', { name: '名称', exact: true }).inputValue(), '阿同')
  await draft.getByRole('button', { name: '取消', exact: true }).click()
  assert.equal((await request(`${studio}/entities/character?project_id=${project}`)).items.length, 1)
  await front.getByRole('button', { name: '对象更多操作' }).click()
  await page.getByRole('menuitem', { name: '新建并关联', exact: true }).click()
  await draft.getByText('参考图片 · 未选择', { exact: true }).click()
  await draft.getByRole('button', { name: '选择参考主体', exact: true }).click()
  await draft.getByRole('button', { name: '选择参考演员 资产库演员', exact: true }).click()
  await draft.getByRole('button', { name: '使用所选图片', exact: true }).click()
  await draft.getByRole('button', { name: '仅创建', exact: true }).click()
  await draft.getByRole('button', { name: '采用并创建', exact: true }).click()
  await draft.waitFor({ state: 'hidden' })
  await front.getByRole('img', { name: '阿同已选参考图', exact: true }).waitFor()
  let selected = (await read()).objects[0]
  assert.notEqual(selected.image_file_id, image, '未生成而采用主体作为主图必须复制文件')
  assert.notEqual(selected.asset_id, 'library-actor')
  const roleId = selected.asset_id
  const selectedFile = selected.image_file_id
  const roleImage = await uploadImage('role.png')
  await request(`${studio}/entities/character/${roleId}/images`, 'POST', { view_angle: 'LEFT', file_id: roleImage, is_primary: true })
  await page.reload()
  assert.equal((await read()).objects[0].image_file_id, selectedFile, '已明确选择的场次文件不随主图变化')
  await front.getByRole('combobox', { name: '参考视角' }).press('ArrowDown')
  await Promise.all([page.waitForResponse(response => response.request().method() === 'PUT' && response.url().includes('/objects/')),
    page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').getByText('左侧', { exact: true }).click()])
  assert.equal((await read()).objects[0].image_file_id, roleImage)
  await back.getByRole('button', { name: '对象更多操作' }).click()
  await page.getByRole('menuitem', { name: '修改关联资产', exact: true }).click()
  await page.getByRole('combobox', { name: '使用已有项目对象' }).click()
  await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').getByText('阿同', { exact: true }).click()
  await back.getByRole('img', { name: '阿同已选参考图', exact: true }).waitFor()
  selected = (await read()).objects[1]
  assert.equal(selected.asset_id, roleId)
  assert.equal(selected.image_file_id, roleImage, '明确复用已有项目对象时默认采用主图')
  assert.equal((await request(`${studio}/entities/character?project_id=${project}`)).items.length, 2)
  assert.deepEqual((await request(canvasUrl)).cards, canvasBefore.cards, '对象创建不修改已有画布')
  const frame = await front.locator('.management-reference-frame').boundingBox()
  const angleControl = await front.locator('.management-reference-angle').boundingBox()
  assert.ok(angleControl.y >= frame.y && angleControl.y + angleControl.height <= frame.y + frame.height, '角度控件位于图片区，不遮挡资产名称')
  await page.screenshot({ path: join(output, 'actor-reference.png'), animations: 'disabled' })
  console.log('PASS extraction creates nothing, common creation/adoption, independent main and explicit project reuse')
} finally { await cleanup() }
