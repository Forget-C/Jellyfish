import { useEffect, useMemo, useRef, useState } from 'react'
import type { NavigateFunction } from 'react-router-dom'
import { StudioChaptersService, StudioShotsService } from '../../../services/generated'
import { StudioEntitiesApi } from '../../../services/studioEntities'
import { getChapterShotsPath, getChapterStudioPath } from '../project/ProjectWorkbench/routes'
import type { TaskUiItem } from './taskUiStore'
import { resolveRelationTypeLabel } from './taskCopy'

type ResolvedTaskMeta = {
  sourceLabel?: string | null
  navigateTo?: string | null
}

const CHAPTER_RELATION_TYPES = new Set([
  'chapter_division',
  'script_extraction',
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

const SHOT_RELATION_TYPES = new Set([
  'video',
  'shot_first_frame_prompt',
  'shot_last_frame_prompt',
  'shot_key_frame_prompt',
])

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
      sourceLabel: chapter.title ? `章节：${chapter.title}` : '章节：名称读取中',
      navigateTo: getChapterShotsPath(chapter.project_id, chapter.id),
    }
  }

  if (relationType && relationEntityId && (SHOT_RELATION_TYPES.has(relationType) || relationType === 'shot')) {
    const shotRes = await StudioShotsService.getShotApiV1StudioShotsShotIdGet({
      shotId: relationEntityId,
    })
    const shot = shotRes.data
    if (!shot) return null
    const chapterRes = await StudioChaptersService.getChapterApiV1StudioChaptersChapterIdGet({
      chapterId: shot.chapter_id,
    })
    const chapter = chapterRes.data
    if (!chapter) {
      return {
        sourceLabel: shot.title ? `镜头：${shot.title}` : '镜头：名称读取中',
        navigateTo: null,
      }
    }
    return {
      sourceLabel: shot.title ? `镜头：${shot.title}（第 ${shot.index} 镜）` : '镜头：名称读取中',
      navigateTo: getChapterStudioPath(chapter.project_id, chapter.id),
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
        sourceLabel: name ? `${labelPrefix}：${name}` : `${labelPrefix}：名称读取中`,
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
        sourceLabel: `${resolveRelationTypeLabel(relationType)}：名称读取中`,
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
        sourceLabel: name ? `${labelPrefix}：${name}` : `${labelPrefix}：名称读取中`,
        navigateTo: buildPath(assetId),
      }
    } catch {
      return {
        sourceLabel: '关联对象：名称读取中',
        navigateTo: buildPath(assetId),
      }
    }
  }

  return null
}

export function useResolvedTaskCenterTasks(
  tasks: TaskUiItem[],
  navigate: NavigateFunction,
): TaskUiItem[] {
  const [metaMap, setMetaMap] = useState<Record<string, ResolvedTaskMeta>>({})
  const loadingKeysRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false

    tasks.forEach((task) => {
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
          if (cancelled || !meta) return
          setMetaMap((current) => ({
            ...current,
            [key]: meta,
          }))
        })
        .finally(() => {
          loadingKeysRef.current.delete(key)
        })
    })

    return () => {
      cancelled = true
    }
  }, [metaMap, tasks])

  return useMemo(
    () =>
      tasks.map((task) => {
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
