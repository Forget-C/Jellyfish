import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { makeWorkspace } from './directing-fixtures.mjs'
const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url)); process.chdir(root)
const output = await mkdtemp(join(tmpdir(), 'jellyfish-sources-'))
execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=teal:s=320x180:d=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(output, 'source.mp4')])
const media = await readFile(join(output, 'source.mp4'))
const server = await createServer({ root, server: { host: '127.0.0.1', port: 4193, strictPort: true, open: false } })
const workspace = makeWorkspace(), design = workspace.designs[1].content
const source = (kind, reference, extra = {}) => ({ kind, reference, version: '1', ...extra })
const model = source('model', 'generation-identity'), retry = source('model', 'retry'), late = source('model', 'late')
design.direction.shots[0].visible_result = { state: 'proposal', text: '递出信件', sources: [model] }
design.direction.shots[0].narrative_function = { state: 'proposal', text: '建立悬念', sources: [retry] }
design.direction.shots.push({ ...structuredClone(design.direction.shots[0]), id: 'shot2', visible_result: { state: 'proposal', text: '停下动作', sources: [late] }, narrative_function: { state: 'unset' } })
design.sources = [source('human', 'local-user'), source('chapter', 'chapter-snapshot'), source('file', 'reference', { file_id: 'reference-file', media_range: { source_in_ms: 1000, source_out_ms: 2000 } }), source('revision', 'd1', { version: '2' }), source('model', 'missing')]
const calls = [], writes = [], errors = [], checks = []
let retries = 0, releaseLate, browser, page, mediaFailure = true
const record = source => ({ source, status: source.reference === 'missing' ? 'unavailable' : 'ready', label: ({ 'generation-identity': 'AI建议 · 历史设计', retry: 'AI建议 · 重试记录', late: 'AI建议 · 迟到记录', missing: '历史生成记录暂不可用', 'local-user': '人工填写', 'chapter-snapshot': '章节原文 · 场次摘录', reference: '参考文件 · 原始视频', d1: '继承自设计' })[source.reference], description: source.kind === 'model' ? '这是生成上下文，并非逐句引用依据。' : '记录的历史来源', ...(source.kind === 'model' && source.reference !== 'missing' ? { model_name: '生成时模型名称', task_id: 'historical-task', context_text: `当时原文：${source.reference}`, created_at: '2026-09-01T09:30:00' } : {}), ...(source.kind === 'chapter' ? { context_text: '当时原文摘录，与当前章节不同', chapter_name: '当前章节名称' } : {}), ...(source.kind === 'file' ? { file_id: source.file_id, file_name: '原始视频', media_kind: 'video' } : {}), ...(source.kind === 'revision' ? { revision_id: 'd1', revision_kind: 'design' } : {}) })
try {
  await server.listen(); browser = await chromium.launch({ headless: true }); page = await browser.newPage({ viewport: { width: 1586, height: 992 } }); page.setDefaultTimeout(15000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: location.origin } })
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname, respond = data => route.fulfill({ json: { success: true, data: structuredClone(data) } })
    if (path.endsWith('/sources/resolve')) {
      const sources = req.postDataJSON().sources; calls.push(sources)
      if (sources.some(source => source.reference === 'late')) await new Promise(resolve => { releaseLate = resolve })
      return respond(sources.filter(source => source.reference !== 'retry' || retries++ > 1).map(record))
    }
    if (req.method() !== 'GET') writes.push(path)
    if (path.endsWith('/s1')) return respond(workspace)
    if (path.endsWith('/tasks/historical-task')) return respond({ task_id: 'historical-task', kind: 'directing_design', status: 'succeeded' })
    if (path.endsWith('/feedback')) return respond({ active_cut_revision_id: 'c-active', current_review_id: null, reviews: [], repairs: [], knowledge: [] })
    if (path.endsWith('/film/tasks')) return respond({ items: [], next_cursor: null })
    if (/\/(assets|styles|batches)$/.test(path)) return respond([])
    if (path.includes('/download')) {
      if (mediaFailure) return route.fulfill({ status: 503, body: 'temporary media failure' })
      const range = req.headers().range, match = range?.match(/bytes=(\d+)-(\d*)/), start = match ? Number(match[1]) : 0, end = match?.[2] ? Math.min(Number(match[2]), media.length - 1) : media.length - 1
      return route.fulfill({ status: range ? 206 : 200, contentType: 'video/mp4', body: media.subarray(start, end + 1), headers: { 'accept-ranges': 'bytes', 'content-length': String(end-start+1), ...(range ? { 'content-range': `bytes ${start}-${end}/${media.length}` } : {}) } })
    }
    return respond({ items: [], total: 0 })
  })
  await page.goto('http://127.0.0.1:4193/projects/p1/chapters/ch1/sequences/s1?view=design&design=d2')
  await page.getByRole('button', { name: '分镜 1', exact: true }).click()
  const inspector = page.locator('.design-inspector')
  await inspector.getByRole('button', { name: /查看来源 1：AI建议 · 历史设计/ }).waitFor()
  await inspector.getByRole('spinbutton', { name: '预计时长（毫秒）' }).fill('6200')
  await inspector.getByRole('button', { name: /查看来源 1：AI建议 · 历史设计/ }).click()
  await inspector.getByText('生成时模型：生成时模型名称').waitFor()
  assert.equal(await inspector.locator('.source-technical').getAttribute('open'), null)
  await inspector.getByText('查看生成时原文上下文', { exact: true }).click()
  await inspector.getByText('当时原文：generation-identity', { exact: true }).waitFor()
  await inspector.getByRole('button', { name: '查看生成记录', exact: true }).click()
  await inspector.getByText('状态：已完成', { exact: true }).waitFor()
  await page.screenshot({ path: join(output, 'model-source.png') })
  await inspector.getByRole('button', { name: '返回字段', exact: true }).click()
  assert.equal(await inspector.getByRole('spinbutton', { name: '预计时长（毫秒）' }).inputValue(), '6200')
  checks.push('可读模型名称与原始上下文、生成记录可达，返回不丢编辑内容')
  await inspector.getByRole('button', { name: '查看来源 1：AI建议', exact: true }).click()
  await inspector.getByText('来源读取失败', { exact: true }).waitFor()
  await inspector.getByRole('button', { name: '重试', exact: true }).click()
  await inspector.getByRole('heading', { name: 'AI建议 · 重试记录', exact: true }).waitFor()
  await inspector.getByRole('button', { name: '返回字段', exact: true }).click()
  for (const label of ['人工填写', '章节原文 · 场次摘录', '参考文件 · 原始视频', '继承自设计', '历史生成记录暂不可用']) {
    await inspector.getByRole('button', { name: new RegExp(`查看来源 .*：${label}$`) }).click()
    await inspector.getByRole('heading', { name: label, exact: true }).waitFor()
    if (label.startsWith('章节')) { await inspector.getByText('查看当时原文摘录', { exact: true }).click(); await inspector.getByText('当时原文摘录，与当前章节不同', { exact: true }).waitFor() }
    if (label.startsWith('参考')) {
      await inspector.getByText('原始视频 · 1.000–2.000 秒', { exact: true }).waitFor()
      assert.ok((await inspector.locator('video').getAttribute('src')).includes('reference-file'))
      await inspector.getByText('来源媒体暂时无法读取，可能已删除或无法访问', { exact: true }).waitFor()
      mediaFailure = false
      await inspector.getByRole('button', { name: '重试预览', exact: true }).click()
      await page.waitForFunction(() => document.querySelector('.source-card video')?.readyState >= 2)
      await inspector.getByRole('button', { name: '播放记录区间', exact: true }).click()
      await page.waitForFunction(() => { const video = document.querySelector('.source-card video'); return video?.paused && video.currentTime >= 2 && video.currentTime < 2.4 })
      checks.push('媒体失败可重试；真实合成媒体从记录入点播放，到出点暂停')
    }
    if (label === '继承自设计') { await inspector.getByRole('button', { name: '查看只读历史', exact: true }).click(); await page.getByRole('dialog', { name: '来源版本 · 只读' }).waitFor(); assert.equal(await page.getByRole('dialog').getByRole('button', { name: '保存设计草稿' }).count(), 0); await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click() }
    await inspector.getByRole('button', { name: '返回字段', exact: true }).click()
  }
  checks.push('五种来源详情、缺失状态、失败重试和只读历史可达')
  await page.getByRole('button', { name: '分镜 2', exact: true }).click()
  await inspector.getByRole('button', { name: '查看来源 1：AI建议', exact: true }).click()
  await page.getByRole('button', { name: '分镜 1', exact: true }).click()
  await inspector.getByRole('button', { name: /查看来源 1：AI建议 · 历史设计/ }).click()
  assert.ok(releaseLate); releaseLate()
  await inspector.getByRole('heading', { name: 'AI建议 · 历史设计', exact: true }).waitFor()
  await page.waitForTimeout(100)
  assert.equal(await inspector.getByRole('heading', { name: 'AI建议 · 迟到记录', exact: true }).count(), 0)
  assert.equal(calls.flat().filter(source => source.reference === 'generation-identity').length, 1)
  assert.deepEqual(writes, []); assert.deepEqual(errors, [])
  checks.push('请求去重、迟到响应不覆盖当前来源，追溯操作没有业务写入')
  await writeFile(join(output, 'results.json'), JSON.stringify({ checks, calls, writes, errors }, null, 2))
  console.log(JSON.stringify({ output, checks }, null, 2))
} catch (error) { if (page) { await page.screenshot({ path: join(output, 'failure.png') }); console.error((await page.locator('body').innerText()).slice(-4000)) } throw error }
finally { releaseLate?.(); await browser?.close(); await server.close() }
