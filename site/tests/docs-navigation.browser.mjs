// Run against both the current checkout and a clean prefixed build, setting SITE_BASE_URL.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const { chromium } = createRequire(new URL('../../front/package.json', import.meta.url))('playwright')
const base = process.env.SITE_BASE_URL || 'http://localhost:1313/'
const groups = {
  安装与配置: ['准备安装环境', '启动并检查服务', '配置生成模型'],
  制作第一场戏: ['创建项目与第一章', '从原文划分场次', '为本场选参考图', '生成分镜与查看候选画面'],
  独立工具与任务: ['管理资产图片', '使用生成实验室', '使用生成画布', '查看与处理任务'],
  开发与贡献: ['开发快速开始', '参与贡献'],
}
const bookmarks = [
  ['guide/sequence-workflow', '为场次准备对象参考', '为本场选参考图', '为场次准备对象参考'],
  ['guide/sequence-workflow', '使用旧版场次记录', '从原文划分场次', '查看或恢复历史划分'],
  ['guide/sequence-workflow', '从设计进入拍摄', '生成分镜与查看候选画面', '在工作台生成和编辑分镜'],
  ['guide/sequence-workflow', '审片采用和剪辑', '生成分镜与查看候选画面', '预览分镜生成的候选图'],
  ['guide/sequence-workflow', '用于章节和整场导出', '生成分镜与查看候选画面', '预览分镜生成的候选图'],
  ['guide/chapter-and-scene-versions', '管理旧版场次版本', '从原文划分场次', '查看或恢复历史划分'],
  ['guide/sequence-asset-to-shoot', '', '为本场选参考图', ''],
  ['guide/sequence-asset-to-shoot', '指令与拍摄', '生成分镜与查看候选画面', '在工作台生成和编辑分镜'],
  ['legacy/versions', '管理旧版场次版本', '从原文划分场次', '查看或恢复历史划分'],
  ['legacy/edit-delivery', '用于章节和整场导出', '生成分镜与查看候选画面', '预览分镜生成的候选图'],
  ['legacy', '', '制作第一场戏', ''],
  ['legacy/versions', '', '从原文划分场次', ''],
  ['legacy/edit-delivery', '', '生成分镜与查看候选画面', ''],
]

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL })
try {
  for (const width of [1440, 375]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    const menu = page.locator('aside.hextra-sidebar-container')
    const mobile = width < 768
    const openMenu = async () => {
      const toggle = page.getByRole('button', { name: '菜单', exact: true })
      if (mobile && await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click()
    }

    await page.goto(base)
    await openMenu()
    await page.getByRole('link', { name: '文档', exact: true }).filter({ visible: true }).first().click()
    await page.getByRole('heading', { name: '文档中心', exact: true }).waitFor()
    for (const [group, titles] of Object.entries(groups)) {
      await openMenu()
      await menu.getByRole('link', { name: group, exact: true }).filter({ visible: true }).click()
      for (const title of titles) {
        await openMenu()
        const link = menu.getByRole('link', { name: title, exact: true }).filter({ visible: true })
        await link.click()
        await page.getByRole('heading', { level: 1, name: title, exact: true }).waitFor()
        const crumb = page.locator('#content > div').first()
        assert.deepEqual(await crumb.locator('a').allTextContents(), ['文档中心', group], title)
        assert.ok((await crumb.innerText()).endsWith(title))
        await openMenu()
        const names = (await menu.locator('a:visible').allTextContents()).map(s => s.trim())
        assert.ok(!names.includes('旧版场次工作台'), '目录仅列出现行工作区')
        assert.deepEqual(names.filter(name => Object.hasOwn(groups, name)), Object.keys(groups))
        assert.deepEqual(names.filter(name => titles.includes(name)), titles, group)
        assert.deepEqual((await menu.locator('.hextra-sidebar-active-item:visible').allTextContents()).map(s => s.trim()), [title])
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, title)
      }
    }

    await page.goto(new URL('product/workflow/', base).href)
    await page.getByRole('link', { name: '操作指南 · 在工作台生成和编辑分镜' }).click()
    const title = '生成分镜与查看候选画面'
    await page.getByRole('heading', { level: 1, name: title }).waitFor()
    await page.locator('main a[title="为本场选参考图"]').click()
    await page.getByRole('heading', { level: 1, name: '为本场选参考图' }).waitFor()
    await page.locator('main a[title="' + title + '"]').click()
    await page.getByRole('heading', { level: 1, name: title }).waitFor()

    for (const [slug, anchor, destination, target] of bookmarks) {
      await page.goto(new URL('docs/' + slug + '/#' + anchor, base).href)
      await page.getByRole('heading', { name: destination, level: 1, exact: true }).waitFor()
      if (target) {
        await page.waitForURL(url => decodeURIComponent(url.hash.slice(1)) === target)
        assert.ok(await page.locator('h2 [id="' + target + '"]').count(), target)
      }
    }
    assert.deepEqual(errors, [])
    console.log(base, width, 'section menus, all article links, breadcrumbs, pager and bookmarks passed')
    await page.close()
  }
} finally {
  await browser.close()
}
