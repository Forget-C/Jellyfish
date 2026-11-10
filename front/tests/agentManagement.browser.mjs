import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { browserCleanup, browserOutput } from './browser-runtime.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-agent-management-')
const origin = 'http://127.0.0.1:4636'
const server = await createServer({ root, server: { host: '127.0.0.1', port: 4636, strictPort: true, open: false } })
let browser
let listFails = true
let agents = [{ id: 'agent1', name: '验收 Agent', type: 'plot', description: '供隔离验收使用的 Agent 简介', isDefault: false, version: '1.0', createdBy: '验收用户', updatedBy: '验收用户' }]
let createFails = true
let updateFails = true
let deleteFails = true
let createRequests = 0
const deletedIds = []
let nextListGate
let releaseStale
const cleanup = browserCleanup(() => ({ browser, server }))
try {
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1440, height: 900 } })
  page.setDefaultTimeout(6000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: location.origin } })
  await page.route('**/api/**', async route => {
    const { pathname } = new URL(route.request().url())
    const method = route.request().method()
    const fail = () => route.fulfill({ status: 500, json: { message: '隔离请求失败' } })
    if (pathname === '/api/agents' && method === 'GET') {
      if (nextListGate) {
        const snapshot = structuredClone(agents)
        const gate = nextListGate
        nextListGate = undefined
        await gate
        return route.fulfill({ json: snapshot })
      }
      return listFails ? fail() : route.fulfill({ json: agents })
    }
    if (pathname === '/api/agents' && method === 'POST') {
      createRequests += 1
      const body = route.request().postDataJSON()
      assert.deepEqual(body, { name: '新角色 Agent', type: 'character', description: '保持输入' })
      if (createFails) return fail()
      const created = { ...agents[0], ...body, id: 'created-agent' }
      agents.push(created)
      return route.fulfill({ json: created })
    }
    if (pathname.startsWith('/api/agents/')) {
      const id = pathname.split('/').at(-1)
      const agent = agents.find(item => item.id === id)
      if (method === 'PUT') {
        assert.deepEqual(route.request().postDataJSON(), { isDefault: true })
        if (updateFails) return fail()
        for (const item of agents) if (item.type === agent.type) item.isDefault = item.id === id
      }
      if (method === 'DELETE') {
        deletedIds.push(id)
        if (deleteFails && id === 'created-agent') return fail()
        agents = agents.filter(item => item.id !== id)
        return route.fulfill({ json: null })
      }
      return route.fulfill({ json: agent })
    }
    return route.fulfill({ json: { code: 200, data: { items: [], next_cursor: null } } })
  })
  await page.goto(origin + '/agents')
  await page.getByRole('alert').filter({ hasText: '无法读取 Agent 列表' }).waitFor()
  assert.equal(await page.getByText(/暂无 Agent|总计 0|已加载 0/).count(), 0)
  listFails = false
  await page.getByRole('button', { name: /重\s*试/ }).click()
  await page.getByText('已加载 1 项', { exact: true }).waitFor()
  await page.getByRole('link', { name: '验收 Agent', exact: true }).waitFor()
  const name = page.getByRole('link', { name: '验收 Agent', exact: true })
  const row = page.getByRole('row').filter({ has: name })
  assert.deepEqual(await page.getByRole('columnheader').allTextContents(), ['名称', '类型', '默认', '简介', '更新时间', '操作'])
  assert.equal(await row.getByRole('cell').nth(4).innerText(), '—')
  assert.equal(await page.getByRole('tab').count(), 0)
  await name.focus()
  await page.keyboard.press('Enter')
  await page.waitForURL(origin + '/agents/agent1/edit')
  await page.goto(origin + '/agents')
  await row.getByRole('button', { name: /测\s*试/ }).click()
  await page.waitForURL(origin + '/agents/agent1/edit?test=1')
  await page.goto(origin + '/agents')
  await name.waitFor()

  const search = page.getByRole('textbox', { name: '搜索 Agent' })
  await search.fill('不存在')
  await page.getByText('无匹配结果', { exact: true }).waitFor()
  await page.getByRole('button', { name: '清除筛选', exact: true }).click()
  await page.getByRole('button', { name: '类型筛选', exact: true }).click()
  const filters = page.getByRole('dialog').filter({ hasText: '类型筛选' })
  await filters.getByText('角色提取 (0)', { exact: true }).click()
  await filters.getByRole('button', { name: 'Close' }).click()
  await page.getByText('无匹配结果', { exact: true }).waitFor()
  await page.getByRole('button', { name: '清除筛选', exact: true }).click()
  await search.fill('验收')
  listFails = true
  await page.getByRole('button', { name: '刷新 Agent' }).click()
  await page.getByRole('alert').filter({ hasText: '刷新 Agent 列表失败' }).waitFor()
  await name.waitFor()
  assert.equal(await search.inputValue(), '验收')
  listFails = false
  await page.getByRole('button', { name: /重\s*试/ }).click()
  await page.getByRole('alert').waitFor({ state: 'hidden' })
  await search.fill('')

  await row.getByRole('button', { name: '更多操作：验收 Agent' }).click()
  assert.equal(await page.getByRole('menuitem', { name: '复制（暂未接入）' }).getAttribute('aria-disabled'), 'true')
  await page.getByRole('menuitem', { name: '设为默认', exact: true }).click()
  const defaultDialog = page.getByRole('dialog').filter({ hasText: '替换当前剧情提取类型的默认 Agent' })
  await defaultDialog.getByRole('button', { name: '设为默认', exact: true }).click()
  await page.getByText('设置失败，请重试').waitFor()
  updateFails = false
  await defaultDialog.getByRole('button', { name: /取\s*消/ }).click()
  await defaultDialog.waitFor({ state: 'hidden' })
  nextListGate = new Promise(resolve => { releaseStale = resolve })
  await page.getByRole('button', { name: '刷新 Agent' }).click()
  await row.getByRole('button', { name: '更多操作：验收 Agent' }).press('Enter')
  await page.getByRole('menuitem', { name: '设为默认', exact: true }).click()
  listFails = true
  await defaultDialog.getByRole('button', { name: '设为默认', exact: true }).click()
  await defaultDialog.waitFor({ state: 'hidden' })
  await row.getByText('默认', { exact: true }).waitFor()
  const stale = page.waitForResponse(response => response.url().endsWith('/api/agents') && response.ok())
  releaseStale()
  await stale
  await page.getByRole('alert').filter({ hasText: '刷新 Agent 列表失败' }).waitFor()
  await row.getByText('默认', { exact: true }).waitFor()
  listFails = false

  await page.getByRole('button', { name: '创建新 Agent', exact: true }).click()
  const create = page.getByRole('dialog', { name: '创建新 Agent', exact: true })
  await create.getByRole('textbox', { name: '名称', exact: true }).fill('新角色 Agent')
  await create.getByRole('radio', { name: '角色提取', exact: true }).check()
  await create.getByRole('textbox', { name: '描述（选填）', exact: true }).fill('保持输入')
  await create.getByRole('button', { name: /创\s*建/, exact: true }).click()
  await page.getByText('创建失败，请重试').waitFor()
  assert.equal(await create.getByRole('textbox', { name: '名称', exact: true }).inputValue(), '新角色 Agent')
  createFails = false
  await create.getByRole('button', { name: /创\s*建/, exact: true }).click()
  await page.waitForURL(origin + '/agents/created-agent/edit')
  assert.equal(createRequests, 2)
  await page.goto(origin + '/agents')
  await page.getByText('已加载 2 项', { exact: true }).waitFor()

  const longName = '用于验证长名称展示与完整提示的 Agent 名称'.repeat(4)
  agents.push(...Array.from({ length: 22 }, (_, index) => ({ ...agents[0], id: `extra${index}`, name: index === 0 ? longName : `额外 Agent ${index}`, isDefault: false, updatedAt: '2026-11-10' })))
  await page.getByRole('button', { name: '刷新 Agent' }).click()
  await page.getByText('已加载 24 项', { exact: true }).waitFor()
  await page.getByRole('link', { name: longName, exact: true }).waitFor()
  assert.equal(await page.getByRole('link', { name: longName, exact: true }).getAttribute('title'), longName)
  await page.getByTitle('2', { exact: true }).click()
  await name.waitFor()
  await page.getByTitle('1', { exact: true }).click()

  for (const appearance of ['gradient', 'solid']) {
    for (const [width, height] of [[1440, 900], [1366, 768], [1024, 768], [1023, 768], [375, 812]]) {
      await page.setViewportSize({ width, height })
      const newAgent = page.getByRole('button', { name: '创建新 Agent', exact: true })
      await page.waitForFunction(({ element, height }) => Math.round(element.getBoundingClientRect().height) === height, { element: await newAgent.elementHandle(), height: width < 1024 ? 36 : 32 })
      assert.equal(await newAgent.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(36, 95, 197)')
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2))
      if (width === 1440 || width === 375) await page.screenshot({ path: `${output}/agents-${appearance}-${width}.png`, animations: 'disabled' })
    }
    if (appearance === 'gradient') {
      await page.getByRole('button', { name: '用户与语言设置' }).click()
      await page.getByRole('menuitemradio', { name: /雾蓝纯色/ }).click()
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  agents = agents.filter(agent => !agent.id.startsWith('extra'))
  await page.getByRole('button', { name: '刷新 Agent' }).click()
  await page.getByText('已加载 2 项', { exact: true }).waitFor()
  await row.getByRole('button', { name: '更多操作：验收 Agent' }).click()
  await page.getByRole('menuitem', { name: /删\s*除/, exact: true }).click()
  const singleDelete = page.getByRole('dialog').filter({ hasText: '删除 Agent' })
  await singleDelete.getByText('验收 Agent', { exact: true }).waitFor()
  await singleDelete.getByRole('button', { name: /取\s*消/, exact: true }).click()
  assert.equal(deletedIds.length, 0)
  await page.getByRole('button', { name: '排序与管理' }).click()
  await page.getByRole('menuitem', { name: '名称排序' }).click()
  await page.getByRole('button', { name: '排序与管理' }).click()
  await page.getByRole('menuitem', { name: '批量管理', exact: true }).click()
  await page.getByRole('checkbox', { name: '选择 验收 Agent', exact: true }).check()
  await page.getByRole('checkbox', { name: '选择 新角色 Agent', exact: true }).check()
  await page.getByText('已选 2 项', { exact: true }).waitFor()
  nextListGate = new Promise(resolve => { releaseStale = resolve })
  await page.getByRole('button', { name: '刷新 Agent' }).click()
  await page.getByRole('button', { name: '批量删除', exact: true }).click()
  const deletion = page.getByRole('dialog').filter({ hasText: '批量删除 Agent' })
  await deletion.getByText('验收 Agent', { exact: true }).waitFor()
  await deletion.getByText('新角色 Agent', { exact: true }).waitFor()
  await deletion.getByRole('button', { name: /删\s*除/, exact: true }).click()
  await page.getByText('删除未完成，已保留未删除对象，请重试').waitFor()
  await page.getByText('已选 1 项', { exact: true }).waitFor()
  await deletion.getByText('确定删除以下 1 个 Agent？此操作无法撤销。', { exact: true }).waitFor()
  assert.equal(await deletion.getByText('验收 Agent', { exact: true }).count(), 0)
  const staleDelete = page.waitForResponse(response => response.url().endsWith('/api/agents') && response.ok())
  releaseStale()
  await staleDelete
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  assert.equal(await row.count(), 0, '旧列表响应不能恢复已确认删除的对象')
  deleteFails = false
  await deletion.getByRole('button', { name: /删\s*除/, exact: true }).click()
  await deletion.waitFor({ state: 'hidden' })
  await page.getByText('暂无 Agent', { exact: true }).waitFor()
  assert.deepEqual(deletedIds, ['agent1', 'created-agent', 'created-agent'])
  await page.getByText('已加载 0 项', { exact: true }).waitFor()
  console.log(`Agent management checks passed: ${output}`)
} finally {
  releaseStale?.()
  await cleanup()
}
