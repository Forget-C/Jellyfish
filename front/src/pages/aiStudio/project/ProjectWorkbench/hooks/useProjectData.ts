import { useEffect, useState, useCallback, useRef } from 'react'
import { projects as mockProjects, chapters as mockChapters, type Project, type Chapter as MockChapter } from '../../../../../mocks/data'
import { StudioChaptersService, StudioProjectsService } from '../../../../../services/generated'
import type { ChapterRead, ProjectRead } from '../../../../../services/generated'
import { StudioEntitiesApi } from '../../../../../services/studioEntities'

const useMock = import.meta.env.VITE_USE_MOCK === 'true'

function newId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

function toUIProject(p: ProjectRead): Project {
  const stats = (p.stats ?? {}) as Record<string, unknown>
  const getNum = (key: string) => {
    const v = stats[key]
    return typeof v === 'number' && Number.isFinite(v) ? v : 0
  }
  const updatedAt =
    (typeof stats.updated_at === 'string' && stats.updated_at) ||
    (typeof stats.updatedAt === 'string' && stats.updatedAt) ||
    new Date().toISOString()
  return {
    id: p.id,
    name: p.name,
    description: p.description ?? '',
    style: (p.style as Project['style']) ?? '现实主义',
    seed: p.seed ?? 0,
    unifyStyle: p.unify_style ?? true,
    progress: p.progress ?? 0,
    stats: {
      chapters: getNum('chapters'),
      roles: getNum('roles'),
      scenes: getNum('scenes'),
      props: getNum('props'),
    },
    updatedAt,
  }
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
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!projectId) {
      setProject(null)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      if (useMock) {
        setProject(mockProjects.find((p) => p.id === projectId) ?? null)
      } else {
        const res = await StudioProjectsService.getProjectApiV1StudioProjectsProjectIdGet({ projectId })
        const p = res.data ?? null
        setProject(p ? toUIProject(p) : null)
      }
    } catch {
      setProject(useMock ? mockProjects.find((p) => p.id === projectId) ?? null : null)
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    void load()
  }, [load])

  return { project, loading, refresh: load }
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
