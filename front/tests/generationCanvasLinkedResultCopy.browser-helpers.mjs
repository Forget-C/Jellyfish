import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { browserCleanup, browserOutput, captureBackend } from './browser-runtime.mjs'

/** 两种模式均通过隔离服务提交并归档正式结果，再从实际页面复制。 */
export async function verifyLinkedResultCopy(modality, port, apiPort) {
  const video = modality === 'video'
  const root = fileURLToPath(new URL('..', import.meta.url))
  const output = await browserOutput(`jellyfish-generation-canvas-linked-${modality}-copy-`)
  const fixture = join(output, 'video.mp4')
  if (video) execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:d=1', '-c:v', 'libx264', '-y', fixture])
  const api = `http://127.0.0.1:${apiPort}`
  const base = `${api}/api/v1/studio/generation-canvases/canvas-project`
  const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', video ? 'tests.generation_canvas_video_browser_server' : 'tests.generation_canvas_runtime_browser_server'], {
    cwd: join(root, '../backend'), env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: String(apiPort), CANVAS_VIDEO_FIXTURE: fixture }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  captureBackend(backend, output)
  let server, browser
  const cleanup = browserCleanup(() => ({ server, browser, backend }))

  try {
    let ready = false
    for (let attempt = 0; attempt < 80; attempt++) {
      if (backend.exitCode !== null) throw new Error('isolated backend exited')
      try { if ((await fetch(base)).ok) { ready = true; break } } catch {}
      await delay(250)
    }
    assert.ok(ready, 'isolated backend ready')
    const request = async (path, body, method = 'POST') => {
      const response = await fetch(base + path, body ? { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined)
      assert.ok(response.ok, await response.clone().text())
      return (await response.json()).data
    }
    const label = video ? '视频' : '文本'
    const canvas = await request('', { name: `复制关联${label}结果` })
    const path = '/' + canvas.id
    const model = { id: 'model', type: `model.${modality}`, model_id: video ? 'video-frames' : 'canvas-runtime-text', show_result_cards: true,
      prompt: { segments: [{ id: 'p', kind: 'text', text: `生成一段${label}` }] }, config: video ? { ratio: '16:9', seconds: 5 } : {} }
    await request(path, { request_id: 'seed', expected_revision: 0, document: { ...canvas.document, cards: [model] } }, 'PUT')
    const precheck = await request(path + '/precheck', { card_id: model.id })
    assert.equal(precheck.can_run, true, JSON.stringify(precheck.diagnostics))
    await request(path + '/runs', { request_id: 'generate', preview_token: precheck.preview_token })
    const control = `${api}/test/${video ? 'video' : 'runtime'}-controls`
    const released = await fetch(control, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ release: video ? true : 2 }) })
    assert.ok(released.ok)

    server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port, strictPort: true, open: false, proxy: { '/api': api } } })
    await server.listen()
    browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    page.setDefaultTimeout(15000)
    await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
    await page.goto(`http://127.0.0.1:${port}/projects/canvas-project/generation-canvas?canvas=${canvas.id}`)
    const linked = page.getByRole('article', { name: `${label}生成结果 1`, exact: true })
    if (video) {
      await linked.getByRole('button', { name: '卡片操作', exact: true }).press('Enter')
      await linked.getByRole('button', { name: '复制、封面与下载…', exact: true }).click()
      await page.getByRole('menuitem', { name: '复制副本', exact: true }).click()
    } else {
      await linked.press('Enter')
      await linked.press('ControlOrMeta+d')
    }
    await page.locator(`[data-card-type="content.${modality}"]`).waitFor()
    await page.getByRole('status', { name: '画布保存状态', exact: true }).filter({ hasText: '已保存' }).waitFor()
    const copy = (await request(path)).document.cards.find(card => card.type === `content.${modality}`)
    if (video) {
      const current = (await request(path + '/runtime')).current_outputs[model.id][0]
      assert.equal(copy.file_id, current.file_id)
    } else assert.equal(copy.text, '第一段第二段第三段')
    assert.equal(copy.origin, undefined)
    const calls = (await (await fetch(control)).json()).calls
    assert.equal(video ? calls.filter(call => call.method === 'POST').length : calls.length, 1)
    console.log(`PASS linked ${modality} copy uses ordinary duplicate action`)
  } finally { await cleanup() }
}
