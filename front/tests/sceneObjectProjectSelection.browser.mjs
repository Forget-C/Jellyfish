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
const output = await browserOutput('jellyfish-dynamic-object-reference-')
const api = 'http://127.0.0.1:8298', studio = `${api}/api/v1/studio`
const project = 'canvas-project', chapter = 'object-test-chapter', excerpt = '前门的阿同拿着信封。后门的阿同等待。'
const raw = excerpt + '空镜。'
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_runtime_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache',
    CANVAS_BROWSER_SCENE_OBJECTS: '1', CANVAS_BROWSER_OBJECT_CANDIDATE: '1', CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'),
    CANVAS_BROWSER_PORT: '8298' }, stdio: ['ignore', 'pipe', 'pipe'],
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
    try { if ((await fetch(`${studio}/generation-canvases`)).ok) { ready = true; break } } catch {}
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
  const canvasUrl = `${studio}/generation-canvases/${canvas.id}?project_id=${project}`
  const canvasBefore = await request(canvasUrl)
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4298, strictPort: true, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  page.setDefaultTimeout(12000)
  const management = `http://127.0.0.1:4298/projects/${project}/chapters/${chapter}/workbench-management?sequence=${sequence.id}&step=objects`
  await page.route('**/files/object-browser-image/download**', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1536"><rect width="1536" height="1536" fill="lightgray"/></svg>' }))
  await page.goto(management)
  await page.getByRole('navigation', { name: '制作步骤' }).waitFor()
  const extract = page.getByRole('button', { name: '提取对象', exact: true })
  await page.getByText(/^尚未提取对象/).waitFor()
  await extract.press('Enter')
  await page.locator('.ant-modal-confirm').filter({ hasText: '确认提取对象？' }).getByRole('button', { name: '开始提取', exact: true }).click()
  const front = page.getByRole('region', { name: '阿同 · 前门的阿同', exact: true })
  const back = page.getByRole('region', { name: '阿同 · 后门的阿同', exact: true })
  await front.waitFor()
  await page.getByRole('button', { name: '用户与语言设置' }).click()
  await page.getByRole('menuitem', { name: 'English', exact: true }).click()
  await page.getByRole('navigation', { name: 'Production steps' }).waitFor()
  await page.getByRole('heading', { name: 'Object references', exact: true }).waitFor()
  await front.getByRole('button', { name: 'Select', exact: true }).click()
  const englishPicker = page.getByRole('dialog', { name: 'Select project asset' })
  await englishPicker.getByRole('button', { name: 'Select 已有角色', exact: true }).click()
  // Intercept this first attempt so both languages submit from the same revision.
  let englishChoice
  const objectUrl = objectsUrl + '/' + (await read()).objects.find(item => item.excerpt === '前门的阿同').id
  await page.route('**' + new URL(objectUrl).pathname, route => {
    englishChoice = route.request().postDataJSON()
    return route.fulfill({ status: 503, json: { detail: 'Fixture unavailable' } })
  }, { times: 1 })
  await englishPicker.getByRole('button', { name: 'Confirm selection' }).click()
  await englishPicker.getByRole('button', { name: 'Back', exact: true }).click()
  await page.getByRole('button', { name: 'User and language settings' }).click()
  await page.getByRole('menuitem', { name: '简体中文', exact: true }).click()
  await front.getByRole('button', { name: '选用', exact: true }).click()
  const picker = page.getByRole('dialog', { name: '选用项目资源', exact: true })
  await picker.waitFor()
  await picker.getByRole('button', { name: '选择已有角色', exact: true }).click()
  assert.equal((await read()).objects.find(item => item.excerpt === '前门的阿同').asset_id, null)
  const [chineseChoice] = await Promise.all([
    page.waitForRequest(req => req.method() === 'PUT' && new URL(req.url()).pathname === new URL(objectUrl).pathname),
    picker.getByRole('button', { name: '确认选用', exact: true }).click(),
  ])
  assert.deepEqual(chineseChoice.postDataJSON(), englishChoice)
  assert.equal(englishChoice.asset_id, 'object-browser-character')
  await picker.waitFor({ state: 'hidden' })
  await front.getByRole('button', { name: '编辑阿同资源', exact: true }).waitFor()
  assert.equal((await read()).objects.find(item => item.excerpt === '前门的阿同').asset_id, 'object-browser-character')
  assert.equal(await front.locator('.management-object-body').evaluate(node => node.children.length), 3)
  assert.equal(await front.locator('.management-object-excerpt').evaluate(node => node.getBoundingClientRect().height), 20)
  await front.getByRole('button', { name: '对象更多操作', exact: true }).click()
  assert.deepEqual(await page.getByRole('menuitem').allTextContents(), ['描述与出处', '清空'])
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 1920, height: 850 })
  await front.getByRole('button', { name: '编辑阿同资源', exact: true }).click()
  const detail = page.getByRole('region', { name: '已有角色', exact: true })
  await detail.getByRole('textbox', { name: '名称', exact: true }).waitFor()
  await detail.locator('.actor-feature-image img').evaluate(img => img.decode())
  for (const [width, height] of [[1920,850],[1440,900],[1366,768],[1024,440],[375,812]]) {
    await page.setViewportSize({ width, height })
    await page.waitForFunction(() => {
      const root = document.querySelector('.management-inline-asset')
      const body = root?.querySelector('.resource-editor-body')
      const panel = root?.closest('.management-panel')
      return body && panel && !!root.querySelector('.actor-detail-tabs') === (panel.clientWidth < 960 || body.clientHeight < 600)
    })
    const compact = detail.getByRole('tab', { name: '图片', exact: true })
    if (await compact.count()) await compact.click()
    await detail.getByRole('button', { name: '生成图片', exact: true }).scrollIntoViewIfNeeded()
    const geometry = await detail.evaluate(node => {
      const panel = node.closest('.management-panel')
      const body = node.querySelector('.resource-editor-body')
      return { panelHeight: panel.clientHeight, panelScroll: panel.scrollHeight, bodyHeight: body.clientHeight, bodyScroll: body.scrollHeight, compact: !!node.querySelector('.actor-detail-tabs') }
    })
    assert.ok(geometry.panelScroll <= geometry.panelHeight + 1, `object reference detail outer panel at ${width}x${height}: ${JSON.stringify(geometry)}`)
    if (!geometry.compact) assert.ok(geometry.bodyScroll <= geometry.bodyHeight + 1, `desktop detail body must fit: ${JSON.stringify(geometry)}`)
    await page.screenshot({ path: join(output, `object-detail-${width}-${height}.png`) })
  }
  await page.setViewportSize({ width: 1440, height: 960 })
  await detail.getByRole('button', { name: '返回', exact: true }).click()
  await detail.waitFor({ state: 'hidden' })
  await request(`${studio}/entities/character`, 'POST', { id: 'same-name-role', project_id: project, name: '阿同', description: '同名无图' })
  await page.reload()
  await back.getByRole('button', { name: '选用同名', exact: true }).waitFor()
  assert.equal(await back.locator('.management-object-actions-row button').count(), 3)
  for (const width of [575, 576, 767, 768, 839, 840, 1023, 1024, 1079, 1080, 1359, 1360, 1639, 1640, 1879, 1880, 1900]) {
    await page.setViewportSize({ width, height: 900 })
    assert.ok(await back.locator('.management-object-actions-row button').evaluateAll(buttons => buttons.every(button => {
      const box = button.getBoundingClientRect()
      return [...button.querySelectorAll('span')].every(span => { const text = span.getBoundingClientRect(); return text.left >= box.left && text.right <= box.right })
    })), `three-action text stays inside buttons at ${width}`)
  }
  await page.setViewportSize({ width: 1440, height: 960 })
  assert.ok(await back.locator('.management-object-actions-row button').evaluateAll(buttons => buttons.every(button => {
    const box = button.getBoundingClientRect()
    return [...button.querySelectorAll('span')].every(span => { const text = span.getBoundingClientRect(); return text.left >= box.left && text.right <= box.right })
  })), 'three actions fit without clipping labels')
  await back.getByRole('button', { name: '选用同名', exact: true }).click()
  const same = page.getByRole('dialog', { name: '选用同名资源', exact: true })
  await same.waitFor()
  assert.equal(await same.getAttribute('aria-modal'), 'false')
  await same.getByRole('button', { name: '选用其他资源', exact: true }).click()
  await picker.getByRole('textbox', { name: '搜索项目资源', exact: true }).waitFor()
  await picker.getByRole('button', { name: '返回', exact: true }).click()
  await back.getByRole('button', { name: '选用同名', exact: true }).click()
  await same.waitFor()
  assert.equal(await same.locator('.resource-import-form').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(255, 255, 255)')
  const sameCard = same.getByRole('button', { name: '选择阿同', exact: true })
  await sameCard.waitFor()
  assert.equal(await sameCard.locator('.resource-card-metadata').count(), 1)
  assert.equal(await sameCard.locator('.project-resource-description').textContent(), '同名无图')
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await page.waitForFunction(() => { const node = document.querySelector('.resource-selection-drawer'); if (!node) return false; const box = node.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth + 1 })
    assert.ok(await same.evaluate(node => node.scrollWidth <= node.clientWidth))
    await page.screenshot({ path: join(output, `same-name-picker-${width}.png`), animations: 'disabled' })
  }
  await page.setViewportSize({ width: 1440, height: 960 })
  await sameCard.focus()
  await page.keyboard.press('Space')
  assert.equal(await sameCard.getAttribute('aria-pressed'), 'true')

  await same.getByRole('button', { name: '选择阿同', exact: true }).click()
  await same.getByText('暂无图片，选用后可进入详情准备图片。').waitFor()
  await same.getByRole('button', { name: '确认选用', exact: true }).click()
  await same.waitFor({ state: 'hidden' })
  await back.getByRole('button', { name: '重新选用', exact: true }).waitFor()
  await back.getByRole('button', { name: '重新选用', exact: true }).click()
  await picker.getByRole('textbox', { name: '搜索项目资源' }).fill('没有这种对象')
  await picker.getByRole('textbox', { name: '搜索项目资源' }).press('Enter')
  await picker.getByText('未找到匹配的项目资源').waitFor()
  await picker.getByRole('textbox', { name: '搜索项目资源' }).fill('已有')
  await picker.getByRole('textbox', { name: '搜索项目资源' }).press('Enter')
  await picker.getByRole('button', { name: '选择已有角色', exact: true }).waitFor()
  await picker.getByRole('button', { name: '返回', exact: true }).click()
  assert.equal((await read()).objects.find(item => item.excerpt === '后门的阿同').asset_id, 'same-name-role')
  await back.getByRole('button', { name: '重新创建', exact: true }).click()
  await page.getByRole('button', { name: /^填写设定/ }).click()
  const creation = page.getByRole('dialog', { name: '新建角色', exact: true })
  await creation.getByRole('textbox', { name: '名称', exact: true }).waitFor()
  assert.equal(await creation.getByRole('textbox', { name: '名称', exact: true }).inputValue(), '阿同')
  await creation.getByRole('textbox', { name: '名称', exact: true }).fill('新建阿同')
  await creation.getByRole('button', { name: '保存设定', exact: true }).click()
  await page.getByRole('dialog', { name: '新建阿同', exact: true }).waitFor()
  await page.getByRole('dialog', { name: '新建阿同', exact: true }).getByRole('button', { name: '返回', exact: true }).click()
  await back.getByRole('button', { name: '编辑阿同资源', exact: true }).waitFor()
  const replaced = (await read()).objects.find(item => item.excerpt === '后门的阿同')
  assert.notEqual(replaced.asset_id, 'same-name-role')
  assert.equal((await request(`${studio}/entities/character/same-name-role`)).name, '阿同')
  for (const [width, height] of [[1920, 1080], [1900, 833], [1440, 900], [1366, 768], [390, 844], [280, 760]]) {
    await page.setViewportSize({ width, height })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    assert.equal(await back.locator('.management-object-excerpt').evaluate(node => node.getBoundingClientRect().height), 20)
    await page.waitForFunction(expected => [...document.querySelectorAll('.management-object-actions-row button')].every(button => button.getBoundingClientRect().height === expected), width < 768 ? 36 : 32)
    const layout = await page.locator('.management-object-card').evaluateAll(cards => cards.map(card => {
      const buttons = [...card.querySelectorAll('.management-object-actions-row button')].map(button => { const rect = button.getBoundingClientRect(); return { width: rect.width, height: rect.height, right: rect.right } })
      return { width: card.getBoundingClientRect().width, right: card.getBoundingClientRect().right, buttons }
    }))
    assert.ok(layout.every(card => Math.abs(card.width - layout[0].width) < 1), 'short and long content must have equal card widths')
    const columnCount = await page.locator('.management-object-kind .management-card-grid').evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length)
    const gridWidth = await page.locator('.management-object-kind .management-card-grid').evaluate(node => node.getBoundingClientRect().width)
    if (width === 1900 || width === 1920) assert.equal(columnCount, 6, 'wide desktop fits six equal-width object columns')
    if (width === 1366) assert.equal(columnCount, 4, 'compact desktop fits four equal-width object columns')
    if (width === 1900) assert.ok(await page.locator('.management-object-kind .management-card-grid').evaluate(grid => {
      const originalWidth = grid.firstElementChild.getBoundingClientRect().width
      const added = []
      try {
        while (grid.children.length < 7) { const copy = grid.firstElementChild.cloneNode(true); grid.append(copy); added.push(copy) }
        const cards = [...grid.children].map(card => card.getBoundingClientRect())
        return cards.every(card => Math.abs(card.width - originalWidth) < 1)
          && Math.abs(cards[5].right - grid.getBoundingClientRect().right) < 1
          && cards[6].top > cards[0].top && Math.abs(cards[6].left - cards[0].left) < 1
      } finally { added.forEach(card => card.remove()) }
    }), 'seven objects keep their width, fill six columns, and wrap the last card')
    const remainder = gridWidth - columnCount * layout[0].width - (columnCount - 1) * 16
    assert.ok(Math.abs(remainder) < 1, 'equal-width tracks fill the content area even with few objects')
    assert.ok(await page.locator('.management-object-actions-row button').evaluateAll(buttons => buttons.every(button => {
      const box = button.getBoundingClientRect()
      return [...button.querySelectorAll('span')].every(span => { const text = span.getBoundingClientRect(); return text.left >= box.left && text.right <= box.right })
    })), `action text stays inside buttons at ${width}`)
    for (const card of layout) {
      assert.ok(card.buttons.every(button => button.height === (width < 768 ? 36 : 32) && button.right <= card.right), `uniform action height without overflow at ${width}: ${JSON.stringify(layout)}`)
      if (width >= 390) assert.ok(card.buttons.every(button => Math.abs(button.width - card.buttons[0].width) < 1), 'actions evenly fill their row')
    }
    await page.screenshot({ path: join(output, `project-selection-${width}.png`), animations: 'disabled' })
  }
  await page.setViewportSize({ width: 1440, height: 960 })
  for (let index = 0; index < 13; index++) await request(`${studio}/entities/character`, 'POST', { id: `paging-${index}`, project_id: project, name: `分页对象${index}` })
  await front.getByRole('button', { name: '重新选用', exact: true }).click()
  await picker.getByTitle('下一页').click()
  await picker.locator('.ant-pagination-item-active').getByText('2', { exact: true }).waitFor()
  await picker.getByRole('button', { name: /^选择分页对象/ }).first().waitFor()
  await picker.getByRole('button', { name: '返回', exact: true }).click()
  console.log('project object card selection passed')
} catch (error) { if (page) await page.screenshot({ path: join(output, 'failure.png') }); throw error } finally { await cleanup() }
