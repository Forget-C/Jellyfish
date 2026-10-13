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
  env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', SCENE_BROWSER_TEST_DATABASE: join(output, 'browser.sqlite'), SCENE_BROWSER_TEST_PORT: '8193', SCENE_BROWSER_TEST_LEGACY_TAKE: '1', SCENE_BROWSER_TEST_LEGACY_FRAMING: '1' },
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
  const sceneUrl = `${api}/api/v1/studio/projects/canvas-project/directing/sequences/${sequenceId}`
  const originalTakes = (await (await fetch(sceneUrl)).json()).data.takes
  assert.equal(originalTakes.length, 1)
  const library = (await (await fetch(`${versionsUrl}/${version.id}/take-library`)).json()).data
  assert.equal(library.length, 1)
  assert.equal(library[0].take_kind, 'production_plan')
  assert.equal(library[0].file_id, 'legacy-take-file')
  assert.equal(library[0].task_id, 'legacy-video-task')
  assert.equal(library[0].prompt.text, '旧生产计划的固定拍摄指令')
  const content = structuredClone(version.content)
  content.design.direction.shots = [{ id: 'framing-shot', beat_ids: [], event_ids: [], blocking_state_ids: [], participant_ids: [], criterion_ids: [], narrative_function: {}, visible_result: { state: 'proposal', text: '构图测试', sources: [{ kind: 'human', reference: 'author', version: '1' }] } }]
  content.timeline.items = ['first', 'second'].map((id, index) => ({ kind: 'media', id, take_kind: library[0].take_kind, take_id: library[0].take_id, file_id: library[0].file_id, fit: 'contain', media_range: { source_in_ms: 0, source_out_ms: 1000 }, timeline_start_ms: index * 5000 }))
  const saved = await fetch(`${versionsUrl}/${version.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: version.revision, content }) })
  assert.equal(saved.status, 200, await saved.text())
  await page.goto(`http://127.0.0.1:4193/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${version.id}`)
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  await page.getByRole('switch', { name: '自动保存', exact: true }).click()
  await page.getByRole('button', { name: '编辑画布', exact: true }).click()
  await page.getByRole('button', { name: '时间线', exact: true }).click()
  const detailUrl = `${versionsUrl}/${version.id}`
  const deliveriesUrl = `${api}/api/v1/studio/projects/canvas-project/directing/chapters/canvas-chapter/deliveries`
  const used = async () => (await (await fetch(deliveriesUrl)).json()).data.sequences[0].delivery
  await page.getByRole('combobox', { name: '场次输出画幅', exact: true }).click()
  await page.getByText('9:16 竖屏', { exact: true }).last().click()
  await page.getByRole('button', { name: '用于章节', exact: true }).click({ timeout: 5000 })
  await page.getByText('章节当前使用：覆盖编辑验收', { exact: true }).waitFor()
  const first = await used()
  assert.equal(first.content.output_aspect_ratio, '9:16')
  assert.equal(first.review, null)
  const chapterPage = await context.newPage()
  await chapterPage.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  await chapterPage.goto('http://127.0.0.1:4193/projects/canvas-project?tab=chapters&chapter=canvas-chapter&panel=assembly')
  await chapterPage.getByText('交付来源：覆盖编辑验收', { exact: true }).waitFor()
  await chapterPage.getByText('实际覆盖尚未核对', { exact: true }).waitFor()
  await chapterPage.getByRole('button', { name: '按场次顺序播放', exact: true }).click()
  await chapterPage.getByLabel('时间线媒体', { exact: true }).waitFor()
  assert.equal(await chapterPage.getByLabel('时间线输出画面', { exact: true }).evaluate(node => getComputedStyle(node).aspectRatio), '9 / 16')
  await chapterPage.getByRole('button', { name: '停止章节播放', exact: true }).click()
  await page.getByRole('combobox', { name: '场次输出画幅', exact: true }).click()
  await page.getByText('1:1 方形', { exact: true }).last().click()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  assert.deepEqual(await used(), first)
  await chapterPage.getByRole('button', { name: '刷新章节使用', exact: true }).click()
  await chapterPage.getByText('交付画幅：9:16', { exact: true }).waitFor()
  const updated = page.waitForResponse(response => response.url().endsWith('/deliveries') && response.request().method() === 'POST' && response.status() === 200)
  await page.getByRole('button', { name: '更新到章节', exact: true }).click()
  await updated
  assert.equal((await used()).content.output_aspect_ratio, '1:1')
  await chapterPage.getByRole('button', { name: '刷新章节使用', exact: true }).click()
  await chapterPage.getByText('交付画幅：1:1', { exact: true }).waitFor()
  assert.equal((await (await fetch(detailUrl)).json()).data.content.output_aspect_ratio, '1:1')
  const second = await used()
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  assert.deepEqual(await used(), second)
  await page.getByRole('button', { name: '重做', exact: true }).click()
  await page.getByRole('combobox', { name: '场次输出画幅', exact: true }).click()
  await page.getByText('16:9 横屏', { exact: true }).last().click()
  let deliveredPosts = 0
  page.on('request', request => { if (request.url().endsWith('/deliveries') && request.method() === 'POST') deliveredPosts++ })
  await page.route(`**/versions/${version.id}`, route => route.request().method() === 'PUT'
    ? route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ detail: '交付验收夹具：保存失败' }) }) : route.continue())
  await page.getByRole('button', { name: '更新到章节', exact: true }).click()
  await page.getByText('保存尚未成功，章节使用内容未更新；请核实保存结果后重试。', { exact: true }).waitFor()
  assert.equal(deliveredPosts, 0)
  assert.deepEqual(await used(), second)
  await page.unroute(`**/versions/${version.id}`)
  let originalRequest
  await page.route('**/deliveries', async route => {
    if (route.request().method() !== 'POST') return route.continue()
    originalRequest = route.request().postDataJSON()
    const response = await route.fetch()
    assert.equal(response.status(), 200, await response.text())
    await route.abort('failed')
  })
  await page.getByRole('button', { name: '更新到章节', exact: true }).click()
  await page.getByRole('button', { name: '核实原交付请求', exact: true }).waitFor()
  const third = await used()
  assert.equal(third.content.output_aspect_ratio, '16:9')
  await page.unroute('**/deliveries')
  await page.getByRole('combobox', { name: '场次输出画幅', exact: true }).click()
  await page.getByText('9:16 竖屏', { exact: true }).last().click()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  await page.reload()
  const retried = page.waitForRequest(request => request.url().endsWith('/deliveries') && request.method() === 'POST')
  await page.getByRole('button', { name: '核实原交付请求', exact: true }).click()
  assert.deepEqual((await retried).postDataJSON(), originalRequest)
  await page.getByRole('button', { name: '更新到章节', exact: true }).waitFor()
  assert.deepEqual(await used(), third)
  assert.equal((await (await fetch(detailUrl)).json()).data.content.output_aspect_ratio, '9:16')
  assert.equal((await (await fetch(`${sceneUrl}/deliveries`)).json()).data.length, 3)
  await chapterPage.route('**/deliveries', route => route.abort('failed'))
  await chapterPage.getByRole('button', { name: '刷新章节使用', exact: true }).click()
  await chapterPage.getByText('章节使用内容读取失败', { exact: true }).waitFor()
  assert.equal(await chapterPage.getByRole('button', { name: '按场次顺序播放', exact: true }).isDisabled(), true)
  await chapterPage.unroute('**/deliveries')
  await chapterPage.getByRole('button', { name: '刷新章节使用', exact: true }).click()
  await chapterPage.getByText('交付画幅：16:9', { exact: true }).waitFor()
  await page.evaluate(() => {
    window.originalDeliveryStorage = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('scene-delivery:')) throw new Error('fixture storage failure')
      return window.originalDeliveryStorage.call(this, key, value)
    }
  })
  const beforeStorageFailure = deliveredPosts
  await page.getByRole('button', { name: '更新到章节', exact: true }).click()
  await page.getByText('内容已保存，但交付凭据写入失败，本次未交付。', { exact: true }).waitFor()
  assert.equal(deliveredPosts, beforeStorageFailure)
  assert.deepEqual(await used(), third)
  await page.evaluate(() => { Storage.prototype.setItem = window.originalDeliveryStorage })
  await page.getByRole('button', { name: '重读交付凭据', exact: true }).click()
  const alternateResponse = await fetch(versionsUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), title: '章节使用 B' }) })
  const alternate = (await alternateResponse.json()).data
  alternate.content.design = structuredClone(content.design)
  alternate.content.timeline.items = [{ kind: 'planned', id: 'planned-b', shot_id: 'framing-shot', timeline_start_ms: 0, estimated_duration_ms: 3000 }]
  const savedAlternate = await fetch(`${versionsUrl}/${alternate.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: alternate.revision, content: alternate.content }) })
  assert.equal(savedAlternate.status, 200, await savedAlternate.text())
  await page.goto(`http://127.0.0.1:4193/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${alternate.id}`)
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  await page.getByText('章节当前使用：覆盖编辑验收', { exact: true }).waitFor()
  assert.deepEqual(await used(), third)
  await page.close(); page = undefined
  await chapterPage.getByRole('link', { name: '继续场次创作', exact: true }).click()
  await chapterPage.getByText('章节使用 B', { exact: true }).first().waitFor()
  assert.deepEqual(await used(), third)
  const publishB = chapterPage.waitForResponse(response => response.url().endsWith('/deliveries') && response.request().method() === 'POST' && response.status() === 200)
  await chapterPage.getByRole('button', { name: '更新到章节', exact: true }).click()
  await publishB
  await chapterPage.goto('http://127.0.0.1:4193/projects/canvas-project?tab=chapters&chapter=canvas-chapter&panel=assembly')
  await chapterPage.getByText('交付来源：章节使用 B', { exact: true }).waitFor()
  await chapterPage.getByText('待拍占位 planned-b：预计 3000 毫秒，不代表真实覆盖', { exact: true }).waitFor()
  await chapterPage.getByText('交付画面未验收', { exact: true }).waitFor()
  await chapterPage.getByRole('button', { name: '按场次顺序播放', exact: true }).click()
  await chapterPage.getByLabel('时间线待拍占位', { exact: true }).waitFor()
  const chapterBase = `${api}/api/v1/studio/projects/canvas-project/directing/chapters/canvas-chapter`
  const narrowed = await fetch(`${chapterBase}/sequences/${sequenceId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: chapter.sequences[0].title, position: 0, expected_version: chapter.sequences[0].version, source_version: chapter.source_version, span: { start: 0, end: 1 } }) })
  assert.equal(narrowed.status, 200, await narrowed.text())
  const secondSceneResponse = await fetch(chapterBase + '/sequences', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: '第二场预演', position: 1, source_version: chapter.source_version, span: { start: 1, end: 2 } }) })
  assert.equal(secondSceneResponse.status, 200, await secondSceneResponse.clone().text())
  const secondScene = (await secondSceneResponse.json()).data
  const secondVersions = `${api}/api/v1/studio/projects/canvas-project/directing/sequences/${secondScene.id}/versions`
  const secondVersion = (await (await fetch(secondVersions, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), title: '第二场章节使用' }) })).json()).data
  secondVersion.content.design = structuredClone(alternate.content.design)
  secondVersion.content.output_aspect_ratio = '1:1'
  secondVersion.content.timeline.items = [{ kind: 'planned', id: 'planned-second', shot_id: 'framing-shot', timeline_start_ms: 0, estimated_duration_ms: 3000 }]
  const savedSecond = await fetch(`${secondVersions}/${secondVersion.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: 1, content: secondVersion.content }) })
  assert.equal(savedSecond.status, 200, await savedSecond.clone().text())
  const deliveredSecond = await fetch(`${secondVersions}/${secondVersion.id}/deliveries`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: (await savedSecond.json()).data.revision }) })
  assert.equal(deliveredSecond.status, 200, await deliveredSecond.text())
  await chapterPage.getByRole('button', { name: '刷新章节使用', exact: true }).click()
  await chapterPage.getByText('交付来源：第二场章节使用', { exact: true }).waitFor()
  await chapterPage.getByRole('button', { name: '按场次顺序播放', exact: true }).click()
  await chapterPage.getByText('正在预演：第二场预演', { exact: true }).waitFor({ timeout: 10000 })
  assert.equal(await chapterPage.getByLabel('时间线待拍占位', { exact: true }).evaluate(node => getComputedStyle(node).aspectRatio), '1 / 1')
  console.log(`PASS explicit chapter delivery, fixed framing and chapter preview; evidence: ${output}`)
} catch (error) {
  if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {})
  console.error(`Browser evidence: ${output}`)
  throw error
} finally {
  await browser?.close()
  await server?.close()
  backend.kill('SIGTERM')
}
