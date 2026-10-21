import { ESLint } from 'eslint'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

async function main() {
  const args = process.argv.slice(2)
  const index = args.indexOf('--root')
  if (index >= 0 && (!args[index + 1] || args[index + 1].startsWith('--'))) throw new Error('--root 需要目录')
  const root = index < 0 ? fileURLToPath(new URL('..', import.meta.url)) : resolve(args.splice(index, 2)[1] || '')
  if (args.length > 1 || args.some(arg => !['--init', '--prune'].includes(arg))) throw new Error('用法：lint-baseline.mjs [--root 目录] [--init|--prune]')
  const mode = args[0]
  const path = join(root, 'eslint-baseline.json')
  const results = await new ESLint({ cwd: root, extensions: ['.ts', '.tsx'] }).lintFiles(['.'])
  const current = new Map(), locations = new Map()
  for (const result of results) {
    const lines = result.messages.length ? (await readFile(result.filePath, 'utf8')).split(/\r?\n/) : []
    for (const message of result.messages) {
      if (message.fatal) throw new Error(`${relative(root, result.filePath)}:${message.line} ${message.message}`)
      const entry = { file: relative(root, result.filePath).replaceAll('\\', '/'), rule: message.ruleId, severity: message.severity,
        fingerprint: createHash('sha256').update(`${message.message}\n${lines[message.line - 1]?.trim() || ''}`).digest('hex') }
      const key = JSON.stringify(entry)
      current.set(key, (current.get(key) || 0) + 1)
      locations.set(key, `${entry.file}:${message.line}:${message.column} ${message.ruleId} ${message.message}`)
    }
  }
  const entries = [...current].sort(([a], [b]) => a.localeCompare(b)).map(([key, count]) => ({ ...JSON.parse(key), count }))
  const serialized = JSON.stringify({ schema: 1, entries }, null, 2) + '\n'
  if (mode === '--init') {
    await writeFile(path, serialized, { flag: 'wx' })
    console.log(`已建立 lint 存量基线：${[...current.values()].reduce((sum, count) => sum + count, 0)} 项；文件已存在时不会覆盖。`)
    return
  }
  const baseline = JSON.parse(await readFile(path, 'utf8'))
  if (baseline.schema !== 1 || !Array.isArray(baseline.entries)) throw new Error('lint 基线格式无效')
  const known = new Map(baseline.entries.map(({ count, ...entry }) => {
    if (!Number.isInteger(count) || count <= 0) throw new Error('lint 基线计数无效')
    return [JSON.stringify(entry), count]
  }))
  const introduced = [...current].filter(([key, count]) => count > (known.get(key) || 0))
  if (introduced.length) throw new Error(`新增 lint 问题（基线不会接纳）：\n${introduced.slice(0, 20).map(([key]) => locations.get(key)).join('\n')}`)
  const resolved = [...known].reduce((sum, [key, count]) => sum + Math.max(0, count - (current.get(key) || 0)), 0)
  if (mode === '--prune') await writeFile(path, serialized)
  else if (resolved) throw new Error(`已修复 ${resolved} 项旧问题；请运行 pnpm --dir front run lint:baseline 收缩基线。`)
  console.log(`PASS lint 存量基线：${[...current.values()].reduce((sum, count) => sum + count, 0)} 项已知问题，0 项新增${mode === '--prune' ? `，移除 ${resolved} 项` : ''}`)
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
