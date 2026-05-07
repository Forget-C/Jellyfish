import { StudioImageTasksService } from '../../../services/generated'
import { StudioEntitiesApi } from '../../../services/studioEntities'
import { extractTaskIdFromApiEnvelope } from '../components/taskActionHelpers'
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
    deleteImageSlot: async (id: string, imageId: number) => {
      await StudioEntitiesApi.deleteImage('character', id, imageId)
    },
    updateImage: async (id: string, imageId: number, payload) => {
      await StudioEntitiesApi.updateImage('character', id, imageId, normalizeUpdateImagePayload(payload))
    },
    renderPrompt: async (id: string, imageId: number) => {
      const res = await StudioImageTasksService.renderCharacterImagePromptApiV1StudioImageTasksCharactersCharacterIdRenderPromptPost({
        characterId: id,
        requestBody: { image_id: imageId, model_id: null } as any,
      })
      const data = res.data
      return {
        prompt: (data?.prompt ?? '') as string,
        images: (data?.images ?? []) as string[],
      }
    },
    createGenerationTask: async (id: string, imageId: number, payload: { prompt: string; images: string[] }) => {
      const res = await StudioImageTasksService.createCharacterImageGenerationTaskApiV1StudioImageTasksCharactersCharacterIdImageTasksPost({
        characterId: id,
        requestBody: { image_id: imageId, model_id: null, prompt: payload.prompt, images: payload.images } as any,
      })
      return extractTaskIdFromApiEnvelope(res)
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
    deleteImageSlot: async (id: string, imageId: number) => {
      await StudioEntitiesApi.deleteImage('actor', id, imageId)
    },
    updateImage: async (id: string, imageId: number, payload) => {
      await StudioEntitiesApi.updateImage('actor', id, imageId, normalizeUpdateImagePayload(payload))
    },
    renderPrompt: async (id: string, imageId: number) => {
      const res = await StudioImageTasksService.renderActorImagePromptApiV1StudioImageTasksActorsActorIdRenderPromptPost({
        actorId: id,
        requestBody: { image_id: imageId, model_id: null } as any,
      })
      const data = res.data
      return {
        prompt: (data?.prompt ?? '') as string,
        images: (data?.images ?? []) as string[],
      }
    },
    createGenerationTask: async (id: string, imageId: number, payload: { prompt: string; images: string[] }) => {
      const res = await StudioImageTasksService.createActorImageGenerationTaskApiV1StudioImageTasksActorsActorIdImageTasksPost({
        actorId: id,
        requestBody: { image_id: imageId, model_id: null, prompt: payload.prompt, images: payload.images } as any,
      })
      return extractTaskIdFromApiEnvelope(res)
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
    deleteImageSlot: async (id: string, imageId: number) => {
      await StudioEntitiesApi.deleteImage('scene', id, imageId)
    },
    updateImage: async (id: string, imageId: number, payload) => {
      await StudioEntitiesApi.updateImage('scene', id, imageId, normalizeUpdateImagePayload(payload))
    },
    renderPrompt: async (id: string, imageId: number) => {
      const res = await StudioImageTasksService.renderAssetImagePromptApiV1StudioImageTasksAssetsAssetTypeAssetIdRenderPromptPost({
        assetType: 'scene',
        assetId: id,
        requestBody: { image_id: imageId, model_id: null } as any,
      })
      const data = res.data
      return {
        prompt: (data?.prompt ?? '') as string,
        images: (data?.images ?? []) as string[],
      }
    },
    createGenerationTask: async (id: string, imageId: number, payload: { prompt: string; images: string[] }) => {
      const res = await StudioImageTasksService.createAssetImageGenerationTaskApiV1StudioImageTasksAssetsAssetTypeAssetIdImageTasksPost({
        assetType: 'scene',
        assetId: id,
        requestBody: { image_id: imageId, prompt: payload.prompt, images: payload.images } as any,
      })
      return extractTaskIdFromApiEnvelope(res)
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
    deleteImageSlot: async (id: string, imageId: number) => {
      await StudioEntitiesApi.deleteImage('prop', id, imageId)
    },
    updateImage: async (id: string, imageId: number, payload) => {
      await StudioEntitiesApi.updateImage('prop', id, imageId, normalizeUpdateImagePayload(payload))
    },
    renderPrompt: async (id: string, imageId: number) => {
      const res = await StudioImageTasksService.renderAssetImagePromptApiV1StudioImageTasksAssetsAssetTypeAssetIdRenderPromptPost({
        assetType: 'prop',
        assetId: id,
        requestBody: { image_id: imageId, model_id: null } as any,
      })
      const data = res.data
      return {
        prompt: (data?.prompt ?? '') as string,
        images: (data?.images ?? []) as string[],
      }
    },
    createGenerationTask: async (id: string, imageId: number, payload: { prompt: string; images: string[] }) => {
      const res = await StudioImageTasksService.createAssetImageGenerationTaskApiV1StudioImageTasksAssetsAssetTypeAssetIdImageTasksPost({
        assetType: 'prop',
        assetId: id,
        requestBody: { image_id: imageId, prompt: payload.prompt, images: payload.images } as any,
      })
      return extractTaskIdFromApiEnvelope(res)
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
    deleteImageSlot: async (id: string, imageId: number) => {
      await StudioEntitiesApi.deleteImage('costume', id, imageId)
    },
    updateImage: async (id: string, imageId: number, payload) => {
      await StudioEntitiesApi.updateImage('costume', id, imageId, normalizeUpdateImagePayload(payload))
    },
    renderPrompt: async (id: string, imageId: number) => {
      const res = await StudioImageTasksService.renderAssetImagePromptApiV1StudioImageTasksAssetsAssetTypeAssetIdRenderPromptPost({
        assetType: 'costume',
        assetId: id,
        requestBody: { image_id: imageId, model_id: null } as any,
      })
      const data = res.data
      return {
        prompt: (data?.prompt ?? '') as string,
        images: (data?.images ?? []) as string[],
      }
    },
    createGenerationTask: async (id: string, imageId: number, payload: { prompt: string; images: string[] }) => {
      const res = await StudioImageTasksService.createAssetImageGenerationTaskApiV1StudioImageTasksAssetsAssetTypeAssetIdImageTasksPost({
        assetType: 'costume',
        assetId: id,
        requestBody: { image_id: imageId, prompt: payload.prompt, images: payload.images } as any,
      })
      return extractTaskIdFromApiEnvelope(res)
    },
  } satisfies AdapterConfig<any, any>,
}
