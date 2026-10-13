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
  env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', SCENE_BROWSER_TEST_DATABASE: join(output, 'browser.sqlite'), SCENE_BROWSER_TEST_PORT: '8193', SCENE_BROWSER_TEST_LEGACY_TAKE: '1' },
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
  content.timeline.items = [
    { kind: 'media', fit: 'contain', id: 'first', take_kind: library[0].take_kind, take_id: library[0].take_id, file_id: library[0].file_id, media_range: { source_in_ms: 500, source_out_ms: 1000 }, timeline_start_ms: 1000 },
    { kind: 'media', fit: 'contain', id: 'second', take_kind: library[0].take_kind, take_id: library[0].take_id, file_id: library[0].file_id, media_range: { source_in_ms: 1000, source_out_ms: 1500 }, timeline_start_ms: 2500 },
  ]
  const saved = await fetch(`${versionsUrl}/${version.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: version.revision, content }) })
  assert.equal(saved.status, 200, await saved.text())
  await page.goto(`http://127.0.0.1:4193/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${version.id}`)
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  await page.getByRole('button', { name: '编辑画布', exact: true }).click()
  await page.getByRole('button', { name: '时间线', exact: true }).click()
  assert.equal(await page.locator('video').count(), 0)
  const before = performance.now()
  await page.getByRole('button', { name: '播放整场时间线', exact: true }).click({ timeout: 5000 })
  const black = page.getByLabel('时间线黑场', { exact: true })
  await black.waitFor()
  assert.equal(await black.evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(0, 0, 0)')
  assert.equal(await page.locator('video').count(), 0)
  const video = page.getByLabel('时间线媒体', { exact: true })
  await video.waitFor()
  assert.ok(performance.now() - before >= 850, 'initial gap must not be skipped')
  await page.waitForFunction(() => {
    const video = document.querySelector('video[aria-label="时间线媒体"]')
    return video && !video.paused && video.currentTime >= 0.5
  })
  assert.ok(await video.evaluate(node => node.currentTime < 1.1))
  assert.equal(await video.evaluate(node => node.muted), false)
  if (process.env.SCENE_BROWSER_TEST_LEGACY_AUDIO === '1') {
    const amplitude = await video.evaluate(async node => {
      const audio = new AudioContext()
      const source = audio.createMediaElementSource(node)
      const analyser = audio.createAnalyser()
      source.connect(analyser); analyser.connect(audio.destination)
      await audio.resume()
      await new Promise(resolve => setTimeout(resolve, 80))
      const samples = new Float32Array(analyser.fftSize)
      analyser.getFloatTimeDomainData(samples)
      const peak = Math.max(...samples.map(Math.abs))
      window.timelineTestAudio = audio
      return peak
    })
    assert.ok(amplitude > 0.01, `real source audio must be decoded, peak=${amplitude}`)
  } else assert.equal(await video.evaluate(node => node.captureStream().getAudioTracks().length), 0)
  await black.waitFor()
  assert.equal(await page.locator('video').count(), 0)
  const gapStart = performance.now()
  await video.waitFor()
  assert.ok(performance.now() - gapStart >= 800, 'middle gap must not be skipped')
  await page.waitForFunction(() => {
    const video = document.querySelector('video[aria-label="时间线媒体"]')
    return video && !video.paused && video.currentTime >= 1
  })
  assert.ok(await video.evaluate(node => node.currentTime < 1.6))
  await page.getByText('时间线播放完毕', { exact: true }).waitFor()
  await page.evaluate(() => window.timelineTestAudio?.close())
  const elapsed = performance.now() - before
  assert.ok(elapsed >= 2800 && elapsed < 6500, `three-second timeline took ${elapsed}ms`)
  assert.deepEqual((await (await fetch(`${versionsUrl}/${version.id}`)).json()).data.content.timeline, content.timeline)
  await page.getByRole('button', { name: '播放整场时间线', exact: true }).click()
  await black.waitFor()
  await page.getByRole('button', { name: '暂停时间线', exact: true }).click()
  const pausedPosition = await page.getByLabel('时间线播放位置', { exact: true }).innerText()
  await delay(300)
  assert.equal(await page.getByLabel('时间线播放位置', { exact: true }).innerText(), pausedPosition)
  assert.equal(await page.locator('video').count(), 0)
  await page.getByRole('button', { name: '继续时间线', exact: true }).click()
  await video.waitFor()
  await page.getByRole('button', { name: '停止时间线', exact: true }).click()
  assert.equal(await page.locator('video').count(), 0)
  const mediaPath = new URL(library[0].media_url, api).pathname
  await page.route(`**${mediaPath}*`, route => route.abort())
  await page.getByRole('button', { name: '播放整场时间线', exact: true }).click()
  await page.getByText('片段 first 无法读取或解码，播放已停止；可重试原片段。', { exact: true }).waitFor()
  await delay(300)
  assert.ok((await page.getByLabel('时间线播放位置', { exact: true }).innerText()).startsWith('1000 /'))
  await page.unroute(`**${mediaPath}*`)
  await page.getByRole('button', { name: '重试当前片段', exact: true }).click()
  await page.waitForFunction(() => {
    const video = document.querySelector('video[aria-label="时间线媒体"]')
    return video && !video.paused && video.currentTime >= 0.5 && video.currentTime < 1
  })
  await page.getByRole('button', { name: '暂停时间线', exact: true }).click()
  const mediaPaused = await video.evaluate(node => node.currentTime)
  await delay(250)
  assert.equal(await video.evaluate(node => node.currentTime), mediaPaused)
  assert.equal(await video.evaluate(node => node.paused), true)
  await page.getByRole('button', { name: '继续时间线', exact: true }).click()
  await page.getByRole('button', { name: '停止时间线', exact: true }).click()
  await page.getByRole('button', { name: '播放整场时间线', exact: true }).click()
  await page.getByRole('button', { name: '同场次素材', exact: true }).click()
  await page.getByRole('button', { name: '选择素材 1', exact: true }).click()
  await page.getByRole('button', { name: '当前素材', exact: true }).click()
  await page.getByRole('button', { name: '预览当前素材', exact: true }).click()
  assert.equal(await page.getByLabel('时间线媒体', { exact: true }).count(), 0)
  assert.equal(await page.getByRole('button', { name: '暂停时间线', exact: true }).count(), 0)
  await page.getByRole('button', { name: '时间线', exact: true }).click()
  await page.getByRole('button', { name: '播放整场时间线', exact: true }).click()
  assert.equal(await page.getByLabel('当前素材视频', { exact: true }).count(), 0)
  await page.getByRole('button', { name: '删除片段 1', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: '暂停时间线', exact: true }).count(), 0)
  assert.equal(await page.getByLabel('时间线媒体', { exact: true }).count(), 0)
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  assert.deepEqual((await (await fetch(sceneUrl)).json()).data.takes, originalTakes)
  console.log(`PASS real source ranges and silent black gaps; evidence: ${output}`)
} catch (error) {
  if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {})
  console.error(`Browser evidence: ${output}`)
  throw error
} finally {
  await browser?.close()
  await server?.close()
  backend.kill('SIGTERM')
}
