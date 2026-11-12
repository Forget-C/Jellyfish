import { useCallback, useEffect, useRef, useState } from 'react'
import { StudioFilesService, type FileRead } from '../../../services/generated'
import api from '../../../services/aiStudioApi'

export type FileEntry = Omit<FileRead, 'tags'> & { tags: string[]; createdAt?: string }
export const DEMO_MODE = import.meta.env.VITE_USE_MOCK === 'true'
const normalize = (items: FileRead[]): FileEntry[] => {
  if (!Array.isArray(items) || items.some(file => !file || typeof file.id !== 'string' || !file.id)) throw new Error('文件列表响应无效')
  return items.map(file => ({ ...file, name: typeof file.name === 'string' ? file.name : '', tags: [...new Set((Array.isArray(file.tags) ? file.tags : []).filter(tag => typeof tag === 'string' && tag.trim()))] }))
}

/** Reads bounded search rounds. Refresh commits atomically so failures preserve the old list. */
export function useManagedFiles(query: string, tag: string | undefined, onReset: () => void) {
  const [files, setFiles] = useState<FileEntry[]>([])
  const [tags, setTags] = useState<string[]>([])
  const [total, setTotal] = useState<number>()
  const [scanned, setScanned] = useState(0)
  const [more, setMore] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const cursor = useRef({ page: 0, scanned: 0, more: true })
  const epoch = useRef(0)
  const working = useRef(false)
  const request = useRef<ReturnType<typeof StudioFilesService.listFilesApiApiV1StudioFilesGet>>()
  const reset = useRef(onReset)
  reset.current = onReset
  const filtered = Boolean(query || tag)
  const load = useCallback(async (refresh = false) => {
    if (working.current || (!refresh && !cursor.current.more)) return
    working.current = true
    setBusy(true)
    setError('')
    const generation = epoch.current
    let next = refresh ? { page: 0, scanned: 0, more: true } : { ...cursor.current }
    let collected: FileEntry[] = []
    let matched = 0
    let latestTotal: number | undefined
    try {
      const demo = DEMO_MODE ? normalize(await api.files.list()) : undefined
      for (let round = 0; round < (filtered ? 4 : 1) && next.more; round++) {
        const pending = demo ? undefined : StudioFilesService.listFilesApiApiV1StudioFilesGet({ page: next.page + 1, pageSize: 24, order: 'updated_at', isDesc: true })
        request.current = pending
        const data = demo ? { items: demo.slice(next.page * 24, (next.page + 1) * 24), pagination: { total: demo.length } } : (await pending)?.data
        if (generation !== epoch.current) return
        if (!data) throw new Error('缺少文件列表')
        const items = normalize(data.items)
        latestTotal = data.pagination?.total
        next = { page: next.page + 1, scanned: next.scanned + items.length, more: items.length > 0 && (latestTotal === undefined ? items.length === 24 : (next.page + 1) * 24 < latestTotal) }
        setTags(previous => [...new Set([...previous, ...items.flatMap(file => file.tags)])].sort())
        const pageMatches = items.filter(file => (!query || file.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()) || file.tags.some(value => value.toLocaleLowerCase().includes(query.toLocaleLowerCase()))) && (!tag || file.tags.includes(tag)))
        collected.push(...pageMatches)
        matched += pageMatches.length
        if (!refresh) {
          const matches = collected
          collected = []
          setFiles(previous => [...new Map([...previous, ...matches].map(file => [file.id, file])).values()])
          cursor.current = { ...next }
          setScanned(next.scanned)
          setMore(next.more)
          setTotal(latestTotal)
        }
        if (matched >= 24 || (!refresh && !filtered)) break
      }
      if (refresh) {
        setFiles(collected)
        cursor.current = next
        setScanned(next.scanned)
        setMore(next.more)
        setTotal(latestTotal)
        reset.current()
      }
    } catch {
      if (generation === epoch.current) setError(refresh ? '刷新文件失败，仍显示上次结果' : '读取文件失败')
    } finally {
      if (generation === epoch.current) { working.current = false; setBusy(false) }
    }
  }, [query, tag, filtered])
  useEffect(() => {
    const generation = ++epoch.current
    request.current?.cancel()
    working.current = false
    cursor.current = { page: 0, scanned: 0, more: true }
    setFiles([]); setScanned(0); setTotal(undefined); setMore(true)
    reset.current()
    void load()
    return () => { epoch.current = generation + 1; request.current?.cancel() }
  }, [load])
  return { files, tags, total, scanned, more, busy, error, filtered, load }
}
