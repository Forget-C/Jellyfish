import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { browserCleanup, browserOutput } from './browser-runtime.mjs'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-project-files-')
const server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4544, strictPort: true } })
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
  let failList = false, empty = false
  const video = execFileSync('ffmpeg', ['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=navy:s=128x72:d=0.2','-c:v','libx264','-pix_fmt','yuv420p','-f','mp4','-movflags','frag_keyframe+empty_moov','pipe:1'])
  const audio = execFileSync('ffmpeg', ['-hide_banner','-loglevel','error','-f','lavfi','-i','anullsrc=r=8000:cl=mono','-t','0.2','-f','wav','pipe:1'])
  const rows = Array.from({ length: 11 }, (_, i) => ({ id: `file${i}`, type: i === 1 ? 'video' : i === 2 ? 'audio' : 'image', name: i === 0 ? '雨夜参考图' : i === 1 ? '雨夜视频' : i === 2 ? '雨夜音频' : i === 3 ? '损坏图片' : i === 4 ? '很长的参考图片名称'.repeat(10) : `图片${i}` }))
  await context.route('**/api/**', route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname
    const respond = data => route.fulfill({ json: { success: true, data } })
    if (path.endsWith('/projects/p-files')) return respond({ id: 'p-files', name: '文件项目', stats: {} })
    if (path.endsWith('/chapters')) return respond({ items: [{ id: 'c1', project_id: 'p-files', index: 1, title: '雨夜' }], pagination: { total: 1 } })
    if (path.endsWith('/files')) {
      listRequests.push(Object.fromEntries(url.searchParams))
      if (failList) return route.fulfill({ status: 503, json: { detail: '文件读取不可用' } })
      const pageNumber = Number(url.searchParams.get('page') || 1)
      return respond({ items: empty ? [] : rows.slice((pageNumber - 1) * 10, pageNumber * 10), pagination: { total: empty ? 0 : 11 } })
    }
    if (path.endsWith('/files/file3/download')) return route.fulfill({ status: 404, body: 'missing image' })
    if (path.endsWith('/download') && request.isNavigationRequest()) {
      downloads.push(path)
      return route.fulfill({ contentType: 'application/octet-stream', headers: { 'content-disposition': 'attachment; filename="reference.svg"' }, body: 'downloaded-file-content' })
    }
    if (path.endsWith('/files/file1/download')) return route.fulfill({ contentType: 'video/mp4', body: video })
    if (path.endsWith('/files/file2/download')) return route.fulfill({ contentType: 'audio/wav', body: audio })
    if (path.endsWith('/download')) return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="navy"/></svg>' })
    return respond({ items: [] })
  })
  await page.goto('http://127.0.0.1:4544/projects/p-files?tab=files')
  await page.getByText('雨夜参考图', { exact: true }).waitFor()
  assert.equal(await page.getByRole('checkbox').count(), 0, '默认浏览不显示复选框')
  await page.getByRole('button', { name: '批量选择', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: '批量下载（0）', exact: true }).isDisabled(), true)
  await page.getByRole('checkbox', { name: '选择雨夜参考图', exact: true }).check()
  await page.getByRole('button', { name: '批量下载（1）', exact: true }).waitFor()
  await page.getByRole('button', { name: '退出批量选择', exact: true }).click()
  assert.equal(await page.getByRole('checkbox').count(), 0)
  await page.getByRole('button', { name: '批量选择', exact: true }).click()
  assert.equal(await page.getByRole('checkbox', { name: '选择雨夜参考图', exact: true }).isChecked(), false)
  const image = page.getByRole('button', { name: '预览雨夜参考图', exact: true })
  await page.getByRole('checkbox', { name: '选择雨夜参考图', exact: true }).check()
  await image.press('Enter')
  const preview = page.getByRole('dialog', { name: '雨夜参考图', exact: true })
  await preview.getByRole('img', { name: '雨夜参考图', exact: true }).waitFor()
  await page.waitForFunction(() => !document.querySelector('.ant-zoom-appear'))
  await preview.getByRole('button', { name: 'Close', exact: true }).focus()
  await page.keyboard.press('Escape')
  await preview.waitFor({ state: 'hidden' })
  await image.and(page.locator(':focus')).waitFor()
  assert.equal(await page.getByRole('checkbox', { name: '选择雨夜参考图', exact: true }).isChecked(), true, '预览不改变已选文件')
  await page.getByRole('checkbox', { name: '选择雨夜音频', exact: true }).check()
  await page.getByRole('button', { name: '批量下载（2）', exact: true }).click()
  for (let attempt = 0; attempt < 40 && downloads.length < 2; attempt++) await new Promise(resolve => setTimeout(resolve, 50))
  assert.deepEqual(downloads.sort(), ['/api/v1/studio/files/file0/download','/api/v1/studio/files/file2/download'])
  await page.getByRole('button', { name: '退出批量选择', exact: true }).click()
  assert.equal(await page.getByRole('checkbox').count(), 0)
  const singleRequest = context.waitForEvent('request', { predicate: request => request.isNavigationRequest() && request.url().endsWith('/files/file1/download') })
  await page.getByRole('button', { name: '下载雨夜视频', exact: true }).click()
  assert.ok((await singleRequest).url().endsWith('/api/v1/studio/files/file1/download'))

  for (const [name, label] of [['雨夜音频','音频预览'], ['雨夜视频','视频预览']]) {
    const trigger = page.getByRole('button', { name: `预览${name}`, exact: true })
    await trigger.press('Enter')
    const modal = page.getByRole('dialog', { name, exact: true })
    const media = modal.getByLabel(label, { exact: true })
    await media.waitFor()
    assert.ok(await media.getAttribute('controls') !== null)
    await page.waitForFunction(element => element.readyState >= 1, await media.elementHandle())
    assert.ok((await media.getAttribute('src')).endsWith(name === '雨夜音频' ? '/files/file2/download' : '/files/file1/download'))
    await page.waitForFunction(() => !document.querySelector('.ant-zoom-appear'))
    await modal.getByRole('button', { name: 'Close', exact: true }).focus()
    await page.keyboard.press('Escape')
    await modal.waitFor({ state: 'hidden' })
    await trigger.and(page.locator(':focus')).waitFor()
  }
  assert.equal(await page.getByRole('button', { name: '预览损坏图片', exact: true }).count(), 0)
  await page.getByText('图片加载失败', { exact: true }).waitFor()

  await page.getByRole('button', { name: '批量选择', exact: true }).click()
  await page.getByRole('checkbox', { name: '选择雨夜参考图', exact: true }).check()
  const filter = page.getByRole('combobox', { name: '按章节筛选文件', exact: true })
  const filtered = page.waitForResponse(response => new URL(response.url()).searchParams.get('chapter_title') === '雨夜')
  await filter.click()
  await page.getByText('雨夜（第1章）', { exact: true }).click()
  await filtered
  assert.equal(listRequests.at(-1).project_id, 'p-files')
  assert.equal(listRequests.at(-1).chapter_title, '雨夜')
  await page.getByTitle('2', { exact: true }).click()
  await page.getByText('图片10', { exact: true }).waitFor()
  assert.equal(listRequests.at(-1).page, '2')
  await page.getByRole('button', { name: '批量下载（1）', exact: true }).waitFor()
  await page.getByTitle('1', { exact: true }).click()
  await image.waitFor()
  assert.equal(await page.getByRole('checkbox', { name: '选择雨夜参考图', exact: true }).isChecked(), true, '既有跨筛选分页选择语义保持')
  await page.getByRole('button', { name: '退出批量选择', exact: true }).click()
  for (const theme of ['雾蓝纯色', '雾蓝微渐变']) {
    await page.getByRole('button', { name: '用户与语言设置', exact: true }).click()
    await page.getByRole('menuitemradio', { name: theme, exact: true }).click()
    await page.getByRole('menu').waitFor({ state: 'hidden' })
    assert.equal(await page.getByRole('button', { name: '用户与语言设置', exact: true }).getAttribute('aria-expanded'), 'false')
    for (const [width, height] of [[1440,900],[1366,768],[1024,440],[375,812]]) {
      await page.setViewportSize({ width, height })
      await image.waitFor()
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '文件内容不得造成横向溢出')
      const titleEdge = (await page.getByRole('heading', { name: '项目文件', exact: true }).boundingBox()).x
      const cardEdge = (await page.getByRole('article').first().boundingBox()).x
      assert.ok(Math.abs(cardEdge - titleEdge) <= 1, 'resource cards align with the content title and share one page gutter')
      await page.screenshot({ path: join(output, `files-${theme}-${width}.png`), animations: 'disabled' })
    }
    await page.setViewportSize({ width: 1440, height: 900 })
  }
  failList = true
  await page.reload()
  await page.getByText('读取项目文件失败，请重试', { exact: true }).waitFor()
  assert.equal(await page.getByText('暂无文件（仅展示已在项目中产生过关联记录的文件）', { exact: true }).count(), 0)
  failList = false
  await page.getByRole('button', { name: '重试读取文件', exact: true }).click()
  await image.waitFor()
  empty = true
  await page.reload()
  await page.getByText('暂无文件（仅展示已在项目中产生过关联记录的文件）', { exact: true }).waitFor()
  assert.ok(listRequests.every(request => request.project_id === 'p-files'), '文件范围始终限定当前项目')

} finally { await cleanup() }
