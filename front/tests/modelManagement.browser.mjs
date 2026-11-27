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
  capability_profile: { tool_calling: true, native_streaming: true, remote_task: false },
  storyboard_inspection_capabilities: { image_inputs: true, video_inputs: false },
}
const provider = { provider_key: 'openai', id: 'provider1', name: '验收供应商', base_url: 'https://example.invalid' }
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
let defaultOptionsFail = false
let editFails = true
let deleteFails = true
let deleteRequests = 0
let listFails = true
let releaseInitialLoad
const initialLoad = new Promise(resolve => { releaseInitialLoad = resolve })
let deleteGate
let createRequests = 0
let capabilityVerifications = []
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
    if (pathname.endsWith('/models/model1/capability-verifications')) {
      if (route.request().method() === 'POST') {
        const { capability } = route.request().postDataJSON()
        assert.ok(['audio_inputs','video_inputs','tool_calling'].includes(capability))
        if (capability === 'tool_calling' && capabilityVerifications.some(item => item.capability === capability)) return route.fulfill({status:503,json:{message:'服务暂不可用'}})
        const item = {
          id: 'verification'+capabilityVerifications.length, provider_id: provider.id, provider_name: provider.name,
          model_name: '此前保存的型号', endpoint: 'https://example.invalid/chat/completions',
          capability, outcome: capability === 'video_inputs' ? 'failed' : 'passed', reason: capability === 'video_inputs' ? 'expected_observation_missing' : 'verified',
          tested_at: '2026-11-22T08:00:00Z', current: true,
        }
        capabilityVerifications.push(item)
        return respond(item)
      }
      return respond(capabilityVerifications)
    }
    if (pathname.endsWith('/capability-verifications')) return respond([])
    if (pathname.endsWith('/models/model1') && route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON()
      assert.equal(body.description, '更新后的完整描述')
      assert.equal(body.capability_profile.remote_task, false)
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
        provider_id: provider.id, provider_key: 'fixture', source: 'provider_catalog', models: [{ name: '目录模型', category: 'text', description: '目录描述', params: { temperature: 0.5 }, capability_profile: { image_inputs: true, tool_calling: true, native_streaming: true } }],
      })
    }
    if (pathname.endsWith('/providers/provider1/models/import') && route.request().method() === 'POST') {
      createRequests += 1
      const { models } = route.request().postDataJSON()
      const declarations = models.map(({ capability_profile }) => capability_profile)
      assert.deepEqual(models.map(({ capability_profile: _, ...entry }) => entry), [
        { name: '新增验收模型', category: 'text', params: {}, description: '手填描述' },
        { name: '目录模型', category: 'text', description: '目录描述', params: { temperature: 0.5 } },
      ])
      for (const declaration of declarations) {
        assert.equal(declaration.tool_calling, false)
        assert.equal(declaration.native_streaming, true)
        assert.equal(declaration.context_window,4096)
      }
      assert.equal(declarations[1].image_inputs, true)
      const created = { ...models[0], id: 'new-model', provider_id: provider.id }
      rows.push(created)
      return respond({ created: [created], skipped: [models[1]] })
    }
    if (pathname.endsWith('/models')) {
      await initialLoad
      const query = Object.fromEntries(searchParams)
      loadedQueries.push(query)
      if (listFails || defaultOptionsFail) return route.fulfill({ status: 500, json: { message: '读取失败' } })
      const matching = rows.filter(row =>
        (!query.category || row.category === query.category) && (!query.q || row.name.includes(query.q)))
      const start = (Number(query.page) - 1) * Number(query.page_size)
      return respond({
        items: matching.slice(start, start + Number(query.page_size)),
        ...(omitTotal ? {} : { pagination: { total: matching.length } }),
      })
    }
    if (pathname.endsWith('/supported')) return respond([{ key: 'openai', display_name: 'OpenAI', supported_categories: ['text', 'image', 'video'], capability_defaults: { text: { native_streaming: true, tool_calling: true } } }])
    if (pathname.endsWith('/model-settings')) {
      if (route.request().method() === 'PUT') {
        const body = route.request().postDataJSON()
        assert.deepEqual(body, { default_image_model_id: settings.default_image_model_id === 'image105' ? null : 'image105' })
        if (defaultSaveFails) return route.fulfill({ status: 500, json: { message: '保存失败' } })
        settings.default_image_model_id = body.default_image_model_id
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
  await page.setViewportSize({ width: 1366, height: 768 })
  await name.focus()
  await page.keyboard.press('Enter')
  const editor = page.getByRole('dialog', { name: '编辑模型' })
  await editor.screenshot({ path: output + '/model-editor-desktop.png', animations: 'disabled' })
  assert.equal((await editor.boundingBox()).width, 720)
  const disclosure = editor.locator('summary').filter({hasText:'模型能力'})
  assert.equal(await editor.getByRole('group', { name: '输入模态' }).count(), 0)
  assert.equal(await editor.getByRole('button',{name:'恢复模型能力默认值'}).count(),0)
  await disclosure.press('Enter')
  await editor.getByRole('group', { name: '输入模态' }).getByRole('checkbox', { name: '图像' }).waitFor()
  const modelDescription = editor.getByRole('textbox', { name: '描述', exact: true })
  await editor.getByText(model.created_by, { exact: false }).waitFor()
  assert.equal(await modelDescription.inputValue(), model.description)
  assert.match(await editor.getByRole('textbox', { name: '参数（JSON）' }).inputValue(), /abcdefghijklmnopqrstuvwxyz/)
  assert.ok(await editor.getByRole('switch', { name: '函数调用（Function calling）', exact: true }).isChecked())
  assert.equal(await editor.getByRole('spinbutton', { name: '上下文窗口' }).inputValue(), '')
  await editor.getByText('分镜检查可读取图片和视频静帧，当前接入无法读取连续视频。').waitFor()
  assert.equal(capabilityVerifications.length, 0)
  const inputGroup = editor.getByRole('group',{name:'输入模态',exact:true})
  const typography = element => element.evaluate(node => {
    const {fontFamily, fontSize, fontWeight, lineHeight, color} = getComputedStyle(node)
    return {fontFamily, fontSize, fontWeight, lineHeight, color}
  })
  assert.deepEqual(await typography(inputGroup.getByText('输入模态',{exact:true})), await typography(editor.locator('label').filter({hasText:/^模型名称$/})))
  assert.deepEqual(await typography(inputGroup.getByText('图像',{exact:true})), await typography(editor.getByText(provider.name+'（OpenAI）',{exact:true})))
  await inputGroup.getByLabel('读取连续视频').focus()
  await page.getByRole('tooltip').getByText('读取连续视频').waitFor()
  await inputGroup.scrollIntoViewIfNeeded()
  await editor.screenshot({path:output+'/model-capabilities-desktop.png',animations:'disabled'})
  await page.setViewportSize({width:375,height:812})
  assert.ok(await editor.evaluate(node => node.scrollWidth <= node.clientWidth + 1))
  const probe = editor.getByRole('button',{name:'测试输入模态'})
  await probe.press('Enter')
  const panel = page.getByRole('group',{name:'测试输入模态',exact:true})
  await panel.getByRole('checkbox',{name:'连续视频输入'}).check()
  await panel.getByRole('checkbox',{name:'音频输入'}).check()
  await panel.getByRole('button',{name:'开始测试'}).click()
  await panel.getByText(/未确认模型读取到该项内容/).filter({visible:true}).first().waitFor()
  await panel.getByRole('button',{name:/重\s*试/}).click()
  await panel.getByText('验证历史').click()
  await panel.getByText(/此前保存的型号/).first().waitFor()
  await panel.getByRole('button',{name:'开始测试'}).press('Escape')
  await panel.waitFor({state:'hidden'})
  await editor.getByRole('button',{name:'测试工具调用'}).click()
  const toolPanel = page.getByRole('group',{name:'测试工具调用'})
  await toolPanel.getByRole('button',{name:'开始测试'}).click()
  await toolPanel.getByText(/工具调用 · 验证通过/).first().waitFor()
  await toolPanel.getByRole('button',{name:'开始测试'}).click()
  await toolPanel.getByText(/工具调用 · 无法发起能力验证/).waitFor()
  await toolPanel.getByRole('button',{name:'开始测试'}).press('Escape')
  await editor.getByRole('group',{name:'工具调用',exact:true}).getByText('无法发起能力验证',{exact:true}).waitFor()
  await disclosure.press('Space')
  assert.equal(await inputGroup.count(),0)
  await disclosure.press('Enter')
  await editor.getByRole('group',{name:'工具调用',exact:true}).getByText('无法发起能力验证',{exact:true}).waitFor()
  assert.deepEqual(capabilityVerifications.map(item => item.capability),['video_inputs','audio_inputs','video_inputs','tool_calling'])
  assert.equal(await editor.getByRole('group',{name:'输入模态',exact:true}).getByRole('checkbox',{name:'视频'}).isChecked(),false)
  await page.setViewportSize({width:1366,height:768})
  await modelDescription.fill('未保存的描述')
  await page.keyboard.press('Escape')
  const discard = page.getByRole('dialog', { name: '放弃未保存的修改？' })
  await discard.getByRole('button', { name: '继续编辑' }).click()
  await discard.waitFor({ state: 'hidden' })
  assert.equal(await modelDescription.inputValue(), '未保存的描述')
  await editor.getByRole('button', { name: '返回' }).click()
  await discard.getByRole('button', { name: '放弃修改' }).click()
  await editor.waitFor({ state: 'hidden' })
  await name.and(page.locator(':focus')).waitFor()
  await page.setViewportSize({ width: 1440, height: 900 })
  const modelRow = page.getByRole('row').filter({ has: name })
  assert.equal(await modelRow.getByRole('button', { name: /测试|编辑/ }).count(), 0)
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
  defaultOptionsFail = true
  await defaults.click()
  const defaultModal = page.getByRole('dialog', { name: '全局默认模型' })
  const checkDefaultModalLayout = async (viewportWidth, viewportHeight) => {
    await defaultModal.waitFor()
    await defaultModal.evaluate(async dialog => {
      await Promise.all(dialog.getAnimations().map(animation => animation.finished))
    })
    const box = await defaultModal.boundingBox()
    const width = Math.min(viewportWidth - 32, 480)
    assert.ok(Math.abs(box.width - width) <= 1, JSON.stringify(box))
    assert.ok(Math.abs(box.x - (viewportWidth - width) / 2) <= 1, JSON.stringify(box))
    assert.ok(Math.abs(box.y + box.height / 2 - viewportHeight / 2) <= 2, JSON.stringify(box))
  }
  await checkDefaultModalLayout(1440, 900)
  const imageChoice = { name: '图片生成' }
  const imageDefault = defaultModal.getByRole('combobox', imageChoice)
  const optionsError = defaultModal.getByRole('alert').filter({ hasText: '默认模型选项读取失败' })
  await optionsError.waitFor()
  assert.ok(await imageDefault.isDisabled())
  defaultOptionsFail = false
  await optionsError.getByRole('button', { name: /重\s*试/ }).click()
  await optionsError.waitFor({ state: 'hidden' })
  const targetOption = page.getByText('验收图片模型 105 · 验收供应商（OpenAI）', { exact: true })
  await imageDefault.fill('验收图片模型 105')
  await targetOption.waitFor()
  await page.keyboard.press('Escape')
  await targetOption.waitFor({ state: 'hidden' })
  await defaultModal.waitFor()
  await imageDefault.fill('验收图片模型 105')
  await targetOption.click()
  await page.getByText('更新默认模型失败').waitFor()
  assert.equal(settings.default_image_model_id, null)
  await defaultModal.getByText('选择图片生成', { exact: true }).waitFor()
  defaultSaveFails = false
  await imageDefault.fill('验收图片模型 105')
  await targetOption.click()
  await defaultModal.getByTitle('验收图片模型 105 · 验收供应商（OpenAI）', { exact: true }).waitFor()
  await defaultModal.getByRole('button', { name: '关闭', exact: true }).click()
  await defaultModal.waitFor({ state: 'hidden' })
  await defaults.and(page.locator(':focus')).waitFor()
  assert.equal(await search.inputValue(), '供应商未找到')
  await search.fill('验收图片模型 105')
  const defaultRow = page.getByRole('row').filter({ hasText: '验收图片模型 105' })
  await defaultRow.getByText('默认', { exact: true }).waitFor()
  await page.setViewportSize({ width: 390, height: 844 })
  await defaults.click()
  await checkDefaultModalLayout(390, 844)
  await defaultModal.getByTitle('验收图片模型 105 · 验收供应商（OpenAI）', { exact: true }).waitFor()
  const imageSelect = defaultModal.locator('.ant-select').filter({ has: page.getByRole('combobox', imageChoice) })
  await imageSelect.hover()
  await imageSelect.locator('.ant-select-clear').click()
  await defaultModal.getByText('选择图片生成', { exact: true }).waitFor()
  assert.equal(settings.default_image_model_id, null)
  await page.mouse.click(4, 4)
  await defaultModal.waitFor({ state: 'hidden' })
  await defaults.and(page.locator(':focus')).waitFor()
  await defaultRow.getByText('默认', { exact: true }).waitFor({ state: 'hidden' })
  await page.setViewportSize({ width: 1440, height: 900 })

  omitTotal = false
  await search.fill('验收文本模型')
  await page.getByRole('button', { name: '用户与语言设置' }).click()
  await page.getByRole('menuitem', { name: 'English', exact: true }).click()
  await page.getByRole('tab', { name: 'Model', exact: true }).waitFor()
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 900 })
    const layout = await page.getByRole('tablist').evaluate(async nav => {
      const heading = nav.closest('.management-heading')
      const title = heading.querySelector('h1')
      const table = document.querySelector('.management-table')
      let previous, stableFrames = 0
      for (let frame = 0; frame < 60 && stableFrames < 12; frame++) {
        await new Promise(requestAnimationFrame)
        const sample = [nav.getBoundingClientRect().width, table.getBoundingClientRect().top].join(',')
        stableFrames = sample === previous ? stableFrames + 1 : 0
        previous = sample
      }
      const tabs = nav.getBoundingClientRect(), label = title.getBoundingClientRect()
      return { stableFrames, belowTitle: tabs.top >= label.bottom, besideTitle: tabs.left >= label.right && tabs.top < label.bottom,
        fillsRow: Math.abs(tabs.left - label.left) < 1 && Math.abs(tabs.right - heading.getBoundingClientRect().right
          + parseFloat(getComputedStyle(heading).paddingRight)) < 1 }
    })
    assert.equal(layout.stableFrames, 12, `英文页签和表格在 ${width}px 下应连续 12 帧保持稳定`)
    assert.ok(width === 390 ? layout.belowTitle && layout.fillsRow : layout.besideTitle, JSON.stringify(layout))
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await name.click()
  const edit = page.getByRole('dialog', { name: 'Edit model' })
  const description = edit.getByRole('textbox', { name: 'Description', exact: true })
  await description.fill('更新后的完整描述')
  const save = edit.getByRole('button', { name: 'Save' })
  await save.click()
  await page.getByText('Save failed').waitFor()
  assert.equal(await description.inputValue(), '更新后的完整描述')
  editFails = false
  await save.click()
  await edit.waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: 'User and language settings' }).click()
  await page.getByRole('menuitem', { name: '简体中文', exact: true }).click()
  await modelRow.getByText('更新后的完整描述', { exact: true }).waitFor()

  await modelRow.getByRole('button', { name: `${model.name}的更多操作` }).click()
  assert.equal(await page.getByRole('menuitem', { name: /复制/ }).count(), 0)
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
  await page.setViewportSize({ width: 390, height: 844 })
  await create.click()
  const add = page.getByRole('dialog', { name: '添加模型' })
  const supplier = add.getByRole('combobox', { name: '供应商', exact: true })
  await supplier.click()
  await page.getByText('验收供应商（OpenAI）', { exact: true }).filter({ visible: true }).last().waitFor()
  await page.keyboard.press('Escape')
  await supplier.and(page.locator('[aria-expanded="false"]')).waitFor()
  assert.equal(await add.isVisible(), true)
  await supplier.click()
  await page.getByText('验收供应商（OpenAI）', { exact: true }).filter({ visible: true }).last().click()
  await add.getByRole('combobox', { name: '类别', exact: true }).click()
  await page.getByText('文本生成', { exact: true }).filter({ visible: true }).last().click()
  const supplierField = add.getByRole('combobox', { name: '供应商', exact: true })
  const categoryField = add.getByRole('combobox', { name: '类别', exact: true })
  assert.ok((await categoryField.boundingBox()).y > (await supplierField.boundingBox()).y)
  assert.ok(await add.evaluate(node => node.scrollWidth <= node.clientWidth))
  await add.screenshot({ path: output + '/model-editor-narrow.png', animations: 'disabled' })
  const modelNames = add.getByRole('combobox', { name: '模型名称', exact: true })
  await modelNames.fill('新增验收模型')
  await modelNames.press('Enter')
  await modelNames.fill('目录')
  await page.getByText('目录模型 · 目录描述', { exact: true }).filter({ visible: true }).last().click()
  await add.getByRole('textbox', { name: '描述', exact: true }).fill('手填描述')
  await add.getByText('高级参数', { exact: true }).click()
  const json = add.getByRole('textbox', { name: '参数（JSON）' })
  await json.fill('[]')
  await add.getByText('高级参数', { exact: true }).click()
  const submit = add.getByRole('button', { name: /^添\s*加$/ })
  await submit.click()
  await add.getByText('参数必须为 JSON 对象').waitFor()
  await json.and(page.locator(':focus')).waitFor()
  assert.equal(createRequests, 0)
  await json.fill('{}')
  const contextLimit = add.getByRole('spinbutton', { name: '上下文窗口' })
  const addDisclosure = add.locator('summary').filter({hasText:'模型能力'})
  await addDisclosure.click()
  await contextLimit.fill('0')
  await addDisclosure.click()
  await submit.click()
  await add.getByText('请输入大于零的 Token 限额').waitFor()
  await contextLimit.and(page.locator(':focus')).waitFor()
  await contextLimit.fill('4.096')
  await addDisclosure.click()
  await addDisclosure.click()
  assert.equal(await contextLimit.inputValue(),'4.096')
  await add.getByRole('button', { name: '恢复模型能力默认值' }).click()
  assert.equal(await contextLimit.inputValue(), '')
  await add.getByRole('button', {name:'撤销'}).click()
  assert.equal(await contextLimit.inputValue(),'4.096')
  await add.getByRole('switch', { name: '函数调用（Function calling）', exact: true }).click()
  await submit.click()
  await add.waitFor({ state: 'hidden' })
  assert.equal(createRequests, 1)
  await page.getByText('已添加 1 个模型，跳过 1 个已存在模型', { exact: true }).waitFor()
  await page.setViewportSize({ width: 1366, height: 768 })
  await search.fill('新增验收模型')
  const created = page.getByRole('button', { name: '新增验收模型', exact: true })
  await created.waitFor()
  await created.click()
  assert.equal(await inputGroup.count(),0)
  await disclosure.click()
  assert.equal(await editor.getByRole('spinbutton', {name:'上下文窗口'}).inputValue(),'4.096')
  assert.equal(await editor.getByRole('switch', { name: '函数调用（Function calling）', exact: true }).isChecked(), false)
  await editor.getByRole('button', { name: '返回' }).click()
  await editor.waitFor({ state: 'hidden' })
  const addedRow = page.getByRole('row').filter({ has: created })
  const copy = addedRow.getByRole('button', { name: /^复\s*制$/ })
  await copy.click()
  await add.getByText('新增验收模型-复制', { exact: true }).waitFor()
  await add.getByRole('button', { name: '返回' }).click()
  await add.waitFor({ state: 'hidden' })
  await copy.and(page.locator(':focus')).waitFor()
  assert.equal(createRequests, 1)
  await copy.press('Enter')
  await add.getByText('新增验收模型-复制', { exact: true }).waitFor()
  await modelNames.fill('尚未回车的模型名')
  await page.mouse.click(20, 100)
  await discard.getByRole('button', { name: '放弃修改' }).click()
  await add.waitFor({ state: 'hidden' })

  await search.fill('')
  await page.getByText('共 107 个模型', { exact: true }).waitFor()
  await search.blur()
  await page.getByText('已添加 1 个模型，跳过 1 个已存在模型', { exact: true }).waitFor({ state: 'hidden' })
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
  process.stdout.write('模型管理：主题、视口、列表状态、抽屉布局与草稿保护、默认配置、添加、复制、编辑和删除通过。\n')
} finally {
  await cleanup()
}
