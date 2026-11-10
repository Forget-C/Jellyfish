import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { browserCleanup, browserOutput } from './browser-runtime.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-model-management-')
const port = 4792
const origin = `http://127.0.0.1:${port}`
const server = await createServer({ root, server: { host: '127.0.0.1', port, strictPort: true, open: false } })
const model = {
  id: 'model1',
  name: '验收文本模型' + '长名称'.repeat(28),
  category: 'text',
  provider_id: 'provider1',
  description: '完整说明' + '，用于验证长文本的浏览和换行'.repeat(20),
  created_by: '验收创建人',
  params: { long_value: 'abcdefghijklmnopqrstuvwxyz'.repeat(35) },
}
const provider = { id: 'provider1', name: '验收供应商', base_url: 'https://example.invalid' }
const images = Array.from({ length: 105 }, (_, i) => ({
  id: `image${i + 1}`, name: `验收图片模型 ${i + 1}`, category: 'image', provider_id: 'provider1',
}))
const rows = [
  model,
  ...images.slice(0, 20),
  { id: 'unknown', name: '供应商未找到的模型', category: 'video', provider_id: 'missing' },
  ...images.slice(20),
]
const settings = {
  id: 1, default_text_model_id: model.id, default_image_model_id: null, default_video_model_id: null,
}
let defaultSaveFails = true
let editFails = true
let deleteFails = true
let deleteRequests = 0
let listFails = true
let releaseInitialLoad
const initialLoad = new Promise(resolve => { releaseInitialLoad = resolve })
let deleteGate
let createRequests = 0
let omitTotal = false
const loadedQueries = []
let browser
const cleanup = browserCleanup(() => ({ browser, server }))

try {
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1440, height: 900 } })
  page.setDefaultTimeout(5000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: location.origin } })
  await page.route('**/api/**', async route => {
    const { pathname, searchParams } = new URL(route.request().url())
    const respond = data => route.fulfill({ json: { code: 200, data } })
    if (pathname.endsWith('/models/model1') && route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON()
      assert.equal(body.description, '更新后的完整描述')
      assert.equal(body.provider_id, provider.id)
      assert.equal(body.category, 'text')
      if (editFails) return route.fulfill({ status: 500, json: { detail: '编辑失败' } })
      Object.assign(model, body)
      return respond(model)
    }
    if (pathname.endsWith('/models/model1') && route.request().method() === 'DELETE') {
      deleteRequests += 1
      if (deleteFails) {
        await new Promise(resolve => { deleteGate = resolve })
        return route.fulfill({ status: 409, json: { detail: '模型仍有关联，无法删除' } })
      }
      rows.splice(rows.indexOf(model), 1)
      settings.default_text_model_id = null
      return respond(null)
    }
    if (pathname.endsWith('/providers')) return respond({ items: [provider], pagination: { total: 1 } })
    if (pathname.endsWith('/providers/provider1/models/catalog')) {
      return respond({
        provider_id: provider.id, provider_key: 'fixture', source: 'provider_catalog', models: [],
      })
    }
    if (pathname.endsWith('/providers/provider1/models/import') && route.request().method() === 'POST') {
      createRequests += 1
      const { models } = route.request().postDataJSON()
      assert.deepEqual(models, [{ name: '新增验收模型', category: 'text', params: {} }])
      const created = { ...models[0], id: 'new-model', provider_id: provider.id }
      rows.push(created)
      return respond({ created: [created], skipped: [] })
    }
    if (pathname.endsWith('/models')) {
      await initialLoad
      const query = Object.fromEntries(searchParams)
      loadedQueries.push(query)
      if (listFails) return route.fulfill({ status: 500, json: { message: '读取失败' } })
      const matching = rows.filter(row =>
        (!query.category || row.category === query.category) && (!query.q || row.name.includes(query.q)))
      const start = (Number(query.page) - 1) * Number(query.page_size)
      return respond({
        items: matching.slice(start, start + Number(query.page_size)),
        ...(omitTotal ? {} : { pagination: { total: matching.length } }),
      })
    }
    if (pathname.endsWith('/supported')) return respond([])
    if (pathname.endsWith('/model-settings')) {
      if (route.request().method() === 'PUT') {
        assert.deepEqual(route.request().postDataJSON(), { default_image_model_id: 'image105' })
        if (defaultSaveFails) return route.fulfill({ status: 500, json: { message: '保存失败' } })
        settings.default_image_model_id = 'image105'
      }
      return respond(settings)
    }
    return respond({ items: [], next_cursor: null })
  })

  await page.goto(origin + '/models')
  await page.getByRole('tab', { name: '模型', exact: true }).click()
  await page.getByRole('status', { name: '正在加载模型' }).waitFor()
  assert.equal(await page.getByText('共 0 个模型', { exact: true }).count(), 0)
  releaseInitialLoad()
  await page.getByText('加载模型失败', { exact: true }).waitFor()
  assert.equal(await page.getByText('共 0 个模型', { exact: true }).count(), 0)
  listFails = false
  const retry = page.getByRole('button', { name: /重\s*试/, exact: true })
  await retry.click()
  await page.getByText('共 107 个模型', { exact: true }).waitFor()

  const name = page.getByRole('button', { name: model.name, exact: true })
  await name.focus()
  await page.keyboard.press('Enter')
  const details = page.getByRole('dialog').filter({ hasText: '模型详情' })
  await details.getByText(model.description, { exact: true }).waitFor()
  await details.getByText(model.created_by, { exact: true }).waitFor()
  const parameters = details.getByLabel('完整参数 JSON')
  assert.match(await parameters.innerText(), /abcdefghijklmnopqrstuvwxyz/)
  const codeGeometry = await parameters.evaluate(element => ({
    width: element.clientWidth, scrollWidth: element.scrollWidth, parentWidth: element.parentElement.clientWidth,
    whiteSpace: getComputedStyle(element).whiteSpace, overflowX: getComputedStyle(element).overflowX,
  }))
  assert.ok(codeGeometry.scrollWidth > codeGeometry.width, JSON.stringify(codeGeometry))
  assert.ok(await details.evaluate(element => element.scrollWidth <= element.clientWidth + 1))
  await details.screenshot({ path: output + '/model-details.png', animations: 'disabled' })
  await page.keyboard.press('Escape')
  await details.waitFor({ state: 'hidden' })
  await name.and(page.locator(':focus')).waitFor()
  const modelRow = page.getByRole('row').filter({ has: name })
  assert.equal(await modelRow.getByRole('button', { name: /测试.*暂未接入/ }).isDisabled(), true)
  await modelRow.getByText('默认', { exact: true }).waitFor()
  await page.getByRole('button', { name: '筛选', exact: true }).click()
  const filters = page.getByRole('dialog').filter({ has: page.getByText('筛选', { exact: true }) })
  await filters.getByText('图片生成', { exact: true }).click()
  await page.keyboard.press('Escape')
  await filters.waitFor({ state: 'hidden' })
  await page.getByText('共 105 个模型', { exact: true }).waitFor()
  assert.equal(loadedQueries.at(-1).category, 'image')
  const search = page.getByRole('textbox', { name: '搜索模型' })
  listFails = true
  await search.fill('验收')
  await page.getByText('刷新模型失败，仍显示上次结果').waitFor()
  await page.getByRole('button', { name: '验收图片模型 1', exact: true }).waitFor()
  assert.equal(await search.inputValue(), '验收')
  listFails = false
  await retry.click()
  await page.getByText('刷新模型失败，仍显示上次结果').waitFor({ state: 'hidden' })
  assert.equal(loadedQueries.at(-1).q, '验收')
  assert.equal(loadedQueries.at(-1).category, 'image')
  await search.fill('没有结果')
  await page.getByText('无匹配结果', { exact: true }).waitFor()
  await page.getByRole('button', { name: '清除筛选', exact: true }).click()
  await name.waitFor()
  await page.getByRole('button', { name: /排序/ }).click()
  await Promise.all([
    page.waitForResponse(response => new URL(response.url()).searchParams.get('order') === 'category'),
    page.getByRole('menuitem', { name: '类别', exact: true }).click(),
  ])
  await page.getByText('共 107 个模型', { exact: true }).waitFor()
  await page.getByTitle('2', { exact: true }).click()
  const unknownRow = page.getByRole('row').filter({ hasText: '供应商未找到的模型' })
  await unknownRow.getByText('未知', { exact: true }).waitFor()
  assert.equal(loadedQueries.at(-1).page, '2')
  omitTotal = true
  await search.fill('供应商未找到')
  await page.getByText('已加载 1 个模型', { exact: true }).waitFor()
  omitTotal = false

  const defaults = page.getByRole('button', { name: '默认模型', exact: true })
  await defaults.click()
  const defaultDrawer = page.getByRole('dialog').filter({ hasText: '全局默认模型' })
  const imageDefault = defaultDrawer.getByRole('combobox', { name: '默认图片生成' })
  const targetOption = page.getByText('验收图片模型 105 · 验收供应商', { exact: true })
  await imageDefault.fill('验收图片模型 105')
  await targetOption.click()
  await page.getByText('更新默认模型失败').waitFor()
  assert.equal(settings.default_image_model_id, null)
  await defaultDrawer.getByText('选择默认图片生成', { exact: true }).waitFor()
  defaultSaveFails = false
  await imageDefault.fill('验收图片模型 105')
  await targetOption.click()
  await defaultDrawer.getByTitle('验收图片模型 105 · 验收供应商', { exact: true }).waitFor()
  await defaultDrawer.getByRole('button', { name: 'Close' }).focus()
  await page.keyboard.press('Escape')
  await defaultDrawer.waitFor({ state: 'hidden' })
  await defaults.and(page.locator(':focus')).waitFor()
  assert.equal(await search.inputValue(), '供应商未找到')
  await search.fill('验收图片模型 105')
  const defaultRow = page.getByRole('row').filter({ hasText: '验收图片模型 105' })
  await defaultRow.getByText('默认', { exact: true }).waitFor()

  omitTotal = false
  await search.fill('验收文本模型')
  await modelRow.getByRole('button', { name: `编辑 ${model.name}`, exact: true }).click()
  const edit = page.getByRole('dialog', { name: '编辑模型' })
  const description = edit.getByRole('textbox', { name: '描述', exact: true })
  await description.fill('更新后的完整描述')
  const save = edit.getByRole('button', { name: /确\s*定/ })
  await save.click()
  await page.getByText('保存失败').waitFor()
  assert.equal(await description.inputValue(), '更新后的完整描述')
  editFails = false
  await save.click()
  await edit.waitFor({ state: 'hidden' })
  await modelRow.getByText('更新后的完整描述', { exact: true }).waitFor()

  await modelRow.getByRole('button', { name: `${model.name}的更多操作` }).click()
  await page.getByRole('menuitem', { name: /删除/ }).click()
  const confirm = page.getByRole('dialog').filter({ hasText: model.name })
  await confirm.getByText('同时清除文本生成的全局默认模型配置', { exact: false }).waitFor()
  const confirmDelete = confirm.getByRole('button', { name: /删\s*除/, exact: true })
  await confirmDelete.click()
  await confirmDelete.press('Enter')
  assert.equal(deleteRequests, 1)
  deleteGate()
  await confirm.getByText('模型仍有关联，无法删除', { exact: true }).waitFor()
  assert.equal(deleteRequests, 1)
  await name.waitFor()
  deleteFails = false
  await confirmDelete.click()
  await confirm.waitFor({ state: 'hidden' })
  await page.getByText('无匹配结果', { exact: true }).waitFor()
  assert.equal(deleteRequests, 2)
  await search.fill('')
  const create = page.getByRole('button', { name: /添加模型$/ })
  await create.click()
  const add = page.getByRole('dialog', { name: '添加模型' })
  await add.getByRole('combobox', { name: '供应商', exact: true }).click()
  await page.getByText(provider.name, { exact: true }).filter({ visible: true }).last().click()
  await add.getByRole('combobox', { name: '类别', exact: true }).click()
  await page.getByText('文本生成', { exact: true }).filter({ visible: true }).last().click()
  const modelNames = add.getByRole('combobox', { name: '模型名称', exact: true })
  await modelNames.fill('新增验收模型')
  await modelNames.press('Enter')
  await add.getByRole('button', { name: /确\s*定/ }).click()
  await add.waitFor({ state: 'hidden' })
  assert.equal(createRequests, 1)
  await search.fill('新增验收模型')
  const created = page.getByRole('button', { name: '新增验收模型', exact: true })
  await created.waitFor()
  const addedRow = page.getByRole('row').filter({ has: created })
  await addedRow.getByRole('button', { name: '新增验收模型的更多操作' }).click()
  await page.getByRole('menuitem', { name: /复制/ }).click()
  await add.getByText('新增验收模型-复制', { exact: true }).waitFor()
  await add.getByRole('button', { name: /取\s*消/ }).click()
  await add.waitFor({ state: 'hidden' })
  assert.equal(createRequests, 1)

  await search.fill('')
  await page.getByText('共 107 个模型', { exact: true }).waitFor()
  await search.blur()
  await page.getByText('已添加 1 个模型', { exact: true }).waitFor({ state: 'hidden' })
  for (const appearance of ['gradient', 'solid']) {
    for (const [width, height] of [[1440, 900], [1366, 768], [1024, 768], [1023, 768], [375, 812]]) {
      await page.setViewportSize({ width, height })
      const createHeight = await create.evaluate(async element => {
        element.getBoundingClientRect()
        await Promise.allSettled(element.getAnimations().map(animation => animation.finished))
        return Math.round(element.getBoundingClientRect().height)
      })
      assert.equal(createHeight, width < 1024 ? 36 : 32, `操作按钮高度 @ ${width}px`)
      assert.equal(await create.evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(36, 95, 197)')
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2))
      if (width === 375) {
        const localScroll = await page.getByRole('table').evaluate(table => {
          for (let node = table.parentElement; node !== document.body; node = node.parentElement) {
            if (node.scrollWidth > node.clientWidth && getComputedStyle(node).overflowX === 'auto') {
              node.scrollLeft = node.scrollWidth
              const offset = node.scrollLeft
              node.scrollLeft = 0
              return offset
            }
          }
          return 0
        })
        assert.ok(localScroll > 0, '窄屏表格可在自身容器内横向滚动')
      }
      if (width === 1440 || width === 375) await page.screenshot({
        path: `${output}/models-${appearance}-${width}.png`, animations: 'disabled',
      })
    }
    if (appearance === 'gradient') {
      await page.getByRole('button', { name: '用户与语言设置' }).click()
      await page.getByRole('menuitemradio', { name: /雾蓝纯色/ }).click()
    }
  }

  rows.length = 0
  await page.reload()
  await page.getByRole('tab', { name: '模型', exact: true }).click()
  await page.getByText('暂无模型', { exact: true }).waitFor()
  await page.getByRole('button', { name: /添加第一个模型/ }).waitFor()
  process.stdout.write('模型管理：主题、视口、列表状态、详情、默认配置、添加、复制、编辑和删除通过。\n')
} finally {
  await cleanup()
}
