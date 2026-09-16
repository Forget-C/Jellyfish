import type { Source, SourceRead } from '../../../services/generated'

/** 来源身份包含可选文件和真实区间；字段顺序不影响去重。 */
export const sourceKey = (source: Source) => JSON.stringify([source.kind, source.reference, source.version, source.file_id ?? null, source.media_range?.source_in_ms ?? null, source.media_range?.source_out_ms ?? null])

/** 同一场次按微任务合批，失败可重试；响应必须与请求的完整来源身份一致。 */
export function createSourceResolver(fetch: (sources: Source[]) => Promise<SourceRead[]>) {
  const cache = new Map<string, Promise<SourceRead>>()
  let queue: Array<{ source: Source; resolve: (row: SourceRead) => void; reject: (error: Error) => void }> = []
  const flush = async () => {
    const pending = queue; queue = []
    for (let offset = 0; offset < pending.length; offset += 100) {
      const batch = pending.slice(offset, offset + 100)
      try {
        const rows = await fetch(batch.map(item => item.source))
        for (const item of batch) {
          const matches = rows.filter(row => sourceKey(row.source) === sourceKey(item.source))
          if (matches.length !== 1) { cache.delete(sourceKey(item.source)); item.reject(new Error('来源查询未返回可核对的记录')) } else item.resolve(matches[0])
        }
      } catch (error) {
        for (const item of batch) { cache.delete(sourceKey(item.source)); item.reject(error instanceof Error ? error : new Error('来源查询失败')) }
      }
    }
  }
  return (source: Source) => {
    const key = sourceKey(source), existing = cache.get(key)
    if (existing) return existing
    const request = new Promise<SourceRead>((resolve, reject) => {
      queue.push({ source, resolve, reject })
      if (queue.length === 1) queueMicrotask(() => { void flush() })
    })
    cache.set(key, request)
    return request
  }
}
