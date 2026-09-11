import { StudioGenerationPromptsService, StudioGenerationTasksService } from '../../../services/generated'
import type { AssetPromptAudit, AssetImagePromptRenderBody, GenerationSubmitRequest, RenderedPromptSnapshot } from '../../../services/generated'
import { StudioEntitiesApi } from '../../../services/studioEntities'
import type { AssetEditPageBaseProps, BaseAsset, BaseAssetImage } from './components/AssetEditPageBase'

type AdapterConfig<TAsset extends BaseAsset, TImage extends BaseAssetImage> = Omit<
  AssetEditPageBaseProps<TAsset, TImage>,
  'assetId' | 'onNavigate'
>

type UpdateImagePayload = {
  file_id: string
  width?: number | null
  height?: number | null
  format?: string | null
}

function normalizeUpdateImagePayload(payload: UpdateImagePayload): UpdateImagePayload {
  return {
    ...payload,
    format: payload.format ?? 'png',
  }
}

/**
 * 将旧提示词预览产出的文件标识转换为统一图片任务请求。
 *
 * 预览接口仍负责读取资产事实和渲染提示词；提交阶段只冻结最终提示词与
 * FileItem 标识，避免把可变 URL 或资产目标再次放入请求体。
 */
function createImageGenerationRequest(payload: { prompt: string; images: string[]; saveAsCandidate?: boolean; audit?: AssetPromptAudit }): GenerationSubmitRequest {
  return {
    model_id: null,
    execution_prompt: payload.prompt,
    render_id: payload.audit?.render_id,
    asset_prompt_audit: payload.audit,
    media: {
      references: payload.images
        .filter((fileId) => Boolean(fileId?.trim()))
        .map((fileId, ordinal) => ({ file_id: fileId, media_kind: 'image', ordinal })),
    },
    operation_input: {
      kind: 'image_generation',
      count: 1,
      save_as_candidate: payload.saveAsCandidate ?? false,
    },
  }
}

/**
 * 将统一 Renderer 的快照投影为资产编辑页既有的提示词草稿结构。
 *
 * 资产编辑页保留最终提示词、有序图片标识及审计元数据；提交时携带同一快照，
 * 避免重新解释或遗漏预览中的参考集合。
 */
function projectRenderedAssetPrompt(snapshot: RenderedPromptSnapshot | null | undefined): {
  prompt: string
  images: string[]
  audit?: AssetPromptAudit
} {
  const recommendedMedia = snapshot?.recommended_media
  const references = recommendedMedia && 'references' in recommendedMedia
    ? (recommendedMedia.references ?? [])
    : []
  const fileIds = references.filter((reference) => reference.media_kind === 'image').map((reference) => reference.file_id)
  return {
    audit: snapshot ? {
      render_id: snapshot.render_id, template_id: snapshot.template_id, template_version: snapshot.template_version,
      variables: Object.fromEntries(Object.entries(snapshot.variables_snapshot).filter((entry): entry is [string, string] => typeof entry[1] === 'string')),
      execution_prompt: snapshot.execution_prompt, reference_file_ids: fileIds,
    } : undefined,
    prompt: snapshot?.execution_prompt ?? '',
    images: references
      .filter((reference) => reference.media_kind === 'image')
      .map((reference) => reference.file_id),
  }
}

/**
 * 按已绑定的资产图片槽位渲染提示词。
 *
 * 路径参数固定业务目标，省略参考图集合时由 Renderer 使用槽位的推荐参考图，
 * 从而避免旧图片任务接口重复承担提示词渲染职责。
 */
async function renderAssetImagePrompt(
  assetType: 'actor' | 'character' | 'prop' | 'scene' | 'costume',
  assetId: string,
  slotId: number,
  options: AssetImagePromptRenderBody = {},
): Promise<{ prompt: string; images: string[]; audit?: AssetPromptAudit }> {
  const response = await StudioGenerationPromptsService.renderAssetImagePromptApiV1StudioGenerationPromptsAssetsAssetTypeAssetIdSlotsSlotIdRenderPost({
    assetType,
    assetId,
    slotId,
    requestBody: options,
  })
  return projectRenderedAssetPrompt(response.data)
}

export const assetAdapters = {
  character: {
    missingAssetIdText: '缺少 character_id',
    assetDisplayName: '角色',
    backTo: '/projects',
    relationType: 'character_image',
    getAsset: async (id: string) => {
      const res = await StudioEntitiesApi.get('character', id)
      return (res.data ?? null) as any | null
    },
    updateAsset: async (id: string, payload) => {
      const res = await StudioEntitiesApi.update('character', id, payload as Record<string, unknown>)
      return (res.data ?? null) as any | null
    },
    listImages: async (id: string) => {
      const res = await StudioEntitiesApi.listImages('character', id, { page: 1, pageSize: 100 })
      return (res.data?.items ?? []) as any[]
    },
    createImageSlot: async (id: string, angle) => {
      await StudioEntitiesApi.createImage('character', id, { view_angle: angle })
    },
    updateImage: async (id: string, imageId: number, payload) => {
      await StudioEntitiesApi.updateImage('character', id, imageId, normalizeUpdateImagePayload(payload))
    },
    renderPrompt: async (id: string, imageId: number, options?: AssetImagePromptRenderBody) => {
      return renderAssetImagePrompt('character', id, imageId, options)
    },
    createGenerationTask: async (id: string, imageId: number, payload: { prompt: string; images: string[]; saveAsCandidate?: boolean; audit?: AssetPromptAudit }) => {
      const res = await StudioGenerationTasksService.submitCharacterImageGenerationTaskApiV1StudioGenerationTasksCharactersCharacterIdSlotsSlotIdTasksPost({
        characterId: id,
        slotId: imageId,
        requestBody: createImageGenerationRequest(payload),
      })
      return res.data?.task_id ?? null
    },
  } satisfies AdapterConfig<any, any>,
  actor: {
    missingAssetIdText: '缺少 actor_id',
    assetDisplayName: '演员',
    backTo: '/assets?tab=actor',
    relationType: 'actor_image',
    getAsset: async (id: string) => {
      const res = await StudioEntitiesApi.get('actor', id)
      return (res.data ?? null) as any | null
    },
    updateAsset: async (id: string, payload) => {
      const res = await StudioEntitiesApi.update('actor', id, payload as Record<string, unknown>)
      return (res.data ?? null) as any | null
    },
    listImages: async (id: string) => {
      const res = await StudioEntitiesApi.listImages('actor', id, { page: 1, pageSize: 100 })
      return (res.data?.items ?? []) as any[]
    },
    createImageSlot: async (id: string, angle) => {
      await StudioEntitiesApi.createImage('actor', id, { view_angle: angle })
    },
    updateImage: async (id: string, imageId: number, payload) => {
      await StudioEntitiesApi.updateImage('actor', id, imageId, normalizeUpdateImagePayload(payload))
    },
    renderPrompt: async (id: string, imageId: number, options?: AssetImagePromptRenderBody) => {
      return renderAssetImagePrompt('actor', id, imageId, options)
    },
    createGenerationTask: async (id: string, imageId: number, payload: { prompt: string; images: string[]; saveAsCandidate?: boolean; audit?: AssetPromptAudit }) => {
      const res = await StudioGenerationTasksService.submitActorImageGenerationTaskApiV1StudioGenerationTasksActorsActorIdSlotsSlotIdTasksPost({
        actorId: id,
        slotId: imageId,
        requestBody: createImageGenerationRequest(payload),
      })
      return res.data?.task_id ?? null
    },
  } satisfies AdapterConfig<any, any>,
  scene: {
    missingAssetIdText: '缺少 scene_id',
    assetDisplayName: '场景',
    backTo: '/assets?tab=scene',
    relationType: 'scene_image',
    getAsset: async (id: string) => {
      const res = await StudioEntitiesApi.get('scene', id)
      return (res.data ?? null) as any | null
    },
    updateAsset: async (id: string, payload) => {
      const res = await StudioEntitiesApi.update('scene', id, payload as Record<string, unknown>)
      return (res.data ?? null) as any | null
    },
    listImages: async (id: string) => {
      const res = await StudioEntitiesApi.listImages('scene', id, { page: 1, pageSize: 100 })
      return (res.data?.items ?? []) as any[]
    },
    createImageSlot: async (id: string, angle) => {
      await StudioEntitiesApi.createImage('scene', id, { view_angle: angle })
    },
    updateImage: async (id: string, imageId: number, payload) => {
      await StudioEntitiesApi.updateImage('scene', id, imageId, normalizeUpdateImagePayload(payload))
    },
    renderPrompt: async (id: string, imageId: number, options?: AssetImagePromptRenderBody) => {
      return renderAssetImagePrompt('scene', id, imageId, options)
    },
    createGenerationTask: async (id: string, imageId: number, payload: { prompt: string; images: string[]; saveAsCandidate?: boolean; audit?: AssetPromptAudit }) => {
      const res = await StudioGenerationTasksService.submitAssetImageGenerationTaskApiV1StudioGenerationTasksAssetsAssetTypeAssetIdSlotsSlotIdTasksPost({
        assetType: 'scene',
        assetId: id,
        slotId: imageId,
        requestBody: createImageGenerationRequest(payload),
      })
      return res.data?.task_id ?? null
    },
  } satisfies AdapterConfig<any, any>,
  prop: {
    missingAssetIdText: '缺少 prop_id',
    assetDisplayName: '道具',
    backTo: '/assets?tab=prop',
    relationType: 'prop_image',
    getAsset: async (id: string) => {
      const res = await StudioEntitiesApi.get('prop', id)
      return (res.data ?? null) as any | null
    },
    updateAsset: async (id: string, payload) => {
      const res = await StudioEntitiesApi.update('prop', id, payload as Record<string, unknown>)
      return (res.data ?? null) as any | null
    },
    listImages: async (id: string) => {
      const res = await StudioEntitiesApi.listImages('prop', id, { page: 1, pageSize: 100 })
      return (res.data?.items ?? []) as any[]
    },
    createImageSlot: async (id: string, angle) => {
      await StudioEntitiesApi.createImage('prop', id, { view_angle: angle })
    },
    updateImage: async (id: string, imageId: number, payload) => {
      await StudioEntitiesApi.updateImage('prop', id, imageId, normalizeUpdateImagePayload(payload))
    },
    renderPrompt: async (id: string, imageId: number, options?: AssetImagePromptRenderBody) => {
      return renderAssetImagePrompt('prop', id, imageId, options)
    },
    createGenerationTask: async (id: string, imageId: number, payload: { prompt: string; images: string[]; saveAsCandidate?: boolean; audit?: AssetPromptAudit }) => {
      const res = await StudioGenerationTasksService.submitAssetImageGenerationTaskApiV1StudioGenerationTasksAssetsAssetTypeAssetIdSlotsSlotIdTasksPost({
        assetType: 'prop',
        assetId: id,
        slotId: imageId,
        requestBody: createImageGenerationRequest(payload),
      })
      return res.data?.task_id ?? null
    },
  } satisfies AdapterConfig<any, any>,
  costume: {
    missingAssetIdText: '缺少 costume_id',
    assetDisplayName: '服装',
    backTo: '/assets?tab=costume',
    relationType: 'costume_image',
    getAsset: async (id: string) => {
      const res = await StudioEntitiesApi.get('costume', id)
      return (res.data ?? null) as any | null
    },
    updateAsset: async (id: string, payload) => {
      const res = await StudioEntitiesApi.update('costume', id, payload as Record<string, unknown>)
      return (res.data ?? null) as any | null
    },
    listImages: async (id: string) => {
      const res = await StudioEntitiesApi.listImages('costume', id, { page: 1, pageSize: 100 })
      return (res.data?.items ?? []) as any[]
    },
    createImageSlot: async (id: string, angle) => {
      await StudioEntitiesApi.createImage('costume', id, { view_angle: angle })
    },
    updateImage: async (id: string, imageId: number, payload) => {
      await StudioEntitiesApi.updateImage('costume', id, imageId, normalizeUpdateImagePayload(payload))
    },
    renderPrompt: async (id: string, imageId: number, options?: AssetImagePromptRenderBody) => {
      return renderAssetImagePrompt('costume', id, imageId, options)
    },
    createGenerationTask: async (id: string, imageId: number, payload: { prompt: string; images: string[]; saveAsCandidate?: boolean; audit?: AssetPromptAudit }) => {
      const res = await StudioGenerationTasksService.submitAssetImageGenerationTaskApiV1StudioGenerationTasksAssetsAssetTypeAssetIdSlotsSlotIdTasksPost({
        assetType: 'costume',
        assetId: id,
        slotId: imageId,
        requestBody: createImageGenerationRequest(payload),
      })
      return res.data?.task_id ?? null
    },
  } satisfies AdapterConfig<any, any>,
}
