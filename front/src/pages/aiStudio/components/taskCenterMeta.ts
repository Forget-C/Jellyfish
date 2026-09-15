import { useEffect, useMemo, useRef, useState } from 'react'
import type { NavigateFunction } from 'react-router-dom'
import { StudioChaptersService, type TaskSourceRead } from '../../../services/generated'
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
  if (kind === 'chapter' && projectId) navigateTo = `/projects/${projectId}/chapters/${id}/sequences`
  else if (kind === 'sequence' && projectId && chapterId) {
    const view = task.taskKind === 'directing_design' ? 'design' : task.taskKind === 'image_generation' ? 'visual' : 'shoot'
    const query = new URLSearchParams({ view, task: task.taskId, focus: 'tasks' })
    navigateTo = `/projects/${projectId}/chapters/${chapterId}/sequences/${id}?${query}`
  }
  else if (kind === 'project') navigateTo = `/projects/${id}`
  else if (kind === 'character' && projectId) navigateTo = `/projects/${projectId}/roles/${id}/edit`
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
      navigateTo: `/projects/${chapter.project_id}/chapters/${chapter.id}/sequences`,
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
            onNavigate: meta.navigateTo ? () => navigate(meta.navigateTo!) : null,
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
    [metaMap, navigate, tasks],
  )
}
