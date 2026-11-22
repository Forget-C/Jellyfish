import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { browserCleanup, browserOutput } from './browser-runtime.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-provider-management-')
const port = 4791
const origin = `http://127.0.0.1:${port}`
const server = await createServer({ root, server: { host: '127.0.0.1', port, strictPort: true, open: false } })
const provider = {
  id: 'provider1',
  provider_key: 'openai',
  name: '验收供应商',
  base_url: 'https://example.invalid/v1',
  description: '完整供应商描述',
  created_by: '验收用户',
  status: 'active',
}
let browser
let listFails = false
let saveFails = true
let credentialsReads = 0
let listedId = provider.id
let testPrompts = { text: '回复 OK' }
let catalogFails = false
let paidCalls = 0
let releaseSubmission
let deleteRequests = 0
let lastSearch = ''
let providerExists = true
const cleanup = browserCleanup(() => ({ browser, server }))

try {
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1440, height: 900 } })
  page.setDefaultTimeout(6000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: location.origin } })
  await page.route('**/api/**', async route => {
    const { pathname, searchParams } = new URL(route.request().url())
    const method = route.request().method()
    const respond = data => route.fulfill({ json: { code: 200, data } })
    if (pathname.endsWith('/providers') && method === 'POST') {
      const body = route.request().postDataJSON()
      assert.equal(body.name, '生产')
      assert.equal(body.provider_key, 'vidu')
      return respond({ ...provider, ...body })
    }
    if (pathname.endsWith('/providers')) {
      lastSearch = searchParams.get('q') ?? ''
      if (listFails) return route.fulfill({ status: 500, json: { message: '读取失败' } })
      const items = providerExists && (!lastSearch || provider.name.includes(lastSearch)) ? [{ ...provider, id: listedId }] : []
      return respond({ items, pagination: { total: items.length, page: 1, page_size: 20, max_page: 1 } })
    }
    if (pathname.endsWith('/providers/provider1/credentials')) {
      credentialsReads += 1
      return respond({ api_key: 'isolated-key', api_secret: 'isolated-secret' })
    }
    if (pathname.endsWith('/providers/provider1') && method === 'PATCH') {
      const body = route.request().postDataJSON()
      assert.equal(body.description, '更新的供应商描述')
      if (saveFails) return route.fulfill({ status: 500, json: { message: '保存失败' } })
      provider.description = body.description
      return respond(provider)
    }
    if (pathname.endsWith('/providers/provider1') && method === 'DELETE') {
      deleteRequests += 1
      providerExists = false
      return respond(null)
    }
    if (pathname.endsWith('/test-call')) {
      paidCalls++
      assert.deepEqual(route.request().postDataJSON(), { model: 'manual', category: 'text' })
      if (paidCalls === 2) return route.fulfill({ status: 503, json: { message: 'Provider api_key is empty for provider_id=provider1' } })
      await new Promise(resolve => { releaseSubmission = resolve })
      return respond({ outcome: 'success', http_status: 200 })
    }
    if (pathname.endsWith('/catalog') && catalogFails) return route.fulfill({ status: 503, json: {} })
    if (pathname.endsWith('/catalog')) return respond({ models: [{ name: 'remote-model', category: 'text' }] })
    if (pathname.endsWith('/models')) return respond({ items: [], pagination: { total: 2 } })
    if (pathname.endsWith('/supported')) return respond([
      { key: 'openai', test_prompts: testPrompts, live_model_catalog: true, display_name: 'OpenAI', default_base_url: 'https://one.example/v1', requires_api_key: true, requires_api_secret: true },
      { key: 'vidu', display_name: 'Vidu', default_base_url: 'https://two.example/v1' },
    ])
    return respond({ items: [], next_cursor: null })
  })

  page.on('pageerror', error => console.error(error.message))
  page.on('requestfailed', request => console.error(request.url(), request.failure()))
  await page.goto(origin + '/models')
  const create = page.getByRole('button', { name: /添加供应商$/ })
  await create.waitFor().catch(async error => {
    console.error(await page.locator('body').innerText())
    throw error
  })
  assert.equal(await create.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(36, 95, 197)')
  await page.getByRole('columnheader', { name: '凭据配置状态' }).waitFor()
  await page.setViewportSize({ width: 1366, height: 768 })
  await create.click()
  const add = page.getByRole('dialog', { name: '添加供应商' })
  await add.getByRole('button', { name: '返回' }).waitFor()
  await add.screenshot({ path: output + '/provider-create-desktop.png', animations: 'disabled' })
  const desktopBox = await add.boundingBox()
  assert.equal(desktopBox.width, 720)
  assert.equal(desktopBox.x + desktopBox.width, 1366)
  const drawerBody = add.locator('.ant-drawer-body')
  const assertFitsHeight = async () => {
    const sizes = await drawerBody.evaluate(el => [el.scrollHeight, el.clientHeight])
    assert.ok(sizes[0] <= sizes[1], `默认抽屉正文高 ${sizes[0]}px，可用 ${sizes[1]}px`)
  }
  await assertFitsHeight()
  const preset = add.getByRole('combobox', { name: '供应商', exact: true })
  await preset.press('ArrowDown')
  await page.getByText('OpenAI', { exact: true }).filter({ visible: true }).last().click()
  const configName = add.getByRole('textbox', { name: '配置名称' })
  assert.equal(await configName.inputValue(), 'OpenAI')
  await configName.fill('生产')
  const keyInput = add.getByLabel(/^API Key/)
  const status = add.getByRole('combobox', { name: '状态', exact: true })
  const secret = add.getByLabel(/^API Secret/)
  const fieldTops = () => Promise.all([configName, preset, status, keyInput, secret].map(field =>
    field.evaluate(el => el.closest('.ant-form-item').getBoundingClientRect().top)))
  const [nameTop, presetTop, statusTop, keyTop, secretTop] = await fieldTops()
  assert.equal(nameTop, presetTop)
  assert.equal(presetTop, statusTop)
  assert.equal(keyTop, secretTop)
  await assertFitsHeight()
  await page.setViewportSize({ width: 375, height: 812 })
  await page.waitForFunction(() => document.querySelector('#provider-editor-drawer')?.getBoundingClientRect().width === 375)
  await add.screenshot({ path: output + '/provider-create-narrow.png', animations: 'disabled' })
  assert.equal(await add.evaluate(el => el.scrollWidth <= el.clientWidth), true)
  assert.ok(await drawerBody.evaluate(el => el.scrollWidth <= el.clientWidth))
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  const narrowTops = await fieldTops()
  assert.ok(narrowTops.every((top, i) => i === 0 || top > narrowTops[i - 1]))
  for (const [name, hints] of [['API Key', ['调用时必需', '请勿分享密钥']], ['API Secret', ['调用时必需']]]) {
    const label = add.locator('label').filter({ hasText: name })
    const labelBox = await label.boundingBox()
    for (const hint of hints) {
      const hintBox = await label.getByText(hint, { exact: true }).boundingBox()
      assert.ok(hintBox.y >= labelBox.y && hintBox.y + hintBox.height <= labelBox.y + labelBox.height + 1)
      assert.ok(hintBox.x + hintBox.width <= 375)
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await keyInput.fill('fixture-key')
  await preset.press('ArrowDown')
  await page.getByText('Vidu', { exact: true }).filter({ visible: true }).last().click()
  const confirm = page.getByRole('dialog').filter({ hasText: '切换供应商？' })
  await confirm.getByRole('button', { name: /取\s*消/ }).click()
  await confirm.waitFor({ state: 'hidden' })
  assert.equal(await keyInput.inputValue(), 'fixture-key')
  await preset.press('ArrowDown')
  await page.getByText('Vidu', { exact: true }).filter({ visible: true }).last().click()
  await confirm.getByRole('button', { name: /切\s*换/ }).click()
  assert.equal(await configName.inputValue(), '生产')
  assert.equal(await keyInput.inputValue(), '')
  assert.equal(await add.getByLabel('文本/通用 Base URL').inputValue(), 'https://two.example/v1')
  await add.getByRole('button', { name: '返回' }).click()
  const discard = page.getByRole('dialog', { name: '放弃未保存的修改？' })
  await page.setViewportSize({ width: 375, height: 812 })
  await discard.getByRole('button', { name: '继续编辑' }).and(page.locator(':focus')).waitFor()
  const confirmBox = await discard.boundingBox()
  assert.ok(confirmBox.x >= 16 && confirmBox.x + confirmBox.width <= 359)
  await discard.screenshot({ path: output + '/discard-narrow.png', animations: 'disabled' })
  await discard.getByRole('button', { name: '继续编辑' }).click()
  await discard.waitFor({ state: 'hidden' })
  assert.equal(await configName.inputValue(), '生产')
  await page.setViewportSize({ width: 1440, height: 900 })
  await Promise.all([
    page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/providers')),
    add.getByRole('button', { name: /创\s*建/ }).click(),
  ])
  await add.waitFor({ state: 'hidden' })
  const name = page.getByRole('button', { name: provider.name, exact: true })
  assert.equal(await page.getByRole('button', { name: `编辑 ${provider.name}`, exact: true }).count(), 0)
  assert.equal(credentialsReads, 0)
  await name.focus()
  await page.keyboard.press('Enter')
  const edit = page.getByRole('dialog', { name: '编辑供应商' })
  const back = edit.getByRole('button', { name: '返回' })
  await back.waitFor()
  assert.equal(await edit.getByRole('textbox', { name: '配置名称' }).inputValue(), provider.name)
  await back.press('Escape')
  await edit.waitFor({ state: 'hidden' })
  await name.and(page.locator(':focus')).waitFor()
  const testButton = page.getByRole('button', { name: '测试调用', exact: true })
  await testButton.click()
  const probe = page.getByRole('dialog', { name: '测试调用' })
  const model = probe.getByRole('combobox', { name: '远端模型' })
  const startTest = probe.getByRole('button', { name: /^测\s*试$/ })
  const feeNotice = '本次测试会向供应商发起真实调用，可能产生费用。'
  const feeConfirm = page.getByRole('dialog', { name: '确认付费测试？' })
  assert.equal(await probe.evaluate(el => !!el.closest('.ant-popover')), true)
  assert.equal(await probe.getByRole('combobox').count(), 1)
  assert.equal(await page.locator('.ant-popover-title:visible').count(), 0)
  const info = probe.getByRole('button', { name: '调用详情' })
  await info.hover()
  await page.getByRole('tooltip').filter({ hasText: provider.base_url }).last().waitFor()
  assert.equal(await model.evaluate(el => getComputedStyle(el).fontSize), '12px')
  assert.ok((await probe.boundingBox()).width <= 280)
  assert.equal(await startTest.isDisabled(), true)
  assert.equal(await probe.getByText(feeNotice).count(), 0)
  await model.click()
  await page.getByText('remote-model', { exact: true }).last().click()
  await model.fill('manual')
  await model.press('Tab')
  await page.locator('.ant-popover').filter({ has: probe }).screenshot({ path: output + '/provider-test-desktop.png', animations: 'disabled' })
  assert.equal(paidCalls, 0)
  await page.setViewportSize({ width: 390, height: 844 })
  await probe.and(page.locator('.ant-modal')).waitFor()
  const mobileDialog = await probe.elementHandle()
  await startTest.focus()
  await startTest.press('Enter')
  await feeConfirm.getByText(feeNotice).waitFor()
  assert.equal(await feeConfirm.evaluate((el, previous) => el === previous, mobileDialog), true)
  await feeConfirm.getByText(provider.name, { exact: true }).waitFor()
  await feeConfirm.getByText('manual', { exact: true }).waitFor()
  assert.equal(await feeConfirm.evaluate(el => el.scrollWidth <= el.clientWidth), true)
  await feeConfirm.screenshot({ path: output + '/provider-test-confirm-mobile.png', animations: 'disabled' })
  assert.equal(paidCalls, 0)
  await page.keyboard.press('Escape')
  await feeConfirm.waitFor({ state: 'hidden' })
  assert.equal(await model.inputValue(), 'manual')
  assert.equal(await probe.evaluate(el => el.scrollWidth <= el.clientWidth), true)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.locator('.ant-popover').getByRole('dialog', { name: '测试调用' }).waitFor()
  const desktopPanel = await probe.elementHandle()
  await startTest.click()
  assert.equal(await feeConfirm.evaluate((el, previous) => el === previous, desktopPanel), true)
  await feeConfirm.getByRole('button', { name: /返\s*回/ }).click()
  assert.equal(await model.inputValue(), 'manual')
  assert.equal(paidCalls, 0)
  const submitting = page.waitForRequest(request => request.url().endsWith('/test-call'))
  await startTest.click()
  await feeConfirm.getByRole('button', { name: '确认测试' }).click()
  await submitting
  assert.equal(await probe.getByRole('button', { name: /关\s*闭/ }).isDisabled(), true)
  await page.getByRole('columnheader', { name: '凭据配置状态' }).click()
  assert.equal(await probe.isVisible(), true)
  await page.keyboard.press('Escape')
  assert.equal(await probe.isVisible(), true)
  assert.equal(typeof releaseSubmission, 'function')
  releaseSubmission()
  const successIcon = probe.getByRole('button', { name: /调用成功，已收到有效输出/ })
  await successIcon.focus()
  await page.getByRole('tooltip').filter({ hasText: 'HTTP 200' }).last().waitFor()
  assert.equal(paidCalls, 1)
  await probe.getByRole('button', { name: /关\s*闭/ }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await testButton.click()
  assert.equal(await model.inputValue(), 'manual')
  await startTest.click()
  await feeConfirm.getByRole('button', { name: '确认测试' }).click()
  await probe.getByText('请先为此配置填写 API Key').waitFor()
  await probe.getByRole('button', { name: /关\s*闭/ }).click()

  await page.setViewportSize({ width: 1440, height: 900 })
  catalogFails = true
  await testButton.click()
  const listHint = probe.getByText('列表不可用，请手填', { exact: true })
  await listHint.waitFor()
  await model.fill('manual')
  await page.locator('.ant-popover').filter({ has: probe }).screenshot({ path: output + '/provider-test-catalog-failed.png', animations: 'disabled' })
  const hintLayout = await listHint.evaluate(el => {
    const range = document.createRange()
    range.selectNodeContents(el)
    const dialog = el.closest('[role="dialog"]')
    const closeButton = [...dialog.querySelectorAll('button')].find(button => button.textContent.replace(/\s/g, '') === '关闭')
    const end = closeButton.getBoundingClientRect().left
    const text = range.getBoundingClientRect()
    const canvas = document.createElement('canvas').getContext('2d')
    canvas.font = getComputedStyle(el).font
    return { lines: range.getClientRects().length, width: text.width, space: end - text.left,
      fullWidth: canvas.measureText(el.title).width, panelWidth: dialog.closest('.ant-popover').offsetWidth }
  })
  console.log('模型目录提示布局', hintLayout)
  assert.equal(hintLayout.panelWidth, 280)
  assert.equal(hintLayout.lines, 1)
  assert.ok(hintLayout.width > 0 && hintLayout.width < hintLayout.space)
  await probe.getByRole('button', { name: /关\s*闭/ }).click()

  catalogFails = false
  testPrompts = { text: '回复 OK', image: '一个蓝色圆点' }
  await page.reload()
  await testButton.click()
  assert.equal(await model.inputValue(), 'manual')
  await model.fill('remote')
  await page.getByText('remote-model', { exact: true }).last().click()
  const type = probe.getByRole('combobox', { name: '调用类型' })
  await type.press('ArrowDown')
  await page.getByText('图片', { exact: true }).last().click()
  await page.reload()
  await testButton.click()
  assert.equal(await model.inputValue(), 'remote-model')
  await probe.locator('.ant-select-selection-item').filter({ hasText: /^图片$/ }).waitFor()
  listedId = 'other-config'
  await page.reload()
  await testButton.click()
  assert.equal(await model.inputValue(), '')
  assert.equal(await startTest.isDisabled(), true)
  assert.equal(paidCalls, 2)
  listedId = provider.id
  testPrompts = { text: '回复 OK' }
  await page.reload()
  await testButton.click()
  assert.equal(await model.inputValue(), 'remote-model')
  assert.equal(await startTest.isEnabled(), true)
  await probe.getByRole('button', { name: /关\s*闭/ }).click()

  await page.setViewportSize({ width: 1440, height: 900 })
  const description = edit.getByRole('textbox', { name: '描述', exact: true })
  const save = edit.getByRole('button', { name: /保\s*存/ })
  await name.click()
  await save.waitFor()
  await page.waitForFunction(() => document.querySelector('#provider-editor-drawer input[placeholder="AK"]')?.value === 'isolated-key')
  assert.equal(await edit.getByRole('combobox', { name: '供应商', exact: true }).isDisabled(), true)
  await description.fill('临时描述')
  await description.fill(provider.description)
  await back.click()
  await edit.waitFor({ state: 'hidden' })

  await name.click()
  await description.fill('未保存的草稿')
  await description.press('Escape')
  await discard.getByRole('button', { name: '继续编辑' }).click()
  assert.equal(await description.inputValue(), '未保存的草稿')
  await back.click()
  await discard.getByRole('button', { name: '放弃修改' }).click()
  await edit.waitFor({ state: 'hidden' })

  await name.click()
  assert.equal(await description.inputValue(), provider.description)
  await description.fill('更新的供应商描述')
  await save.click()
  await page.getByText('保存供应商失败，请重试').waitFor()
  assert.equal(await description.inputValue(), '更新的供应商描述')
  assert.equal(credentialsReads, 4)
  saveFails = false
  await save.click()
  await edit.waitFor({ state: 'hidden' })

  const search = page.getByRole('textbox', { name: '搜索供应商' })
  listFails = true
  await search.fill('验收')
  await page.getByText('刷新供应商失败，仍显示上次结果').waitFor()
  await name.waitFor()
  assert.equal(await search.inputValue(), '验收')
  listFails = false
  await Promise.all([
    page.waitForResponse(response => response.ok() && new URL(response.url()).searchParams.get('q') === '验收'),
    page.getByRole('button', { name: /重\s*试/ }).click(),
  ])
  await page.getByText('刷新供应商失败，仍显示上次结果').waitFor({ state: 'hidden' })
  assert.equal(lastSearch, '验收')
  await search.fill('没有结果')
  await page.getByText('无匹配结果').waitFor()
  await page.getByRole('button', { name: '清除搜索' }).click()
  await name.waitFor()
  await page.getByText('供应商已更新').waitFor({ state: 'hidden' })

  for (const appearance of ['gradient', 'solid']) {
    for (const [width, height] of [[1440, 900], [1366, 768], [1024, 768], [1023, 768], [375, 812]]) {
      await page.setViewportSize({ width, height })
      await page.screenshot({
        path: width === 1440 || width === 375 ? output + `/providers-${appearance}-${width}.png` : undefined,
        animations: 'disabled',
      })
      assert.equal(await create.evaluate(el => Math.round(el.getBoundingClientRect().height)), width < 1024 ? 36 : 32)
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2))
    }
    if (appearance === 'gradient') {
      await page.getByRole('button', { name: '用户与语言设置' }).click()
      await page.getByRole('menuitemradio', { name: /雾蓝纯色/ }).click()
      assert.equal(await create.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(36, 95, 197)')
    }
  }

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByRole('button', { name: `${provider.name}的更多操作` }).click()
  await page.getByRole('menuitem', { name: /删除/ }).click()
  const confirmation = page.getByRole('dialog').filter({ hasText: `删除供应商「${provider.name}」？` })
  await confirmation.getByText(/关联 2 个模型/).waitFor()
  await confirmation.getByRole('button', { name: /取\s*消/ }).click()
  await confirmation.waitFor({ state: 'hidden' })
  assert.equal(deleteRequests, 0)
  await page.getByRole('button', { name: `${provider.name}的更多操作` }).click()
  await page.getByRole('menuitem', { name: /删除/ }).click()
  listFails = true
  await confirmation.getByRole('button', { name: /删\s*除/ }).click()
  await page.getByText('刷新供应商失败，仍显示上次结果').waitFor()
  assert.equal(await name.count(), 0, '已确认删除的供应商不能因刷新失败恢复到可操作列表')
  listFails = false
  await page.getByRole('button', { name: /重\s*试/ }).click()
  await page.getByText('暂无供应商').waitFor()
  assert.equal(deleteRequests, 1)

  listFails = true
  await page.reload()
  await page.getByText('加载供应商失败', { exact: true }).waitFor()
  assert.equal(await page.getByText('暂无供应商', { exact: true }).count(), 0)
  assert.equal(await page.getByText('共 0 个供应商').count(), 0)
  console.log('供应商管理：主题、视口、编辑入口焦点、编辑重试、删除及数据状态通过。')
} finally {
  await cleanup()
}
