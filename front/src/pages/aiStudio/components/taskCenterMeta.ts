import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, type NavigateFunction } from 'react-router-dom'
import { StudioChaptersService, type TaskSourceRead } from '../../../services/generated'
import { workbenchManagementLocation } from '../directing/chapterNavigation'
import { generationCanvasLocation } from '../generationCanvas/navigation'
import { StudioEntitiesApi } from '../../../services/studioEntities'
import type { TaskUiItem } from './taskUiStore'

type ResolvedTaskMeta = {
  sourceLabel?: string | null
  navigateTo?: string | null
}

/** 将服务端已验证的轻量来源映射为页面入口，不再逐条请求业务详情。 */
function sourceMeta(source: TaskSourceRead | null | undefined, task: TaskUiItem): ResolvedTaskMeta {
  if (!source) return {}
  const { kind, id, project_id: projectId, chapter_id: chapterId } = source
  let navigateTo: string | null = null
  if (kind === 'chapter' && projectId) navigateTo = workbenchManagementLocation(projectId, id, undefined, 'division')
  else if (kind === 'sequence' && projectId && chapterId && task.taskKind === 'directing_object_extract') {
    navigateTo = workbenchManagementLocation(projectId, chapterId, id, 'objects', { objectTask: task.taskId })
  }
  else if (kind === 'sequence' && projectId && chapterId && task.taskKind === 'directing_storyboard') {
    navigateTo = workbenchManagementLocation(projectId, chapterId, id, 'storyboard', { storyboardTask: task.taskId })
  }
  else if (kind === 'sequence' && projectId && chapterId) {
    const view = task.taskKind === 'directing_design' ? 'design' : task.taskKind === 'image_generation' ? 'visual' : 'shoot'
    const query = new URLSearchParams({ view, task: task.taskId, focus: 'tasks' })
    if (task.taskKind === 'scene_export' && source.version_id) {
      query.set('version', source.version_id); query.set('exportVersion', source.version_id); query.set('exportTask', task.taskId); query.set('view', 'cut')
    }
    if (task.taskKind === 'directing_unit_design' && source.version_id) {
      query.set('version', source.version_id); query.set('unitDesignTask', task.taskId); query.set('view', 'units')
      if (source.shot_id) query.set('directorShot', source.shot_id)
    }
    const historyKind = task.taskKind === 'directing_instruction' ? 'instructions' : task.taskKind === 'directing_instruction_check' ? 'checks' : task.taskKind === 'directing_design' ? 'design' : task.taskKind === 'video_generation' && source.unit_id ? 'videos' : undefined
    if (historyKind && source.version_id) {
      query.set('version', source.version_id)
      query.set('sceneTask', task.taskId)
      query.set('taskVersion', source.version_id)
      query.set('taskKind', historyKind)
      if (source.unit_id) query.set('taskUnit', source.unit_id)
    }
    navigateTo = `/projects/${projectId}/chapters/${chapterId}/sequences/${id}?${query}`
  }
  else if (kind === 'project') navigateTo = `/projects/${id}`
  else if (kind === 'character' && projectId) navigateTo = `/projects/${projectId}/roles/${id}/edit`
  else if (kind === 'generation_canvas' && projectId && source.canvas_id) {
    const query = new URLSearchParams({ canvas: source.canvas_id })
    if (source.run_id) query.set('run', source.run_id)
    if (source.node_id) query.set('node', source.node_id)
    if (source.check_card_id) query.set('check', source.check_card_id)
    if (source.check_report_id) query.set('report', source.check_report_id)
    navigateTo = generationCanvasLocation(projectId, query)
  }
  else if (kind === 'experiment_session') navigateTo = `/lab?session=${encodeURIComponent(id)}`
  else navigateTo = ASSET_EDIT_PATH_BUILDERS[`${kind}_image`]?.(id) ?? null
  return { sourceLabel: source.title, navigateTo }
}

const CHAPTER_RELATION_TYPES = new Set([
  'consistency_check',
  'script_optimization',
  'script_simplification',
])

const ASSET_EDIT_PATH_BUILDERS: Record<string, (id: string) => string> = {
  actor_image: (id) => `/assets/actors/${id}/edit`,
  scene_image: (id) => `/assets/scenes/${id}/edit`,
  prop_image: (id) => `/assets/props/${id}/edit`,
  costume_image: (id) => `/assets/costumes/${id}/edit`,
}

const ASSET_ENTITY_TYPES: Record<string, 'actor' | 'scene' | 'prop' | 'costume'> = {
  actor_image: 'actor',
  scene_image: 'scene',
  prop_image: 'prop',
  costume_image: 'costume',
}

function metaKeyForTask(task: TaskUiItem): string | null {
  if (task.navigateRelationType && task.navigateRelationEntityId) {
    return `${task.navigateRelationType}:${task.navigateRelationEntityId}`
  }
  if (task.relationType && task.relationEntityId) {
    return `${task.relationType}:${task.relationEntityId}`
  }
  return null
}

async function resolveTaskMeta(task: TaskUiItem): Promise<ResolvedTaskMeta | null> {
  const relationType = task.navigateRelationType ?? task.relationType
  const relationEntityId = task.navigateRelationEntityId ?? task.relationEntityId

  if (relationType && relationEntityId && CHAPTER_RELATION_TYPES.has(relationType)) {
    const res = await StudioChaptersService.getChapterApiV1StudioChaptersChapterIdGet({
      chapterId: relationEntityId,
    })
    const chapter = res.data
    if (!chapter) return null
    return {
      sourceLabel: chapter.title ? `章节：${chapter.title}` : `章节：${relationEntityId}`,
      navigateTo: workbenchManagementLocation(chapter.project_id, chapter.id, undefined, 'division'),
    }
  }

  if (relationType && relationEntityId && ['actor', 'scene', 'prop', 'costume', 'character'].includes(relationType)) {
    const entityType = relationType as 'actor' | 'scene' | 'prop' | 'costume' | 'character'
    try {
      const res = await StudioEntitiesApi.get(entityType, relationEntityId)
      const data = res.data as Record<string, unknown> | null
      const name = typeof data?.name === 'string' ? data.name.trim() : ''
      const projectId = typeof data?.project_id === 'string' ? data.project_id.trim() : ''
      const labelPrefix =
        entityType === 'actor'
          ? '演员'
          : entityType === 'scene'
            ? '场景'
            : entityType === 'prop'
              ? '道具'
              : entityType === 'costume'
                ? '服装'
                : '角色'
      const navigateTo =
        entityType === 'character'
          ? projectId
            ? `/projects/${projectId}/roles/${relationEntityId}/edit`
            : null
          : entityType === 'actor'
            ? `/assets/actors/${relationEntityId}/edit`
            : entityType === 'scene'
              ? `/assets/scenes/${relationEntityId}/edit`
              : entityType === 'prop'
                ? `/assets/props/${relationEntityId}/edit`
                : `/assets/costumes/${relationEntityId}/edit`
      return {
        sourceLabel: name ? `${labelPrefix}：${name}` : `${labelPrefix}：${relationEntityId}`,
        navigateTo,
      }
    } catch {
      const navigateTo =
        entityType === 'character'
          ? null
          : entityType === 'actor'
            ? `/assets/actors/${relationEntityId}/edit`
            : entityType === 'scene'
              ? `/assets/scenes/${relationEntityId}/edit`
              : entityType === 'prop'
                ? `/assets/props/${relationEntityId}/edit`
                : `/assets/costumes/${relationEntityId}/edit`
      return {
        sourceLabel: `${relationType}：${relationEntityId}`,
        navigateTo,
      }
    }
  }

  if (relationEntityId?.includes(':')) {
    const [assetRelationType, assetId] = relationEntityId.split(':', 2)
    const entityType = ASSET_ENTITY_TYPES[assetRelationType]
    const buildPath = ASSET_EDIT_PATH_BUILDERS[assetRelationType]
    if (!entityType || !buildPath || !assetId) return null

    try {
      const res = await StudioEntitiesApi.get(entityType, assetId)
      const data = res.data as Record<string, unknown> | null
      const name = typeof data?.name === 'string' ? data.name.trim() : ''
      const labelPrefix =
        entityType === 'actor'
          ? '演员'
          : entityType === 'scene'
            ? '场景'
            : entityType === 'prop'
              ? '道具'
              : '服装'
      return {
        sourceLabel: name ? `${labelPrefix}：${name}` : `${labelPrefix}：${assetId}`,
        navigateTo: buildPath(assetId),
      }
    } catch {
      return {
        sourceLabel: `${assetRelationType}：${assetId}`,
        navigateTo: buildPath(assetId),
      }
    }
  }

  return null
}

/** 按来源复用导航信息，单项解析完成不会丢弃同批其他请求的结果。 */
export function useResolvedTaskCenterTasks(
  tasks: TaskUiItem[],
  navigate: NavigateFunction,
): TaskUiItem[] {
  const location = useLocation()
  const [metaMap, setMetaMap] = useState<Record<string, ResolvedTaskMeta>>({})
  const loadingKeysRef = useRef<Set<string>>(new Set())

  const mountedRef = useRef(false)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {

    tasks.forEach((task) => {
      if (task.sourceResolved) return
      const effectiveRelationType = task.navigateRelationType ?? task.relationType
      const effectiveRelationEntityId = task.navigateRelationEntityId ?? task.relationEntityId
      if ((task.sourceLabel && task.onNavigate) || !effectiveRelationType || !effectiveRelationEntityId) {
        return
      }
      const key = metaKeyForTask(task)
      if (!key || metaMap[key] || loadingKeysRef.current.has(key)) return
      loadingKeysRef.current.add(key)
      void resolveTaskMeta(task)
        .then((meta) => {
          if (!mountedRef.current) return
          setMetaMap((current) => ({
            ...current,
            [key]: meta ?? {},
          }))
        })
        .catch(() => {
          // 来源已删除或暂时不可用时保留任务历史，不产生未处理异常或重复请求循环。
          if (mountedRef.current) setMetaMap((current) => ({ ...current, [key]: {} }))
        })
        .finally(() => {
          loadingKeysRef.current.delete(key)
        })
    })

  }, [metaMap, tasks])

  return useMemo(
    () =>
      tasks.map((task) => {
        if (task.sourceResolved) {
          const meta = sourceMeta(task.source, task)
          return {
            ...task,
            sourceLabel: meta.sourceLabel ?? null,
            onNavigate: meta.navigateTo ? () => {
              const target = new URL(meta.navigateTo!, window.location.origin)
              if (task.taskKind === 'scene_export' && task.source?.version_id && target.pathname === location.pathname) {
                const query = new URLSearchParams(location.search)
                for (const key of ['sceneTask', 'taskVersion', 'taskKind', 'taskUnit']) query.delete(key)
                query.set('exportVersion', task.source.version_id)
                query.set('exportTask', task.taskId)
                navigate(`${location.pathname}?${query}`)
              } else if (target.searchParams.has('sceneTask') && target.pathname === location.pathname) {
                const query = new URLSearchParams(location.search)
                for (const key of ['exportTask', 'exportVersion', 'sceneTask', 'taskVersion', 'taskKind', 'taskUnit']) query.delete(key)
                for (const key of ['sceneTask', 'taskVersion', 'taskKind', 'taskUnit']) {
                  const value = target.searchParams.get(key)
                  if (value) query.set(key, value)
                }
                navigate(`${location.pathname}?${query}`)
              } else navigate(meta.navigateTo!)
            } : null,
          }
        }
        const key = metaKeyForTask(task)
        const meta = key ? metaMap[key] : undefined
        return {
          ...task,
          sourceLabel: task.sourceLabel ?? meta?.sourceLabel ?? null,
          onNavigate:
            task.onNavigate ??
            (meta?.navigateTo
              ? () => {
                  navigate(meta.navigateTo!)
                }
              : null),
        }
      }),
    [metaMap, navigate, tasks, location.pathname, location.search],
  )
}
