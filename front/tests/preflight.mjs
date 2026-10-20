import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// 在载入 Vite/Playwright 前检查版本，让旧运行时得到可操作的错误。
if (Number(process.versions.node.split('.')[0]) < 20) {
  console.error(`测试环境预检失败：Node.js ${process.versions.node}；需要 20+，CI 版本见 front/.node-version。`)
  process.exit(1)
}
const backend = spawnSync('uv', ['run', '--no-sync', 'python', '-m', 'tests.preflight', '--media'], {
  cwd: fileURLToPath(new URL('../../backend', import.meta.url)),
  env: { ...process.env, UV_CACHE_DIR: process.env.UV_CACHE_DIR || '/tmp/jellyfish-uv-cache' },
  encoding: 'utf8', timeout: 30000,
})
if (backend.status !== 0) {
  console.error(`测试环境预检失败：uv/Python（${backend.error?.message || backend.stderr.trim() || `exit ${backend.status}`}）`)
  process.exit(1)
}
process.stdout.write(backend.stdout)
try {
  await import('vite')
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL, timeout: 15000 })
  await browser.close()
} catch (error) {
  console.error(`测试环境预检失败：前端依赖或 Chromium：${error.message}`)
  console.error('请安装前端依赖与 Playwright Chromium，或设置 PLAYWRIGHT_CHANNEL=chrome 使用本机 Chrome。')
  process.exit(1)
}
console.log(`PASS Node.js ${process.versions.node}、前端依赖与 Chromium`)
