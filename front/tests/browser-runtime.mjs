import { appendFileSync } from 'node:fs'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { once } from 'node:events'

/** 统一入口分配证据目录；直接运行单文件时保留原有临时目录。 */
export async function browserOutput(prefix) {
  if (!process.env.JELLYFISH_BROWSER_OUTPUT) return mkdtemp(join(tmpdir(), prefix))
  const output = resolve(process.env.JELLYFISH_BROWSER_OUTPUT)
  await mkdir(output, { recursive: true })
  return output
}

/** 后端完整日志保留在证据中，不依赖失败分支是否打印内存日志。 */
export function captureBackend(backend, output) {
  for (const stream of [backend.stdout, backend.stderr]) stream.on('data', data => appendFileSync(join(output, 'backend.log'), data))
}

/** 正常完成、失败和中断共用同一清理；浏览器可能有独立进程组，先显式关闭。 */
export function browserCleanup(resources) {
  let pending
  const cleanup = () => pending ||= (async () => {
    const { browser, server, backend } = resources()
    try { await browser?.close() }
    finally {
      try { await server?.close() }
      finally {
        if (backend?.pid && backend.exitCode === null && backend.signalCode === null) {
          const closed = once(backend, 'close')
          backend.kill('SIGTERM')
          await closed
        }
      }
    }
  })()
  for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) process.once(signal, async () => {
    try { await cleanup() } finally { process.exit(code) }
  })
  return cleanup
}
