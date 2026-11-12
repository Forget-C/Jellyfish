import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { browserCleanup, browserOutput } from './browser-runtime.mjs'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = process.env.FILE_PERF_ROOT || fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-managed-files-')
const server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4546, strictPort: true } })
let browser
const cleanup = browserCleanup(() => ({ browser, server }))
try {
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
  const page = await context.newPage()
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: location.origin } })
  page.setDefaultTimeout(10000)
  const listRequests = [], downloads = []
  let failList = false, empty = false, delayRain = false, releaseRain
  const rainGate = new Promise(resolve => { releaseRain = resolve })
  const video = execFileSync('ffmpeg', ['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=navy:s=128x72:d=0.2','-c:v','libx264','-pix_fmt','yuv420p','-f','mp4','-movflags','frag_keyframe+empty_moov','pipe:1'])
  const audio = execFileSync('ffmpeg', ['-hide_banner','-loglevel','error','-f','lavfi','-i','anullsrc=r=8000:cl=mono','-t','0.2','-f','wav','pipe:1'])
  const raster = execFileSync('ffmpeg', ['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=1920x1080:rate=1','-frames:v','1','-c:v','mjpeg','-f','image2pipe','pipe:1'])
  const rows = Array.from({ length: 60 }, (_, i) => ({ id: `file${i}`, type: i === 1 ? 'video' : i === 2 ? 'audio' : 'image', name: i === 0 ? '雨夜参考图' : i === 1 ? '雨夜视频' : i === 2 ? '雨夜音频' : i === 3 ? '损坏图片' : i === 4 ? '很长的参考图片名称'.repeat(10) : `图片${i}` }))
  await context.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname
    const respond = data => route.fulfill({ json: { success: true, data } })
    if (path.endsWith('/projects/p-files')) return respond({ id: 'p-files', name: '文件项目', stats: {} })
    if (path.endsWith('/chapters')) return respond({ items: [{ id: 'c1', project_id: 'p-files', index: 1, title: '雨夜' }, { id: 'c2', project_id: 'p-files', index: 2, title: '晴天' }], pagination: { total: 1 } })
    if (path.endsWith('/files')) {
      listRequests.push(Object.fromEntries(url.searchParams))
      if (delayRain && url.searchParams.get('chapter_title') === '雨夜') await rainGate
      if (url.searchParams.get('chapter_title') === '晴天') return respond({ items: [{ id: 'sun', name: '晴天唯一文件', type: 'image' }], pagination: { total: 1 } })
      if (failList) return route.fulfill({ status: 503, json: { detail: '文件读取不可用' } })
      const pageNumber = Number(url.searchParams.get('page') || 1)
      return respond({ items: empty ? [] : rows.slice((pageNumber - 1) * Number(url.searchParams.get('page_size')), pageNumber * Number(url.searchParams.get('page_size'))), pagination: { total: empty ? 0 : rows.length } })
    }
    if (path.endsWith('/files/file3/download')) return route.fulfill({ status: 404, body: 'missing image' })
    if (path.endsWith('/download') && request.isNavigationRequest()) {
      downloads.push(path)
      return route.fulfill({ contentType: 'application/octet-stream', headers: { 'content-disposition': 'attachment; filename="reference.svg"' }, body: 'downloaded-file-content' })
    }
    if (path.endsWith('/files/file1/download')) return route.fulfill({ contentType: 'video/mp4', body: video })
    if (path.endsWith('/files/file2/download')) return route.fulfill({ contentType: 'audio/wav', body: audio })
    if (path.endsWith('/download')) return route.fulfill({ contentType: 'image/jpeg', body: raster })
    return respond({ items: [] })
  })
  await page.goto('http://127.0.0.1:4546/files')
  await page.getByText('雨夜参考图', { exact: true }).waitFor()
  const cdp = await context.newCDPSession(page)
  const samples = []
  for (const amount of [240, 1200, 5000]) {
    rows.length = 0
    for (let i = 0; i < amount; i++) rows.push({ id: `perf${i}`, type: 'image', name: `性能文件${i}` })
    await page.reload()
    await page.getByText('性能文件0', { exact: true }).waitFor()
    const started = Date.now()
    let timedOut = false
    for (;;) {
      if (Date.now() - started > 60000) { timedOut = true; break }
      await page.locator('.management-panel').evaluate(el => { el.scrollTop = el.scrollHeight })
      if (await page.getByText(`已显示全部 ${amount} 个文件`, { exact: true }).isVisible()) break
      await page.waitForTimeout(30)
    }
    if (timedOut) {
      samples.push({ amount, timedOut: true, elapsedMs: Date.now()-started, loaded: await page.locator('.management-count').textContent(), mountedCards: await page.getByRole('article').count() })
      console.log(JSON.stringify(samples.at(-1)))
      if (!process.env.BASELINE) assert.fail('60秒内未完成加载')
      continue
    }
    await cdp.send('HeapProfiler.collectGarbage')
    const before = await cdp.send('Runtime.getHeapUsage')
    const frames = await page.evaluate(async () => {
      const panel = document.querySelector('.management-panel')
      const delays = []; let last = performance.now()
      for (let i = 0; i < 120; i++) {
        panel.scrollTop = (i % 2 ? 0 : panel.scrollHeight)
        await new Promise(requestAnimationFrame)
        const now = performance.now(); delays.push(now - last); last = now
      }
      return delays.sort((a,b) => a-b)[113]
    })
    await cdp.send('HeapProfiler.collectGarbage')
    const after = await cdp.send('Runtime.getHeapUsage')
    samples.push({ amount, loadMs: Date.now()-started, mountedCards: await page.getByRole('article').count(), heapBefore: before.usedSize, heapAfter: after.usedSize, frameP95: frames })
    console.log(JSON.stringify(samples.at(-1)))
    if (!process.env.BASELINE) assert.ok(await page.getByRole('article').count() < 100)
  }
  console.log(JSON.stringify(samples))
} finally { await cleanup() }
