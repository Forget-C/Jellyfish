import { useEffect, useState, useCallback, useRef } from 'react'
import { chapters as mockChapters, type Project, type Chapter as MockChapter } from '../../../../../mocks/data'
import { StudioChaptersService, StudioProjectsService } from '../../../../../services/generated'
import type { ChapterRead, ProjectRead, ProjectUpdate } from '../../../../../services/generated'
import { StudioEntitiesApi } from '../../../../../services/studioEntities'

const useMock = import.meta.env.VITE_USE_MOCK === 'true'

function newId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

export type Chapter = Omit<MockChapter, 'sequenceCount'> & {
  rawText?: string
  sequenceCount?: number
}

function toUIChapter(c: ChapterRead): Chapter {
  return {
    id: c.id,
    projectId: c.project_id,
    index: c.index,
    title: c.title,
    summary: c.summary ?? '',
    rawText: c.raw_text ?? undefined,
    sequenceCount: c.sequence_count,
    status: c.status ?? 'draft',
    updatedAt: new Date().toISOString(),
  }
}

export function useProject(projectId: string | undefined) {
  const [project, setProject] = useState<ProjectRead | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const pendingSave = useRef(false)

  useEffect(() => {
    let active = true
    setProject(null)
    setLoading(true)
    async function load() {
      try {
        if (!projectId) return
        const response = await StudioProjectsService.getProjectApiV1StudioProjectsProjectIdGet({ projectId })
        if (active) setProject(response.data ?? null)
      } catch {
        if (active) setProject(null)
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => { active = false }
  }, [projectId])

  // 持有设置页的保存锁，切换项目内页签时仍由同一个工作台处理返回结果。
  async function saveProject(values: ProjectUpdate) {
    if (!projectId || pendingSave.current) return false
    pendingSave.current = true
    setSaving(true)
    try {
      const response = await StudioProjectsService.updateProjectApiV1StudioProjectsProjectIdPatch({
        projectId,
        requestBody: values,
      })
      const updated = response.data
      if (updated?.id !== projectId) throw new Error('未能确认保存结果，请重试')
      setProject(current => current?.id === updated.id ? updated : current)
      return true
    } finally {
      pendingSave.current = false
      setSaving(false)
    }
  }

  return { project, loading, saving, saveProject }
}

/** 按服务端分页读取章节；迟到响应不覆盖新查询，读取失败与空列表分别表达。 */
export function useChapters(projectId: string | undefined, { page = 1, pageSize = 100, query = '' } = {}) {
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState('')
  const request = useRef(0)

  const load = useCallback(async () => {
    const identity = ++request.current
    if (!projectId) {
      setChapters([])
      setTotal(0)
      setLoading(false)
      return
    }
    setLoading(true); setError('')
    try {
      if (useMock) {
        const items = mockChapters.filter(c => c.projectId === projectId && `${c.title} ${c.summary}`.includes(query))
        setChapters(items.slice((page - 1) * pageSize, page * pageSize)); setTotal(items.length)
      } else {
        const res = await StudioChaptersService.listChaptersApiV1StudioChaptersGet({
          projectId, page, pageSize, q: query || undefined,
        })
        if (!res.data) throw new Error('章节列表读取失败')
        if (identity === request.current) {
          setChapters(res.data.items.map(toUIChapter)); setTotal(res.data.pagination?.total ?? res.data.items.length)
        }
      }
    } catch {
      if (identity === request.current) { setChapters([]); setError('章节列表读取失败，请重试') }
    } finally {
      if (identity === request.current) setLoading(false)
    }
  }, [projectId, page, pageSize, query])

  useEffect(() => {
    void load()
    return () => { request.current++ }
  }, [load])

  return { chapters, loading, total, error, refresh: load }
}

export function useProjectCharacters(projectId: string | undefined) {
  const [characters, setCharacters] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!projectId) {
      setCharacters([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const res = await StudioEntitiesApi.list('character', {
        page: 1,
        pageSize: 100,
        q: null,
      })
      const items = (res.data?.items ?? []).filter((x) => x.project_id === projectId)
      setCharacters(items)
    } catch {
      setCharacters([])
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    void load()
  }, [load])

  return { characters, loading, refresh: load }
}

export { newId }
export type { Project }
