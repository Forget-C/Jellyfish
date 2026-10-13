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
  content.timeline.items = ['first', 'second'].map((id, index) => ({ kind: 'media', id, take_kind: library[0].take_kind, take_id: library[0].take_id, file_id: library[0].file_id, fit: 'contain', media_range: { source_in_ms: 0, source_out_ms: 2000 }, timeline_start_ms: index * 2500 }))
  const saved = await fetch(`${versionsUrl}/${version.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: version.revision, content }) })
  assert.equal(saved.status, 200, await saved.text())
  await page.goto(`http://127.0.0.1:4193/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${version.id}`)
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  await page.getByRole('switch', { name: '自动保存', exact: true }).click()
  await page.getByRole('button', { name: '编辑画布', exact: true }).click()
  await page.getByRole('button', { name: '时间线', exact: true }).click()
  for (const [ratio, label] of [['16:9', '16:9 横屏'], ['9:16', '9:16 竖屏'], ['1:1', '1:1 方形']]) {
    await page.getByRole('combobox', { name: '场次输出画幅', exact: true }).click({ timeout: 5000 })
    await page.getByText(label, { exact: true }).last().click()
    if (ratio !== '16:9') {
      await page.getByRole('button', { name: '单元画布', exact: true }).click()
      await page.getByRole('combobox', { name: '单元所属镜头', exact: true }).click()
      await page.getByText('镜头 1：构图测试', { exact: true }).last().click()
      await page.getByRole('button', { name: ratio === '9:16' ? '为当前镜头建立单元' : '为当前镜头增加补拍单元', exact: true }).click()
      await page.getByRole('button', { name: '保存', exact: true }).click()
      await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
      const units = (await (await fetch(`${versionsUrl}/${version.id}`)).json()).data.content.units
      assert.deepEqual(units.map(unit => unit.ratio), ratio === '9:16' ? ['9:16'] : ['9:16', '1:1'])
      await page.getByRole('button', { name: '编辑画布', exact: true }).click()
      await page.getByRole('button', { name: '时间线', exact: true }).click()
    }
    for (const [fit, fitLabel] of [['contain', '完整显示'], ['cover', '居中填满']]) {
      await page.getByRole('combobox', { name: '片段 1 构图', exact: true }).click()
      await page.getByText(fitLabel, { exact: true }).last().click()
      if (await page.getByRole('button', { name: '保存', exact: true }).isEnabled()) await page.getByRole('button', { name: '保存', exact: true }).click()
      await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
      const current = (await (await fetch(`${versionsUrl}/${version.id}`)).json()).data.content
      assert.equal(current.output_aspect_ratio, ratio)
      assert.equal(current.timeline.items[0].fit, fit)
      assert.equal(current.timeline.items[1].fit, 'contain')
      assert.deepEqual(current.timeline.items.map(({ fit: omitted, ...item }) => item), content.timeline.items.map(({ fit: omitted, ...item }) => item))
      await page.getByRole('button', { name: '播放整场时间线', exact: true }).click()
      await page.waitForFunction(() => { const video = document.querySelector('video[aria-label="时间线媒体"]'); return video && !video.paused && video.currentTime > 0.05 })
      await page.getByRole('button', { name: '暂停时间线', exact: true }).click()
      const frame = page.getByLabel('时间线输出画面', { exact: true })
      const box = await frame.boundingBox()
      const [width, height] = ratio.split(':').map(Number)
      assert.ok(Math.abs(box.width / box.height - width / height) < 0.02)
      const png = await frame.screenshot({ path: join(output, `${ratio.replace(':', '-')}-${fit}.png`) })
      const colors = await page.evaluate(async bytes => {
        const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }))
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
        const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0)
        return [[0.1, 0.5], [0.5, 0.1], [0.5, 0.5], [0.9, 0.5]].map(([x, y]) => [...ctx.getImageData(Math.floor(x * bitmap.width), Math.floor(y * bitmap.height), 1, 1).data].slice(0, 3))
      }, [...png])
      const green = ([r, g, b]) => g > 80 && r < 40 && b < 40
      assert.ok(green(colors[2]), `center must remain green: ${colors}`)
      if (fit === 'contain' || ratio === '16:9') {
        assert.ok(colors[0][0] > 180 && colors[0][1] < 40, `left source edge retained: ${colors}`)
        assert.ok(colors[3][2] > 180 && colors[3][1] < 40, `right source edge retained: ${colors}`)
        if (ratio !== '16:9') assert.ok(colors[1].every(channel => channel < 15), `letterbox is black: ${colors}`)
      } else assert.ok(green(colors[0]) && green(colors[1]) && green(colors[3]), `centered cover crops sides: ${colors}`)
      await page.getByRole('button', { name: '停止时间线', exact: true }).click()
    }
  }
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  assert.equal((await (await fetch(`${versionsUrl}/${version.id}`)).json()).data.content.timeline.items[0].fit, 'contain')
  await page.getByRole('button', { name: '重做', exact: true }).click()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  await page.getByRole('combobox', { name: '场次输出画幅', exact: true }).click()
  await page.getByText('9:16 竖屏', { exact: true }).last().click()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  assert.equal((await (await fetch(`${versionsUrl}/${version.id}`)).json()).data.content.output_aspect_ratio, '9:16')
  for (const [action, expected] of [['撤销', '1:1'], ['重做', '9:16'], ['撤销', '1:1']]) {
    await page.getByRole('button', { name: action, exact: true }).click()
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
    const restored = (await (await fetch(`${versionsUrl}/${version.id}`)).json()).data.content
    assert.equal(restored.output_aspect_ratio, expected)
    assert.deepEqual(restored.units.map(unit => unit.ratio), ['9:16', '1:1'])
  }
  await page.reload()
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  const final = (await (await fetch(`${versionsUrl}/${version.id}`)).json()).data.content
  assert.equal(final.output_aspect_ratio, '1:1')
  assert.deepEqual(final.timeline.items.map(item => item.fit), ['cover', 'contain'])
  assert.deepEqual(final.units.map(unit => unit.ratio), ['9:16', '1:1'])
  const otherCreated = await fetch(versionsUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), title: '独立构图方案' }) })
  assert.equal(otherCreated.status, 200)
  const other = (await otherCreated.json()).data
  const otherContent = { ...final, output_aspect_ratio: '9:16', timeline: { items: final.timeline.items.map(item => ({ ...item, fit: 'contain' })) } }
  const otherSaved = await fetch(`${versionsUrl}/${other.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: other.revision, content: otherContent }) })
  assert.equal(otherSaved.status, 200, await otherSaved.text())
  assert.deepEqual((await (await fetch(`${versionsUrl}/${version.id}`)).json()).data.content, final)
  assert.deepEqual((await (await fetch(sceneUrl)).json()).data.takes, originalTakes)
  console.log(`PASS three output ratios and two fits with rendered pixel verification; evidence: ${output}`)
} catch (error) {
  if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {})
  console.error(`Browser evidence: ${output}`)
  throw error
} finally {
  await browser?.close()
  await server?.close()
  backend.kill('SIGTERM')
}
