import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { makeWorkspace, clip } from './directing-fixtures.mjs'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
process.chdir(root)
const output = await mkdtemp(join(tmpdir(), 'jellyfish-ux5-'))
execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=teal:s=640x360:d=6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(output, 'sample.mp4')])
const media = await readFile(join(output, 'sample.mp4'))
const server = await createServer({ root, server: { host: '127.0.0.1', port: 4182, strictPort: true, open: false } })
let browser
try {
  await server.listen()
  browser = await chromium.launch({ headless: true })
  const results = []
  for (const width of [1440, 1024, 768, 375]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    page.setDefaultTimeout(15000)
    await page.addInitScript(() => { window.__ENV = { BACKEND_URL: location.origin } })
    let workspace, failure = false, mediaFailure = false, taskRows = []
    const errors = [], writes = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/api/**', async route => {
      const request = route.request(), path = new URL(request.url()).pathname
      const respond = data => route.fulfill({ json: { success: true, data: structuredClone(data) } })
      if (request.method() !== 'GET') writes.push(path)
      if (path.endsWith('/s1')) return respond(workspace)
      if (path.includes('/directing/tasks/')) return respond(taskRows.find(task => task.task_id === path.split('/').at(-1)))
      if (path.endsWith('/s1/feedback')) return failure ? route.fulfill({ status: 503, json: { detail: '采用读取暂时不可用' } }) : respond({ active_cut_revision_id: workspace.cuts.length ? 'c-active' : null, current_review_id: null, reviews: [], repairs: [], knowledge: [] })
      if (path.endsWith('/s1/continuity')) return respond({ active_cut_revision_id: 'c-active', frames: [], seams: [], units: [] })
      if (path.endsWith('/s1/ledger')) return respond({ workspace, continuity: { frames: [], seams: [], units: [] }, feedback: { active_cut_revision_id: 'c-active', reviews: [], repairs: [], knowledge: [] }, actions: [], executions: [] })
      if (path.endsWith('/media')) return mediaFailure ? route.fulfill({ status: 503, json: { detail: '测试媒体暂时不可用' } }) : respond({ take_id: path.split('/').at(-2), file_id: 'sample', duration_ms: 6000, url: '/api/sample.mp4' })
      if (path.endsWith('/sample.mp4')) {
        const range = request.headers().range?.match(/bytes=(\d+)-(\d*)/)
        const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(Number(range[2]), media.length - 1) : media.length - 1
        return route.fulfill({ status: range ? 206 : 200, body: media.subarray(start, end + 1), contentType: 'video/mp4', headers: { 'accept-ranges': 'bytes', 'content-length': String(end - start + 1), ...(range ? { 'content-range': `bytes ${start}-${end}/${media.length}` } : {}) } })
      }
      if (path.endsWith('/film/tasks')) return respond({ items: [], next_cursor: null })
      if (/\/(styles|assets|batches)$/.test(path)) return respond([])
      return respond({ items: [], total: 0 })
    })
    const keyboard = async locator => {
      await locator.focus()
      await page.keyboard.press('Tab')
      await page.keyboard.press('Shift+Tab')
      assert.equal(await locator.evaluate(element => document.activeElement === element), true)
      assert.equal(await locator.evaluate(element => getComputedStyle(element).outlineStyle !== 'none'), true, 'Keyboard focus must be visible')
      await page.keyboard.press('Enter')
    }
    for (const state of ['first', 'design', 'design-expanded', 'shoot', 'tasks', 'cut', 'cut-expanded', 'confirmed-cut', 'source-changed', 'adoption-error', 'media-error', 'continuity', 'feedback', 'ledger']) {
      console.log(`Checking ${width} ${state}`)
      workspace = makeWorkspace()
      workspace.sequence.title = '旧信重逢'
      taskRows = state === 'tasks' ? ['queued', 'running', 'failed', 'cancelled', 'succeeded'].map(status => ({ task_id: `task-${status}`, kind: 'image_generation', status, error: status === 'failed' ? '参考画面生成失败，请先核对人物与场景参考是否可用，再决定是否重试本次任务' : null })) : []
      workspace.task_ids = taskRows.map(task => task.task_id)
      workspace.cuts[2].content.items = [clip('draft-candidate', 't3', 0, 1000)]
      if (state === 'shoot') {
        workspace.plans[0].content.units[0].coverage[0].action_scope = '他缓缓递出旧信，停顿后确认她认出了笔迹，再把信留在桌面上'
        workspace.plans[0].content.units.push({ ...structuredClone(workspace.plans[0].content.units[0]), id: 'u2' })
      }
      if (state === 'first') for (const key of ['designs', 'plans', 'prompts', 'reviews', 'takes', 'cuts']) workspace[key] = []
      workspace.sequence.source_changed = state === 'source-changed'
      failure = state === 'adoption-error'
      mediaFailure = state === 'media-error'
      const view = ['cut', 'cut-expanded', 'confirmed-cut', 'adoption-error', 'media-error'].includes(state) ? 'cut' : state === 'tasks' ? 'shoot' : ['shoot', 'continuity', 'feedback', 'ledger'].includes(state) ? state : 'design'
      await page.goto(`http://127.0.0.1:4182/projects/p1/chapters/ch1/sequences/s1?view=${view}&design=d1&plan=p-old&unit=u1&cut=${state === 'confirmed-cut' ? 'c-active' : 'c-draft'}&take=${state === 'cut' ? 't3' : 't1'}`)
      await page.locator('.workspace-stage-tabs').waitFor()
      if (view === 'cut' && !mediaFailure) await page.getByLabel('当前候选播放器', { exact: true }).evaluate(video => new Promise(resolve => { if (video.readyState >= 2) resolve(); else video.addEventListener('loadeddata', resolve, { once: true }) }))
      if (failure) await page.getByRole('button', { name: '当前采用待核对', exact: true }).waitFor()
      if (state === 'design-expanded') {
        if (width < 1280) await page.getByRole('button', { name: '场次导航', exact: true }).click()
        await keyboard(page.locator('.design-navigation').getByRole('button', { name: /全场概览/ }))
        await page.getByRole('textbox', { name: '本场信息变化', exact: true }).waitFor()
      }
      if (state === 'cut-expanded') {
        await keyboard(page.locator('summary').filter({ hasText: '对比另一条素材' }))
        if (width < 1280) await page.getByRole('button', { name: '审片与片段详情', exact: true }).click()
        const inspector = page.locator(width < 1280 ? '.ant-drawer-open' : '.cut-inspector')
        await inspector.getByRole('tab', { name: '来源', exact: true }).click()
        await keyboard(inspector.locator('summary').filter({ hasText: '完整素材、实际观察与来源' }))
      }
      if (state === 'shoot') {
        await page.getByRole('tab', { name: '生成指令', exact: true }).click()
        const select = page.getByRole('combobox', { name: '选择编译单元', exact: true })
        await select.focus(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter')
        await page.waitForURL(url => url.searchParams.get('unit') === 'u2')
        await select.focus(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowUp'); await page.keyboard.press('Enter')
        await page.waitForURL(url => url.searchParams.get('unit') === 'u1')
        await page.keyboard.press('Escape')
      }
      if (state === 'tasks') {
        await page.getByRole('button', { name: '任务中心', exact: true }).click()
        await page.getByRole('button', { name: '查看本场任务与业务结果', exact: true }).click()
        await keyboard(page.locator('summary').filter({ hasText: '完整任务记录 · 5 项' }))
        for (const [status, label] of Object.entries({ queued: '等待执行', running: '执行中', failed: '失败', cancelled: '已取消', succeeded: '已完成' })) await page.locator(`[data-task-id="task-${status}"]`).getByText(label, { exact: true }).waitFor()
      }
      // Check the actual route scroll owner as well as the document: body overflow hidden must not mask a wide page.
      const dimensions = await page.evaluate(() => {
        const route = document.querySelector('.app-route-viewport')
        const wide = [...route.querySelectorAll('*')].filter(element => {
          const box = element.getBoundingClientRect()
          return box.width > 0 && box.right > route.getBoundingClientRect().right + 2 && getComputedStyle(element).position !== 'absolute'
        }).slice(0, 12).map(element => ({ tag: element.tagName, class: element.className, text: element.textContent.slice(0, 80) }))
        return { document: document.documentElement.scrollWidth, viewport: innerWidth, route: route.clientWidth, content: route.scrollWidth, wide }
      })
      results.push({ width, state, ...dimensions })
      await page.screenshot({ path: join(output, `${width}-${state}.png`), fullPage: true, animations: 'disabled' })
      while (await page.locator('.ant-drawer-open').count()) { await page.locator('.ant-drawer-open').last().getByRole('button', { name: 'Close', exact: true }).click(); await page.waitForTimeout(400) }
      await page.waitForFunction(() => [...document.querySelectorAll('.ant-drawer-mask')].every(element => !element.getClientRects().length || getComputedStyle(element).visibility === 'hidden'))
      const actions = [page.getByRole('tab', { name: '导演设计', exact: true }), page.getByRole('tab', { name: '单元试拍', exact: true }), page.getByRole('tab', { name: '剪辑验收', exact: true })]
      if (view === 'cut') actions.push(page.getByRole('button', { name: '保存剪辑草稿', exact: true }).or(page.getByRole('button', { name: '保存为新剪辑草稿', exact: true })), page.getByRole('button', { name: '确认并设为当前采用', exact: true }))
      if (state === 'shoot') actions.push(page.getByRole('button', { name: '准备生成指令', exact: true }))
      if (view === 'design' && state !== 'first') actions.push(page.getByRole('button', { name: '保存为新设计草稿', exact: true }), page.getByRole('button', { name: '确认本轮设计', exact: true }))
      for (const action of actions) {
        assert.equal(await action.evaluate(element => {
          const box = element.getBoundingClientRect(), viewport = document.querySelector('.app-route-viewport').getBoundingClientRect()
          const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
          return box.top >= viewport.top && box.bottom <= viewport.bottom && box.left >= viewport.left && box.right <= viewport.right + 1 && element.scrollWidth <= element.clientWidth + 1 && !!hit && element.contains(hit)
        }), true, `${width} ${state}: clipped or obscured action ${await action.innerText()} ${JSON.stringify(await action.evaluate(element => { const box = element.getBoundingClientRect(); return { box: box.toJSON(), hit: document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.outerHTML, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth } }))}`)
      }
      if (state === 'first') {
        await keyboard(page.getByRole('button', { name: '更多场次操作', exact: true }))
        await page.getByRole('menuitem', { name: '版本与历史', exact: true }).click()
        await page.locator('.ant-drawer-content').filter({ hasText: '版本与历史（只读）' }).waitFor()
        await page.keyboard.press('Escape')
        await page.locator('.ant-drawer-content').filter({ hasText: '版本与历史（只读）' }).waitFor({ state: 'hidden' })
        if (width === 375) {
          const menu = page.getByRole('button', { name: '打开主导航', exact: true })
          await menu.focus(); await page.keyboard.press('Enter')
          await page.getByRole('dialog').waitFor()
          await page.keyboard.press('Escape')
          await page.getByRole('dialog').waitFor({ state: 'hidden' })
        }
        await page.getByRole('tab', { name: '导演设计', exact: true }).focus()
        await page.keyboard.press('Tab')
        await page.keyboard.press('Enter')
        await page.waitForURL(url => url.searchParams.get('view') === 'shoot')
      }
    }
    if (width === 1440) {
      assert.equal(await page.getByRole('navigation', { name: '主导航', exact: true }).evaluate(element => element.getBoundingClientRect().width), 64)
    }
    if (width === 375) {
      await page.goto('http://127.0.0.1:4182/projects')
      await page.getByRole('button', { name: '打开主导航', exact: true }).click()
      await page.getByRole('navigation', { name: '移动主导航', exact: true }).waitFor()
      await page.keyboard.press('Escape')
      await page.getByRole('dialog').waitFor({ state: 'hidden' })
    }
    assert.deepEqual(errors, [])
    assert.deepEqual(writes, [])
    await page.close()
  }
  await writeFile(join(output, 'results.json'), JSON.stringify(results, null, 2))
  console.log(JSON.stringify({ output, results }, null, 2))
  assert.ok(results.every(row => row.content <= row.route + 2 && row.document <= row.viewport + 2), 'Page overflow: inspect results.json and screenshots')
} catch (error) {
  for (const context of browser?.contexts() || []) for (const page of context.pages()) {
    await page.screenshot({ path: join(output, 'failure.png') });
    console.log(await page.locator('body').innerText());
    console.log(await page.evaluate(() => ({ width: innerWidth, navigation: document.querySelector('.sequence-mobile-navigation')?.outerHTML })));
  }
  console.log('Browser evidence:', output); throw error
} finally {
  await browser?.close()
  await server.close()
}
