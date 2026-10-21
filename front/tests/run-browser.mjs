import { spawn } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import net from 'node:net'

const front = fileURLToPath(new URL('..', import.meta.url))
const args = process.argv.slice(2)
let interrupted
const stop = (child, signal = 'SIGTERM') => {
  try { if (process.platform === 'win32') child.kill(signal); else process.kill(-child.pid, signal) } catch (error) { if (error.code !== 'ESRCH') throw error }
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { interrupted = signal })
const option = name => {
  const index = args.indexOf(name)
  if (index < 0) return undefined
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} 需要参数`)
  args.splice(index, 2)
  return value
}
const freePort = port => new Promise((accept, reject) => {
  const server = net.createServer()
  server.once('error', error => reject(new Error(`端口 ${port} 已占用或不可监听：${error.message}`)))
  server.listen(port, '127.0.0.1', () => server.close(accept))
})

async function main() {
  const manifestPath = resolve(option('--manifest') || join(front, 'tests/browser-suites.json'))
  const requestedOutput = option('--output')
  const list = args.includes('--list')
  if (list) args.splice(args.indexOf('--list'), 1)
  if (args.length > 1 || args.some(arg => arg.startsWith('--'))) throw new Error('用法：run-browser.mjs [all|套件|用例] [--list] [--manifest 文件] [--output 目录]')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const selection = args[0] || 'all'
  const names = selection === 'all' ? [...new Set(Object.values(manifest.suites).flat())]
    : manifest.suites[selection] || (manifest.cases[selection] ? [selection] : undefined)
  if (!names?.length || typeof manifest.preflight !== 'string') throw new Error(`未知或无效套件：${selection}`)
  const cases = names.map(name => {
    const item = manifest.cases[name]
    if (!/^[a-z0-9-]+$/.test(name) || typeof item?.file !== 'string' || !Array.isArray(item.ports) ||
      !item.ports.every(port => Number.isInteger(port) && port > 0 && port < 65536) || !Number.isInteger(item.timeoutMs) || item.timeoutMs <= 0) throw new Error(`无效用例：${name}`)
    return { name, ...item }
  })
  if (list) { console.log(JSON.stringify(cases, null, 2)); return }
  await mkdir(join(front, 'test-results'), { recursive: true })
  const output = requestedOutput ? resolve(requestedOutput) : await mkdtemp(join(front, 'test-results/browser-'))
  await mkdir(output, { recursive: true })
  if ((await readdir(output)).length) throw new Error(`证据目录非空，请使用新目录：${output}`)
  const results = []
  const run = async (name, file, ports, timeoutMs) => {
    const directory = join(output, name)
    await mkdir(directory, { recursive: true })
    const log = join(directory, 'run.log')
    await writeFile(log, '')
    const start = Date.now()
    try {
      if (interrupted) throw new Error(`已中断：${interrupted}`)
      for (const port of ports) await freePort(port)
      const code = await new Promise((accept, reject) => {
        const child = spawn(process.execPath, [resolve(dirname(manifestPath), file)], {
          cwd: front, env: { ...process.env, JELLYFISH_BROWSER_OUTPUT: directory }, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
        })
        let expired = false, force, stopping = false
        const terminate = () => {
          if (stopping) return
          stopping = true
          stop(child)
          force = setTimeout(() => {
            try { stop(child, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') appendFileSync(log, error.message) }
          }, 5000)
        }
        const timer = setTimeout(() => { expired = true; terminate() }, timeoutMs)
        const abort = () => terminate()
        process.once('SIGINT', abort); process.once('SIGTERM', abort)
        const finish = () => {
          clearTimeout(timer); clearTimeout(force)
          // 用例退出后兜底清理同组后代，包括崩溃后关闭了输出管道的子进程。
          stop(child, 'SIGKILL')
          process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort)
        }
        child.stdout.on('data', data => appendFileSync(log, data))
        child.stderr.on('data', data => appendFileSync(log, data))
        child.once('error', error => { finish(); reject(error) })
        child.once('close', code => { finish(); if (expired || interrupted) reject(new Error(expired ? `超时（${timeoutMs}ms）` : `已中断：${interrupted}`)); else accept(code) })
      })
      if (code !== 0) throw new Error(`进程退出码 ${code}`)
      results.push({ name, status: 'passed', durationMs: Date.now() - start, directory })
      console.log(`PASS ${name} (${((Date.now() - start) / 1000).toFixed(1)}s)`)
    } catch (error) {
      results.push({ name, status: 'failed', durationMs: Date.now() - start, directory, error: error.message })
      const tail = (await readFile(log, 'utf8')).slice(-4000)
      throw new Error(`${name}：${error.message}\n${tail}\n日志：${log}`)
    } finally { await writeFile(join(output, 'results.json'), JSON.stringify(results, null, 2) + '\n') }
  }
  console.log(`证据目录：${output}`)
  await run('preflight', manifest.preflight, [], 60000)
  for (const item of cases) await run(item.name, item.file, item.ports, item.timeoutMs)
}
main().catch(error => { console.error(error.message); process.exitCode = interrupted === 'SIGINT' ? 130 : interrupted === 'SIGTERM' ? 143 : 1 })
