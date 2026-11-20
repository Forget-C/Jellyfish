import { readFile, readdir } from 'node:fs/promises'
import { dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

async function main() {
  const args = process.argv.slice(2)
  if (args.length && (args.length !== 2 || args[0] !== '--manifest')) throw new Error('用法：check-browser-manifest.mjs [--manifest 文件]')
  const path = args[1] ? resolve(args[1]) : fileURLToPath(new URL('./browser-suites.json', import.meta.url))
  const manifest = JSON.parse(await readFile(path, 'utf8'))
  const directory = dirname(path)
  const entries = await readdir(directory, { recursive: true, withFileTypes: true })
  const files = entries.filter(entry => entry.isFile()).map(entry => relative(directory, resolve(entry.parentPath, entry.name)).replaceAll('\\', '/'))
  const object = value => value && typeof value === 'object' && !Array.isArray(value)
  for (const field of ['cases', 'suites', 'excludedFiles', 'nonDefaultCases']) {
    if (!object(manifest[field])) throw new Error(`无效清单字段：${field}`)
  }
  if (!files.includes(manifest.preflight)) throw new Error(`预检文件不存在：${manifest.preflight}`)
  const registered = new Set()
  for (const [name, item] of Object.entries(manifest.cases)) {
    if (!/^[a-z0-9-]+$/.test(name) || typeof item?.file !== 'string' ||
      !/^[a-zA-Z0-9_./-]+\.mjs$/.test(item.file) || item.file.split('/').some(part => !part || part === '.' || part === '..') ||
      !Array.isArray(item.ports) || !item.ports.every(port => Number.isInteger(port) && port > 0 && port < 65536) ||
      !Number.isInteger(item.timeoutMs) || item.timeoutMs <= 0) throw new Error(`无效用例：${name}`)
    if (registered.has(item.file)) throw new Error(`重复登记文件：${item.file}`)
    registered.add(item.file)
  }
  for (const [name, cases] of Object.entries(manifest.suites)) {
    if (!Array.isArray(cases) || !cases.every(item => typeof item === 'string')) throw new Error(`无效套件：${name}`)
  }
  for (const file of registered) {
    if (!files.includes(file)) throw new Error(`用例文件不存在：${file}`)
  }
  const excluded = manifest.excludedFiles || {}
  for (const [file, reason] of Object.entries(excluded)) {
    if (!files.includes(file)) throw new Error(`排除文件不存在：${file}`)
    if (registered.has(file)) throw new Error(`登记与排除冲突：${file}`)
    if (typeof reason !== 'string' || !reason.trim()) throw new Error(`排除理由缺失：${file}`)
  }
  for (const file of files.filter(file => file.endsWith('.browser.mjs')).sort()) {
    if (!registered.has(file) && !Object.hasOwn(excluded, file)) throw new Error(`未登记浏览器文件：${file}`)
  }
  // 与 run-browser.mjs 的默认 all 一致：只执行所有套件的并集。
  const reachable = new Set(Object.values(manifest.suites).flat())
  for (const name of reachable) {
    if (!Object.hasOwn(manifest.cases, name)) throw new Error(`套件引用不存在：${name}`)
  }
  const nonDefault = manifest.nonDefaultCases || {}
  for (const [name, reason] of Object.entries(nonDefault)) {
    if (!Object.hasOwn(manifest.cases, name)) throw new Error(`排除用例不存在：${name}`)
    if (reachable.has(name)) throw new Error(`默认执行与排除冲突：${name}`)
    if (typeof reason !== 'string' || !reason.trim()) throw new Error(`非默认执行理由缺失：${name}`)
  }
  for (const name of Object.keys(manifest.cases)) {
    if (!reachable.has(name) && !Object.hasOwn(nonDefault, name)) throw new Error(`套件不可达：${name}`)
  }
  console.log(`PASS browser manifest (${Object.keys(manifest.cases).length} cases)`)
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
