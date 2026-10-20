import { workbenchControl } from './workbenchControls.mjs'
import { workbenchShot } from './workbenchControls.mjs'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await mkdtemp(join(tmpdir(), 'jellyfish-scene-version-'))
const api = 'http://127.0.0.1:8193'
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.directing.scene_version_browser_server'], {
  cwd: join(root, '../backend'),
  env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', SCENE_BROWSER_TEST_DATABASE: join(output, 'browser.sqlite'), SCENE_BROWSER_TEST_PORT: '8193' },
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
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4193, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  page = await context.newPage()
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const create = await fetch(versionsUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), title: '覆盖编辑验收' }) })
  assert.equal(create.status, 200)
  const version = (await create.json()).data
  const content = version.content
  const assets = []
  for (const [kind, name] of [['character', '共享读信者'], ['scene', '共享书房']]) {
    const response = await fetch(`${api}/api/v1/studio/projects/canvas-project/directing/sequences/${sequenceId}/assets`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), kind, name }) })
    assert.equal(response.status, 200)
    assets.push((await response.json()).data)
  }
  const form = new FormData()
  form.append('file', new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64')], { type: 'image/png' }), 'navigation.png')
  form.append('project_id', 'canvas-project'); form.append('usage_kind', 'reference')
  const upload = await fetch(`${api}/api/v1/studio/files/upload`, { method: 'POST', body: form })
  assert.equal(upload.status, 201, await upload.clone().text())
  const file = (await upload.json()).data
  const note = text => ({ state: 'proposal', text, sources: [{ kind: 'human', reference: 'navigation', version: '1' }] })
  const historicalWorkspace = (await (await fetch(`${api}/api/v1/studio/projects/canvas-project/directing/sequences/${sequenceId}`)).json()).data
  const historicalDesign = historicalWorkspace.designs[0]
  content.design.direction.viewpoint = note('从读信者视角观察')
  content.design.direction.viewpoint.sources = [{ kind: 'revision', reference: historicalDesign.id, version: String(historicalDesign.version) }]
  content.design.direction.location_asset_id = assets[1].id
  content.design.participants = [{ id: 'reader', name: '读信者', character_id: assets[0].id }]
  content.design.direction.shots = [{ id: 'A', beat_ids: [], event_ids: [], blocking_state_ids: [], participant_ids: ['reader'], criterion_ids: [], narrative_function: {}, visible_result: note('读信') }]
  content.units = [{ id: 'A1', ratio: '16:9', instruction: '原正文', coverage: [{ id: 'coverage', shot_id: 'A', action_scope: '拆信' }], references: [{ id: 'reference', file_id: file.id, media_kind: 'image', purpose: 'identity', participant_ids: ['reader'], ordinal: 0, source: { kind: 'file', reference: file.id, version: '1', file_id: file.id } }] }]
  const saved = await fetch(`${versionsUrl}/${version.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: 1, content }) })
  assert.equal(saved.status, 200, await saved.clone().text())
  const baseline = (await saved.json()).data
  await page.goto(`http://127.0.0.1:4193/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${version.id}`)
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
  await (await workbenchControl(page, '保存设置', 'switch', '自动保存')).click()
  await (await workbenchShot(page, '镜头 1：读信')).click()
  await page.getByRole('button', { name: '指令画布', exact: true }).click()
  const body = page.getByRole('textbox', { name: '当前单元指令正文', exact: true })
  await body.fill('保持未保存正文')
  const relations = page.getByRole('navigation', { name: '场次关系树', exact: true })
  await relations.getByRole('button', { name: '展开关系树', exact: true }).click()
  await relations.getByRole('button', { name: '查看全场共享设计', exact: true }).click({ timeout: 5000 })
  const details = page.getByRole('complementary', { name: '关系对象 · 只读', exact: true })
  assert.equal(await details.getByRole('textbox', { name: '观察视点', exact: true }).inputValue(), '从读信者视角观察')
  assert.equal(await details.getByRole('textbox', { name: '观察视点', exact: true }).isDisabled(), true)
  await details.getByRole('button', { name: /查看来源 1：继承自设计/ }).click()
  await page.route(`**/sequences/${sequenceId}`, route => route.abort('failed'))
  await details.getByRole('button', { name: '查看只读历史', exact: true }).click()
  const historical = page.getByRole('region', { name: '来源版本 · 只读', exact: true })
  await historical.getByText('历史来源读取失败', { exact: true }).waitFor()
  assert.equal(await historical.getByText('原历史修订已不可用；请重新选择来源', { exact: true }).count(), 0)
  await page.unroute(`**/sequences/${sequenceId}`)
  await historical.getByRole('button', { name: '重试历史来源', exact: true }).click()
  const viewpoint = historical.getByRole('textbox', { name: '观察视点', exact: true }).filter({ hasText: '弟弟的反应' })
  await viewpoint.waitFor()
  assert.equal(await viewpoint.inputValue(), '弟弟的反应')
  assert.equal(await viewpoint.isDisabled(), true)
  await historical.getByRole('button', { name: '返回来源', exact: true }).click()
  await details.getByRole('button', { name: '关闭详情', exact: true }).click()
  await relations.getByRole('button', { name: '查看版本原文依据', exact: true }).click()
  await details.getByRole('button', { name: /查看来源 1：章节原文/ }).click()
  await details.getByText('当时保存的场次原文范围；章节名称为当前名称。未记录字段级原文定位。', { exact: true }).waitFor({ timeout: 5000 })
  await details.getByText('查看当时原文摘录', { exact: true }).click()
  assert.equal(await details.locator('blockquote').innerText(), baseline.content.basis.text)
  await details.getByRole('button', { name: '关闭详情', exact: true }).click()
  await relations.getByRole('button', { name: '查看参与对象：读信者', exact: true }).click()
  await details.getByText('角色资产：共享读信者', { exact: true }).waitFor()
  await details.getByRole('button', { name: '关闭详情', exact: true }).click()
  await page.route('**/directing/assets', route => route.abort('failed'))
  await relations.getByRole('button', { name: '查看本场场所', exact: true }).click()
  await details.getByText('关联资产读取失败', { exact: true }).waitFor()
  assert.equal(await details.getByText('原资产已不可用', { exact: true }).count(), 0)
  await page.unroute('**/directing/assets')
  await details.getByRole('button', { name: '重试关联资产', exact: true }).click()
  await details.getByText('场所资产：共享书房', { exact: true }).waitFor()
  await details.getByRole('button', { name: '关闭详情', exact: true }).click()
  await relations.getByRole('button', { name: '展开镜头 1', exact: true }).click()
  await relations.getByRole('button', { name: '展开单元 1', exact: true }).click()
  const referenceButton = relations.getByRole('button', { name: '查看单元 1 参考 1', exact: true })
  await referenceButton.click()
  await details.getByText('参考用途：人物／物件身份', { exact: true }).waitFor()
  await details.getByText('绑定对象：读信者', { exact: true }).waitFor()
  await page.waitForFunction(() => { const image = document.querySelector('img[alt="当前参考图片"]'); return image?.complete && image.naturalWidth === 1 })
  await details.getByRole('button', { name: '关闭详情', exact: true }).click()
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '查看单元 1 参考 1')
  await page.route(`**/files/${file.id}/download`, route => route.abort('failed'))
  await referenceButton.click()
  await details.getByText('参考媒体读取失败，原绑定已保留', { exact: true }).waitFor()
  await details.getByText('绑定对象：读信者', { exact: true }).waitFor()
  await page.unroute(`**/files/${file.id}/download`)
  await details.getByRole('button', { name: '重试参考媒体', exact: true }).click()
  await page.waitForFunction(() => { const image = document.querySelector('img[alt="当前参考图片"]'); return image?.complete && image.naturalWidth === 1 })
  await details.getByRole('button', { name: '关闭详情', exact: true }).click()
  assert.equal(await body.inputValue(), '保持未保存正文')
  assert.deepEqual((await (await fetch(`${versionsUrl}/${version.id}`)).json()).data, baseline)
  console.log(`PASS shared objects and references inspected in place without changing current work; evidence: ${output}`)
} catch (error) {
  if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true, animations: 'disabled' }).catch(() => {})
  console.error(`Browser evidence: ${output}`)
  throw error
} finally {
  await browser?.close()
  await server?.close()
  backend.kill('SIGTERM')
}
