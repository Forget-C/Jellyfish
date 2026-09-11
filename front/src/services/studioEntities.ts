import { StudioEntitiesService } from './generated'
import type { ActorCreate, CharacterCreate, SceneCreate, PropCreate, CostumeCreate } from './generated'

type EntityType = 'actor' | 'character' | 'scene' | 'prop' | 'costume'

export const StudioEntitiesApi = {
  list(entityType: EntityType, params: { q?: string | null; page?: number; pageSize?: number; order?: string | null; isDesc?: boolean }) {
    return StudioEntitiesService.listEntitiesApiV1StudioEntitiesEntityTypeGet({
      entityType,
      q: params.q ?? null,
      page: params.page ?? 1,
      pageSize: params.pageSize ?? 10,
      order: params.order ?? null,
      isDesc: params.isDesc ?? false,
    })
  },
  get(entityType: EntityType, entityId: string) {
    return StudioEntitiesService.getEntityApiV1StudioEntitiesEntityTypeEntityIdGet({
      entityType,
      entityId,
    })
  },
  create(entityType: EntityType, payload: Record<string, unknown>) {
    return StudioEntitiesService.createEntityApiV1StudioEntitiesEntityTypePost({
      entityType,
      requestBody: payload as ActorCreate | CharacterCreate | SceneCreate | PropCreate | CostumeCreate,
    })
  },
  update(entityType: EntityType, entityId: string, payload: Record<string, unknown>) {
    return StudioEntitiesService.updateEntityApiV1StudioEntitiesEntityTypeEntityIdPatch({
      entityType,
      entityId,
      requestBody: payload,
    })
  },
  remove(entityType: EntityType, entityId: string) {
    return StudioEntitiesService.deleteEntityApiV1StudioEntitiesEntityTypeEntityIdDelete({
      entityType,
      entityId,
    })
  },
  listImages(entityType: EntityType, entityId: string, params: { page?: number; pageSize?: number; order?: string | null; isDesc?: boolean }) {
    return StudioEntitiesService.listEntityImagesApiV1StudioEntitiesEntityTypeEntityIdImagesGet({
      entityType,
      entityId,
      page: params.page ?? 1,
      pageSize: params.pageSize ?? 10,
      order: params.order ?? null,
      isDesc: params.isDesc ?? false,
    })
  },
  createImage(entityType: EntityType, entityId: string, payload: Record<string, unknown>) {
    return StudioEntitiesService.createEntityImageApiV1StudioEntitiesEntityTypeEntityIdImagesPost({
      entityType,
      entityId,
      requestBody: payload,
    })
  },
  updateImage(entityType: EntityType, entityId: string, imageId: number, payload: Record<string, unknown>) {
    return StudioEntitiesService.updateEntityImageApiV1StudioEntitiesEntityTypeEntityIdImagesImageIdPatch({
      entityType,
      entityId,
      imageId,
      requestBody: payload,
    })
  },
  deleteImage(entityType: EntityType, entityId: string, imageId: number) {
    return StudioEntitiesService.deleteEntityImageApiV1StudioEntitiesEntityTypeEntityIdImagesImageIdDelete({
      entityType,
      entityId,
      imageId,
    })
  },
}

